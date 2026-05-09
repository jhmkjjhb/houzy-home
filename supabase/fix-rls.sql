-- 权限级别辅助函数（SECURITY DEFINER 避免 RLS 递归）
CREATE OR REPLACE FUNCTION auth_user_level()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT CASE role
    WHEN 'staff'            THEN 1
    WHEN 'store_manager'    THEN 2
    WHEN 'regional_manager' THEN 3
    WHEN 'general_manager'  THEN 4
    WHEN 'superadmin'       THEN 5
    WHEN 'admin'            THEN 4
    ELSE 0
  END
  FROM profiles WHERE id = auth.uid()
$$;

-- 保留兼容旧代码
CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

-- 重建 profiles 策略
DROP POLICY IF EXISTS "profiles_admin" ON profiles;
DROP POLICY IF EXISTS "profiles_self"  ON profiles;
CREATE POLICY "profiles_admin" ON profiles FOR ALL    USING (auth_user_level() >= 4);
CREATE POLICY "profiles_self"  ON profiles FOR SELECT USING (id = auth.uid());

-- ── orders 策略（清理全部旧策略，重建）────────────────────────────
DROP POLICY IF EXISTS "orders_staff_admin"     ON orders;
DROP POLICY IF EXISTS "orders_select"          ON orders;
DROP POLICY IF EXISTS "orders_insert"          ON orders;
DROP POLICY IF EXISTS "orders_update"          ON orders;
DROP POLICY IF EXISTS "orders_delete"          ON orders;
DROP POLICY IF EXISTS "orders_supplier_read"   ON orders;
DROP POLICY IF EXISTS "orders_supplier_update" ON orders;
DROP POLICY IF EXISTS "orders_customer"        ON orders;
DROP POLICY IF EXISTS "orders_logistics_read"  ON orders;
DROP POLICY IF EXISTS "orders_logistics_update" ON orders;

-- 员工分级可见：L1/L2 只看本店，L3 看本区域，L4+ 看全部
CREATE POLICY "orders_select" ON orders FOR SELECT USING (
  CASE auth_user_level()
    WHEN 1 THEN store_id = (SELECT store_id FROM profiles WHERE id = auth.uid())
    WHEN 2 THEN store_id = (SELECT store_id FROM profiles WHERE id = auth.uid())
    WHEN 3 THEN store_id IN (
      SELECT s.id FROM stores s
      JOIN profiles p ON p.id = auth.uid()
      WHERE s.region = p.region
    )
    ELSE auth_user_level() >= 4
  END
  -- 厂家：通过 order_items 分配（新模式）或 orders.supplier_id（旧模式）
  OR EXISTS (
    SELECT 1 FROM order_items oi
    JOIN suppliers sup ON sup.id = oi.supplier_id
    WHERE oi.order_id = orders.id AND sup.user_id = auth.uid()
  )
  OR EXISTS (SELECT 1 FROM suppliers WHERE user_id = auth.uid() AND id = orders.supplier_id)
  -- 客户自读
  OR EXISTS (SELECT 1 FROM customers WHERE user_id = auth.uid() AND id = orders.customer_id)
  -- 物流：只看已发货/在途/已到货
  OR (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'logistics'
    AND status IN ('shipped','in_transit','arrived')
  )
);

CREATE POLICY "orders_insert" ON orders FOR INSERT WITH CHECK (auth_user_level() >= 1);

CREATE POLICY "orders_update" ON orders FOR UPDATE USING (
  auth_user_level() >= 1
  OR EXISTS (
    SELECT 1 FROM order_items oi
    JOIN suppliers sup ON sup.id = oi.supplier_id
    WHERE oi.order_id = orders.id AND sup.user_id = auth.uid()
  )
  OR EXISTS (SELECT 1 FROM suppliers WHERE user_id = auth.uid() AND id = orders.supplier_id)
  OR (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'logistics'
    AND status IN ('shipped','in_transit','arrived','installing')
  )
);

CREATE POLICY "orders_delete" ON orders FOR DELETE USING (auth_user_level() >= 4);

-- ── order_items 策略 ─────────────────────────────────────────────
DROP POLICY IF EXISTS "order_items_staff"         ON order_items;
DROP POLICY IF EXISTS "order_items_supplier_read" ON order_items;

