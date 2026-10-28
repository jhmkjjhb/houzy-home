-- Owner e-signature on an uploaded unsigned contract PDF.
-- Flow: store saves the draft with the unsigned PDF -> requests a signing link -> the owner
-- passes a phone last-4 check, reads the PDF and signs -> a store manager countersigns; the
-- browser appends a signature page to the original PDF, archives it, and the project is confirmed.
-- The unsigned PDF stays archived; renovation_command is unchanged, triggers guard the draft.
BEGIN;

CREATE TABLE IF NOT EXISTS public.renovation_contract_esigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.renovation_projects(id),
 contract_path text NOT NULL,
 contract_sha256 text NOT NULL CHECK(contract_sha256 ~ '^[0-9a-f]{64}$'),
 terms jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','signed','countersigned','voided')),
 signing_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 failed_checks integer NOT NULL DEFAULT 0,
 verified_until timestamptz,
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 signed_at timestamptz, signer_name text, signed_terms_hash text, signature_strokes jsonb, signature_hash text,
 company_signer_name text, company_strokes jsonb, company_signed_by uuid, company_signed_at timestamptz,
 signed_pdf_path text, signed_pdf_sha256 text,
 voided_at timestamptz, voided_by uuid, void_reason text,
 CONSTRAINT renovation_esign_signed_check CHECK(status NOT IN ('signed','countersigned') OR
  (signed_at IS NOT NULL AND signer_name IS NOT NULL AND signed_terms_hash IS NOT NULL AND signature_strokes IS NOT NULL AND signature_hash IS NOT NULL)),
 CONSTRAINT renovation_esign_countersigned_check CHECK(status<>'countersigned' OR
  (company_signer_name IS NOT NULL AND company_strokes IS NOT NULL AND company_signed_at IS NOT NULL
   AND signed_pdf_path IS NOT NULL AND signed_pdf_sha256 ~ '^[0-9a-f]{64}$')),
 CONSTRAINT renovation_esign_void_check CHECK(status<>'voided' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS renovation_contract_esigns_one_live
 ON public.renovation_contract_esigns(project_id) WHERE status<>'voided';
ALTER TABLE public.renovation_contract_esigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renovation_contract_esigns FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.renovation_contract_esigns TO authenticated;
DROP POLICY IF EXISTS renovation_contract_esigns_read ON public.renovation_contract_esigns;
CREATE POLICY renovation_contract_esigns_read ON public.renovation_contract_esigns FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.renovation_projects p WHERE p.id=project_id AND public._reno_access(p.store_id,p.created_by)));

