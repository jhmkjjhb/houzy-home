-- Preserve each incoming transfer and allocate it to a locked contract instalment.
BEGIN;
ALTER TABLE public.renovation_payments ADD COLUMN IF NOT EXISTS installment integer CHECK(installment>=1);
CREATE OR REPLACE FUNCTION public._reno_check_installment_totals(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;r record;cap numeric;
BEGIN
 SELECT * INTO p FROM renovation_projects WHERE id=p_id;
 FOR r IN SELECT installment,
  coalesce(sum(CASE WHEN kind='receipt' THEN amount ELSE -amount END) FILTER(WHERE verified_at IS NOT NULL),0) paid,
  coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0) pending
  FROM renovation_payments WHERE project_id=p_id AND voided_at IS NULL GROUP BY installment
 LOOP
  IF r.installment IS NOT NULL AND r.installment>jsonb_array_length(coalesce(p.snapshot->'payments','[]'::jsonb)) THEN RAISE EXCEPTION '收退款期数不在合同计划内'; END IF;
  cap:=CASE WHEN r.installment IS NULL THEN (p.snapshot->>'net')::numeric ELSE (p.snapshot->'payments'->(r.installment-1)->>'amount')::numeric END;
  IF r.paid<0 THEN RAISE EXCEPTION '该期退款或作废超过已确认收款，请核对收退款所属期数'; END IF;
  IF r.paid+r.pending>cap THEN RAISE EXCEPTION '该期收款超过本期合同应付金额（含待核对现金），请核对期数和进款单金额'; END IF;
 END LOOP;
END;$$;
REVOKE ALL ON FUNCTION public._reno_check_installment_totals(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public._reno_installment_view(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH stages AS (SELECT x.value,x.ordinality::integer AS n,(p.snapshot->>'net')::numeric total
 FROM renovation_projects p CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.snapshot->'payments','[]'::jsonb)) WITH ORDINALITY x WHERE p.id=p_id),
 ledger AS (SELECT installment,coalesce(sum(amount) FILTER(WHERE kind='receipt' AND verified_at IS NOT NULL),0) received,
 coalesce(sum(amount) FILTER(WHERE kind='refund' AND verified_at IS NOT NULL),0) refunded,
 coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0) pending
 FROM renovation_payments WHERE project_id=p_id AND voided_at IS NULL GROUP BY installment)
 SELECT coalesce(jsonb_agg(jsonb_build_object('number',s.n,'name',s.value->>'name','amount',(s.value->>'amount')::numeric,
 'percentage',round((s.value->>'amount')::numeric*100/nullif(s.total,0),2),'received',coalesce(l.received,0),'refunded',coalesce(l.refunded,0),
 'paid',coalesce(l.received,0)-coalesce(l.refunded,0),'pending',coalesce(l.pending,0),
 'balance',(s.value->>'amount')::numeric-coalesce(l.received,0)+coalesce(l.refunded,0)) ORDER BY s.n),'[]'::jsonb)
 FROM stages s LEFT JOIN ledger l ON l.installment=s.n;
