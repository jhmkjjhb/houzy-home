-- ============================================================================
-- add_orders_deadline_at_migration.sql
-- 根因（2026-05-19 探测确认）：线上 orders 表【缺少 deadline_at 列】
--   → 所有倒计时/超时报警/列表计时/详情大横幅一律不显示（代码无错，缺数据列）。
-- 本脚本：①补列；②给「进行中（非终态）且当前为空」的订单按阶段标准时长回填，
--          让现有订单立刻能看到倒计时；终态(完成/关闭/取消)与已有值不动。
-- 安全：IF NOT EXISTS、仅填 NULL、不删不改其它数据，可重复执行。
-- 运行：Supabase Dashboard → SQL Editor → New query → 粘贴全部 → Run
-- ============================================================================

-- ① 补列
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;

-- ② 回填进行中的订单（阶段标准时长与前端 STATUS_SLA_HOURS 保持一致）
UPDATE orders SET deadline_at = created_at + (
  CASE status
    WHEN 'pending_payment' THEN INTERVAL '15 minutes'   -- 0.25h
    WHEN 'paid'            THEN INTERVAL '2 hours'        -- 120 分钟
    WHEN 'in_production'   THEN INTERVAL '25 days'        -- 600h
    WHEN 'shipped'         THEN INTERVAL '20 days'        -- 480h
    WHEN 'arrived'         THEN INTERVAL '24 hours'
    WHEN 'installing'      THEN INTERVAL '5 days'         -- 120h
    WHEN 'after_sales'     THEN INTERVAL '365 days'       -- 年度质保提醒
    ELSE NULL
  END)
WHERE deadline_at IS NULL
  AND status NOT IN ('completed','closed','cancelled')
  AND status IN ('pending_payment','paid','in_production','shipped','arrived','installing','after_sales');

-- ③ 让 REST/前端立即识别新列
NOTIFY pgrst, 'reload schema';

-- 自检：看新列与回填结果
-- select status, count(*) total, count(deadline_at) has_deadline
-- from orders group by status order by status;
