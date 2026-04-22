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
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO stores (name, code, address) VALUES
  ('新山店 JB', 'JB', '141, Jalan Mutiara Emas 10/19, Taman Mount Austin, 81100 Johor Bahru'),
  ('新加坡店 SG', 'SG', 'Singapore')
ON CONFLICT (code) DO NOTHING;

-- User profiles (links to Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT '',
  phone      TEXT,
  role       TEXT NOT NULL DEFAULT 'customer'
               CHECK (role IN ('customer','staff','supplier','admin')),
  store_id   UUID REFERENCES stores(id),   -- staff only
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
  active       BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

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
                     'completed','after_sales','closed'
                   )),
  description    TEXT,
  notes          TEXT,
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

-- Profiles
CREATE POLICY "profiles_self"  ON profiles FOR ALL USING (id = auth.uid());
CREATE POLICY "profiles_admin" ON profiles FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
);

-- Stores: authenticated read
CREATE POLICY "stores_read"  ON stores FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "stores_admin" ON stores FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
);

-- Customers: staff/admin full; self-read
CREATE POLICY "customers_staff" ON customers FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('staff','admin')
);
CREATE POLICY "customers_self" ON customers FOR SELECT USING (user_id = auth.uid());

-- Referrers: staff/admin
CREATE POLICY "referrers_staff" ON referrers FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('staff','admin')
);

-- Suppliers: staff/admin full; supplier self-read
CREATE POLICY "suppliers_staff" ON suppliers FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('staff','admin')
);
CREATE POLICY "suppliers_self" ON suppliers FOR SELECT USING (user_id = auth.uid());

-- Orders
CREATE POLICY "orders_staff_admin" ON orders FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('staff','admin')
);
CREATE POLICY "orders_supplier_read" ON orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM suppliers WHERE user_id = auth.uid() AND id = orders.supplier_id)
);
CREATE POLICY "orders_supplier_update" ON orders FOR UPDATE USING (
  EXISTS (SELECT 1 FROM suppliers WHERE user_id = auth.uid() AND id = orders.supplier_id)
);
CREATE POLICY "orders_customer" ON orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM customers WHERE user_id = auth.uid() AND id = orders.customer_id)
);

-- Order logs
CREATE POLICY "logs_staff_admin" ON order_logs FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('staff','admin')
);
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
