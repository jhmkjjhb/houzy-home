-- ============================================================
-- HOUZY HOME OMS — Supabase Schema
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

-- Stores (门店)
CREATE TABLE IF NOT EXISTS stores (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,   -- JB, SG
  address    TEXT,
  region     TEXT,                   -- 区域代码，供 regional_manager 数据隔离
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO stores (name, code, address) VALUES
  ('001 Austin', '001', '141, Jalan Mutiara Emas 10/19, Taman Mount Austin, 81100 Johor Bahru'),
  ('002 Singapore', '002', 'Singapore')
ON CONFLICT (code) DO NOTHING;

-- User profiles (links to Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT '',
  phone      TEXT,
  role       TEXT NOT NULL DEFAULT 'customer'
               CHECK (role IN (
                 'customer','staff','store_manager','regional_manager',
                 'general_manager','superadmin','admin',
                 'supplier','logistics'
               )),
  store_id   UUID REFERENCES stores(id),
  region     TEXT,                          -- regional_manager 的管辖区域代码
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Referrers (推荐人)
CREATE TABLE IF NOT EXISTS referrers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT NOT NULL DEFAULT 'channel'
               CHECK (type IN ('staff','customer','designer','channel')),
  name       TEXT NOT NULL,
  phone      TEXT,
  notes      TEXT,
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customers (客户，不一定有 Supabase 账号)
CREATE TABLE IF NOT EXISTS customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id),
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  address     TEXT,
  referrer_id UUID REFERENCES referrers(id),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Suppliers (厂家)
CREATE TABLE IF NOT EXISTS suppliers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id),
  name         TEXT NOT NULL,
  contact_name TEXT,
  phone        TEXT,
  categories   TEXT,
  tier         INTEGER DEFAULT 2 CHECK (tier IN (1,2,3)),
  active       BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
-- Migration: run once if table already exists
-- ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tier INTEGER DEFAULT 2 CHECK (tier IN (1,2,3));
-- ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT;
-- ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'MYR';
-- ALTER TABLE orders ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;

-- Order number daily sequences
CREATE TABLE IF NOT EXISTS order_sequences (
  store_code TEXT NOT NULL,
  date_str   TEXT NOT NULL,   -- YYYYMMDD
  last_seq   INTEGER DEFAULT 0,
  PRIMARY KEY (store_code, date_str)
);

-- Orders (订单)
CREATE TABLE IF NOT EXISTS orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no       TEXT UNIQUE NOT NULL,   -- JB-20260422-0001
  store_id       UUID NOT NULL REFERENCES stores(id),
  customer_id    UUID NOT NULL REFERENCES customers(id),
  staff_id       UUID REFERENCES profiles(id),
  referrer_id    UUID REFERENCES referrers(id),
  supplier_id    UUID REFERENCES suppliers(id),
  amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
                   CHECK (payment_status IN ('unpaid','paid')),
  status         TEXT NOT NULL DEFAULT 'pending_payment'
                   CHECK (status IN (
                     'pending_payment','paid','assigned','accepted',
                     'in_production','production_complete','shipped',
                     'in_transit','arrived','installing',
                     'completed','after_sales','closed','cancelled'
                   )),
  description    TEXT,
  notes          TEXT,
  tracking_no    TEXT,
  logistics_notes TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

-- Order progress logs (订单进度日志)
CREATE TABLE IF NOT EXISTS order_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status         TEXT NOT NULL,
  operator_id    UUID REFERENCES auth.users(id),
  operator_role  TEXT NOT NULL,
  operator_name  TEXT,
  notes          TEXT,
  images         JSONB DEFAULT '[]'::JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Generate order number: JB-20260422-0001
