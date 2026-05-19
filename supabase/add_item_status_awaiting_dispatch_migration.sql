-- ============================================================================
-- add_item_status_awaiting_dispatch_migration.sql
-- 背景：出库/仓管/混合单功能新增商品状态 'awaiting_dispatch'（待仓库发货），
--   但线上 order_items 有 CHECK 约束 order_items_item_status_check，原仅允许
--   6 值（pending/in_production/ready/shipped/arrived/damaged），新值被拦：
--   ERROR new row ... violates check constraint "order_items_item_status_check"。
-- 方案：DROP 旧约束 → 重建为 7 值（原 6 值 + awaiting_dispatch，顺序按业务流）。
-- 安全：原约束允许值是新约束的子集，现有行全部合法 → ADD 不会校验失败；
--   DROP IF EXISTS + ADD，可重复执行。
-- 运行：Supabase Dashboard → SQL Editor → New query → 粘贴全部 → Run
-- ============================================================================

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_item_status_check;

ALTER TABLE order_items ADD CONSTRAINT order_items_item_status_check
  CHECK (item_status = ANY (ARRAY[
    'pending'::text,
    'in_production'::text,
    'ready'::text,
    'awaiting_dispatch'::text,   -- 新增：店员确认出库、待仓库实际发货
    'shipped'::text,
    'arrived'::text,
    'damaged'::text
  ]));

NOTIFY pgrst, 'reload schema';
