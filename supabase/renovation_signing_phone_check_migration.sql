-- Phone last-4 check on addition and deduction signing links.
-- A signing link may end up in a group chat. Before this, anyone holding the link could read the
-- amounts and payment plan and could sign. Now the link shows nothing until the owner's registered
-- phone last 4 digits are entered, the same check the contract e-sign uses.
-- 8 wrong tries lock the link for 1 hour. Signing is accepted only within 30 minutes of a passed
-- check, so the sign call cannot be used to guess digits.
-- The old link functions stay for internal reuse but anon/authenticated can no longer call them.
-- The owner's own project page (customer_token) is unchanged.
-- Run after renovation_contract_esign and renovation_prorate_installments migrations. Safe to re-run.
BEGIN;

ALTER TABLE public.renovation_additions ADD COLUMN IF NOT EXISTS link_failed_checks integer NOT NULL DEFAULT 0;
ALTER TABLE public.renovation_additions ADD COLUMN IF NOT EXISTS link_locked_until timestamptz;
ALTER TABLE public.renovation_additions ADD COLUMN IF NOT EXISTS link_verified_until timestamptz;
ALTER TABLE public.renovation_deductions ADD COLUMN IF NOT EXISTS link_failed_checks integer NOT NULL DEFAULT 0;
ALTER TABLE public.renovation_deductions ADD COLUMN IF NOT EXISTS link_locked_until timestamptz;
ALTER TABLE public.renovation_deductions ADD COLUMN IF NOT EXISTS link_verified_until timestamptz;

-- Shared result for a check that did not pass (NULL when it passed).
CREATE OR REPLACE FUNCTION public._reno_link_gate(p_phone text,p_last4 text,p_failed integer,p_locked timestamptz)
RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT CASE
  WHEN p_locked>now() THEN jsonb_build_object('status','locked')
  WHEN length(regexp_replace(coalesce(p_phone,''),'\D','','g'))<4 THEN jsonb_build_object('status','no_phone')
  WHEN _reno_esign_check_phone(p_phone,p_last4) THEN NULL
  ELSE jsonb_build_object('status',CASE WHEN p_failed+1>=8 THEN 'locked' ELSE 'wrong_phone' END,'remaining',greatest(0,8-(p_failed+1))) END;
