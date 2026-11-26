-- quote_cloud_slot_delete_migration.sql
-- 2026-11-27 报价器「我的云端报价」可以删掉不要的一份（只能删自己账号的；别的窗口刚改过就不删，先刷新）。
-- 依赖：quote_cloud_slots_migration.sql 已运行。
-- 可重复执行。运行：Supabase SQL Editor → 粘贴全部 → Run

CREATE OR REPLACE FUNCTION public.delete_quote_cloud_slot(p_slot integer, p_expected_revision integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid := auth.uid();
BEGIN
  IF v_owner IS NULL OR NOT public._is_active_staff(1) THEN
    RAISE EXCEPTION 'Employee login required' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));
  DELETE FROM public.quote_cloud_slots q
   WHERE q.owner_id = v_owner AND q.slot = p_slot AND q.revision = p_expected_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote slot changed; refresh the list before deleting';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_quote_cloud_slot(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_quote_cloud_slot(integer, integer) TO authenticated;