CREATE POLICY "order_items_staff" ON order_items FOR ALL USING (
  auth_user_level() >= 1
);
CREATE POLICY "order_items_supplier_read" ON order_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM suppliers s
    WHERE s.id = order_items.supplier_id AND s.user_id = auth.uid()
  )
);

-- ── order_logs 策略 ──────────────────────────────────────────────
DROP POLICY IF EXISTS "logs_staff_admin" ON order_logs;
DROP POLICY IF EXISTS "logs_supplier"    ON order_logs;
DROP POLICY IF EXISTS "logs_logistics"   ON order_logs;
DROP POLICY IF EXISTS "order_logs_supplier_read"   ON order_logs;
DROP POLICY IF EXISTS "order_logs_supplier_insert" ON order_logs;

CREATE POLICY "logs_staff_admin" ON order_logs FOR ALL USING (auth_user_level() >= 1);
CREATE POLICY "logs_supplier" ON order_logs FOR ALL USING (
  EXISTS (
    SELECT 1 FROM order_items oi
    JOIN suppliers s ON s.id = oi.supplier_id
    WHERE oi.order_id = order_logs.order_id AND s.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM orders o JOIN suppliers s ON s.id = o.supplier_id
    WHERE o.id = order_logs.order_id AND s.user_id = auth.uid()
  )
);
CREATE POLICY "logs_logistics" ON order_logs FOR ALL USING (
  EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = order_logs.order_id
      AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'logistics'
      AND o.status IN ('shipped','in_transit','arrived','installing','completed')
  )
);

-- ── order_attachments 策略 ───────────────────────────────────────
DROP POLICY IF EXISTS "order_attachments_staff"         ON order_attachments;
DROP POLICY IF EXISTS "order_attachments_supplier_read" ON order_attachments;

CREATE POLICY "order_attachments_staff" ON order_attachments FOR ALL USING (
  auth_user_level() >= 1
);
CREATE POLICY "order_attachments_supplier_read" ON order_attachments FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM order_items oi
    JOIN suppliers s ON s.id = oi.supplier_id
    WHERE oi.order_id = order_attachments.order_id AND s.user_id = auth.uid()
  )
);

-- ── suppliers 策略 ───────────────────────────────────────────────
DROP POLICY IF EXISTS "suppliers_staff"     ON suppliers;
DROP POLICY IF EXISTS "suppliers_read"      ON suppliers;
DROP POLICY IF EXISTS "suppliers_self"      ON suppliers;
DROP POLICY IF EXISTS "suppliers_self_read" ON suppliers;

CREATE POLICY "suppliers_staff" ON suppliers FOR ALL    USING (auth_user_level() >= 3);
CREATE POLICY "suppliers_read"  ON suppliers FOR SELECT USING (auth_user_level() >= 1);
CREATE POLICY "suppliers_self"  ON suppliers FOR SELECT USING (user_id = auth.uid());

-- ── customers / referrers ────────────────────────────────────────
DROP POLICY IF EXISTS "customers_staff"    ON customers;
DROP POLICY IF EXISTS "customers_supplier" ON customers;
DROP POLICY IF EXISTS "customers_self"     ON customers;
DROP POLICY IF EXISTS "referrers_staff"    ON referrers;

CREATE POLICY "customers_staff"    ON customers FOR ALL    USING (auth_user_level() >= 1);
CREATE POLICY "customers_supplier" ON customers FOR SELECT USING (
  EXISTS (SELECT 1 FROM suppliers WHERE user_id = auth.uid())
);
CREATE POLICY "customers_self"     ON customers FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "referrers_staff"    ON referrers FOR ALL    USING (auth_user_level() >= 1);

-- ── registrations 策略 ───────────────────────────────────────────
DROP POLICY IF EXISTS "reg_select" ON public.registrations;
DROP POLICY IF EXISTS "reg_insert" ON public.registrations;
DROP POLICY IF EXISTS "reg_update" ON public.registrations;

CREATE POLICY "reg_select" ON public.registrations FOR SELECT USING (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id OR auth_user_level() >= 4
  )
);
CREATE POLICY "reg_insert" ON public.registrations FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL
);
CREATE POLICY "reg_update" ON public.registrations FOR UPDATE USING (
  auth_user_level() >= 4
);
