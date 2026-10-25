-- Customer journey: read-only, token-scoped execution groups. Apply after
-- renovation_addition_signatures_migration.sql. No business data is changed.
BEGIN;
CREATE OR REPLACE FUNCTION public.renovation_customer_progress_view(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('state',p.state,'accepted_on',p.accepted_on,'revision',p.revision,
  'work_orders',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'group_name',CASE WHEN a.id IS NOT NULL THEN a.group_name ELSE w.group_name END,
   'status',w.status,'updated_at',w.updated_at) ORDER BY w.group_name,w.id)
   FROM public.renovation_work_orders w
   LEFT JOIN public.renovation_additions a ON a.work_order_id=w.id
   WHERE w.project_id=p.id AND w.cancelled_at IS NULL
    AND (a.id IS NULL OR (a.voided_at IS NULL AND a.signature_status='signed'))),'[]'::jsonb))
 FROM public.renovation_projects p WHERE p.customer_token=p_token AND p.state<>'draft';
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_progress_view(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.renovation_customer_progress_view(uuid) TO anon,authenticated;
COMMENT ON FUNCTION public.renovation_customer_progress_view(uuid) IS
 'Customer-token read-only execution progress. Excludes assignees, staff IDs, internal notes, prices and signing credentials.';
NOTIFY pgrst,'reload schema';
COMMIT;
