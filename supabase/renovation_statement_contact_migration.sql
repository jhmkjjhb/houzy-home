-- Statement contact phone: the phone of the staff account that owns the order (created_by),
-- when that account is active and has a phone; otherwise the PDF falls back to the store number.
-- Apply after renovation_installment_statements_migration.sql.
BEGIN;
CREATE OR REPLACE FUNCTION public._reno_contact_phone(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT nullif(trim(pr.phone),'') FROM renovation_projects p JOIN profiles pr ON pr.id=p.created_by
 WHERE p.id=p_id AND coalesce(pr.active,false);
$$;
REVOKE ALL ON FUNCTION public._reno_contact_phone(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.renovation_statement_contact(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;
BEGIN
 SELECT * INTO p FROM renovation_projects WHERE id=p_id;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 RETURN jsonb_build_object('contact_phone',_reno_contact_phone(p.id));
END $$;
REVOKE ALL ON FUNCTION public.renovation_statement_contact(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_statement_contact(uuid) TO authenticated;

-- Same as renovation_installment_statements_migration.sql plus contact_phone.
CREATE OR REPLACE FUNCTION public.renovation_customer_installment_statement(p_token uuid,p_installment integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;stage jsonb;plan jsonb;stage_amount numeric;received numeric;refunded numeric;pending numeric;unassigned numeric;paid numeric;entries jsonb;
BEGIN
 IF p_token IS NULL OR p_installment IS NULL OR p_installment<1 OR p_installment>100 THEN RAISE EXCEPTION '付款单链接或期数无效'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE customer_token=p_token AND state<>'draft';
 IF p.id IS NULL THEN RAISE EXCEPTION '客户链接无效或已失效'; END IF;
 plan:=_reno_billing_plan(p.id);
 IF p_installment>jsonb_array_length(plan) THEN RAISE EXCEPTION '付款期数不在当前项目计划内'; END IF;
 stage:=plan->(p_installment-1);
 IF coalesce((stage->>'pending_signature')::boolean,false) OR coalesce((stage->>'cancelled')::boolean,false) THEN
  RAISE EXCEPTION '待签或已撤销的付款节点不可生成付款单';
 END IF;
 stage_amount:=(stage->>'amount')::numeric;
 IF stage_amount IS NULL OR stage_amount<=0 THEN RAISE EXCEPTION '该付款节点金额无效'; END IF;
 SELECT coalesce(sum(l.amount) FILTER(WHERE l.kind='receipt' AND l.verified_at IS NOT NULL),0),
        coalesce(sum(l.amount) FILTER(WHERE l.kind='refund' AND l.verified_at IS NOT NULL),0),
        coalesce(sum(l.amount) FILTER(WHERE l.verified_at IS NULL),0)
 INTO received,refunded,pending
 FROM _reno_payment_lines(p.id) l WHERE l.installment=p_installment AND l.voided_at IS NULL;
 paid:=received-refunded;
 SELECT coalesce(sum(CASE WHEN l.kind='receipt' THEN l.amount ELSE -l.amount END) FILTER(WHERE l.verified_at IS NOT NULL),0)
 INTO unassigned FROM _reno_payment_lines(p.id) l WHERE l.installment IS NULL AND l.voided_at IS NULL;
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'amount',l.amount,'method',e.method,
  'paid_on',e.paid_on,'verified',l.verified_at IS NOT NULL) ORDER BY e.paid_on,e.created_at,e.id),'[]'::jsonb)
 INTO entries FROM _reno_payment_lines(p.id) l JOIN renovation_payments e ON e.id=l.entry_id
 WHERE l.installment=p_installment AND l.voided_at IS NULL;
 RETURN jsonb_build_object(
  'reference',p.contract_no||'-'||upper(substr(p.id::text,1,8))||'-P'||lpad(p_installment::text,2,'0'),
  'contract_no',p.contract_no,'customer_name',p.customer_name,'address',p.address,
  'project_total',p.current_total,'original_total',(p.snapshot->>'net')::numeric,
  'additions_total',p.additions_total,'deductions_total',p.deductions_total,
  'installment',p_installment,'stage_name',stage->>'name','is_addition',coalesce((stage->>'is_addition')::boolean,false),
  'amount',stage_amount,'received',received,'refunded',refunded,'paid',paid,'pending',pending,
  'unassigned_paid',unassigned,'balance',greatest(stage_amount-paid,0),
  'status',CASE WHEN paid>=stage_amount THEN 'paid' WHEN pending>0 OR unassigned>0 THEN 'review'
    WHEN paid>0 THEN 'partial' ELSE 'unpaid' END,
  'entries',entries,'generated_at',now(),'contact_phone',_reno_contact_phone(p.id));
END $$;
REVOKE ALL ON FUNCTION public.renovation_customer_installment_statement(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.renovation_customer_installment_statement(uuid,integer) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