-- Raises unless the strokes are a real hand-drawn signature (same rules as addition/deduction signing).
CREATE OR REPLACE FUNCTION public._reno_check_strokes(p_strokes jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE stroke jsonb;point jsonb;x numeric;y numeric;minx numeric:=1;miny numeric:=1;maxx numeric:=0;maxy numeric:=0;points integer:=0;
BEGIN
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
END $$;
REVOKE ALL ON FUNCTION public._reno_check_strokes(jsonb) FROM PUBLIC;

-- What the owner signs: the PDF fingerprint plus the money terms read from it.
CREATE OR REPLACE FUNCTION public._reno_esign_money(p_snapshot jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('net',(p_snapshot->>'net')::numeric,'discount',coalesce((p_snapshot->>'discount')::numeric,0),
  'payments',coalesce((SELECT jsonb_agg(jsonb_build_object('name',x->>'name','amount',(x->>'amount')::numeric) ORDER BY n)
   FROM jsonb_array_elements(p_snapshot->'payments') WITH ORDINALITY AS t(x,n)),'[]'::jsonb),
  'contract_path',coalesce(p_snapshot->>'unsigned_contract_path',p_snapshot->>'contract_path'));
$$;
REVOKE ALL ON FUNCTION public._reno_esign_money(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._reno_esign_check_phone(p_phone text,p_last4 text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT p_last4 ~ '^[0-9]{4}$' AND right(regexp_replace(coalesce(p_phone,''),'\D','','g'),4)=p_last4;
$$;
REVOKE ALL ON FUNCTION public._reno_esign_check_phone(text,text) FROM PUBLIC;

-- Draft guard: once the owner signed, money terms and the PDF are frozen; a pending link is voided by a change.
CREATE OR REPLACE FUNCTION public._reno_esign_guard_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e renovation_contract_esigns%ROWTYPE;
BEGIN
 IF OLD.state<>'draft' THEN RETURN NEW; END IF;
 SELECT * INTO e FROM renovation_contract_esigns WHERE project_id=NEW.id AND status<>'voided';
 IF e.id IS NULL THEN
  IF NEW.snapshot ? 'unsigned_contract_path' THEN RAISE EXCEPTION '电子签署记录无效，请刷新后重新保存'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.snapshot ? 'unsigned_contract_path' AND (e.status<>'countersigned' OR NEW.snapshot->>'contract_path' IS DISTINCT FROM e.signed_pdf_path) THEN
  RAISE EXCEPTION '电子签署记录无效，请刷新后重新保存';
 END IF;
 IF _reno_esign_money(NEW.snapshot) IS DISTINCT FROM e.terms->'money' THEN
  IF e.status='pending' THEN
   UPDATE renovation_contract_esigns SET status='voided',voided_at=now(),voided_by=auth.uid(),void_reason='合同金额、付款计划或PDF已修改，旧签署链接自动失效' WHERE id=e.id;
   RETURN NEW;
  END IF;
  RAISE EXCEPTION '业主已电子签署，合同金额、付款计划及合同PDF不能再修改；如确需修改，请店长先作废电子签署';
 END IF;
 IF e.status IN ('signed','countersigned') THEN
  NEW.snapshot:=jsonb_set(NEW.snapshot,'{signed_on}',to_jsonb(((e.signed_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date)::text));
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reno_esign_guard_snapshot ON public.renovation_projects;
CREATE TRIGGER reno_esign_guard_snapshot BEFORE UPDATE OF snapshot ON public.renovation_projects
 FOR EACH ROW EXECUTE FUNCTION public._reno_esign_guard_snapshot();
REVOKE ALL ON FUNCTION public._reno_esign_guard_snapshot() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._reno_esign_guard_confirm()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.state='draft' AND NEW.state<>'draft' AND EXISTS(SELECT 1 FROM renovation_contract_esigns WHERE project_id=NEW.id AND status IN ('pending','signed')) THEN
  RAISE EXCEPTION '电子签署尚未完成：须业主签署并由店长会签后再确认合同';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reno_esign_guard_confirm ON public.renovation_projects;
CREATE TRIGGER reno_esign_guard_confirm BEFORE UPDATE OF state ON public.renovation_projects
 FOR EACH ROW EXECUTE FUNCTION public._reno_esign_guard_confirm();
REVOKE ALL ON FUNCTION public._reno_esign_guard_confirm() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.renovation_contract_esign_view(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;
BEGIN
 SELECT * INTO p FROM renovation_projects WHERE id=p_id;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 RETURN (SELECT to_jsonb(e)-'failed_checks'-'verified_until' FROM renovation_contract_esigns e WHERE e.project_id=p.id ORDER BY (e.status='voided'),e.created_at DESC LIMIT 1);
END $$;
REVOKE ALL ON FUNCTION public.renovation_contract_esign_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_contract_esign_view(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.renovation_contract_esign_command(p_id uuid,p_revision integer,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;e renovation_contract_esigns%ROWTYPE;reason text;path text;
BEGIN
 IF auth.uid() IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF p_revision IS NULL OR p.revision<>p_revision THEN RAISE EXCEPTION '项目已被其他人修改，请刷新后重试'; END IF;
 IF p.state<>'draft' THEN RAISE EXCEPTION '合同已确认，不能再发起或修改电子签署'; END IF;
 SELECT * INTO e FROM renovation_contract_esigns WHERE project_id=p.id AND status<>'voided' FOR UPDATE;
 IF p_action='request' THEN
  IF e.id IS NOT NULL THEN RAISE EXCEPTION '已有进行中的电子签署，请先作废后再重新发起'; END IF;
  path:=p.snapshot->>'contract_path';
  IF p.snapshot IS NULL OR p.snapshot->'lines' IS NULL OR path IS NULL OR p.snapshot ? 'unsigned_contract_path'
   OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='renovation-contracts' AND name=path AND split_part(name,'/',1)=p.id::text)
   THEN RAISE EXCEPTION '请先上传未签名合同PDF并保存核对版本'; END IF;
  IF coalesce(p_data->>'contract_sha256','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION '合同PDF指纹无效，请刷新后重试'; END IF;
  IF length(regexp_replace(p.customer_phone,'\D','','g'))<8 THEN RAISE EXCEPTION '业主手机号不完整，无法验证签署人'; END IF;
  INSERT INTO renovation_contract_esigns(project_id,contract_path,contract_sha256,terms,created_by)
  VALUES(p.id,path,p_data->>'contract_sha256',jsonb_build_object('contract_no',p.contract_no,'customer_name',p.customer_name,'address',p.address,
   'store',(SELECT name FROM stores WHERE id=p.store_id),'contract_sha256',p_data->>'contract_sha256','money',_reno_esign_money(p.snapshot)),auth.uid())
  RETURNING * INTO e;
 ELSIF p_action='void' THEN
  IF e.id IS NULL OR e.status NOT IN ('pending','signed') THEN RAISE EXCEPTION '没有可作废的电子签署'; END IF;
  IF e.status='signed' AND NOT _reno_access(p.store_id,p.created_by,true) THEN RAISE EXCEPTION '业主已签署，须由店长作废'; END IF;
  reason:=trim(coalesce(p_data->>'reason',''));
  IF length(reason) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '请填写作废原因'; END IF;
  UPDATE renovation_contract_esigns SET status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=reason WHERE id=e.id RETURNING * INTO e;
 ELSIF p_action='countersign' THEN
  IF NOT _reno_access(p.store_id,p.created_by,true) THEN RAISE EXCEPTION '需店长或上级会签'; END IF;
  IF e.id IS NULL OR e.status<>'signed' THEN RAISE EXCEPTION '业主尚未完成电子签署'; END IF;
  IF _reno_esign_money(p.snapshot) IS DISTINCT FROM e.terms->'money' THEN RAISE EXCEPTION '合同内容与业主签署版本不一致'; END IF;
  IF length(trim(coalesce(p_data->>'signer_name',''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION '请填写会签人姓名'; END IF;
  PERFORM _reno_check_strokes(p_data->'strokes');
  path:=p_data->>'signed_pdf_path';
  IF path IS NULL OR path=e.contract_path OR split_part(path,'/',1)<>p.id::text OR path !~ '/signed-contract-[0-9a-f-]{36}\.pdf$'
   OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='renovation-contracts' AND name=path) THEN RAISE EXCEPTION '已签合同PDF尚未归档'; END IF;
  IF coalesce(p_data->>'signed_pdf_sha256','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION '已签合同PDF指纹无效'; END IF;
  UPDATE renovation_contract_esigns SET status='countersigned',company_signer_name=trim(p_data->>'signer_name'),company_strokes=p_data->'strokes',
   company_signed_by=auth.uid(),company_signed_at=now(),signed_pdf_path=path,signed_pdf_sha256=p_data->>'signed_pdf_sha256' WHERE id=e.id RETURNING * INTO e;
  -- The customer page and archive now open the signed copy; the unsigned original stays recorded.
  UPDATE renovation_projects SET snapshot=snapshot||jsonb_build_object('unsigned_contract_path',e.contract_path,'contract_path',path)
  WHERE id=p.id;
 ELSE RAISE EXCEPTION '不支持的电子签署操作'; END IF;
 UPDATE renovation_projects SET revision=revision+1,updated_at=now() WHERE id=p.id;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,auth.uid(),'esign_'||p_action,
  to_jsonb(e)-'signing_token'-'signature_strokes'-'company_strokes'-'failed_checks'-'verified_until');
 RETURN to_jsonb(e)-'failed_checks'-'verified_until';
END $$;
REVOKE ALL ON FUNCTION public.renovation_contract_esign_command(uuid,integer,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_contract_esign_command(uuid,integer,text,jsonb) TO authenticated;

-- Owner opens the link: the phone last-4 check gates every detail. Wrong digits are counted and
-- returned (not raised) so the count survives; 8 misses lock the link until the store re-issues it.
CREATE OR REPLACE FUNCTION public.renovation_contract_esign_open(p_esign uuid,p_sign_token uuid,p_last4 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e renovation_contract_esigns%ROWTYPE;p renovation_projects%ROWTYPE;
BEGIN
 SELECT * INTO e FROM renovation_contract_esigns WHERE id=p_esign AND signing_token=p_sign_token FOR UPDATE;
 IF e.id IS NULL THEN RETURN NULL; END IF;
 IF e.status='voided' THEN RETURN jsonb_build_object('status','voided'); END IF;
 IF e.failed_checks>=8 THEN RETURN jsonb_build_object('status','locked'); END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=e.project_id;
 IF NOT _reno_esign_check_phone(p.customer_phone,p_last4) THEN
  UPDATE renovation_contract_esigns SET failed_checks=failed_checks+1 WHERE id=e.id RETURNING * INTO e;
  RETURN jsonb_build_object('status',CASE WHEN e.failed_checks>=8 THEN 'locked' ELSE 'wrong_phone' END,'remaining',greatest(0,8-e.failed_checks));
 END IF;
 UPDATE renovation_contract_esigns SET failed_checks=0,verified_until=CASE WHEN status='pending' THEN now()+interval '30 minutes' ELSE verified_until END WHERE id=e.id RETURNING * INTO e;
 RETURN jsonb_build_object('status',e.status,'terms',e.terms,'terms_hash',encode(sha256(convert_to(e.terms::text,'UTF8')),'hex'),
  'contract_path',CASE WHEN e.status='pending' THEN e.contract_path END,'signed_at',e.signed_at,'signer_name',e.signer_name,'signature_hash',e.signature_hash);
END $$;
REVOKE ALL ON FUNCTION public.renovation_contract_esign_open(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_contract_esign_open(uuid,uuid,text) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.renovation_contract_esign_sign(p_esign uuid,p_sign_token uuid,p_last4 text,p_terms_hash text,p_strokes jsonb,p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e renovation_contract_esigns%ROWTYPE;p renovation_projects%ROWTYPE;at_time timestamptz:=now();record jsonb;
BEGIN
 SELECT * INTO e FROM renovation_contract_esigns WHERE id=p_esign AND signing_token=p_sign_token;
 IF e.id IS NULL THEN RAISE EXCEPTION '签署链接无效或已撤销'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=e.project_id FOR UPDATE;
 SELECT * INTO e FROM renovation_contract_esigns WHERE id=p_esign FOR UPDATE;
 IF e.status='voided' THEN RAISE EXCEPTION '此签署链接已作废，请联系门店'; END IF;
 IF e.status<>'pending' THEN RAISE EXCEPTION '合同已签署，不能重复签署'; END IF;
 IF e.failed_checks>=8 OR NOT _reno_esign_check_phone(p.customer_phone,p_last4) OR e.verified_until IS NULL OR e.verified_until<at_time THEN
  RAISE EXCEPTION '身份验证已过期，请重新输入手机号后四位';
 END IF;
 IF p.state<>'draft' THEN RAISE EXCEPTION '项目当前不可签署'; END IF;
 IF _reno_esign_money(p.snapshot) IS DISTINCT FROM e.terms->'money' OR p_terms_hash IS DISTINCT FROM encode(sha256(convert_to(e.terms::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION '合同内容已更新，请刷新核对后重新签名';
 END IF;
 IF p_accept IS DISTINCT FROM true THEN RAISE EXCEPTION '请勾选确认已阅读合同全部内容'; END IF;
 PERFORM _reno_check_strokes(p_strokes);
 record:=jsonb_build_object('terms',e.terms,'signer_name',p.customer_name,'signed_at',at_time,'signature',p_strokes,'consent',true,'phone_verified',true);
 UPDATE renovation_contract_esigns SET status='signed',signed_at=at_time,signer_name=p.customer_name,signed_terms_hash=p_terms_hash,
  signature_strokes=p_strokes,signature_hash=encode(sha256(convert_to(record::text,'UTF8')),'hex'),verified_until=NULL WHERE id=e.id RETURNING * INTO e;
 -- Re-saving the snapshot lets the guard stamp signed_on with the signing date.
 UPDATE renovation_projects SET snapshot=snapshot,revision=revision+1,updated_at=at_time WHERE id=p.id;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,NULL,'esign_customer_signed',
  jsonb_build_object('esign_id',e.id,'signed_at',e.signed_at,'signer_name',e.signer_name,'signature_hash',e.signature_hash));
 RETURN jsonb_build_object('ok',true,'signed_at',e.signed_at,'signature_hash',e.signature_hash);
END $$;
REVOKE ALL ON FUNCTION public.renovation_contract_esign_sign(uuid,uuid,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_contract_esign_sign(uuid,uuid,text,text,jsonb,boolean) TO anon,authenticated;

-- The owner's browser downloads the unsigned PDF only within 30 minutes of passing the phone check.
CREATE OR REPLACE FUNCTION public._reno_esign_pdf_readable(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM renovation_contract_esigns WHERE contract_path=p_name AND status='pending' AND verified_until>now());
$$;
REVOKE ALL ON FUNCTION public._reno_esign_pdf_readable(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._reno_esign_pdf_readable(text) TO anon;
DROP POLICY IF EXISTS reno_esign_pdf_read ON storage.objects;
CREATE POLICY reno_esign_pdf_read ON storage.objects FOR SELECT TO anon
 USING(bucket_id='renovation-contracts' AND public._reno_esign_pdf_readable(name));

-- E-signed contracts take the signing day as signed_on, often weeks after the deposit.
-- Payment dates may now go back 180 days before signing (was 30); same function as
-- renovation_payment_allocations_migration.sql otherwise.
CREATE OR REPLACE FUNCTION public.renovation_payment_command(p_id uuid,p_revision integer,p_action text,p_entry uuid,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;e renovation_payments%ROWTYPE;amt numeric;manager boolean;total numeric;paid numeric;pending numeric;delta numeric;verified boolean;stage integer;previous_stage integer;allocs jsonb;allocation jsonb;allocation_stage integer;allocation_amount numeric;allocation_total numeric;seen_stages integer[];
BEGIN
 IF auth.uid() IS NULL OR p_entry IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此门店项目权限'; END IF;
 IF p.state='draft' THEN RAISE EXCEPTION '请先确认合同，再登记实际收款'; END IF;
 manager:=_reno_access(p.store_id,p.created_by,true);
 SELECT * INTO e FROM renovation_payments WHERE id=p_entry;
 previous_stage:=e.installment;
 allocs:=CASE WHEN p_action='add' THEN p_data->'allocations' END;
 IF p_action='add' AND allocs IS NOT NULL AND p_data->>'installment' IS NOT NULL THEN RAISE EXCEPTION '拆分归款时不要同时指定单一期数'; END IF;
 IF p_action IN ('add','assign') THEN
  IF p_action='add' AND allocs IS NOT NULL THEN stage:=NULL;
  ELSIF p_data->>'installment' IS NOT NULL THEN
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
   AND e.method=p_data->>'method' AND e.paid_on=(p_data->>'paid_on')::date AND e.reference=trim(p_data->>'reference') AND e.note=coalesce(p_data->>'note','') AND e.installment IS NOT DISTINCT FROM stage AND e.allocations IS NOT DISTINCT FROM allocs THEN RETURN to_jsonb(e); END IF;
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
  IF nullif(p.snapshot->>'signed_on','') IS NOT NULL AND (p_data->>'paid_on')::date<(p.snapshot->>'signed_on')::date-180 THEN RAISE EXCEPTION '收退款日期不得早于签约日前180天，请核对日期'; END IF;
  IF (p_data->>'paid_on')::date<date_trunc('month',now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date AND (NOT manager OR coalesce(length(trim(p_data->>'note')),0)=0) THEN RAISE EXCEPTION '补登上月或更早的收退款会改动已结算业绩，须由店长或上级登记，并在备注写明原因'; END IF;
  IF allocs IS NOT NULL THEN
   IF jsonb_typeof(allocs)<>'array' THEN RAISE EXCEPTION '归款明细必须是列表'; END IF;
   IF jsonb_array_length(allocs) NOT BETWEEN 2 AND 50 THEN RAISE EXCEPTION '合并进款须分配到2至50个付款节点'; END IF;
   allocation_total:=0;seen_stages:=ARRAY[]::integer[];
   FOR allocation IN SELECT value FROM jsonb_array_elements(allocs) LOOP
    IF jsonb_typeof(allocation)<>'object' OR coalesce(allocation->>'installment','') !~ '^[1-9][0-9]{0,2}$'
     OR coalesce(allocation->>'amount','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION '归款期数或金额格式无效'; END IF;
    allocation_stage:=(allocation->>'installment')::integer;
    allocation_amount:=(allocation->>'amount')::numeric;
    IF allocation_amount<=0 OR allocation_stage=ANY(seen_stages)
     OR allocation_stage>jsonb_array_length(_reno_billing_plan(p_id)) THEN RAISE EXCEPTION '归款节点无效或重复'; END IF;
    IF coalesce((_reno_billing_plan(p_id)->(allocation_stage-1)->>'pending_signature')::boolean,false)
     OR coalesce((_reno_billing_plan(p_id)->(allocation_stage-1)->>'cancelled')::boolean,false)
     THEN RAISE EXCEPTION '待签或已作废增项不能收款'; END IF;
    seen_stages:=array_append(seen_stages,allocation_stage);
    allocation_total:=allocation_total+allocation_amount;
   END LOOP;
   IF allocation_total<>amt THEN RAISE EXCEPTION '各节点归款合计必须等于这笔实际收退款'; END IF;
  END IF;
  IF coalesce(length(trim(p_data->>'reference')),0) NOT BETWEEN 1 AND 200 OR length(coalesce(p_data->>'note',''))>1000 THEN RAISE EXCEPTION '请填写银行参考号或收据编号（最多200字），备注最多1000字'; END IF;
  IF p_data->>'kind'='refund' AND NOT manager THEN RAISE EXCEPTION '退款须由店长或上级登记'; END IF;
  IF p_data->>'kind'='receipt' AND paid+pending+amt>total THEN RAISE EXCEPTION '收款金额超过合同剩余应收（含待核对现金）'; END IF;
  IF p_data->>'kind'='refund' AND amt>paid THEN RAISE EXCEPTION '退款金额超过已确认净收款'; END IF;
  IF EXISTS(SELECT 1 FROM renovation_payments WHERE kind=p_data->>'kind' AND lower(reference)=lower(trim(p_data->>'reference')) AND voided_at IS NULL) THEN RAISE EXCEPTION '同一参考号或收据编号已在本项目或其他项目登记，请勿重复收款；一笔转账付多个项目请在参考号后加项目编号区分'; END IF;
  verified:=(p_data->>'method'<>'cash' OR manager);
  INSERT INTO renovation_payments(id,project_id,kind,amount,method,paid_on,reference,note,created_by,verified_by,verified_at,installment,allocations)
   VALUES(p_entry,p_id,p_data->>'kind',amt,p_data->>'method',(p_data->>'paid_on')::date,trim(p_data->>'reference'),coalesce(p_data->>'note',''),auth.uid(),CASE WHEN verified THEN auth.uid() END,CASE WHEN verified THEN now() END,stage,allocs) RETURNING * INTO e;
 ELSIF p_action='assign' THEN
  IF e.allocations IS NOT NULL THEN RAISE EXCEPTION '合并进款不可用单一期数调整；请由店长核对后作废重登'; END IF;
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

NOTIFY pgrst,'reload schema';
COMMIT;
