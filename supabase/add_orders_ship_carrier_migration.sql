-- ============================================================================
-- add_orders_ship_carrier_migration.sql
-- 报错：仓管确认发货 column "ship_carrier" does not exist。
-- 根因：orders 早期建表缺 ship_carrier / ship_method 列(staff.html
--   saveLogisticsInfo 与 warehouse_confirm_ship 都写它们)。tracking_no /
--   ship_time / ship_notes 已存在，只缺这两列。
-- 修法：ADD COLUMN IF NOT EXISTS（幂等，可重复执行，不动任何数据）。
-- 运行：Supabase Dashboard → SQL Editor → New query → 粘贴全部 → Run
-- ============================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS ship_carrier TEXT,
  ADD COLUMN IF NOT EXISTS ship_method  TEXT;

NOTIFY pgrst, 'reload schema';
