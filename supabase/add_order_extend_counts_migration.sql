-- ============================================================================
-- add_order_extend_counts_migration.sql
-- 需求（用户 2026-05-19 确认）：订单详情「延期」按钮
--   发货→到货：可 +7 天 × 最多 2 次；安装中：可 +5 天 × 最多 1 次
-- 本脚本：给 orders 加两个计数列，记录各自已延期次数（用完按钮置灰）。
-- 安全：IF NOT EXISTS + 默认 0，不动任何已有数据，可重复执行。
-- 运行：Supabase Dashboard → SQL Editor → New query → 粘贴全部 → Run
-- ============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_extend_count    INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS install_extend_count INT NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
