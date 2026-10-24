-- Owner-requested access model: registered phone alone opens confirmed contracts.
-- Drafts remain summaries; internal audit, costs, storage paths and customer
-- identity fields are never returned. PDF signing still validates project token.
BEGIN;
CREATE OR REPLACE FUNCTION public.renovation_customer_orders(p_phone text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(
  jsonb_build_object('id',p.id,'contract_no',p.contract_no,'state',p.state,'created_at',p.created_at)
  || CASE WHEN p.state<>'draft' THEN jsonb_build_object('address',p.address,'net',p.snapshot->'net','view_token',p.customer_token)
     ELSE '{}'::jsonb END
  ORDER BY p.created_at DESC),'[]'::jsonb)
 FROM public.renovation_projects p
 WHERE length(p_phone)<=50 AND public._reno_normalize_phone(p_phone) IS NOT NULL
 AND public._reno_lookup_phone(p.customer_phone)=public._reno_normalize_phone(p_phone);
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_orders(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_orders(text) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
