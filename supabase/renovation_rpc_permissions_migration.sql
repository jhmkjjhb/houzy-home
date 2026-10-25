-- Supabase default privileges can grant EXECUTE directly to anon/authenticated.
-- Revoke those explicit grants from internal helpers and employee-only commands.
BEGIN;
DO $$
DECLARE signature text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['_reno_billing_plan(uuid)','_reno_effective_lines(uuid)','_reno_payment_summary(uuid)','_reno_check_installment_totals(uuid)','_reno_installment_view(uuid)','_reno_addition_terms(uuid)','_reno_lookup_phone(text)','_reno_normalize_phone(text)'] LOOP
  IF to_regprocedure('public.'||signature) IS NOT NULL THEN EXECUTE 'REVOKE ALL ON FUNCTION public.'||signature||' FROM PUBLIC,anon,authenticated'; END IF;
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['renovation_command(uuid,integer,text,jsonb)','renovation_addition_command(uuid,integer,text,uuid,jsonb)','renovation_addition_view(uuid)','renovation_payment_command(uuid,integer,text,uuid,jsonb)','renovation_payment_view(uuid)','renovation_rotate_link(uuid,integer)','get_store_performance(date,date,uuid,boolean)'] LOOP
  IF to_regprocedure('public.'||signature) IS NOT NULL THEN
   EXECUTE 'REVOKE ALL ON FUNCTION public.'||signature||' FROM PUBLIC,anon';
   EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||signature||' TO authenticated';
  END IF;
 END LOOP;
 IF to_regprocedure('public._reno_access(uuid,uuid,boolean)') IS NOT NULL THEN
  REVOKE ALL ON FUNCTION public._reno_access(uuid,uuid,boolean) FROM PUBLIC,anon;
  GRANT EXECUTE ON FUNCTION public._reno_access(uuid,uuid,boolean) TO authenticated;
 END IF;
END;$$;
NOTIFY pgrst,'reload schema';
COMMIT;
