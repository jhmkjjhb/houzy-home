-- New work/material additions require customer electronic consent before activation.
BEGIN;
LOCK TABLE public.renovation_additions IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='renovation_additions' AND column_name='signature_status')
 AND EXISTS(SELECT 1 FROM renovation_additions WHERE voided_at IS NULL) THEN
  RAISE EXCEPTION '已有未签增项，请先核对已收款及执行状态后迁移，不能静默改写历史应收';
 END IF;
END;$$;
ALTER TABLE public.renovation_audit ALTER COLUMN actor DROP NOT NULL;
ALTER TABLE public.renovation_additions ALTER COLUMN work_order_id DROP NOT NULL;
ALTER TABLE public.renovation_additions ADD COLUMN IF NOT EXISTS signature_status text NOT NULL DEFAULT 'pending' CHECK(signature_status IN ('pending','signed'));
ALTER TABLE public.renovation_additions ADD COLUMN IF NOT EXISTS signing_token uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.renovation_additions ADD COLUMN IF NOT EXISTS signed_at timestamptz;
ALTER TABLE public.renovation_additions ADD COLUMN IF NOT EXISTS signer_name text;
ALTER TABLE public.renovation_additions ADD COLUMN IF NOT EXISTS signed_terms_hash text;
ALTER TABLE public.renovation_additions ADD COLUMN IF NOT EXISTS signature_strokes jsonb;
ALTER TABLE public.renovation_additions ADD COLUMN IF NOT EXISTS signed_snapshot jsonb;
ALTER TABLE public.renovation_additions ADD COLUMN IF NOT EXISTS signature_hash text;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='renovation_addition_signed_record_check' AND conrelid='public.renovation_additions'::regclass) THEN
 ALTER TABLE public.renovation_additions ADD CONSTRAINT renovation_addition_signed_record_check CHECK(signature_status<>'signed' OR (signed_at IS NOT NULL AND signer_name IS NOT NULL AND signed_terms_hash IS NOT NULL AND signature_strokes IS NOT NULL AND signed_snapshot IS NOT NULL AND signature_hash IS NOT NULL AND work_order_id IS NOT NULL));
 END IF;END;$$;
CREATE UNIQUE INDEX IF NOT EXISTS renovation_additions_signing_token_idx ON renovation_additions(signing_token);
CREATE OR REPLACE FUNCTION public._reno_billing_plan(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(p.snapshot->'payments','[]'::jsonb)||coalesce((SELECT jsonb_agg(jsonb_build_object(
 'name','增项：'||a.name||' · '||a.payment_node,'amount',CASE WHEN a.voided_at IS NULL AND a.signature_status='signed' THEN a.amount ELSE 0 END,
 'original_amount',a.amount,'is_addition',true,'pending_signature',a.signature_status='pending' AND a.voided_at IS NULL,'addition_id',a.id,'cancelled',a.voided_at IS NOT NULL) ORDER BY a.installment)
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
 ) ORDER BY a.installment) FROM renovation_additions a JOIN renovation_work_orders w ON w.id=a.work_order_id WHERE a.project_id=p.id AND a.voided_at IS NULL AND a.signature_status='signed'),'[]'::jsonb)
 FROM renovation_projects p WHERE p.id=p_id;
