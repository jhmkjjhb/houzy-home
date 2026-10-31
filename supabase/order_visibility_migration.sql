-- 普通订单可见范围在数据库层锁定(2026-10-31)
-- 之前 orders_select = true:页面上店员只显示自己的单,但任何登录账号绕过页面都能读到全部订单。
-- 规则(与整装订单 _reno_access 一致):
--   店员 staff          → 只看自己开的单(staff_id = 自己),不限门店
--   店长 store_manager  → 本店全部
--   区域经理            → 本区全部
--   总经理 / 管理员      → 全部
--   厂家 supplier       → 分配给自己的订单(order_items.supplier_id 或 orders.supplier_id)
--   物流 logistics      → 已发货 / 运输中 / 已到货
-- 订单明细、日志、收款记录同样按订单可见范围收紧(厂家、物流原有策略不变)。
-- 停用账号(active=false)一律看不到。
-- 在 Supabase SQL Editor 运行,可重复运行。

-- 按订单行的字段判断(orders 自身策略用这个:新建订单 insert…select 时,按 id 回查看不到刚插入的行)
CREATE OR REPLACE FUNCTION public._order_row_visible(p_order uuid, p_store uuid, p_staff uuid, p_supplier uuid, p_status text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    LEFT JOIN stores s ON s.id = p_store
    WHERE p.id = auth.uid() AND p.active = true AND (
      p.role IN ('general_manager','admin','superadmin')
      OR (p.role = 'regional_manager' AND p.region = s.region)
      OR (p.role = 'store_manager' AND p.store_id = p_store)
      OR (p.role = 'staff' AND p_staff = p.id)
      OR (p.role = 'logistics' AND p_status IN ('shipped','in_transit','arrived'))
      OR (p.role = 'supplier' AND EXISTS (
            SELECT 1 FROM suppliers sup
            WHERE sup.user_id = p.id AND (
              sup.id = p_supplier
              OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = p_order AND oi.supplier_id = sup.id))))
    )
  );
$$;

-- 按订单 id 判断(明细、日志、收款用)
CREATE OR REPLACE FUNCTION public._order_visible(p_order uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM orders o WHERE o.id = p_order
    AND _order_row_visible(o.id, o.store_id, o.staff_id, o.supplier_id, o.status));
$$;
REVOKE ALL ON FUNCTION public._order_row_visible(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._order_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._order_row_visible(uuid, uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._order_visible(uuid) TO authenticated;

DROP POLICY IF EXISTS "orders_select" ON orders;
CREATE POLICY "orders_select" ON orders FOR SELECT
  USING (_order_row_visible(id, store_id, staff_id, supplier_id, status));

DROP POLICY IF EXISTS "order_items_staff" ON order_items;
CREATE POLICY "order_items_staff" ON order_items FOR ALL
  USING (auth_user_level() >= 1 AND _order_visible(order_id));

DROP POLICY IF EXISTS "logs_staff_admin" ON order_logs;
CREATE POLICY "logs_staff_admin" ON order_logs FOR ALL
  USING (auth_user_level() >= 1 AND _order_visible(order_id));

DROP POLICY IF EXISTS "payments_read" ON order_payments;
CREATE POLICY "payments_read" ON order_payments FOR SELECT
  USING (auth_user_level() >= 1 AND _order_visible(order_id));

DROP POLICY IF EXISTS "payments_manage" ON order_payments;
CREATE POLICY "payments_manage" ON order_payments FOR ALL
  USING (auth_user_level() >= 2 AND _order_visible(order_id));
