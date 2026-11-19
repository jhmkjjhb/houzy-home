-- 工厂确认下单的签字页，带上业主已签名确认的图纸和业主签名（电子手写签名，或纸质确认单扫描件），
-- 让工厂看清清单的同时也看到业主已经确认。只给「工厂确认下单内容」的链接，只在验证码通过、还没签字时可看。
-- 仍然不给业主姓名和电话。依赖 renovation_party_signoffs_migration.sql。可重复运行。

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
