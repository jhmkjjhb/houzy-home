-- Additional work/material charges are separate from the immutable signed snapshot.
BEGIN;
-- Later migrations redefine functions created here; re-running this file would
-- silently restore older money/permission rules, so refuse once they exist.
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='renovation_additions' AND column_name='signature_status') THEN
 RAISE EXCEPTION '此迁移已被 renovation_addition_signatures_migration.sql 取代，重跑会恢复旧规则，已停止。请按《整装订单上线与验收》的迁移顺序执行。';
END IF; END $guard$;
ALTER TABLE public.renovation_projects ADD COLUMN IF NOT EXISTS additions_total numeric(14,2) NOT NULL DEFAULT 0 CHECK(additions_total>=0);
ALTER TABLE public.renovation_projects ADD COLUMN IF NOT EXISTS current_total numeric GENERATED ALWAYS AS (coalesce((snapshot->>'net')::numeric,0)+additions_total) STORED;
ALTER TABLE public.renovation_projects ADD COLUMN IF NOT EXISTS scope_revision integer NOT NULL DEFAULT 0;
ALTER TABLE public.renovation_work_orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
CREATE TABLE IF NOT EXISTS public.renovation_additions(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES renovation_projects(id),
 category text NOT NULL CHECK(category IN ('work','material')),name text NOT NULL,spec text NOT NULL DEFAULT '',
 qty numeric(16,3) NOT NULL CHECK(qty>0),unit text NOT NULL,rate numeric(14,2) NOT NULL CHECK(rate>0),
 amount numeric(14,2) GENERATED ALWAYS AS (round(qty*rate,2)) STORED,
 group_name text NOT NULL,payment_node text NOT NULL,installment integer NOT NULL CHECK(installment>=1),
 work_order_id uuid NOT NULL REFERENCES renovation_work_orders(id),
 created_by uuid NOT NULL REFERENCES profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 voided_by uuid REFERENCES profiles(id),voided_at timestamptz,void_reason text,
 UNIQUE(project_id,installment),CHECK((voided_by IS NULL)=(voided_at IS NULL))
);
ALTER TABLE public.renovation_additions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renovation_additions FROM anon,authenticated;
GRANT SELECT ON public.renovation_additions TO authenticated;
DROP POLICY IF EXISTS reno_additions_read ON public.renovation_additions;
CREATE POLICY reno_additions_read ON public.renovation_additions FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM renovation_projects p WHERE p.id=project_id AND _reno_access(p.store_id,p.created_by)));
CREATE OR REPLACE FUNCTION public._reno_billing_plan(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(p.snapshot->'payments','[]'::jsonb)||coalesce((SELECT jsonb_agg(jsonb_build_object(
 'name','增项：'||a.name||' · '||a.payment_node,'amount',CASE WHEN a.voided_at IS NULL THEN a.amount ELSE 0 END,
 'original_amount',a.amount,'is_addition',true,'addition_id',a.id,'cancelled',a.voided_at IS NOT NULL) ORDER BY a.installment)
 FROM renovation_additions a WHERE a.project_id=p.id),'[]'::jsonb)
 FROM renovation_projects p WHERE p.id=p_id;
$$;
REVOKE ALL ON FUNCTION public._reno_billing_plan(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public._reno_effective_lines(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(p.snapshot->'lines','[]'::jsonb)||coalesce((SELECT jsonb_agg(jsonb_build_object(
 'id','ADD-'||a.id,'name',CASE a.category WHEN 'work' THEN '【增项工项】' ELSE '【增项材料】' END||a.name,
 'spec',a.spec,'qty',a.qty,'unit',a.unit,'rate',a.rate,'kind',CASE a.category WHEN 'work' THEN 'work' ELSE 'stock' END,
 'group',w.group_name,'is_addition',true,'warranties',jsonb_build_array(jsonb_build_object('component','新增项目：质保范围及期限待核对','years',NULL,'source','增项登记，按双方确认凭证补充'))
 ) ORDER BY a.installment) FROM renovation_additions a JOIN renovation_work_orders w ON w.id=a.work_order_id WHERE a.project_id=p.id AND a.voided_at IS NULL),'[]'::jsonb)
 FROM renovation_projects p WHERE p.id=p_id;
$$;
REVOKE ALL ON FUNCTION public._reno_effective_lines(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.renovation_addition_view(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;
BEGIN
 SELECT * INTO p FROM renovation_projects WHERE id=p_id;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 RETURN jsonb_build_object('original_total',coalesce((p.snapshot->>'net')::numeric,0),'additions_total',p.additions_total,'total',p.current_total,
 'entries',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.installment) FROM renovation_additions a WHERE a.project_id=p.id),'[]'::jsonb),
 'lines',_reno_effective_lines(p.id),'plan',_reno_billing_plan(p.id));
END;$$;
REVOKE ALL ON FUNCTION public.renovation_addition_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_addition_view(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public._reno_payment_summary(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH totals AS (SELECT coalesce(sum(amount) FILTER(WHERE kind='receipt' AND verified_at IS NOT NULL),0) received,
 coalesce(sum(amount) FILTER(WHERE kind='refund' AND verified_at IS NOT NULL),0) refunded,
 coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0) pending,count(*) entries
 FROM public.renovation_payments WHERE project_id=p_id AND voided_at IS NULL),
 amounts AS (SELECT p.current_total total,coalesce((p.snapshot->>'net')::numeric,0) original_total,p.additions_total,t.*,t.received-t.refunded paid,p.updated_at,p.revision
 FROM public.renovation_projects p CROSS JOIN totals t WHERE p.id=p_id)
 SELECT jsonb_build_object('total',total,'original_total',original_total,'additions_total',additions_total,'received',received,'refunded',refunded,'paid',paid,'balance',total-paid,
 'pending',pending,'status',CASE WHEN entries=0 THEN 'no_records' WHEN paid>=total THEN 'paid' WHEN paid>0 THEN 'partial' WHEN pending>0 THEN 'pending' ELSE 'unpaid' END,
 'updated_at',updated_at,'revision',revision) FROM amounts;
$$;
REVOKE ALL ON FUNCTION public._reno_payment_summary(uuid) FROM PUBLIC;
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
  IF r.installment IS NOT NULL AND r.installment>jsonb_array_length(_reno_billing_plan(p_id)) THEN RAISE EXCEPTION '收退款期数不在合同计划内'; END IF;
  cap:=CASE WHEN r.installment IS NULL THEN p.current_total ELSE (_reno_billing_plan(p_id)->(r.installment-1)->>'amount')::numeric END;
  IF r.paid<0 THEN RAISE EXCEPTION '该期退款或作废超过已确认收款，请核对收退款所属期数'; END IF;
  IF r.paid+r.pending>cap THEN RAISE EXCEPTION '该期收款超过本期合同应付金额（含待核对现金），请核对期数和进款单金额'; END IF;
 END LOOP;
END;$$;
REVOKE ALL ON FUNCTION public._reno_check_installment_totals(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public._reno_installment_view(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH stages AS (SELECT x.value,x.ordinality::integer AS n,(p.snapshot->>'net')::numeric total
 FROM renovation_projects p CROSS JOIN LATERAL jsonb_array_elements(_reno_billing_plan(p.id)) WITH ORDINALITY x WHERE p.id=p_id),
 ledger AS (SELECT installment,coalesce(sum(amount) FILTER(WHERE kind='receipt' AND verified_at IS NOT NULL),0) received,
 coalesce(sum(amount) FILTER(WHERE kind='refund' AND verified_at IS NOT NULL),0) refunded,
 coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0) pending
 FROM renovation_payments WHERE project_id=p_id AND voided_at IS NULL GROUP BY installment)
 SELECT coalesce(jsonb_agg(jsonb_build_object('number',s.n,'name',s.value->>'name','amount',(s.value->>'amount')::numeric,
 'is_addition',coalesce((s.value->>'is_addition')::boolean,false),'cancelled',coalesce((s.value->>'cancelled')::boolean,false),'percentage',CASE WHEN coalesce((s.value->>'is_addition')::boolean,false) THEN NULL ELSE round((s.value->>'amount')::numeric*100/nullif(s.total,0),2) END,'received',coalesce(l.received,0),'refunded',coalesce(l.refunded,0),
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
   IF stage>jsonb_array_length(_reno_billing_plan(p_id)) THEN RAISE EXCEPTION '所选期数不在合同付款计划内'; END IF;
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
 total:=p.current_total;
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
CREATE OR REPLACE FUNCTION public.renovation_customer_payment_view(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('summary',_reno_payment_summary(p.id),'scope_revision',p.scope_revision,'installments',_reno_installment_view(p.id),'state',p.state,
 'plan',_reno_billing_plan(p.id),'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'installment',e.installment,'kind',e.kind,'amount',e.amount,'method',e.method,'paid_on',e.paid_on,'verified',e.verified_at IS NOT NULL) ORDER BY e.paid_on DESC,e.created_at DESC,e.id)
 FROM renovation_payments e WHERE e.project_id=p.id AND e.voided_at IS NULL),'[]'::jsonb))
 FROM renovation_projects p WHERE p.customer_token=p_token AND p.state<>'draft';
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_payment_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_payment_view(uuid) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.renovation_customer_view(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('contract_no',p.contract_no,'address',p.address,'state',p.state,'accepted_on',p.accepted_on,
 'scope_revision',p.scope_revision,'net',p.current_total,'original_net',p.snapshot->'net','additions_total',p.additions_total,'lines',coalesce((SELECT jsonb_agg(jsonb_build_object(
 'id',x->>'id','name',x->>'name','spec',x->>'spec','qty',x->'qty','unit',x->>'unit','gift',x->>'kind'='gift','warranties',x->'warranties'))
 FROM jsonb_array_elements(_reno_effective_lines(p.id)) x),'[]'::jsonb))
 FROM renovation_projects p WHERE p.customer_token=p_token AND p.state<>'draft';
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_view(uuid) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.renovation_command(p_id uuid,p_revision integer,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE; rowdata jsonb; wr jsonb; g text;
 total numeric:=0; discount numeric; net numeric; payments numeric:=0; q numeric; rate numeric;
 ids text[]:='{}'; lineid text; file_path text; v_work renovation_work_orders%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION '请登录后重试'; END IF;
 IF p_action='create' THEN
  IF NOT _reno_access((p_data->>'store_id')::uuid,auth.uid()) THEN RAISE EXCEPTION '无门店操作权限'; END IF;
  IF length(trim(coalesce(p_data->>'contract_no','')))=0 OR length(trim(coalesce(p_data->>'customer_name','')))=0
   OR length(trim(coalesce(p_data->>'customer_phone','')))=0 OR length(trim(coalesce(p_data->>'address','')))=0 THEN RAISE EXCEPTION '请补齐合同编号、客户、电话和项目地址'; END IF;
  INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address)
   VALUES(p_id,(p_data->>'store_id')::uuid,auth.uid(),trim(p_data->>'contract_no'),trim(p_data->>'customer_name'),trim(p_data->>'customer_phone'),trim(p_data->>'address'))
   ON CONFLICT(id) DO NOTHING;
  SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
  IF p.created_by<>auth.uid() OR p.store_id<>(p_data->>'store_id')::uuid THEN RAISE EXCEPTION '项目已存在'; END IF;
  INSERT INTO renovation_audit(project_id,actor,action,payload) SELECT p.id,auth.uid(),'create',p_data WHERE NOT EXISTS(SELECT 1 FROM renovation_audit WHERE project_id=p.id);
  RETURN to_jsonb(p);
 END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF p.revision<>p_revision THEN RAISE EXCEPTION '项目已被其他人修改，请刷新后重试'; END IF;
 IF p_action='save' THEN
  IF p.state<>'draft' THEN RAISE EXCEPTION '合同已锁定，不能覆盖；变更需另签协议'; END IF;
  IF p_data->>'contract_no' IS NOT NULL AND p_data->>'contract_no'<>p.contract_no THEN RAISE EXCEPTION '合同编号与项目不一致'; END IF;
  IF jsonb_typeof(p_data->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'lines')=0
    OR jsonb_array_length(p_data->'lines')>500 THEN RAISE EXCEPTION '需提供1至500项合同清单'; END IF;
  IF octet_length(p_data::text)>2000000 THEN RAISE EXCEPTION '合同数据超过2MB，请缩短原文或拆分附件'; END IF;
  FOR rowdata IN SELECT value FROM jsonb_array_elements(p_data->'lines') LOOP
   lineid:=rowdata->>'id';
   IF coalesce(lineid,'')='' OR lineid=ANY(ids) OR coalesce(trim(rowdata->>'name'),'')='' OR coalesce(trim(rowdata->>'group'),'')=''
    OR rowdata->>'kind' NOT IN ('custom','stock','work','gift') OR rowdata->>'kind' IS NULL THEN RAISE EXCEPTION '清单编号重复、内容或分组不完整'; END IF;
   ids:=array_append(ids,lineid);
   q:=(rowdata->>'qty')::numeric;rate:=(rowdata->>'rate')::numeric;
   IF q IS NULL OR rate IS NULL OR q::text IN ('NaN','Infinity','-Infinity') OR rate::text IN ('NaN','Infinity','-Infinity') OR q<=0 OR q>100000000 OR rate<0 OR rate>100000000 THEN RAISE EXCEPTION '数量或单价无效'; END IF;
   IF rowdata->>'kind'='gift' AND rate<>0 THEN RAISE EXCEPTION '赠送项目售价必须为零'; END IF;
   IF coalesce(rowdata->>'unit','')='' THEN RAISE EXCEPTION '请补充计价单位'; END IF;
   IF jsonb_typeof(rowdata->'warranties') IS DISTINCT FROM 'array' OR jsonb_array_length(rowdata->'warranties')>50 THEN RAISE EXCEPTION '缺少质保核对记录'; END IF;
   FOR wr IN SELECT value FROM jsonb_array_elements(rowdata->'warranties') LOOP
    IF coalesce(wr->>'component','')='' OR coalesce(wr->>'source','')='' THEN RAISE EXCEPTION '质保需注明部件和条款来源'; END IF;
    IF wr->>'years' IS NOT NULL AND ((wr->>'years')::numeric<=0 OR (wr->>'years')::numeric>100 OR trunc((wr->>'years')::numeric)<>(wr->>'years')::numeric) THEN RAISE EXCEPTION '质保年限须为1至100整数，待确认留空'; END IF;
   END LOOP;
   total:=total+round(q*rate,2);
  END LOOP;
  discount:=(p_data->>'discount')::numeric;net:=(p_data->>'net')::numeric;
  IF discount IS NULL OR net IS NULL OR discount<0 OR discount>total OR net<=0 OR net<>round(net,2) OR discount<>round(discount,2) OR total-discount<>net THEN RAISE EXCEPTION '工程合计、优惠和合同价未对平'; END IF;
  IF jsonb_typeof(p_data->'payments') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'payments')=0 OR jsonb_array_length(p_data->'payments')>50 THEN RAISE EXCEPTION '缺少合同付款计划'; END IF;
  FOR rowdata IN SELECT value FROM jsonb_array_elements(p_data->'payments') LOOP
   IF coalesce(rowdata->>'name','')='' OR (rowdata->>'amount') IS NULL OR (rowdata->>'amount')::numeric<=0
    OR (rowdata->>'amount')::numeric<>round((rowdata->>'amount')::numeric,2) THEN RAISE EXCEPTION '付款节点或金额无效'; END IF;
   payments:=payments+(rowdata->>'amount')::numeric;
  END LOOP;
  IF payments<>net THEN RAISE EXCEPTION '付款计划合计与合同价不一致'; END IF;
  file_path:=p_data->>'contract_path';
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='renovation-contracts' AND name=file_path AND split_part(name,'/',1)=p_id::text) THEN RAISE EXCEPTION '合同原文件尚未归档'; END IF;
  UPDATE renovation_projects SET snapshot=p_data,revision=revision+1,updated_at=now() WHERE id=p_id RETURNING * INTO p;
 ELSIF p_action='confirm' THEN
  IF NOT _reno_access(p.store_id,p.created_by,true) THEN RAISE EXCEPTION '需店长或上级确认合同'; END IF;
  IF p.state<>'draft' OR p.snapshot->'lines' IS NULL OR coalesce(p_data->>'signed','')<>'true' OR coalesce(p_data->>'reviewed','')<>'true' THEN RAISE EXCEPTION '请核对清单、质保及双方签署的合同'; END IF;
  IF coalesce(p.snapshot->>'signed_on','')='' OR (p.snapshot->>'signed_on')::date>current_date THEN RAISE EXCEPTION '请填写有效签约日期'; END IF;
  UPDATE renovation_projects SET state='confirmed',revision=revision+1,updated_at=now() WHERE id=p_id RETURNING * INTO p;
 ELSIF p_action='split' THEN
  IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '先确认合同，再生成子订单'; END IF;
  INSERT INTO renovation_work_orders(project_id,group_name,line_ids)
  SELECT p_id,x->>'group',jsonb_agg(x->>'id') FROM jsonb_array_elements(p.snapshot->'lines') x GROUP BY x->>'group'
  ON CONFLICT(project_id,group_name) DO NOTHING;
  UPDATE renovation_projects SET state='executing',revision=revision+1,updated_at=now() WHERE id=p_id RETURNING * INTO p;
 ELSIF p_action='work' THEN
  IF p.state<>'executing' THEN RAISE EXCEPTION '项目当前不可修改履约进度'; END IF;
  SELECT * INTO v_work FROM renovation_work_orders WHERE id=(p_data->>'id')::uuid AND project_id=p_id FOR UPDATE;
  IF v_work.cancelled_at IS NOT NULL THEN RAISE EXCEPTION '此增项已作废，不能修改执行进度'; END IF;
  IF v_work.id IS NULL OR p_data->>'status' NOT IN ('draft','assigned','working','done') OR p_data->>'status' IS NULL THEN RAISE EXCEPTION '子订单或状态无效'; END IF;
  IF p_data->>'status'<>'draft' AND coalesce(trim(p_data->>'assignee'),'')='' THEN RAISE EXCEPTION '先指定负责人'; END IF;
  UPDATE renovation_work_orders SET assignee=trim(p_data->>'assignee'),status=p_data->>'status',updated_at=now() WHERE id=v_work.id;
  UPDATE renovation_projects SET revision=revision+1,updated_at=now() WHERE id=p_id RETURNING * INTO p;
 ELSIF p_action='accept' THEN
  IF NOT _reno_access(p.store_id,p.created_by,true) THEN RAISE EXCEPTION '需店长或上级确认竣工验收'; END IF;
  IF p.state<>'executing' OR NOT EXISTS(SELECT 1 FROM renovation_work_orders WHERE project_id=p_id)
   OR EXISTS(SELECT 1 FROM renovation_work_orders WHERE project_id=p_id AND status<>'done') THEN RAISE EXCEPTION '须先完成全部子订单'; END IF;
  IF coalesce(p_data->>'accepted_on','')='' OR (p_data->>'accepted_on')::date>current_date OR
   (p_data->>'accepted_on')::date<(p.snapshot->>'signed_on')::date THEN RAISE EXCEPTION '验收日期须在签约日至今天之间'; END IF;
  file_path:=p_data->>'acceptance_path';
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='renovation-contracts' AND name=file_path AND split_part(name,'/',1)=p_id::text) THEN RAISE EXCEPTION '请上传竣工验收凭证'; END IF;
  UPDATE renovation_projects SET state='accepted',accepted_on=(p_data->>'accepted_on')::date,acceptance_path=file_path,revision=revision+1,updated_at=now() WHERE id=p_id RETURNING * INTO p;
 ELSE RAISE EXCEPTION '未知操作'; END IF;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,auth.uid(),p_action,p_data);
 RETURN to_jsonb(p);
END; $$;
REVOKE ALL ON FUNCTION public.renovation_command(uuid,integer,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_command(uuid,integer,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.renovation_customer_orders(p_phone text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(
  jsonb_build_object('id',p.id,'contract_no',p.contract_no,'state',p.state,'created_at',p.created_at)
  || CASE WHEN p.state<>'draft' THEN jsonb_build_object('address',p.address,'scope_revision',p.scope_revision,'net',p.current_total,'original_net',p.snapshot->'net','additions_total',p.additions_total,'view_token',p.customer_token)
     ELSE '{}'::jsonb END
  ORDER BY p.created_at DESC),'[]'::jsonb)
 FROM public.renovation_projects p
 WHERE length(p_phone)<=50 AND public._reno_normalize_phone(p_phone) IS NOT NULL
 AND public._reno_lookup_phone(p.customer_phone)=public._reno_normalize_phone(p_phone);
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_orders(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_orders(text) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.renovation_addition_command(p_id uuid,p_revision integer,p_action text,p_entry uuid,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;a renovation_additions%ROWTYPE;q numeric;r numeric;amt numeric;node integer;workid uuid;groupid text;paid numeric;pending numeric;
BEGIN
 IF auth.uid() IS NULL OR p_entry IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '仅已确认且未竣工验收的项目可登记增项；草稿请编辑原清单'; END IF;
 SELECT * INTO a FROM renovation_additions WHERE id=p_entry;
 IF p_action='add' AND a.id IS NOT NULL THEN
  IF a.project_id=p_id AND a.created_by=auth.uid() AND a.category=p_data->>'category' AND a.name=trim(p_data->>'name') AND a.spec=coalesce(p_data->>'spec','')
  AND a.qty=(p_data->>'qty')::numeric AND a.rate=(p_data->>'rate')::numeric AND a.unit=trim(p_data->>'unit') AND a.group_name=trim(p_data->>'group_name') AND a.payment_node=trim(p_data->>'payment_node') THEN RETURN to_jsonb(a); END IF;
  RAISE EXCEPTION '增项编号已使用，请刷新后核对';
 END IF;
 IF p_revision IS NULL OR p.revision<>p_revision THEN RAISE EXCEPTION '项目已被其他人修改，请刷新后重试'; END IF;
 IF p_action='add' THEN
  q:=(p_data->>'qty')::numeric;r:=(p_data->>'rate')::numeric;
  IF q IS NULL OR r IS NULL OR q::text IN ('NaN','Infinity','-Infinity') OR r::text IN ('NaN','Infinity','-Infinity') OR q<=0 OR q>100000000 OR r<=0 OR r>100000000 OR q<>round(q,3) OR r<>round(r,2) THEN RAISE EXCEPTION '数量须大于0且最多3位小数，单价须大于0且最多2位小数'; END IF;
  amt:=round(q*r,2);
  IF amt<0.01 OR p.current_total+amt>999999999999.99 THEN RAISE EXCEPTION '新增金额无效或项目总额超限'; END IF;
  IF p_data->>'category' IS NULL OR p_data->>'category' NOT IN ('work','material') OR coalesce(length(trim(p_data->>'name')),0) NOT BETWEEN 1 AND 200
   OR length(coalesce(p_data->>'spec',''))>2000 OR coalesce(length(trim(p_data->>'unit')),0) NOT BETWEEN 1 AND 50
   OR coalesce(length(trim(p_data->>'group_name')),0) NOT BETWEEN 1 AND 80 OR coalesce(length(trim(p_data->>'payment_node')),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '请补齐增项类别、名称、单位、执行分组和付款节点'; END IF;
  SELECT greatest(jsonb_array_length(coalesce(p.snapshot->'payments','[]'::jsonb)),coalesce(max(installment),0))+1 INTO node FROM renovation_additions WHERE project_id=p_id;
  workid:=gen_random_uuid();groupid:='增项-'||p_entry::text||' · '||trim(p_data->>'group_name');
  INSERT INTO renovation_work_orders(id,project_id,group_name,line_ids) VALUES(workid,p_id,groupid,jsonb_build_array('ADD-'||p_entry));
  INSERT INTO renovation_additions(id,project_id,category,name,spec,qty,unit,rate,group_name,payment_node,installment,work_order_id,created_by)
  VALUES(p_entry,p_id,p_data->>'category',trim(p_data->>'name'),coalesce(p_data->>'spec',''),q,trim(p_data->>'unit'),r,trim(p_data->>'group_name'),trim(p_data->>'payment_node'),node,workid,auth.uid()) RETURNING * INTO a;
 ELSIF p_action='void' THEN
  IF NOT _reno_access(p.store_id,p.created_by,true) THEN RAISE EXCEPTION '作废增项须由店长或上级操作'; END IF;
  IF a.id IS NULL OR a.project_id<>p_id OR a.voided_at IS NOT NULL THEN RAISE EXCEPTION '无此有效增项'; END IF;
  IF coalesce(length(trim(p_data->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '请填写作废原因'; END IF;
  SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount ELSE -amount END) FILTER(WHERE verified_at IS NOT NULL),0),coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0)
  INTO paid,pending FROM renovation_payments WHERE project_id=p_id AND installment=a.installment AND voided_at IS NULL;
  IF paid<>0 OR pending<>0 THEN RAISE EXCEPTION '该增项有已收或待核对款，请先核对退款或归期'; END IF;
  SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount ELSE -amount END) FILTER(WHERE verified_at IS NOT NULL),0),coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0)
  INTO paid,pending FROM renovation_payments WHERE project_id=p_id AND voided_at IS NULL;
  IF paid+pending>p.current_total-a.amount THEN RAISE EXCEPTION '已收及待核对款超过作废后的项目应收，请先核对收款'; END IF;
  IF EXISTS(SELECT 1 FROM renovation_work_orders WHERE id=a.work_order_id AND status<>'draft') THEN RAISE EXCEPTION '增项已安排执行，请先与负责人核对，不能直接作废'; END IF;
  UPDATE renovation_additions SET voided_at=now(),voided_by=auth.uid(),void_reason=trim(p_data->>'reason') WHERE id=p_entry RETURNING * INTO a;
  UPDATE renovation_work_orders SET cancelled_at=now(),status='done',assignee='增项已作废',updated_at=now() WHERE id=a.work_order_id;
 ELSE RAISE EXCEPTION '不支持的增项操作'; END IF;
 UPDATE renovation_projects SET additions_total=coalesce((SELECT sum(amount) FROM renovation_additions WHERE project_id=p_id AND voided_at IS NULL),0),scope_revision=scope_revision+1,revision=revision+1,updated_at=now() WHERE id=p_id;
 PERFORM _reno_check_installment_totals(p_id);
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p_id,auth.uid(),'addition_'||p_action,to_jsonb(a));
 RETURN to_jsonb(a);
END;$$;
REVOKE ALL ON FUNCTION public.renovation_addition_command(uuid,integer,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_addition_command(uuid,integer,text,uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
