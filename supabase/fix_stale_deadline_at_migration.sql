-- ============================================================================
-- fix_stale_deadline_at_migration.sql
-- 背景（2026-05-19）：早期"补 deadline_at 列 + 回填"时按订单【当时状态】回填，
--   但有几条旁路推进状态时未重算 deadline_at（已在 commit 9392dc4 修复"以后"）。
--   导致部分进行中老订单 deadline_at 仍停在旧阶段值 → 一直误报"已超时"。
-- 本脚本：一次性把所有【进行中】订单的 deadline_at 重新校准为
--   「它进入当前状态的时间（取 order_logs 最近一条该状态日志，无则订单创建时间）
--    ＋ 该阶段标准时长」。终态(完成/关闭/取消)与过渡旧状态不动。
-- 安全：只改进行中订单的 deadline_at 一列，不删不改其它数据；可重复执行。
-- 运行：Supabase Dashboard → SQL Editor → New query → 粘贴全部 → Run
-- ============================================================================

UPDATE orders o
SET deadline_at = (
  COALESCE(
    (SELECT MAX(l.created_at) FROM order_logs l
       WHERE l.order_id = o.id AND l.status = o.status),
    o.created_at
  )
  + CASE o.status
      WHEN 'pending_payment' THEN INTERVAL '15 minutes'
      WHEN 'paid'            THEN INTERVAL '2 hours'
      WHEN 'in_production'   THEN INTERVAL '25 days'
      WHEN 'shipped'         THEN INTERVAL '20 days'
      WHEN 'arrived'         THEN INTERVAL '24 hours'
      WHEN 'installing'      THEN INTERVAL '5 days'
      WHEN 'after_sales'     THEN INTERVAL '365 days'
    END
)
WHERE o.status IN
  ('pending_payment','paid','in_production','shipped','arrived','installing','after_sales');

-- 自检（可选，单独跑）：看各状态订单数与截止时间是否都已回到合理范围
-- select status, count(*) total,
--        min(deadline_at) earliest, max(deadline_at) latest
-- from orders
-- where status in ('pending_payment','paid','in_production','shipped','arrived','installing','after_sales')
-- group by status order by status;
-- ============================================================================
