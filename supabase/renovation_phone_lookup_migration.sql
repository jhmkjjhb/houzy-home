-- Phone is a lookup key, not proof of identity. A private per-contract code is
-- required before returning even the main project summary or its capability URL.
BEGIN;
CREATE OR REPLACE FUNCTION public._reno_normalize_phone(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 WITH cleaned AS (SELECT regexp_replace(translate(coalesce(p_phone,''),'０１２３４５６７８９','0123456789'),'[[:space:]()+.\-]','','g') AS n),
 canonical AS (SELECT regexp_replace(n,'^00','') AS n FROM cleaned)
 SELECT CASE WHEN n ~ '^[1-9][0-9]{7,14}$' THEN n ELSE NULL END FROM canonical;
$$;
REVOKE ALL ON FUNCTION public._reno_normalize_phone(text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.renovation_customer_lookup(p_phone text,p_code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'contract_no',p.contract_no,'address',p.address,
 'state',p.state,'net',p.snapshot->'net','view_token',p.customer_token) ORDER BY p.created_at DESC),'[]'::jsonb)
 FROM renovation_projects p
 WHERE length(p_phone)<=50 AND length(p_code)<=50 AND p.state<>'draft'
 AND _reno_normalize_phone(p.customer_phone)=_reno_normalize_phone(p_phone)
 AND lower(regexp_replace(p_code,'[[:space:]\-]','','g')) ~ '^[0-9a-f]{20}$'
 AND left(replace(p.customer_token::text,'-',''),20)=lower(regexp_replace(p_code,'[[:space:]\-]','','g'));
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_lookup(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_lookup(text,text) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