$$;
REVOKE ALL ON FUNCTION public._reno_effective_lines(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public._reno_installment_view(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH stages AS (SELECT x.value,x.ordinality::integer AS n,(p.snapshot->>'net')::numeric total
 FROM renovation_projects p CROSS JOIN LATERAL jsonb_array_elements(_reno_billing_plan(p.id)) WITH ORDINALITY x WHERE p.id=p_id),
 ledger AS (SELECT installment,coalesce(sum(amount) FILTER(WHERE kind='receipt' AND verified_at IS NOT NULL),0) received,
 coalesce(sum(amount) FILTER(WHERE kind='refund' AND verified_at IS NOT NULL),0) refunded,
 coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0) pending
 FROM renovation_payments WHERE project_id=p_id AND voided_at IS NULL GROUP BY installment)
 SELECT coalesce(jsonb_agg(jsonb_build_object('number',s.n,'name',s.value->>'name','amount',(s.value->>'amount')::numeric,
 'is_addition',coalesce((s.value->>'is_addition')::boolean,false),'pending_signature',coalesce((s.value->>'pending_signature')::boolean,false),'cancelled',coalesce((s.value->>'cancelled')::boolean,false),'percentage',CASE WHEN coalesce((s.value->>'is_addition')::boolean,false) THEN NULL ELSE round((s.value->>'amount')::numeric*100/nullif(s.total,0),2) END,'received',coalesce(l.received,0),'refunded',coalesce(l.refunded,0),
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
 IF stage IS NOT NULL AND coalesce((_reno_billing_plan(p_id)->(stage-1)->>'pending_signature')::boolean,false) THEN RAISE EXCEPTION '该增项尚未由客户电子签名，不得收款或归期'; END IF;
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
  -- Deposits may precede signing slightly; anything earlier is a typo. Back-dating into a
  -- closed month changes settled performance, so it needs a manager and a written reason.
  IF nullif(p.snapshot->>'signed_on','') IS NOT NULL AND (p_data->>'paid_on')::date<(p.snapshot->>'signed_on')::date-30 THEN RAISE EXCEPTION '收退款日期不得早于签约日前30天，请核对日期'; END IF;
  IF (p_data->>'paid_on')::date<date_trunc('month',now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date AND (NOT manager OR coalesce(length(trim(p_data->>'note')),0)=0) THEN RAISE EXCEPTION '补登上月或更早的收退款会改动已结算业绩，须由店长或上级登记，并在备注写明原因'; END IF;
  IF coalesce(length(trim(p_data->>'reference')),0) NOT BETWEEN 1 AND 200 OR length(coalesce(p_data->>'note',''))>1000 THEN RAISE EXCEPTION '请填写银行参考号或收据编号（最多200字），备注最多1000字'; END IF;
  IF p_data->>'kind'='refund' AND NOT manager THEN RAISE EXCEPTION '退款须由店长或上级登记'; END IF;
  IF p_data->>'kind'='receipt' AND paid+pending+amt>total THEN RAISE EXCEPTION '收款金额超过合同剩余应收（含待核对现金）'; END IF;
  IF p_data->>'kind'='refund' AND amt>paid THEN RAISE EXCEPTION '退款金额超过已确认净收款'; END IF;
  IF EXISTS(SELECT 1 FROM renovation_payments WHERE kind=p_data->>'kind' AND lower(reference)=lower(trim(p_data->>'reference')) AND voided_at IS NULL) THEN RAISE EXCEPTION '同一参考号或收据编号已在本项目或其他项目登记，请勿重复收款；一笔转账付多个项目请在参考号后加项目编号区分'; END IF;
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
  workid:=NULL;
  INSERT INTO renovation_additions(id,project_id,category,name,spec,qty,unit,rate,group_name,payment_node,installment,work_order_id,created_by)
  VALUES(p_entry,p_id,p_data->>'category',trim(p_data->>'name'),coalesce(p_data->>'spec',''),q,trim(p_data->>'unit'),r,trim(p_data->>'group_name'),trim(p_data->>'payment_node'),node,workid,auth.uid()) RETURNING * INTO a;
 ELSIF p_action='void' THEN
  IF NOT _reno_access(p.store_id,p.created_by,true) AND NOT (a.signature_status='pending' AND a.created_by=auth.uid()) THEN RAISE EXCEPTION '已签增项作废须由店长操作；待签增项由原登记员工或店长撤销'; END IF;
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
 UPDATE renovation_projects SET additions_total=coalesce((SELECT sum(amount) FROM renovation_additions WHERE project_id=p_id AND voided_at IS NULL AND signature_status='signed'),0),scope_revision=scope_revision+1,revision=revision+1,updated_at=now() WHERE id=p_id;
 PERFORM _reno_check_installment_totals(p_id);
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p_id,auth.uid(),'addition_'||p_action,to_jsonb(a));
 RETURN to_jsonb(a);
END;$$;
REVOKE ALL ON FUNCTION public.renovation_addition_command(uuid,integer,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_addition_command(uuid,integer,text,uuid,jsonb) TO authenticated;
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
  IF EXISTS(SELECT 1 FROM renovation_additions WHERE project_id=p_id AND voided_at IS NULL AND signature_status='pending') THEN RAISE EXCEPTION '还有待客户签署的新增单，请先签署或撤销后再验收'; END IF;
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

CREATE OR REPLACE FUNCTION public._reno_addition_terms(p_addition uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('addition_id',a.id,'contract_no',p.contract_no,'address',p.address,'category',a.category,'name',a.name,
 'spec',a.spec,'qty',a.qty,'unit',a.unit,'rate',a.rate,'amount',a.amount,'payment_node',a.payment_node,
 'original_total',coalesce((p.snapshot->>'net')::numeric,0),'current_total',p.current_total,'after_sign_total',p.current_total+a.amount,
 'warranty_note','新增项目质保范围及期限待双方补充确认，不自动沿用其他产品质保')
 FROM renovation_additions a JOIN renovation_projects p ON p.id=a.project_id WHERE a.id=p_addition;
$$;
REVOKE ALL ON FUNCTION public._reno_addition_terms(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.renovation_customer_additions(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'category',a.category,'name',a.name,'spec',a.spec,'qty',a.qty,'unit',a.unit,'rate',a.rate,
 'amount',a.amount,'payment_node',a.payment_node,'signature_status',a.signature_status,'signed_at',a.signed_at,'signer_name',a.signer_name,
 'signature_hash',a.signature_hash,'voided',a.voided_at IS NOT NULL) ORDER BY a.created_at,a.id),'[]'::jsonb)
 FROM renovation_projects p JOIN renovation_additions a ON a.project_id=p.id WHERE p.customer_token=p_token AND p.state<>'draft';
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_additions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_additions(uuid) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.renovation_customer_addition_sign_view(p_token uuid,p_addition uuid,p_sign_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',a.id,'status',CASE WHEN a.voided_at IS NOT NULL THEN 'voided' ELSE a.signature_status END,
 'terms',CASE WHEN a.signature_status='signed' THEN a.signed_snapshot->'terms' ELSE _reno_addition_terms(a.id) END,
 'terms_hash',CASE WHEN a.signature_status='signed' THEN a.signed_terms_hash ELSE encode(sha256(convert_to(_reno_addition_terms(a.id)::text,'UTF8')),'hex') END,
 'signed_at',a.signed_at,'signer_name',a.signer_name,'signature_hash',a.signature_hash,'signature_strokes',a.signature_strokes)
 FROM renovation_additions a JOIN renovation_projects p ON p.id=a.project_id WHERE a.id=p_addition AND a.signing_token=p_sign_token AND p.customer_token=p_token AND p.state<>'draft';
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_addition_sign_view(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_addition_sign_view(uuid,uuid,uuid) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.renovation_customer_sign_addition(p_token uuid,p_addition uuid,p_sign_token uuid,p_terms_hash text,p_name text,p_strokes jsonb,p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;a renovation_additions%ROWTYPE;terms jsonb;digest text;stroke jsonb;point jsonb;x numeric;y numeric;
 minx numeric:=1;miny numeric:=1;maxx numeric:=0;maxy numeric:=0;points integer:=0;at_time timestamptz:=now();record jsonb;workid uuid;
BEGIN
 SELECT * INTO p FROM renovation_projects WHERE customer_token=p_token FOR UPDATE;
 IF p.id IS NULL OR p.state='draft' THEN RAISE EXCEPTION '签署链接无效或已撤销'; END IF;
 SELECT * INTO a FROM renovation_additions WHERE id=p_addition AND project_id=p.id AND signing_token=p_sign_token FOR UPDATE;
 IF a.id IS NULL OR a.voided_at IS NOT NULL THEN RAISE EXCEPTION '签署链接无效或新增单已撤销'; END IF;
 IF a.signature_status='signed' THEN
  IF a.signed_terms_hash=p_terms_hash AND a.signer_name=trim(p_name) AND a.signature_strokes=p_strokes THEN RETURN jsonb_build_object('ok',true,'signed_at',a.signed_at,'signature_hash',a.signature_hash); END IF;
  RAISE EXCEPTION '新增单已签署，签署内容不可覆盖';
 END IF;
 IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '项目当前不可签署新增单'; END IF;
 IF p_accept IS DISTINCT FROM true OR coalesce(length(trim(p_name)),0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION '请填写签署姓名并勾选确认增项内容'; END IF;
 terms:=_reno_addition_terms(a.id);digest:=encode(sha256(convert_to(terms::text,'UTF8')),'hex');
 IF p_terms_hash IS DISTINCT FROM digest THEN RAISE EXCEPTION '新增单或项目金额已更新，请刷新核对后重新签名'; END IF;
 IF p_strokes IS NULL OR jsonb_typeof(p_strokes)<>'array' OR octet_length(p_strokes::text)>65536 OR jsonb_array_length(p_strokes) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION '请在签名框内手写签名'; END IF;
 FOR stroke IN SELECT value FROM jsonb_array_elements(p_strokes) LOOP
  IF jsonb_typeof(stroke)<>'array' OR jsonb_array_length(stroke)<2 THEN RAISE EXCEPTION '签名笔迹无效'; END IF;
  FOR point IN SELECT value FROM jsonb_array_elements(stroke) LOOP
   IF jsonb_typeof(point)<>'array' OR jsonb_array_length(point)<>2 OR jsonb_typeof(point->0)<>'number' OR jsonb_typeof(point->1)<>'number' THEN RAISE EXCEPTION '签名笔迹无效'; END IF;
   x:=(point->>0)::numeric;y:=(point->>1)::numeric;
   IF x NOT BETWEEN 0 AND 1 OR y NOT BETWEEN 0 AND 1 THEN RAISE EXCEPTION '签名笔迹坐标无效'; END IF;
   points:=points+1;IF points>2048 THEN RAISE EXCEPTION '签名笔迹过长，请清除后重签'; END IF;
   minx:=least(minx,x);maxx:=greatest(maxx,x);miny:=least(miny,y);maxy:=greatest(maxy,y);
  END LOOP;
 END LOOP;
 IF points<8 OR (maxx-minx)+(maxy-miny)<0.05 THEN RAISE EXCEPTION '签名为空或笔迹太少，请完整手写签名'; END IF;
 record:=jsonb_build_object('terms',terms,'signer_name',trim(p_name),'signed_at',at_time,'signature',p_strokes,'consent',true);
 workid:=gen_random_uuid();
 INSERT INTO renovation_work_orders(id,project_id,group_name,line_ids) VALUES(workid,p.id,'增项-'||a.id::text||' · '||a.group_name,jsonb_build_array('ADD-'||a.id));
 UPDATE renovation_additions SET signature_status='signed',signed_at=at_time,signer_name=trim(p_name),signed_terms_hash=digest,
 signature_strokes=p_strokes,signed_snapshot=record,signature_hash=encode(sha256(convert_to(record::text,'UTF8')),'hex'),work_order_id=workid WHERE id=a.id RETURNING * INTO a;
 UPDATE renovation_projects SET additions_total=coalesce((SELECT sum(amount) FROM renovation_additions WHERE project_id=p.id AND voided_at IS NULL AND signature_status='signed'),0),scope_revision=scope_revision+1,revision=revision+1,updated_at=at_time WHERE id=p.id;
 PERFORM _reno_check_installment_totals(p.id);
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,NULL,'addition_customer_signed',jsonb_build_object('addition_id',a.id,'signed_at',a.signed_at,'signer_name',a.signer_name,'signature_hash',a.signature_hash,'source','customer_signing_link'));
 RETURN jsonb_build_object('ok',true,'signed_at',a.signed_at,'signature_hash',a.signature_hash);
END;$$;
REVOKE ALL ON FUNCTION public.renovation_customer_sign_addition(uuid,uuid,uuid,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_sign_addition(uuid,uuid,uuid,text,text,jsonb,boolean) TO anon,authenticated;
-- One bank reference / receipt number is one real payment across all projects.
-- The unique index also closes the race between two projects locked separately.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM renovation_payments WHERE voided_at IS NULL GROUP BY kind,lower(reference) HAVING count(*)>1) THEN
  RAISE EXCEPTION '已有重复的有效收退款参考号，请先核对并作废重复记录后再迁移';
 END IF;
END;$$;
CREATE UNIQUE INDEX IF NOT EXISTS renovation_payments_reference_uniq ON public.renovation_payments(kind,lower(reference)) WHERE voided_at IS NULL;
-- Phone lookup must show the same total as the contract page (signed additions included),
-- whichever order the earlier phone/additions migrations were applied in.
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
NOTIFY pgrst,'reload schema';
COMMIT;