CREATE OR REPLACE FUNCTION generate_order_no(p_store_code TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_date TEXT;
  v_seq  INTEGER;
BEGIN
  v_date := TO_CHAR(NOW() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYYMMDD');
  INSERT INTO order_sequences (store_code, date_str, last_seq)
  VALUES (p_store_code, v_date, 1)
  ON CONFLICT (store_code, date_str)
  DO UPDATE SET last_seq = order_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;
  RETURN p_store_code || '-' || v_date || '-' || LPAD(v_seq::TEXT, 4, '0');
END;
$$;

-- Customer order lookup by phone (no auth required)
CREATE OR REPLACE FUNCTION get_orders_by_phone(p_phone TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result JSONB; BEGIN
  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::JSONB) INTO v_result
  FROM (
    SELECT o.id, o.order_no, o.amount, o.payment_status, o.status,
           o.description, o.created_at, o.completed_at,
           s.name AS store_name, c.name AS customer_name
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN stores   s ON s.id = o.store_id
    WHERE c.phone = p_phone
  ) t;
  RETURN v_result;
END;
$$;

-- Order timeline by phone (verify ownership)
CREATE OR REPLACE FUNCTION get_order_timeline(p_order_id UUID, p_phone TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result JSONB; v_ok INTEGER; BEGIN
  SELECT COUNT(*) INTO v_ok FROM orders o
  JOIN customers c ON c.id = o.customer_id
  WHERE o.id = p_order_id AND c.phone = p_phone;
  IF v_ok = 0 THEN RETURN '[]'::JSONB; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(l)::JSONB ORDER BY l.created_at ASC), '[]'::JSONB)
  INTO v_result FROM order_logs l WHERE l.order_id = p_order_id;
  RETURN v_result;
END;
$$;

-- Get my profile
CREATE OR REPLACE FUNCTION get_my_profile()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result JSONB; BEGIN
  SELECT row_to_json(p)::JSONB INTO v_result FROM profiles p WHERE p.id = auth.uid();
  RETURN v_result;
END;
$$;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, name, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    NEW.raw_user_meta_data->>'phone',
    COALESCE(NEW.raw_user_meta_data->>'role', 'customer')
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Auto-update orders.updated_at
CREATE OR REPLACE FUNCTION _update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS orders_updated_at ON orders;
CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION _update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_sequences ENABLE ROW LEVEL SECURITY;

-- ── 权限级别函数（SECURITY DEFINER 绕过 RLS 递归） ──
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

-- Profiles
CREATE POLICY "profiles_self"  ON profiles FOR ALL USING (id = auth.uid());
CREATE POLICY "profiles_admin" ON profiles FOR ALL USING (auth_user_level() >= 4);

-- Stores: authenticated read; L4+ write
CREATE POLICY "stores_read"  ON stores FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "stores_admin" ON stores FOR ALL USING (auth_user_level() >= 4);

-- Customers: L1+ 管理；supplier 可读（订单协同）；客户自读
CREATE POLICY "customers_staff"    ON customers FOR ALL    USING (auth_user_level() >= 1);
CREATE POLICY "customers_supplier" ON customers FOR SELECT USING (
  EXISTS (SELECT 1 FROM suppliers WHERE user_id = auth.uid())
);
CREATE POLICY "customers_self"     ON customers FOR SELECT USING (user_id = auth.uid());

-- Referrers: L1+
CREATE POLICY "referrers_staff" ON referrers FOR ALL USING (auth_user_level() >= 1);

-- Suppliers: L3+ 全权；L1-L2 只读；supplier 用户读自己的记录
CREATE POLICY "suppliers_staff" ON suppliers FOR ALL   USING (auth_user_level() >= 3);
CREATE POLICY "suppliers_read"  ON suppliers FOR SELECT USING (auth_user_level() >= 1);
CREATE POLICY "suppliers_self"  ON suppliers FOR SELECT USING (user_id = auth.uid());

-- Orders: 按角色级别分级隔离
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
  OR EXISTS (SELECT 1 FROM suppliers WHERE user_id = auth.uid() AND id = orders.supplier_id)
  OR EXISTS (SELECT 1 FROM customers WHERE user_id = auth.uid() AND id = orders.customer_id)
);
CREATE POLICY "orders_insert" ON orders FOR INSERT WITH CHECK (auth_user_level() >= 1);
CREATE POLICY "orders_update" ON orders FOR UPDATE USING (
  auth_user_level() >= 1
  OR EXISTS (SELECT 1 FROM suppliers WHERE user_id = auth.uid() AND id = orders.supplier_id)
  OR (auth_user_level() = 0 AND
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'logistics' AND
      status IN ('shipped','in_transit','arrived'))
);
CREATE POLICY "orders_delete" ON orders FOR DELETE USING (auth_user_level() >= 4);

-- Order logs: L1+; supplier; logistics
CREATE POLICY "logs_staff_admin" ON order_logs FOR ALL USING (auth_user_level() >= 1);
CREATE POLICY "logs_supplier" ON order_logs FOR ALL USING (
  EXISTS (
    SELECT 1 FROM orders o JOIN suppliers s ON s.id = o.supplier_id
    WHERE o.id = order_logs.order_id AND s.user_id = auth.uid()
  )
);

-- Order sequences: staff/admin
CREATE POLICY "sequences_staff" ON order_sequences FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('staff','admin')
);

-- Logistics: read/update orders from shipped onward (supplier handles production_complete→shipped)
CREATE POLICY "orders_logistics_read" ON orders FOR SELECT USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'logistics'
  AND status IN ('shipped','in_transit','arrived')
);
CREATE POLICY "orders_logistics_update" ON orders FOR UPDATE USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'logistics'
  AND status IN ('shipped','in_transit','arrived')
);

-- Logistics: read/write order_logs for transit pipeline
CREATE POLICY "logs_logistics" ON order_logs FOR ALL USING (
  EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = order_logs.order_id
      AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'logistics'
      AND o.status IN ('shipped','in_transit','arrived','installing','completed')
  )
);

-- ============================================================
-- MIGRATIONS (safe to run on existing databases)
-- ============================================================
-- ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_no TEXT;
-- ALTER TABLE orders ADD COLUMN IF NOT EXISTS logistics_notes TEXT;
-- ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
-- ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
--   'pending_payment','paid','assigned','accepted',
--   'in_production','production_complete','shipped',
--   'in_transit','arrived','installing',
--   'completed','after_sales','closed','cancelled'
-- ));
-- ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_type_check;
-- ALTER TABLE public.registrations ADD CONSTRAINT registrations_type_check
--   CHECK (type IN ('staff','supplier','logistics'));