$$;
REVOKE ALL ON FUNCTION public._reno_installment_view(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.renovation_payment_command(p_id uuid,p_revision integer,p_action text,p_entry uuid,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;e renovation_payments%ROWTYPE;amt numeric;manager boolean;total numeric;paid numeric;pending numeric;delta numeric;verified boolean;stage integer;previous_stage integer;
BEGIN
 IF auth.uid() IS NULL OR p_entry IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此门店项目权限'; END IF;
 IF p.state='draft' THEN RAISE EXCEPTION '请先确认合同，再登记实际收款'; END IF;
 manager:=_reno_access(p.store_id,p.created_by,true);
 SELECT * INTO e FROM renovation_payments WHERE id=p_entry;
 previous_stage:=e.installment;
 IF p_action IN ('add','assign') THEN
  IF p_data->>'installment' IS NOT NULL THEN
   IF p_data->>'installment' !~ '^[1-9][0-9]{0,2}$' THEN RAISE EXCEPTION '请选择有效合同期数'; END IF;
   stage:=(p_data->>'installment')::integer;
   IF stage>jsonb_array_length(coalesce(p.snapshot->'payments','[]'::jsonb)) THEN RAISE EXCEPTION '所选期数不在合同付款计划内'; END IF;
  END IF;
 ELSE stage:=e.installment;
 END IF;
 -- A retry can safely return the existing record, but cannot reuse another payload.
 IF p_action='add' AND e.id IS NOT NULL THEN
  IF e.project_id=p_id AND e.created_by=auth.uid() AND e.kind=p_data->>'kind' AND e.amount=(p_data->>'amount')::numeric
   AND e.method=p_data->>'method' AND e.paid_on=(p_data->>'paid_on')::date AND e.reference=trim(p_data->>'reference') AND e.note=coalesce(p_data->>'note','') AND e.installment IS NOT DISTINCT FROM stage THEN RETURN to_jsonb(e); END IF;
  RAISE EXCEPTION '收款记录编号已使用，请刷新后核对';
 END IF;
 IF p.revision<>p_revision OR p_revision IS NULL THEN RAISE EXCEPTION '项目已被其他人修改，请刷新后重试'; END IF;
 total:=(p.snapshot->>'net')::numeric;
 SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount ELSE -amount END) FILTER(WHERE verified_at IS NOT NULL),0),coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0)
 INTO paid,pending FROM renovation_payments WHERE project_id=p_id AND voided_at IS NULL;
 IF p_action='add' THEN
  amt:=(p_data->>'amount')::numeric;
  IF amt IS NULL OR amt<=0 OR amt<>round(amt,2) OR amt>999999999999.99 OR (p_data->>'kind') IS NULL OR p_data->>'kind' NOT IN ('receipt','refund')
   OR (p_data->>'method') IS NULL OR p_data->>'method' NOT IN ('bank_transfer','ewallet','card','cash') THEN RAISE EXCEPTION '请填写有效收款类别、方式及两位小数金额'; END IF;
  IF (p_data->>'paid_on')::date IS NULL OR (p_data->>'paid_on')::date>(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date OR NOT isfinite((p_data->>'paid_on')::date) THEN RAISE EXCEPTION '请填写有效收退款日期，不得晚于今天'; END IF;
  IF coalesce(length(trim(p_data->>'reference')),0) NOT BETWEEN 1 AND 200 OR length(coalesce(p_data->>'note',''))>1000 THEN RAISE EXCEPTION '请填写银行参考号或收据编号（最多200字），备注最多1000字'; END IF;
  IF p_data->>'kind'='refund' AND NOT manager THEN RAISE EXCEPTION '退款须由店长或上级登记'; END IF;
  IF p_data->>'kind'='receipt' AND paid+pending+amt>total THEN RAISE EXCEPTION '收款金额超过合同剩余应收（含待核对现金）'; END IF;
  IF p_data->>'kind'='refund' AND amt>paid THEN RAISE EXCEPTION '退款金额超过已确认净收款'; END IF;
  IF EXISTS(SELECT 1 FROM renovation_payments WHERE project_id=p_id AND kind=p_data->>'kind' AND method=p_data->>'method' AND reference=trim(p_data->>'reference') AND voided_at IS NULL) THEN RAISE EXCEPTION '同一参考号或收据编号已登记，请勿重复收款'; END IF;
  verified:=(p_data->>'method'<>'cash' OR manager);
  INSERT INTO renovation_payments(id,project_id,kind,amount,method,paid_on,reference,note,created_by,verified_by,verified_at,installment)
   VALUES(p_entry,p_id,p_data->>'kind',amt,p_data->>'method',(p_data->>'paid_on')::date,trim(p_data->>'reference'),coalesce(p_data->>'note',''),auth.uid(),CASE WHEN verified THEN auth.uid() END,CASE WHEN verified THEN now() END,stage) RETURNING * INTO e;
 ELSIF p_action='assign' THEN
  IF e.id IS NULL OR e.project_id<>p_id OR e.voided_at IS NOT NULL THEN RAISE EXCEPTION '无此有效收退款记录'; END IF;
  IF NOT manager AND e.created_by<>auth.uid() THEN RAISE EXCEPTION '请由原登记员工或店长调整期数'; END IF;
  IF coalesce(length(trim(p_data->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '请填写调整期数的原因'; END IF;
  UPDATE renovation_payments SET installment=stage WHERE id=p_entry RETURNING * INTO e;
 ELSIF p_action IN ('verify','void') THEN
  IF NOT manager THEN RAISE EXCEPTION '核对收款或作废记录须由店长或上级操作'; END IF;
  IF e.id IS NULL OR e.project_id<>p_id OR e.voided_at IS NOT NULL THEN RAISE EXCEPTION '无此有效收款记录'; END IF;
  IF p_action='verify' THEN
   IF e.verified_at IS NOT NULL THEN RAISE EXCEPTION '此笔收款已核对'; END IF;
   IF paid+e.amount>total THEN RAISE EXCEPTION '收款金额超过合同总额'; END IF;
   UPDATE renovation_payments SET verified_by=auth.uid(),verified_at=now() WHERE id=p_entry RETURNING * INTO e;
  ELSE
   IF coalesce(length(trim(p_data->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '请填写作废原因（最多500字）'; END IF;
   delta:=CASE WHEN e.verified_at IS NULL THEN 0 WHEN e.kind='receipt' THEN -e.amount ELSE e.amount END;
   IF paid+delta<0 OR paid+delta+pending-(CASE WHEN e.verified_at IS NULL THEN e.amount ELSE 0 END)>total THEN RAISE EXCEPTION '作废将导致收款余额异常，请先核对后续收退款'; END IF;
   UPDATE renovation_payments SET voided_by=auth.uid(),voided_at=now(),void_reason=trim(p_data->>'reason') WHERE id=p_entry RETURNING * INTO e;
  END IF;
 ELSE RAISE EXCEPTION '不支持的收款操作';
 END IF;
 PERFORM _reno_check_installment_totals(p_id);
 UPDATE renovation_projects SET revision=revision+1,updated_at=now() WHERE id=p_id;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p_id,auth.uid(),'payment_'||p_action,to_jsonb(e)||jsonb_build_object('previous_installment',previous_stage,'assignment_reason',CASE WHEN p_action='assign' THEN p_data->>'reason' END));
 RETURN to_jsonb(e);
END;$$;
REVOKE ALL ON FUNCTION public.renovation_payment_command(uuid,integer,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_payment_command(uuid,integer,text,uuid,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.renovation_payment_view(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;
BEGIN
 SELECT * INTO p FROM renovation_projects WHERE id=p_id;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此门店项目权限'; END IF;
 RETURN jsonb_build_object('summary',_reno_payment_summary(p_id),'installments',_reno_installment_view(p_id),'entries',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC,e.id) FROM renovation_payments e WHERE project_id=p_id),'[]'::jsonb));
END;$$;
REVOKE ALL ON FUNCTION public.renovation_payment_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_payment_view(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.renovation_customer_payment_view(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('summary',_reno_payment_summary(p.id),'installments',_reno_installment_view(p.id),'state',p.state,
 'plan',coalesce(p.snapshot->'payments','[]'::jsonb),'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'installment',e.installment,'kind',e.kind,'amount',e.amount,'method',e.method,'paid_on',e.paid_on,'verified',e.verified_at IS NOT NULL) ORDER BY e.paid_on DESC,e.created_at DESC,e.id)
 FROM renovation_payments e WHERE e.project_id=p.id AND e.voided_at IS NULL),'[]'::jsonb))
 FROM renovation_projects p WHERE p.customer_token=p_token AND p.state<>'draft';
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_payment_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_payment_view(uuid) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
