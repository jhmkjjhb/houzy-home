-- ============================================================================
-- deadline_autoset_migration.sql
-- 2026-05-23:统一倒计时治本方案
-- 问题:recompute_order_status 用 COALESCE,推进阶段时 deadline_at 从不刷新 →
--       任何阶段都可能没计时/计时错。各手动路径也可能漏设。
-- 修法:BEFORE INSERT/UPDATE OF status 触发器,状态一变就按新阶段重设倒计时。
--   · 只在状态变化时重设(店员单独调工期=改 deadline 不改 status,不会被覆盖)
--   · 现货单(无定制商品)「已付款」给 24h;定制 2h
--   · 终态(completed/cancelled/closed)清空计时
-- 可重复执行。Supabase SQL Editor → 粘贴 → Run
-- ============================================================================
CREATE OR REPLACE FUNCTION _set_order_deadline()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_h NUMERIC; v_all_stock BOOLEAN;
BEGIN
  -- UPDATE 但状态没变 → 不动 deadline(尊重手动调的工期)
  IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  -- INSERT 已自带 deadline → 尊重
  IF TG_OP='INSERT' AND NEW.deadline_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 终态:无倒计时
  IF NEW.status IN ('completed','cancelled','closed') THEN
    NEW.deadline_at := NULL; RETURN NEW;
  END IF;

  -- 各阶段 SLA(小时),与前端 STATUS_SLA_HOURS 一致
  v_h := CASE NEW.status
    WHEN 'pending_payment'     THEN 0.25
    WHEN 'paid'                THEN 2
    WHEN 'in_production'       THEN 600
    WHEN 'production_complete' THEN 24
    WHEN 'shipped'             THEN 480
    WHEN 'arrived'             THEN 24
    WHEN 'installing'          THEN 120
    WHEN 'after_sales'         THEN 8760
    ELSE NULL END;

  -- 现货单(全部非定制)「已付款」不排产 → 直接给 24h 发货
  IF NEW.status='paid' THEN
    SELECT NOT EXISTS(
      SELECT 1 FROM order_items oi
      WHERE oi.order_id = NEW.id
        AND COALESCE(oi.fulfillment_type,'custom')='custom'
    ) INTO v_all_stock;
    IF v_all_stock THEN v_h := 24; END IF;
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

-- 一次性回填:所有"进行中却没倒计时"的存量订单
UPDATE orders SET deadline_at = COALESCE(updated_at, created_at, NOW()) + (CASE status
  WHEN 'pending_payment'     THEN 0.25
  WHEN 'paid'                THEN 2
  WHEN 'in_production'       THEN 600
  WHEN 'production_complete' THEN 24
  WHEN 'shipped'             THEN 480
  WHEN 'arrived'             THEN 24
  WHEN 'installing'          THEN 120
  ELSE 24 END || ' hours')::interval
WHERE deadline_at IS NULL
  AND status NOT IN ('completed','after_sales','cancelled','closed');

NOTIFY pgrst, 'reload schema';
