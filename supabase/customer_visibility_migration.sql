-- 客户资料、订单明细的可见范围收紧(2026-10-31,接 order_visibility_migration.sql)
-- 之前:customers 对所有店员(level>=1)和所有厂家全开(含电话、地址);
--       order_items 任何厂家都能读全部订单的明细。
-- 之后:
--   客户 → 能看到该客户的某张订单(按订单可见范围)、或自己建的客户、或总经理/管理员、或客户本人
--   新建订单按电话查老客户 → 走 find_customer_by_phone(只返回电话完全一致的那一个)
--   订单明细(厂家) → 只看分配给自己的商品
-- 依赖 order_visibility_migration.sql 已运行。在 Supabase SQL Editor 运行,可重复运行。

ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid();
CREATE INDEX IF NOT EXISTS customers_created_by_idx ON customers(created_by);
CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON orders(customer_id);

CREATE OR REPLACE FUNCTION public._is_active_staff(p_min_level int)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.active = true
    AND auth_user_level() >= p_min_level);
$$;
REVOKE ALL ON FUNCTION public._is_active_staff(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._is_active_staff(int) TO authenticated;

DROP POLICY IF EXISTS "customers_staff" ON customers;
DROP POLICY IF EXISTS "customers_supplier" ON customers;
DROP POLICY IF EXISTS "customers_select" ON customers;
DROP POLICY IF EXISTS "customers_insert" ON customers;
DROP POLICY IF EXISTS "customers_update" ON customers;
DROP POLICY IF EXISTS "customers_delete" ON customers;
-- 订单子查询本身受 orders 策略过滤:看得到订单才看得到客户(厂家、物流同理)
CREATE POLICY "customers_select" ON customers FOR SELECT USING (
  _is_active_staff(4)
  OR (created_by = auth.uid() AND _is_active_staff(1))
  OR EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = customers.id)
);
CREATE POLICY "customers_insert" ON customers FOR INSERT
  WITH CHECK (_is_active_staff(1) AND created_by = auth.uid());
CREATE POLICY "customers_update" ON customers FOR UPDATE
  USING (_is_active_staff(1)) WITH CHECK (_is_active_staff(1));
CREATE POLICY "customers_delete" ON customers FOR DELETE USING (_is_active_staff(4));

-- 新建订单时按电话找老客户(老客户可能是同事建的,直接查表看不到)
CREATE OR REPLACE FUNCTION public.find_customer_by_phone(p_phone text)
RETURNS TABLE(id uuid, name text, phone text, address text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT c.id, c.name, c.phone, c.address FROM customers c
  WHERE _is_active_staff(1) AND nullif(p_phone, '') IS NOT NULL AND c.phone = p_phone
  ORDER BY c.created_at LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.find_customer_by_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_customer_by_phone(text) TO authenticated;

DROP POLICY IF EXISTS "order_items_supplier" ON order_items;
CREATE POLICY "order_items_supplier" ON order_items FOR SELECT USING (
  supplier_id IN (SELECT s.id FROM suppliers s WHERE s.user_id = auth.uid())
);
