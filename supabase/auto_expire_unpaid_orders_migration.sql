-- ============================================================================
-- auto_expire_unpaid_orders_migration.sql
-- 需求（用户 2026-05-19 确认）：
--   1) 订单仍在「待付款」且一直「未付款」、创建超过 24 小时 → 自动转「已取消」
--   2) 订单已「已取消」且仍「未付款」、创建超过 15 天 → 永久删除
--      （order_items / order_logs 随外键 ON DELETE CASCADE 一并删除）
-- 安全锁：两条规则都强制 payment_status='unpaid'，已付款的单绝不触碰。
-- 实现：Supabase pg_cron 每小时自动跑一次（无服务器也能真·自动）。
-- 幂等：可重复执行，不改任何已有数据结构。
-- 运行：见文件末尾「部署步骤」。
-- ============================================================================

-- 1. 启用 pg_cron（若 Dashboard 已开启，这句会跳过）
create extension if not exists pg_cron;

-- 2. 清理函数：SECURITY DEFINER → 以属主身份执行，绕过 RLS，可安全删改
create or replace function auto_expire_unpaid_orders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancelled int := 0;
  v_deleted   int := 0;
begin
  -- (1) 超 24 小时未付款且仍在待付款 → 自动取消，并写一条系统日志
  with c as (
    update orders
       set status = 'cancelled',
           updated_at = now()
     where status = 'pending_payment'
       and payment_status = 'unpaid'
       and created_at < now() - interval '24 hours'
    returning id
  ),
  logged as (
    insert into order_logs (order_id, status, operator_id, operator_role, operator_name, notes)
    select id, 'cancelled', null, 'system', '系统自动', '超过24小时未付款，系统自动取消'
      from c
    returning 1
  )
  select count(*) into v_cancelled from logged;

  -- (2) 已取消 + 仍未付款 + 创建超 15 天 → 永久删除（明细/日志随 CASCADE 一起删）
  with d as (
    delete from orders
     where status = 'cancelled'
       and payment_status = 'unpaid'
       and created_at < now() - interval '15 days'
    returning id
  )
  select count(*) into v_deleted from d;

  raise notice 'auto_expire_unpaid_orders: cancelled=%, deleted=%', v_cancelled, v_deleted;
end;
$$;

-- 3. 每小时（每个整点）自动跑一次；先撤销旧的同名任务，保证可重复执行
do $$
begin
  perform cron.unschedule('auto-expire-unpaid-orders');
exception when others then
  null;  -- 任务原本不存在时忽略
end $$;

select cron.schedule(
  'auto-expire-unpaid-orders',
  '0 * * * *',
  $cron$ select auto_expire_unpaid_orders(); $cron$
);

-- ============================================================================
-- 部署步骤（在 Supabase 后台操作）：
--   第 1 步：左侧 Database → Extensions，搜 "pg_cron"，把开关打开（如已开跳过）
--   第 2 步：左侧 SQL Editor → New query，把【本文件全部内容】粘进去 → Run
--   第 3 步（可选自检）：另开一个查询跑下面这句，确认定时任务已登记：
--             select jobname, schedule, active from cron.job
--             where jobname = 'auto-expire-unpaid-orders';
--   想立刻手动跑一次验证：select auto_expire_unpaid_orders();
-- 撤销/关闭此功能：select cron.unschedule('auto-expire-unpaid-orders');
-- ============================================================================
