-- Supplier product types + supplier code migration
-- Run once in Supabase SQL Editor

-- 1. Add columns to suppliers table
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS product_types TEXT[]    DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(20);

-- 2. Add product_type to order_items for smart supplier filtering
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS product_type VARCHAR(20);

-- 3. Sequence for auto-generating supplier codes
CREATE SEQUENCE IF NOT EXISTS supplier_code_seq START 1;

-- 4. Backfill existing suppliers without codes
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM suppliers WHERE supplier_code IS NULL ORDER BY created_at
  LOOP
    UPDATE suppliers
      SET supplier_code = 'SUP-' || LPAD(nextval('supplier_code_seq')::TEXT, 3, '0')
    WHERE id = r.id;
  END LOOP;
END;
$$;

-- 5. Trigger to auto-assign code on new supplier insert
CREATE OR REPLACE FUNCTION assign_supplier_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.supplier_code IS NULL THEN
    NEW.supplier_code := 'SUP-' || LPAD(nextval('supplier_code_seq')::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_code ON suppliers;
CREATE TRIGGER trg_supplier_code
  BEFORE INSERT ON suppliers
  FOR EACH ROW EXECUTE FUNCTION assign_supplier_code();
