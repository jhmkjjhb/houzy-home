-- RLS policies for supplier and logistics roles
-- Run in Supabase SQL Editor

-- ── suppliers table ──────────────────────────────────────────────────
-- Suppliers can read their own record (needed to get their suppliers.id)
DROP POLICY IF EXISTS "suppliers_self_read" ON suppliers;
CREATE POLICY "suppliers_self_read" ON suppliers
  FOR SELECT USING (
    auth_user_level() >= 1
    OR user_id = auth.uid()
  );

-- ── order_items table ────────────────────────────────────────────────
-- Suppliers can read items assigned to them
DROP POLICY IF EXISTS "order_items_supplier_read" ON order_items;
CREATE POLICY "order_items_supplier_read" ON order_items
  FOR SELECT USING (
    auth_user_level() >= 1
    OR EXISTS (
      SELECT 1 FROM suppliers s
      WHERE s.id = order_items.supplier_id
        AND s.user_id = auth.uid()
    )
  );

-- ── orders table ─────────────────────────────────────────────────────
-- Suppliers can read orders where they have at least one assigned item
DROP POLICY IF EXISTS "orders_supplier_read" ON orders;
CREATE POLICY "orders_supplier_read" ON orders
  FOR SELECT USING (
    auth_user_level() >= 1
    OR EXISTS (
      SELECT 1 FROM order_items oi
      JOIN suppliers s ON s.id = oi.supplier_id
      WHERE oi.order_id = orders.id
        AND s.user_id = auth.uid()
    )
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'logistics'
      AND status IN ('shipped','arrived')
    )
  );

-- Suppliers can update order status (接单/发货 transitions)
DROP POLICY IF EXISTS "orders_supplier_update" ON orders;
CREATE POLICY "orders_supplier_update" ON orders
  FOR UPDATE USING (
    auth_user_level() >= 1
    OR EXISTS (
      SELECT 1 FROM order_items oi
      JOIN suppliers s ON s.id = oi.supplier_id
      WHERE oi.order_id = orders.id
        AND s.user_id = auth.uid()
    )
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'logistics'
      AND status IN ('shipped','arrived')
    )
  );

-- ── order_logs table ─────────────────────────────────────────────────
-- Suppliers and logistics can read logs for their orders
DROP POLICY IF EXISTS "order_logs_supplier_read" ON order_logs;
CREATE POLICY "order_logs_supplier_read" ON order_logs
  FOR SELECT USING (
    auth_user_level() >= 1
    OR EXISTS (
      SELECT 1 FROM order_items oi
      JOIN suppliers s ON s.id = oi.supplier_id
      WHERE oi.order_id = order_logs.order_id
        AND s.user_id = auth.uid()
    )
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'logistics'
  );

-- Suppliers and logistics can insert logs
DROP POLICY IF EXISTS "order_logs_supplier_insert" ON order_logs;
CREATE POLICY "order_logs_supplier_insert" ON order_logs
  FOR INSERT WITH CHECK (
    auth_user_level() >= 1
    OR (SELECT role FROM profiles WHERE id = auth.uid()) IN ('supplier','logistics')
  );

-- ── order_attachments table ──────────────────────────────────────────
-- Suppliers can read attachments for their orders
DROP POLICY IF EXISTS "order_attachments_supplier_read" ON order_attachments;
CREATE POLICY "order_attachments_supplier_read" ON order_attachments
  FOR SELECT USING (
    auth_user_level() >= 1
    OR EXISTS (
      SELECT 1 FROM order_items oi
      JOIN suppliers s ON s.id = oi.supplier_id
      WHERE oi.order_id = order_attachments.order_id
        AND s.user_id = auth.uid()
    )
  );
