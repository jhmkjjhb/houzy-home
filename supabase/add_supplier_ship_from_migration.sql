-- ============================================================================
-- add_supplier_ship_from_migration.sql
-- 需求:供应商管理增加「发货地」字段(地址/城市,自由文字),用于物流/溯源参考。
-- 安全:IF NOT EXISTS,可重复执行,不改任何已有数据。
-- 运行:Supabase Dashboard → SQL Editor → 粘贴 → Run。
-- ============================================================================

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ship_from TEXT;

NOTIFY pgrst, 'reload schema';
