-- 施工排期也可以转发外部链接：监理或外部施工单位凭链接 + 验证码，填计划开工 / 完工日期并签字；
-- 签字只作记录，员工在子单里「一键确认排期」后才更新进度。依赖 renovation_signoff_owner_proof_migration.sql。可重复运行。
ALTER TABLE public.renovation_party_signoffs DROP CONSTRAINT IF EXISTS renovation_party_signoffs_purpose_check;
ALTER TABLE public.renovation_party_signoffs ADD CONSTRAINT renovation_party_signoffs_purpose_check CHECK(purpose IN ('order','arrival','install','issue','schedule'));
ALTER TABLE public.renovation_party_signoffs ADD COLUMN IF NOT EXISTS plan_start date;
ALTER TABLE public.renovation_party_signoffs ADD COLUMN IF NOT EXISTS plan_end date;

-- 发起签字时允许新用途「schedule」
DO $patch$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.renovation_signoff_command(uuid,text,jsonb)'::regprocedure);
 IF position($x$('order','arrival','install','issue','schedule')$x$ IN d)=0 THEN
  d:=replace(d,$x$v_purpose NOT IN ('order','arrival','install','issue')$x$,$x$v_purpose NOT IN ('order','arrival','install','issue','schedule')$x$);
  IF position($x$('order','arrival','install','issue','schedule')$x$ IN d)=0 THEN RAISE EXCEPTION '没找到签字用途的检查，未修改。请把这条信息发给技术人员。'; END IF;
  EXECUTE d;
 END IF;
END $patch$;

CREATE OR REPLACE FUNCTION public.renovation_signoff_sign(p_id uuid,p_token uuid,p_code text,p_terms_hash text,p_name text,p_company text,p_note text,p_strokes jsonb,p_accept boolean,p_extra jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s renovation_party_signoffs%ROWTYPE;at_time timestamptz:=now();record jsonb;
 v_name text:=trim(coalesce(p_name,''));v_company text:=trim(coalesce(p_company,''));v_note text:=trim(coalesce(p_note,''));
 v_ship date;v_start date;v_end date;v_ref text:=nullif(trim(coalesce(p_extra->>'factory_ref','')),'');v_phone text:=nullif(trim(coalesce(p_extra->>'contact_phone','')),'');
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
 IF p_extra IS NOT NULL AND jsonb_typeof(p_extra) NOT IN ('object','null') THEN RAISE EXCEPTION '资料格式不对'; END IF;
 BEGIN v_ship:=nullif(p_extra->>'ship_on','')::date; EXCEPTION WHEN others THEN RAISE EXCEPTION '出货日期格式不对'; END;
 IF s.purpose='order' AND v_ship IS NULL THEN RAISE EXCEPTION '请填写预计出货日期'; END IF;
 BEGIN v_start:=nullif(p_extra->>'start_on','')::date;v_end:=nullif(p_extra->>'end_on','')::date; EXCEPTION WHEN others THEN RAISE EXCEPTION '排期日期格式不对'; END;
 IF s.purpose='schedule' AND v_start IS NULL THEN RAISE EXCEPTION '请填写计划开工日期'; END IF;
 IF v_start IS NOT NULL AND (v_start<(at_time AT TIME ZONE 'Asia/Kuala_Lumpur')::date-1 OR v_start>DATE '2099-12-31') THEN RAISE EXCEPTION '开工日期不能早于今天'; END IF;
 IF v_end IS NOT NULL AND (v_start IS NULL OR v_end<v_start OR v_end>DATE '2099-12-31') THEN RAISE EXCEPTION '完工日期不能早于开工日期'; END IF;
 IF v_ship IS NOT NULL AND (v_ship<(at_time AT TIME ZONE 'Asia/Kuala_Lumpur')::date-1 OR v_ship>DATE '2099-12-31') THEN RAISE EXCEPTION '出货日期不能早于今天'; END IF;
 IF length(v_ref)>60 OR length(v_phone)>40 THEN RAISE EXCEPTION '工厂单号或电话太长'; END IF;
 PERFORM _reno_check_strokes(p_strokes);
 record:=jsonb_build_object('terms',s.terms,'signer_name',v_name,'signer_company',v_company,'note',v_note,'signed_at',at_time,'signature',p_strokes,'consent',true,'code_verified',true,
  'ship_on',v_ship,'factory_ref',v_ref,'contact_phone',v_phone,'start_on',v_start,'end_on',v_end);
 UPDATE renovation_party_signoffs SET status='signed',signed_at=at_time,signer_name=v_name,signer_company=v_company,signer_note=nullif(v_note,''),
  signed_terms_hash=p_terms_hash,signature_strokes=p_strokes,signature_hash=encode(sha256(convert_to(record::text,'UTF8')),'hex'),verified_until=NULL,
  ship_on=v_ship,factory_ref=v_ref,contact_phone=v_phone,plan_start=v_start,plan_end=v_end
  WHERE id=s.id RETURNING * INTO s;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(s.project_id,NULL,'signoff_signed',
  jsonb_build_object('signoff_id',s.id,'purpose',s.purpose,'signed_at',s.signed_at,'signer_name',s.signer_name,'signer_company',s.signer_company,'note',s.signer_note,
   'ship_on',s.ship_on,'factory_ref',s.factory_ref,'contact_phone',s.contact_phone,'plan_start',s.plan_start,'plan_end',s.plan_end,'signature_hash',s.signature_hash));
 RETURN jsonb_build_object('ok',true,'signed_at',s.signed_at,'signature_hash',s.signature_hash);
END $$;
REVOKE ALL ON FUNCTION public.renovation_signoff_sign(uuid,uuid,text,text,text,text,text,jsonb,boolean,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_signoff_sign(uuid,uuid,text,text,text,text,text,jsonb,boolean,jsonb) TO anon,authenticated;
