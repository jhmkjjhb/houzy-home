-- Phone lookup returns only order identifiers and state. Private contract data
-- and capability tokens still require renovation_customer_lookup(phone, code).
BEGIN;
-- Later migrations redefine functions created here; re-running this file would
-- silently restore older money/permission rules, so refuse once they exist.
DO $guard$ BEGIN IF to_regclass('public.renovation_additions') IS NOT NULL THEN
 RAISE EXCEPTION '此迁移已被 renovation_additions_migration.sql 取代，重跑会恢复旧规则，已停止。请按《整装订单上线与验收》的迁移顺序执行。';
END IF; END $guard$;
-- Historical Malaysian mobile entries may omit +60 or use a trunk zero.
-- Only recognise the Malaysian mobile shape, never arbitrary suffix matching.
CREATE OR REPLACE FUNCTION public._reno_lookup_phone(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 WITH cleaned AS (SELECT regexp_replace(translate(coalesce(p_phone,''),'０１２３４５６７８９','0123456789'),'[[:space:]()+.\-]','','g') AS n)
 SELECT CASE WHEN n ~ '^0?1[0-9]{7,9}$' THEN '60'||regexp_replace(n,'^0','')
 ELSE public._reno_normalize_phone(p_phone) END FROM cleaned;
$$;
REVOKE ALL ON FUNCTION public._reno_lookup_phone(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.renovation_customer_orders(p_phone text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'contract_no',p.contract_no,
 'state',p.state,'created_at',p.created_at) ORDER BY p.created_at DESC),'[]'::jsonb)
 FROM public.renovation_projects p
 WHERE length(p_phone)<=50 AND public._reno_normalize_phone(p_phone) IS NOT NULL
 AND public._reno_lookup_phone(p.customer_phone)=public._reno_normalize_phone(p_phone);
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_orders(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_orders(text) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.renovation_customer_lookup(p_phone text,p_code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'contract_no',p.contract_no,'address',p.address,
 'state',p.state,'net',p.snapshot->'net','view_token',p.customer_token) ORDER BY p.created_at DESC),'[]'::jsonb)
 FROM renovation_projects p
 WHERE length(p_phone)<=50 AND length(p_code)<=50 AND p.state<>'draft'
 AND _reno_lookup_phone(p.customer_phone)=_reno_normalize_phone(p_phone)
 AND lower(regexp_replace(p_code,'[[:space:]\-]','','g')) ~ '^[0-9a-f]{20}$'
 AND left(replace(p.customer_token::text,'-',''),20)=lower(regexp_replace(p_code,'[[:space:]\-]','','g'));
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_lookup(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_lookup(text,text) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