$$;
REVOKE ALL ON FUNCTION public._reno_link_gate(text,text,integer,timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.renovation_signing_link_open(p_addition uuid,p_sign_token uuid,p_last4 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a renovation_additions%ROWTYPE;phone text;gate jsonb;
BEGIN
 SELECT x.* INTO a FROM renovation_additions x JOIN renovation_projects p ON p.id=x.project_id
  WHERE x.id=p_addition AND x.signing_token=p_sign_token AND p.state<>'draft' FOR UPDATE OF x;
 IF a.id IS NULL THEN RETURN NULL; END IF;
 SELECT customer_phone INTO phone FROM renovation_projects WHERE id=a.project_id;
 gate:=_reno_link_gate(phone,p_last4,a.link_failed_checks,a.link_locked_until);
 IF gate IS NOT NULL THEN
  IF gate->>'status' IN ('wrong_phone','locked') AND NOT coalesce(a.link_locked_until>now(),false) THEN
   UPDATE renovation_additions SET link_failed_checks=CASE WHEN gate->>'status'='locked' THEN 0 ELSE link_failed_checks+1 END,
    link_locked_until=CASE WHEN gate->>'status'='locked' THEN now()+interval '1 hour' ELSE link_locked_until END WHERE id=a.id;
  END IF;
  RETURN gate;
 END IF;
 UPDATE renovation_additions SET link_failed_checks=0,link_verified_until=now()+interval '30 minutes' WHERE id=a.id;
 RETURN renovation_signing_link_view(p_addition,p_sign_token);
END $$;

CREATE OR REPLACE FUNCTION public.renovation_deduction_link_open(p_entry uuid,p_sign_token uuid,p_last4 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d renovation_deductions%ROWTYPE;phone text;gate jsonb;
BEGIN
 SELECT x.* INTO d FROM renovation_deductions x JOIN renovation_projects p ON p.id=x.project_id
  WHERE x.id=p_entry AND x.signing_token=p_sign_token AND p.state<>'draft' FOR UPDATE OF x;
 IF d.id IS NULL THEN RETURN NULL; END IF;
 SELECT customer_phone INTO phone FROM renovation_projects WHERE id=d.project_id;
 gate:=_reno_link_gate(phone,p_last4,d.link_failed_checks,d.link_locked_until);
 IF gate IS NOT NULL THEN
  IF gate->>'status' IN ('wrong_phone','locked') AND NOT coalesce(d.link_locked_until>now(),false) THEN
   UPDATE renovation_deductions SET link_failed_checks=CASE WHEN gate->>'status'='locked' THEN 0 ELSE link_failed_checks+1 END,
    link_locked_until=CASE WHEN gate->>'status'='locked' THEN now()+interval '1 hour' ELSE link_locked_until END WHERE id=d.id;
  END IF;
  RETURN gate;
 END IF;
 UPDATE renovation_deductions SET link_failed_checks=0,link_verified_until=now()+interval '30 minutes' WHERE id=d.id;
 RETURN renovation_deduction_sign_view(p_entry,p_sign_token);
END $$;

-- Signing re-checks the digits and needs a passed check in the last 30 minutes.
CREATE OR REPLACE FUNCTION public.renovation_signing_link_sign(p_addition uuid,p_sign_token uuid,p_last4 text,p_terms_hash text,p_name text,p_strokes jsonb,p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a renovation_additions%ROWTYPE;phone text;
BEGIN
 SELECT * INTO a FROM renovation_additions WHERE id=p_addition AND signing_token=p_sign_token;
 IF a.id IS NULL THEN RAISE EXCEPTION '签署链接无效或已撤销'; END IF;
 SELECT customer_phone INTO phone FROM renovation_projects WHERE id=a.project_id;
 IF coalesce(a.link_locked_until>now(),false) OR NOT _reno_esign_check_phone(phone,p_last4) OR a.link_verified_until IS NULL OR a.link_verified_until<now() THEN
  RAISE EXCEPTION '手机号验证已过期，请刷新页面重新验证';
 END IF;
 RETURN renovation_signing_link_sign(p_addition,p_sign_token,p_terms_hash,p_name,p_strokes,p_accept);
END $$;

CREATE OR REPLACE FUNCTION public.renovation_deduction_link_sign(p_entry uuid,p_sign_token uuid,p_last4 text,p_terms_hash text,p_name text,p_strokes jsonb,p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d renovation_deductions%ROWTYPE;phone text;
BEGIN
 SELECT * INTO d FROM renovation_deductions WHERE id=p_entry AND signing_token=p_sign_token;
 IF d.id IS NULL THEN RAISE EXCEPTION '签署链接无效或已撤销'; END IF;
 SELECT customer_phone INTO phone FROM renovation_projects WHERE id=d.project_id;
 IF coalesce(d.link_locked_until>now(),false) OR NOT _reno_esign_check_phone(phone,p_last4) OR d.link_verified_until IS NULL OR d.link_verified_until<now() THEN
  RAISE EXCEPTION '手机号验证已过期，请刷新页面重新验证';
 END IF;
 RETURN renovation_deduction_sign(p_entry,p_sign_token,p_terms_hash,p_name,p_strokes,p_accept);
END $$;

-- Close the old unverified entry points.
REVOKE ALL ON FUNCTION public.renovation_signing_link_view(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.renovation_signing_link_sign(uuid,uuid,text,text,jsonb,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.renovation_deduction_sign_view(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.renovation_deduction_sign(uuid,uuid,text,text,jsonb,boolean) FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION public.renovation_signing_link_open(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_signing_link_open(uuid,uuid,text) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.renovation_deduction_link_open(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_deduction_link_open(uuid,uuid,text) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.renovation_signing_link_sign(uuid,uuid,text,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_signing_link_sign(uuid,uuid,text,text,text,jsonb,boolean) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.renovation_deduction_link_sign(uuid,uuid,text,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_deduction_link_sign(uuid,uuid,text,text,text,jsonb,boolean) TO anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
