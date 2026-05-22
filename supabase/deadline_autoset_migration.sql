-- ============================================================================
-- deadline_autoset_migration.sql (2026-05-23 修订:用 := 赋值避免 SELECT INTO 歧义)
-- 统一倒计时:状态一变就按新阶段重设 deadline_at;含存量回填。
-- 运行前请「全选清空」编辑器,只粘本段。
-- ============================================================================
CREATE OR REPLACE FUNCTION _set_order_deadline()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_h NUMERIC;
  v_all_stock BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.deadline_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('completed','cancelled','closed') THEN
    NEW.deadline_at := NULL;
    RETURN NEW;
  END IF;
  v_h := CASE NEW.status
    WHEN 'pending_payment'     THEN 0.25
    WHEN 'paid'                THEN 2
    WHEN 'in_production'       THEN 600
    WHEN 'production_complete' THEN 24
    WHEN 'shipped'             THEN 480
    WHEN 'arrived'             THEN 24
    WHEN 'installing'          THEN 120
    WHEN 'after_sales'         THEN 8760
    ELSE NULL
  END;
  IF NEW.status = 'paid' THEN
    v_all_stock := NOT EXISTS (
      SELECT 1 FROM order_items oi
      WHERE oi.order_id = NEW.id
        AND COALESCE(oi.fulfillment_type,'custom') = 'custom'
    );
    IF v_all_stock THEN
      v_h := 24;
    END IF;
  END IF;
  IF v_h IS NOT NULL THEN
    NEW.deadline_at := NOW() + (v_h || ' hours')::interval;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_order_deadline ON orders;
CREATE TRIGGER trg_set_order_deadline
  BEFORE INSERT OR UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION _set_order_deadline();

UPDATE orders
SET deadline_at = COALESCE(updated_at, created_at, NOW()) + (CASE status
  WHEN 'pending_payment'     THEN 0.25
  WHEN 'paid'                THEN 2
  WHEN 'in_production'       THEN 600
  WHEN 'production_complete' THEN 24
  WHEN 'shipped'             THEN 480
  WHEN 'arrived'             THEN 24
  WHEN 'installing'          THEN 120
  ELSE 24
END || ' hours')::interval
WHERE deadline_at IS NULL
  AND status NOT IN ('completed','after_sales','cancelled','closed');

NOTIFY pgrst, 'reload schema';
