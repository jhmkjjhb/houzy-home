-- 工厂确认下单的签字页，带上业主已签名确认的图纸和业主签名（电子手写签名，或纸质确认单扫描件），
-- 让工厂看清清单的同时也看到业主已经确认。只给「工厂确认下单内容」的链接，只在验证码通过、还没签字时可看。
-- 另外：工厂确认下单时必须填预计出货日期，可填工厂单号和联系人电话。仍然不给业主姓名和电话。依赖 renovation_party_signoffs_migration.sql。可重复运行。

-- 这张签字单涉及的每一项，取业主最新一版已签名的确认
CREATE OR REPLACE FUNCTION public._reno_signoff_owner_proofs(p_signoff uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH s AS (SELECT * FROM renovation_party_signoffs WHERE id=p_signoff AND purpose='order'),
 latest AS (
  SELECT DISTINCT ON (l.line) l.line,c.id cid,s.work_order_id
  FROM s CROSS JOIN LATERAL jsonb_array_elements_text(s.line_ids) l(line)
  JOIN renovation_custom_confirmations c ON c.work_order_id=s.work_order_id AND c.status='signed' AND c.line_ids ? l.line
  ORDER BY l.line,c.version DESC)
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'kind',c.kind,'version',c.version,'method',c.method,'signed_at',c.signed_at,
   'lines',(SELECT coalesce(jsonb_agg(i.name ORDER BY i.line_id),'[]'::jsonb) FROM latest x JOIN renovation_work_items i ON i.work_order_id=x.work_order_id AND i.line_id=x.line WHERE x.cid=c.id),
   'document_path',c.document_path,'document_sha256',c.document_sha256,
   'paper_path',CASE WHEN c.method='paper' THEN c.paper_path END,'paper_sha256',CASE WHEN c.method='paper' THEN c.paper_sha256 END,
   'strokes',CASE WHEN c.method='electronic' THEN c.signature_strokes END) ORDER BY c.version),'[]'::jsonb)
 FROM renovation_custom_confirmations c WHERE c.id IN (SELECT cid FROM latest);
$$;
REVOKE ALL ON FUNCTION public._reno_signoff_owner_proofs(uuid) FROM PUBLIC,anon,authenticated;

-- 附件可读：本单附件，或（工厂确认下单时）业主签名时的图纸 / 纸质确认单。都只在验证通过的 30 分钟内。
CREATE OR REPLACE FUNCTION public._reno_signoff_doc_readable(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM renovation_party_signoffs WHERE document_path=p_name AND status='pending' AND verified_until>now())
  OR EXISTS(SELECT 1 FROM renovation_party_signoffs s WHERE s.purpose='order' AND s.status='pending' AND s.verified_until>now()
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(public._reno_signoff_owner_proofs(s.id)) p WHERE p->>'document_path'=p_name OR p->>'paper_path'=p_name));
$$;
REVOKE ALL ON FUNCTION public._reno_signoff_doc_readable(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._reno_signoff_doc_readable(text) TO anon;

-- 打开签字页时多返回 owner_proofs（只在等待签字时）
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
  'document_path',CASE WHEN s.status='pending' THEN s.document_path END,'signed_at',s.signed_at,'signer_name',s.signer_name,'signer_company',s.signer_company,
  'owner_proofs',CASE WHEN s.status='pending' THEN public._reno_signoff_owner_proofs(s.id) ELSE '[]'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION public.renovation_signoff_open(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_signoff_open(uuid,uuid,text) TO anon,authenticated;

-- 工厂确认下单时必须填：预计出货日期；选填：工厂单号、工厂联系人电话。签字后员工在记录里看到。
ALTER TABLE public.renovation_party_signoffs ADD COLUMN IF NOT EXISTS ship_on date;
ALTER TABLE public.renovation_party_signoffs ADD COLUMN IF NOT EXISTS factory_ref text CHECK(factory_ref IS NULL OR length(factory_ref)<=60);
ALTER TABLE public.renovation_party_signoffs ADD COLUMN IF NOT EXISTS contact_phone text CHECK(contact_phone IS NULL OR length(contact_phone)<=40);

DROP FUNCTION IF EXISTS public.renovation_signoff_sign(uuid,uuid,text,text,text,text,text,jsonb,boolean);
CREATE OR REPLACE FUNCTION public.renovation_signoff_sign(p_id uuid,p_token uuid,p_code text,p_terms_hash text,p_name text,p_company text,p_note text,p_strokes jsonb,p_accept boolean,p_extra jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s renovation_party_signoffs%ROWTYPE;at_time timestamptz:=now();record jsonb;
 v_name text:=trim(coalesce(p_name,''));v_company text:=trim(coalesce(p_company,''));v_note text:=trim(coalesce(p_note,''));
 v_ship date;v_ref text:=nullif(trim(coalesce(p_extra->>'factory_ref','')),'');v_phone text:=nullif(trim(coalesce(p_extra->>'contact_phone','')),'');
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
 IF v_ship IS NOT NULL AND (v_ship<(at_time AT TIME ZONE 'Asia/Kuala_Lumpur')::date-1 OR v_ship>DATE '2099-12-31') THEN RAISE EXCEPTION '出货日期不能早于今天'; END IF;
 IF length(v_ref)>60 OR length(v_phone)>40 THEN RAISE EXCEPTION '工厂单号或电话太长'; END IF;
 PERFORM _reno_check_strokes(p_strokes);
 record:=jsonb_build_object('terms',s.terms,'signer_name',v_name,'signer_company',v_company,'note',v_note,'signed_at',at_time,'signature',p_strokes,'consent',true,'code_verified',true,
  'ship_on',v_ship,'factory_ref',v_ref,'contact_phone',v_phone);
 UPDATE renovation_party_signoffs SET status='signed',signed_at=at_time,signer_name=v_name,signer_company=v_company,signer_note=nullif(v_note,''),
  signed_terms_hash=p_terms_hash,signature_strokes=p_strokes,signature_hash=encode(sha256(convert_to(record::text,'UTF8')),'hex'),verified_until=NULL,
  ship_on=v_ship,factory_ref=v_ref,contact_phone=v_phone
  WHERE id=s.id RETURNING * INTO s;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(s.project_id,NULL,'signoff_signed',
  jsonb_build_object('signoff_id',s.id,'purpose',s.purpose,'signed_at',s.signed_at,'signer_name',s.signer_name,'signer_company',s.signer_company,'note',s.signer_note,
   'ship_on',s.ship_on,'factory_ref',s.factory_ref,'contact_phone',s.contact_phone,'signature_hash',s.signature_hash));
 RETURN jsonb_build_object('ok',true,'signed_at',s.signed_at,'signature_hash',s.signature_hash);
END $$;
REVOKE ALL ON FUNCTION public.renovation_signoff_sign(uuid,uuid,text,text,text,text,text,jsonb,boolean,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_signoff_sign(uuid,uuid,text,text,text,text,text,jsonb,boolean,jsonb) TO anon,authenticated;
