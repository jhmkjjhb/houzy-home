-- ============================================================================
-- add_orders_warranty_info_migration.sql
-- 根因（2026-05-19 探测确认）：线上 orders 表【缺少 warranty_info 列】。
--   前端写它的地方都带"列不存在静默跳过"，故详细部件质保表数据从未真正存档；
--   customer.html / staff.html 读不到 → 质保面板只能退回笼统"整体产品 1 年"。
-- 本脚本：补 warranty_info 列（存 JSON 文本：按部件分年限的质保明细）。
-- 配合 staff.html：订单进入「安装中」时自动算好并写入该列。
-- 安全：IF NOT EXISTS，不动任何已有数据，可重复执行。
-- 运行：Supabase Dashboard → SQL Editor → New query → 粘贴 → Run
-- ============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS warranty_info TEXT;

NOTIFY pgrst, 'reload schema';
