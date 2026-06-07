-- 产品删除日志表
-- 记录每次删除产品档案的操作。刻意不对 products 加外键:产品删掉后,日志仍保留。
create table if not exists product_delete_logs (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid,            -- 被删产品的原 id(不加外键,产品删了日志还在)
  sku           text,
  name          text,
  category      text,
  specs         text,
  price         numeric,
  operator_id   uuid references auth.users(id),
  operator_role text,
  operator_name text,
  reason        text,            -- 删除原因(选填)
  created_at    timestamptz default now()
);

alter table product_delete_logs enable row level security;

-- 任何已登录员工都可写入/查看删除日志(内部审计用途)
drop policy if exists "pdl_insert" on product_delete_logs;
drop policy if exists "pdl_select" on product_delete_logs;
create policy "pdl_insert" on product_delete_logs for insert to authenticated with check (true);
create policy "pdl_select" on product_delete_logs for select to authenticated using (true);

notify pgrst, 'reload schema';
