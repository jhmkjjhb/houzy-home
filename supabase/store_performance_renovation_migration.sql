-- Combined store performance: merchandise receipts + renovation net receipts.
-- Preserve legacy paid flags as a separately disclosed, optional amount.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_store_performance(p_start date DEFAULT NULL,p_end date DEFAULT NULL,p_store uuid DEFAULT NULL,p_include_legacy boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a profiles%ROWTYPE;start_date date;end_date date;rows jsonb;
BEGIN
 SELECT * INTO a FROM profiles WHERE id=auth.uid() AND active=true;
 IF a.id IS NULL OR a.role NOT IN ('staff','store_manager','regional_manager','general_manager','admin','superadmin') THEN RAISE EXCEPTION '请使用门店或管理账号登录'; END IF;
 start_date:=coalesce(p_start,date_trunc('month',now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date);
 end_date:=coalesce(p_end,(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date);
 IF end_date<start_date OR NOT isfinite(start_date) OR NOT isfinite(end_date) THEN RAISE EXCEPTION '统计日期范围无效'; END IF;
 IF p_store IS NOT NULL AND NOT EXISTS(SELECT 1 FROM stores s WHERE s.id=p_store AND
  (a.role IN ('general_manager','admin','superadmin') OR (a.role='regional_manager' AND s.region=a.region) OR (a.role IN ('staff','store_manager') AND s.id=a.store_id))) THEN RAISE EXCEPTION '无此门店业绩查看权限'; END IF;
 WITH allowed_stores AS (SELECT s.id,s.name FROM stores s WHERE (p_store IS NULL OR s.id=p_store) AND
  (a.role IN ('general_manager','admin','superadmin') OR (a.role='regional_manager' AND s.region=a.region) OR (a.role IN ('staff','store_manager') AND s.id=a.store_id))),
 merchandise AS (SELECT o.id,o.store_id,coalesce(nullif(to_jsonb(o)->>'currency',''),'MYR') currency,o.amount,o.created_at,o.payment_status FROM orders o JOIN allowed_stores s ON s.id=o.store_id WHERE a.role<>'staff' OR o.staff_id=a.id),
 projects AS (SELECT p.id,p.store_id FROM renovation_projects p JOIN allowed_stores s ON s.id=p.store_id WHERE a.role<>'staff' OR p.created_by=a.id),
 events AS (
  SELECT o.store_id,o.currency,'goods'::text source,e.amount::numeric amount,
   (coalesce(e.method,'')='cash' AND e.verified_at IS NULL) pending,false legacy,o.id order_id
  FROM merchandise o JOIN order_payments e ON e.order_id=o.id
  WHERE (e.paid_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date BETWEEN start_date AND end_date
   AND nullif(to_jsonb(e)->>'voided_at','') IS NULL
  UNION ALL
  SELECT o.store_id,o.currency,'goods',o.amount::numeric,false,true,o.id FROM merchandise o
  WHERE coalesce(p_include_legacy,true) AND o.payment_status='paid'
   AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date BETWEEN start_date AND end_date
   AND NOT EXISTS(SELECT 1 FROM order_payments e WHERE e.order_id=o.id)
  UNION ALL
  SELECT p.store_id,'MYR','renovation',CASE WHEN e.kind='refund' THEN -e.amount ELSE e.amount END,e.verified_at IS NULL,false,p.id
  FROM projects p JOIN renovation_payments e ON e.project_id=p.id
  WHERE e.voided_at IS NULL AND e.paid_on BETWEEN start_date AND end_date
 ), grouped AS (
  SELECT s.id store_id,s.name store_name,coalesce(e.currency,'MYR') currency,
   coalesce(sum(e.amount) FILTER(WHERE source='goods' AND NOT pending AND NOT legacy AND amount>0),0) merchandise_received,
   -coalesce(sum(e.amount) FILTER(WHERE source='goods' AND NOT pending AND NOT legacy AND amount<0),0) merchandise_refunded,
   coalesce(sum(e.amount) FILTER(WHERE source='goods' AND legacy),0) merchandise_legacy_paid,
   count(*) FILTER(WHERE source='goods' AND legacy) legacy_order_count,
   coalesce(sum(e.amount) FILTER(WHERE source='goods' AND NOT pending),0) merchandise_net_received,
   coalesce(sum(e.amount) FILTER(WHERE source='renovation' AND NOT pending AND amount>0),0) renovation_received,
   -coalesce(sum(e.amount) FILTER(WHERE source='renovation' AND NOT pending AND amount<0),0) renovation_refunded,
   coalesce(sum(e.amount) FILTER(WHERE source='renovation' AND NOT pending),0) renovation_net_received,
   coalesce(sum(e.amount) FILTER(WHERE NOT pending),0) total_net_received,
   coalesce(sum(e.amount) FILTER(WHERE pending AND amount>0),0) pending_cash,
   count(DISTINCT order_id) FILTER(WHERE source='renovation' AND NOT pending) renovation_projects
  FROM allowed_stores s LEFT JOIN events e ON e.store_id=s.id GROUP BY s.id,s.name,e.currency
 ) SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.store_name,g.currency),'[]'::jsonb) INTO rows FROM grouped g;
 RETURN jsonb_build_object('ok',true,'data',rows,'range',jsonb_build_object('start',start_date,'end',end_date),'include_legacy',coalesce(p_include_legacy,true));
END;$$;
REVOKE ALL ON FUNCTION public.get_store_performance(date,date,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_store_performance(date,date,uuid,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
