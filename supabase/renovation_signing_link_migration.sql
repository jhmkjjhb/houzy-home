-- Signing-only links for additions.
-- An owner may forward the signing link to a family member who signs on their behalf. The old link
-- carried the project's customer_token, which opens the whole project (contract, payments, progress).
-- These functions accept only the addition id + its own signing_token, return only that addition,
-- and leave out the project-wide totals. Signing reuses renovation_customer_sign_addition, so every
-- check (terms hash, stroke validation, state, audit) stays identical. Safe to re-run.
BEGIN;

CREATE OR REPLACE FUNCTION public.renovation_signing_link_view(p_addition uuid,p_sign_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',a.id,'status',CASE WHEN a.voided_at IS NOT NULL THEN 'voided' ELSE a.signature_status END,
 'terms',(CASE WHEN a.signature_status='signed' THEN a.signed_snapshot->'terms' ELSE _reno_addition_terms(a.id) END)-'current_total'-'after_sign_total',
 'terms_hash',CASE WHEN a.signature_status='signed' THEN a.signed_terms_hash ELSE encode(sha256(convert_to(_reno_addition_terms(a.id)::text,'UTF8')),'hex') END,
 'signed_at',a.signed_at,'signer_name',a.signer_name,'signature_hash',a.signature_hash,'signature_strokes',a.signature_strokes)
 FROM renovation_additions a JOIN renovation_projects p ON p.id=a.project_id WHERE a.id=p_addition AND a.signing_token=p_sign_token AND p.state<>'draft';
$$;

CREATE OR REPLACE FUNCTION public.renovation_signing_link_sign(p_addition uuid,p_sign_token uuid,p_terms_hash text,p_name text,p_strokes jsonb,p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_token uuid;
BEGIN
 SELECT p.customer_token INTO v_token FROM renovation_additions a JOIN renovation_projects p ON p.id=a.project_id
  WHERE a.id=p_addition AND a.signing_token=p_sign_token;
 IF v_token IS NULL THEN RAISE EXCEPTION '签署链接无效或已撤销'; END IF;
 RETURN renovation_customer_sign_addition(v_token,p_addition,p_sign_token,p_terms_hash,p_name,p_strokes,p_accept);
END;$$;

REVOKE ALL ON FUNCTION public.renovation_signing_link_view(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_signing_link_view(uuid,uuid) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.renovation_signing_link_sign(uuid,uuid,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_signing_link_sign(uuid,uuid,text,text,jsonb,boolean) TO anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
