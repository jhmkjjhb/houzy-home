-- ============================================================================
-- reopen_unsigned_completed_orders_migration.sql
-- 背景（2026-05-19）：上线"客户电子签名硬性关卡"前，部分订单被店员用旧方式
--   直接点成 status='completed'，跳过了客户签名、也没进质保。
-- 本脚本：把这些「已完成但客户从未电子签名」的订单拉回「安装中」，
--   清掉完成时间，并按安装阶段标准时长(5天)重设截止时间。
--   客户即可在查询端 customer.html 手写签名 → 自动完成 + 进 6 年质保。
-- 判定：status='completed' 且 sign_image 为空（=从未电子签名）。
--   已电子签名 / 已在质保(after_sales) 的订单不动。
-- 安全：只改符合条件的订单，不删数据，可重复执行。
-- 运行：Supabase Dashboard → SQL Editor → New query → 粘贴 → Run
-- ============================================================================

UPDATE orders o
SET status       = 'installing',
    completed_at = NULL,
    deadline_at  = COALESCE(
                     (SELECT MAX(l.created_at) FROM order_logs l
                        WHERE l.order_id = o.id AND l.status = 'installing'),
                     o.created_at
                   ) + INTERVAL '5 days',
    updated_at   = NOW()
WHERE o.status = 'completed'
  AND o.sign_image IS NULL;

-- 自检（可选，单独跑）：确认这些单已回到 installing
-- select order_no, status, sign_image, completed_at, deadline_at
-- from orders where status='installing' order by updated_at desc limit 20;
-- ============================================================================
