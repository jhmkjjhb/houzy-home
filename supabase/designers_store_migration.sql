-- ============================================================================
-- designers_store_migration.sql
-- 2026-05-23:设计师太多时按门店过滤 → designers 加 store_id(归属门店)
-- · 留空 = 全部门店通用;开单时只列「本店 + 通用」的设计师
-- 可重复执行。Supabase SQL Editor → 粘贴 → Run
-- ============================================================================
ALTER TABLE designers ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_designers_store ON designers(store_id) WHERE store_id IS NOT NULL;
NOTIFY pgrst, 'reload schema';
