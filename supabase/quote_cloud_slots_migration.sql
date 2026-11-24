-- Three private cloud quote archives per active employee.
-- Run after customer_visibility_migration.sql, which defines _is_active_staff().
CREATE TABLE IF NOT EXISTS public.quote_cloud_slots (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 3),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  document jsonb NOT NULL,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, slot)
);

ALTER TABLE public.quote_cloud_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quote_cloud_slots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.quote_cloud_slots TO authenticated;
DROP POLICY IF EXISTS quote_cloud_slots_owner_read ON public.quote_cloud_slots;
CREATE POLICY quote_cloud_slots_owner_read ON public.quote_cloud_slots FOR SELECT TO authenticated
USING (owner_id = auth.uid() AND public._is_active_staff(1));

CREATE OR REPLACE FUNCTION public.save_quote_cloud_slot(
  p_slot integer,
  p_expected_revision integer,
  p_document jsonb
) RETURNS TABLE(slot smallint, revision integer, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_revision integer;
  v_name text;
  v_phone text;
BEGIN
  IF v_owner IS NULL OR NOT public._is_active_staff(1) THEN
    RAISE EXCEPTION 'Employee login required' USING ERRCODE = '42501';
  END IF;
  IF p_slot IS NULL OR p_slot NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'Quote archive slot must be 1, 2 or 3';
  END IF;
  IF p_document IS NULL OR jsonb_typeof(p_document) <> 'object'
      OR p_document->>'format' IS DISTINCT FROM 'houzy-quote-v2'
      OR p_document->>'version' IS DISTINCT FROM '1'
      OR jsonb_typeof(p_document->'project'->'rooms') IS DISTINCT FROM 'array'
      OR jsonb_typeof(p_document->'project'->'plans') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid HOUZY quote document';
  END IF;
  IF octet_length(p_document::text) > 8 * 1024 * 1024 THEN
    RAISE EXCEPTION 'Quote archive exceeds 8 MB; reduce attached images';
  END IF;
  v_name := nullif(btrim(p_document #>> '{project,info,name}'), '');
  v_phone := nullif(btrim(p_document #>> '{project,info,phone}'), '');
  IF v_name IS NULL OR v_phone IS NULL THEN
    RAISE EXCEPTION 'Client name and phone are required';
  END IF;

  -- Serialize saves by one employee, including two tabs attempting an empty slot.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));
  SELECT q.revision INTO v_revision FROM public.quote_cloud_slots q
  WHERE q.owner_id = v_owner AND q.slot = p_slot FOR UPDATE;
  IF NOT FOUND THEN
    IF p_expected_revision IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'Quote slot changed; refresh the list before saving';
    END IF;
    INSERT INTO public.quote_cloud_slots(owner_id, slot, document, customer_name, customer_phone)
    VALUES (v_owner, p_slot, p_document, v_name, v_phone);
  ELSE
    IF p_expected_revision IS DISTINCT FROM v_revision THEN
      RAISE EXCEPTION 'Quote slot changed; refresh the list before overwriting';
    END IF;
    UPDATE public.quote_cloud_slots q SET document = p_document,
      customer_name = v_name, customer_phone = v_phone,
      revision = q.revision + 1, updated_at = now()
    WHERE q.owner_id = v_owner AND q.slot = p_slot;
  END IF;
  RETURN QUERY SELECT q.slot, q.revision, q.updated_at
    FROM public.quote_cloud_slots q WHERE q.owner_id = v_owner AND q.slot = p_slot;
END;
$$;
REVOKE ALL ON FUNCTION public.save_quote_cloud_slot(integer, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_quote_cloud_slot(integer, integer, jsonb) TO authenticated;
