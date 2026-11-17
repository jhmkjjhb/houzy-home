-- 履约子单「转发签字」：把勾选的清单项发给工厂或负责人，凭链接 + 4 位验证码查看并手写签字。
-- 用途：工厂确认下单内容 / 到货验收 / 安装完工 / 问题处理。签字只作记录和凭证，不改变清单项的进度。
-- 链接里不放任何价格，也不放业主姓名和电话（只有合同号、地址、子单名称和清单项）。
-- 依赖 renovation_fulfillment_migration.sql 和 renovation_contract_esign_migration.sql（_reno_check_strokes）。可重复运行。

CREATE TABLE IF NOT EXISTS public.renovation_party_signoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.renovation_projects(id),
 work_order_id uuid NOT NULL REFERENCES public.renovation_work_orders(id),
 purpose text NOT NULL CHECK(purpose IN ('order','arrival','install','issue')),
 party text NOT NULL CHECK(length(party) BETWEEN 1 AND 120),
 line_ids jsonb NOT NULL,
 terms jsonb NOT NULL,
 document_path text, document_sha256 text CHECK(document_sha256 IS NULL OR document_sha256 ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','signed','voided')),
 signing_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 access_code text NOT NULL CHECK(access_code ~ '^[0-9]{4}$'),
 failed_checks integer NOT NULL DEFAULT 0,
 verified_until timestamptz,
 signer_name text, signer_company text, signer_note text, signed_at timestamptz,
 signed_terms_hash text, signature_strokes jsonb, signature_hash text,
 voided_at timestamptz, voided_by uuid, void_reason text,
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT reno_signoff_signed_check CHECK(status<>'signed' OR (signed_at IS NOT NULL AND signer_name IS NOT NULL AND signer_company IS NOT NULL
  AND signature_strokes IS NOT NULL AND signature_hash IS NOT NULL AND signed_terms_hash IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS reno_signoffs_project ON public.renovation_party_signoffs(project_id);

-- 员工只能读，验证码也只给有项目权限的员工看到；新建、撤销、签字都走下面的函数。
ALTER TABLE public.renovation_party_signoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renovation_party_signoffs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.renovation_party_signoffs TO authenticated;
DROP POLICY IF EXISTS reno_signoffs_read ON public.renovation_party_signoffs;
CREATE POLICY reno_signoffs_read ON public.renovation_party_signoffs FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.renovation_projects p WHERE p.id=project_id AND public._reno_access(p.store_id,p.created_by)));

-- 签字人验证通过后 30 分钟内可以读附件（图纸 / 照片）。
CREATE OR REPLACE FUNCTION public._reno_signoff_doc_readable(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM renovation_party_signoffs WHERE document_path=p_name AND status='pending' AND verified_until>now());
$$;
REVOKE ALL ON FUNCTION public._reno_signoff_doc_readable(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._reno_signoff_doc_readable(text) TO anon;
DROP POLICY IF EXISTS reno_signoff_doc_read ON storage.objects;
CREATE POLICY reno_signoff_doc_read ON storage.objects FOR SELECT TO anon
 USING(bucket_id='renovation-fulfillment' AND public._reno_signoff_doc_readable(name));

-- 员工：生成签字链接（create）、撤销（void）。
CREATE OR REPLACE FUNCTION public.renovation_signoff_command(p_id uuid,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;w renovation_work_orders%ROWTYPE;s renovation_party_signoffs%ROWTYPE;
 v_purpose text;v_party text;v_note text;v_lines jsonb;picked uuid[];path text;doc_hash text;code text;
BEGIN
 IF auth.uid() IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;

 IF p_action='create' THEN
  IF p.state<>'executing' THEN RAISE EXCEPTION '项目当前不可发起签字'; END IF;
  SELECT * INTO w FROM renovation_work_orders WHERE id=(p_data->>'work_order_id')::uuid AND project_id=p_id AND cancelled_at IS NULL;
  IF w.id IS NULL THEN RAISE EXCEPTION '子订单不存在或已作废'; END IF;
  v_purpose:=p_data->>'purpose';
  IF v_purpose IS NULL OR v_purpose NOT IN ('order','arrival','install','issue') THEN RAISE EXCEPTION '请选择签字用途'; END IF;
  v_party:=trim(coalesce(p_data->>'party',''));
  IF v_party='' OR length(v_party)>120 THEN RAISE EXCEPTION '请填写签字方（工厂或负责人）'; END IF;
  v_note:=trim(coalesce(p_data->>'note',''));
  IF length(v_note)>1000 THEN RAISE EXCEPTION '说明太长，请控制在 1000 字以内'; END IF;
  v_lines:=p_data->'line_ids';
  IF v_lines IS NOT NULL AND jsonb_typeof(v_lines)<>'array' THEN RAISE EXCEPTION '清单项格式不对'; END IF;
  SELECT array_agg(i.id) INTO picked FROM renovation_work_items i
   WHERE i.work_order_id=w.id AND i.stage<>'cancelled'
    AND (coalesce(jsonb_array_length(v_lines),0)=0 OR i.line_id IN (SELECT jsonb_array_elements_text(v_lines)));
  IF coalesce(jsonb_array_length(v_lines),0)>0 AND coalesce(cardinality(picked),0)<>(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(v_lines) x) THEN
   RAISE EXCEPTION '勾选的清单项不属于这张子单或已取消，请刷新后重试';
  END IF;
  IF picked IS NULL THEN RAISE EXCEPTION '这张子单没有可签字的清单项'; END IF;
  IF v_purpose='issue' AND NOT EXISTS(SELECT 1 FROM renovation_work_items WHERE id=ANY(picked) AND issue_note IS NOT NULL) AND v_note='' THEN
   RAISE EXCEPTION '问题处理签字：请先给勾选项标记问题，或在说明里写明要处理的问题';
  END IF;
  IF coalesce(p_data->>'document_path','')<>'' THEN
   path:=_reno_file_arg(p_id,p_data->>'document_path','附件');
   doc_hash:=lower(coalesce(p_data->>'document_sha256',''));
   IF doc_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION '附件校验信息无效，请重新上传'; END IF;
  END IF;
  code:=lpad(((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint)%10000)::text,4,'0');
  INSERT INTO renovation_party_signoffs(project_id,work_order_id,purpose,party,line_ids,terms,document_path,document_sha256,access_code,created_by)
  SELECT p_id,w.id,v_purpose,v_party,jsonb_agg(i.line_id ORDER BY i.line_id),
   jsonb_build_object('contract_no',p.contract_no,'address',p.address,'group_name',w.group_name,'purpose',v_purpose,'party',v_party,'note',v_note,
    'document_sha256',doc_hash,'created_at',now(),
    'lines',jsonb_agg(jsonb_build_object('id',i.line_id,'name',i.name,'spec',i.spec,'qty',i.qty,'unit',i.unit,
      'issue',CASE WHEN v_purpose='issue' THEN i.issue_note END) ORDER BY i.line_id)),
   path,doc_hash,code,auth.uid()
  FROM renovation_work_items i WHERE i.id=ANY(picked) RETURNING * INTO s;
  INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p_id,auth.uid(),'signoff_created',
   jsonb_build_object('signoff_id',s.id,'work_order_id',w.id,'purpose',v_purpose,'party',v_party,'line_ids',s.line_ids));
  RETURN jsonb_build_object('id',s.id,'token',s.signing_token,'code',s.access_code);

 ELSIF p_action='void' THEN
  SELECT * INTO s FROM renovation_party_signoffs WHERE id=(p_data->>'signoff_id')::uuid AND project_id=p_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION '签字单不存在'; END IF;
  IF s.status<>'pending' THEN RAISE EXCEPTION '只有等待签字的链接可以撤销'; END IF;
  IF trim(coalesce(p_data->>'reason',''))='' THEN RAISE EXCEPTION '请填写撤销原因'; END IF;
  UPDATE renovation_party_signoffs SET status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=trim(p_data->>'reason'),verified_until=NULL WHERE id=s.id;
  INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p_id,auth.uid(),'signoff_voided',jsonb_build_object('signoff_id',s.id,'reason',trim(p_data->>'reason')));
  RETURN jsonb_build_object('ok',true);
 END IF;
 RAISE EXCEPTION '不支持的操作';
END $$;
REVOKE ALL ON FUNCTION public.renovation_signoff_command(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_signoff_command(uuid,text,jsonb) TO authenticated;

-- 签字人：凭链接 + 验证码查看。验证码错 8 次锁定，需门店撤销后重发。
CREATE OR REPLACE FUNCTION public.renovation_signoff_open(p_id uuid,p_token uuid,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s renovation_party_signoffs%ROWTYPE;
BEGIN
 SELECT * INTO s FROM renovation_party_signoffs WHERE id=p_id AND signing_token=p_token FOR UPDATE;
 IF s.id IS NULL THEN RETURN NULL; END IF;
 IF s.status='voided' THEN RETURN jsonb_build_object('status','voided'); END IF;
 IF s.failed_checks>=8 THEN RETURN jsonb_build_object('status','locked'); END IF;
 IF p_code IS DISTINCT FROM s.access_code THEN
  UPDATE renovation_party_signoffs SET failed_checks=failed_checks+1 WHERE id=s.id RETURNING * INTO s;
  RETURN jsonb_build_object('status',CASE WHEN s.failed_checks>=8 THEN 'locked' ELSE 'wrong_code' END,'remaining',greatest(0,8-s.failed_checks));
 END IF;
 UPDATE renovation_party_signoffs SET failed_checks=0,verified_until=CASE WHEN status='pending' THEN now()+interval '30 minutes' ELSE verified_until END WHERE id=s.id RETURNING * INTO s;
 RETURN jsonb_build_object('status',s.status,'terms',s.terms,'terms_hash',encode(sha256(convert_to(s.terms::text,'UTF8')),'hex'),
  'document_path',CASE WHEN s.status='pending' THEN s.document_path END,'signed_at',s.signed_at,'signer_name',s.signer_name,'signer_company',s.signer_company);
END $$;
REVOKE ALL ON FUNCTION public.renovation_signoff_open(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_signoff_open(uuid,uuid,text) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.renovation_signoff_sign(p_id uuid,p_token uuid,p_code text,p_terms_hash text,p_name text,p_company text,p_note text,p_strokes jsonb,p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s renovation_party_signoffs%ROWTYPE;at_time timestamptz:=now();record jsonb;
 v_name text:=trim(coalesce(p_name,''));v_company text:=trim(coalesce(p_company,''));v_note text:=trim(coalesce(p_note,''));
BEGIN
 SELECT * INTO s FROM renovation_party_signoffs WHERE id=p_id AND signing_token=p_token FOR UPDATE;
 IF s.id IS NULL THEN RAISE EXCEPTION '签字链接无效或已撤销'; END IF;
 IF s.status='voided' THEN RAISE EXCEPTION '此签字链接已撤销，请联系门店'; END IF;
 IF s.status<>'pending' THEN RAISE EXCEPTION '此签字单已签过，不能重复签'; END IF;
 IF s.failed_checks>=8 OR p_code IS DISTINCT FROM s.access_code OR s.verified_until IS NULL OR s.verified_until<at_time THEN
  RAISE EXCEPTION '验证已过期，请重新输入验证码';
 END IF;
 IF p_terms_hash IS DISTINCT FROM encode(sha256(convert_to(s.terms::text,'UTF8')),'hex') THEN RAISE EXCEPTION '签字单内容已更新，请刷新核对后重新签字'; END IF;
 IF p_accept IS DISTINCT FROM true THEN RAISE EXCEPTION '请勾选确认已核对全部内容'; END IF;
 IF v_name='' OR v_company='' OR length(v_name)>100 OR length(v_company)>120 THEN RAISE EXCEPTION '请填写签字人姓名和所属工厂 / 单位'; END IF;
 IF length(v_note)>1000 THEN RAISE EXCEPTION '备注太长，请控制在 1000 字以内'; END IF;
 PERFORM _reno_check_strokes(p_strokes);
 record:=jsonb_build_object('terms',s.terms,'signer_name',v_name,'signer_company',v_company,'note',v_note,'signed_at',at_time,'signature',p_strokes,'consent',true,'code_verified',true);
 UPDATE renovation_party_signoffs SET status='signed',signed_at=at_time,signer_name=v_name,signer_company=v_company,signer_note=nullif(v_note,''),
  signed_terms_hash=p_terms_hash,signature_strokes=p_strokes,signature_hash=encode(sha256(convert_to(record::text,'UTF8')),'hex'),verified_until=NULL
  WHERE id=s.id RETURNING * INTO s;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(s.project_id,NULL,'signoff_signed',
  jsonb_build_object('signoff_id',s.id,'purpose',s.purpose,'signed_at',s.signed_at,'signer_name',s.signer_name,'signer_company',s.signer_company,'note',s.signer_note,'signature_hash',s.signature_hash));
 RETURN jsonb_build_object('ok',true,'signed_at',s.signed_at,'signature_hash',s.signature_hash);
END $$;
REVOKE ALL ON FUNCTION public.renovation_signoff_sign(uuid,uuid,text,text,text,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_signoff_sign(uuid,uuid,text,text,text,text,text,jsonb,boolean) TO anon,authenticated;
