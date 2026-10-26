-- Actual renovation receipts, separate from contract milestone plans and legacy
-- merchandise order receivables. No historical payments are inferred/backfilled.
BEGIN;
-- Later migrations redefine functions created here; re-running this file would
-- silently restore older money/permission rules, so refuse once they exist.
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='renovation_payments' AND column_name='installment') THEN
 RAISE EXCEPTION '此迁移已被 renovation_payment_installments_migration.sql 取代，重跑会恢复旧规则，已停止。请按《整装订单上线与验收》的迁移顺序执行。';
END IF; END $guard$;
CREATE TABLE IF NOT EXISTS public.renovation_payments(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES public.renovation_projects(id),
 kind text NOT NULL CHECK(kind IN ('receipt','refund')),amount numeric(14,2) NOT NULL CHECK(amount>0),
 method text NOT NULL CHECK(method IN ('bank_transfer','ewallet','card','cash')),
 paid_on date NOT NULL,reference text NOT NULL,note text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 verified_by uuid REFERENCES public.profiles(id),verified_at timestamptz,
 voided_by uuid REFERENCES public.profiles(id),voided_at timestamptz,void_reason text,
 CHECK((verified_by IS NULL)=(verified_at IS NULL)),CHECK((voided_by IS NULL)=(voided_at IS NULL))
);
CREATE INDEX IF NOT EXISTS renovation_payments_project_idx ON public.renovation_payments(project_id,created_at);
ALTER TABLE public.renovation_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renovation_payments FROM anon,authenticated;
GRANT SELECT ON public.renovation_payments TO authenticated;
DROP POLICY IF EXISTS reno_payments_read ON public.renovation_payments;
CREATE POLICY reno_payments_read ON public.renovation_payments FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.renovation_projects p WHERE p.id=project_id AND public._reno_access(p.store_id,p.created_by)));
CREATE OR REPLACE FUNCTION public._reno_payment_summary(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH totals AS (SELECT coalesce(sum(amount) FILTER(WHERE kind='receipt' AND verified_at IS NOT NULL),0) received,
 coalesce(sum(amount) FILTER(WHERE kind='refund' AND verified_at IS NOT NULL),0) refunded,
 coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0) pending,count(*) entries
 FROM public.renovation_payments WHERE project_id=p_id AND voided_at IS NULL),
 amounts AS (SELECT (p.snapshot->>'net')::numeric total,t.*,t.received-t.refunded paid,p.updated_at,p.revision
 FROM public.renovation_projects p CROSS JOIN totals t WHERE p.id=p_id)
 SELECT jsonb_build_object('total',total,'received',received,'refunded',refunded,'paid',paid,'balance',total-paid,
 'pending',pending,'status',CASE WHEN entries=0 THEN 'no_records' WHEN paid>=total THEN 'paid' WHEN paid>0 THEN 'partial' WHEN pending>0 THEN 'pending' ELSE 'unpaid' END,
 'updated_at',updated_at,'revision',revision) FROM amounts;
$$;
REVOKE ALL ON FUNCTION public._reno_payment_summary(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.renovation_payment_view(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;
BEGIN
 SELECT * INTO p FROM renovation_projects WHERE id=p_id;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此门店项目权限'; END IF;
 RETURN jsonb_build_object('summary',_reno_payment_summary(p_id),'entries',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC,e.id) FROM renovation_payments e WHERE project_id=p_id),'[]'::jsonb));
END;$$;
REVOKE ALL ON FUNCTION public.renovation_payment_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_payment_view(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.renovation_payment_command(p_id uuid,p_revision integer,p_action text,p_entry uuid,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;e renovation_payments%ROWTYPE;amt numeric;manager boolean;total numeric;paid numeric;pending numeric;delta numeric;verified boolean;
BEGIN
 IF auth.uid() IS NULL OR p_entry IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此门店项目权限'; END IF;
 IF p.state='draft' THEN RAISE EXCEPTION '请先确认合同，再登记实际收款'; END IF;
 manager:=_reno_access(p.store_id,p.created_by,true);
 SELECT * INTO e FROM renovation_payments WHERE id=p_entry;
 -- A retry can safely return the existing record, but cannot reuse another payload.
 IF p_action='add' AND e.id IS NOT NULL THEN
  IF e.project_id=p_id AND e.created_by=auth.uid() AND e.kind=p_data->>'kind' AND e.amount=(p_data->>'amount')::numeric
   AND e.method=p_data->>'method' AND e.paid_on=(p_data->>'paid_on')::date AND e.reference=trim(p_data->>'reference') AND e.note=coalesce(p_data->>'note','') THEN RETURN to_jsonb(e); END IF;
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
  INSERT INTO renovation_payments(id,project_id,kind,amount,method,paid_on,reference,note,created_by,verified_by,verified_at)
   VALUES(p_entry,p_id,p_data->>'kind',amt,p_data->>'method',(p_data->>'paid_on')::date,trim(p_data->>'reference'),coalesce(p_data->>'note',''),auth.uid(),CASE WHEN verified THEN auth.uid() END,CASE WHEN verified THEN now() END) RETURNING * INTO e;
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
 UPDATE renovation_projects SET revision=revision+1,updated_at=now() WHERE id=p_id;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p_id,auth.uid(),'payment_'||p_action,to_jsonb(e));
 RETURN to_jsonb(e);
END;$$;
REVOKE ALL ON FUNCTION public.renovation_payment_command(uuid,integer,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_payment_command(uuid,integer,text,uuid,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.renovation_customer_payment_view(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('summary',_reno_payment_summary(p.id),'state',p.state,
 'plan',coalesce(p.snapshot->'payments','[]'::jsonb),'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'amount',e.amount,'method',e.method,'paid_on',e.paid_on,'verified',e.verified_at IS NOT NULL) ORDER BY e.paid_on DESC,e.created_at DESC,e.id)
 FROM renovation_payments e WHERE e.project_id=p.id AND e.voided_at IS NULL),'[]'::jsonb))
 FROM renovation_projects p WHERE p.customer_token=p_token AND p.state<>'draft';
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_payment_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_payment_view(uuid) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
