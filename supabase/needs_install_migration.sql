-- ============================================================================
-- needs_install_migration.sql
-- 用户 2026-05-21 确认：客户不需要安装的订单(自取/自装) 应跳过"安装中"，
--   直接 已到货 → 客户签名 → 已完成 → 质保。
-- · orders 加 needs_install BOOLEAN DEFAULT TRUE(老订单全部"需要")
-- · orders 加 install_fee NUMERIC DEFAULT 0(安装费;若需安装可>0,加进 amount)
-- · customer_submit_signature 放宽：允许 arrived + needs_install=false 直接签
-- 可重复执行。运行：Supabase SQL Editor → 粘贴全部 → Run
-- ============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS needs_install BOOLEAN DEFAULT TRUE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS install_fee   NUMERIC DEFAULT 0;

CREATE OR REPLACE FUNCTION customer_submit_signature(
  p_order_id   UUID,
  p_phone      TEXT,
  p_sign_image TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rows INT;
BEGIN
  UPDATE orders
  SET sign_image   = p_sign_image,
      signed_at    = NOW(),
      signed_by    = '客户电子签收',
      completed_at = NOW(),
      status       = 'after_sales',
      deadline_at  = NOW() + INTERVAL '1 year',
      updated_at   = NOW()
  WHERE orders.id = p_order_id
    AND (
      orders.status = 'installing'
      OR (orders.status = 'arrived' AND COALESCE(orders.needs_install, true) = false)
    )
    AND orders.sign_image IS NULL
    AND orders.customer_id IN (
      SELECT id FROM customers WHERE phone = p_phone
    )
    -- 尾款必须收齐(电子方式 或 已核对现金)
    AND (
      SELECT COALESCE(SUM(op.pct), 0)
      FROM order_payments op
      WHERE op.order_id = p_order_id
        AND (op.method <> 'cash' OR op.verified_at IS NOT NULL)
    ) >= 100;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows > 0 THEN
    INSERT INTO order_logs (order_id, status, operator_id, operator_role, operator_name, notes)
    VALUES (p_order_id, 'after_sales', NULL, 'customer', '客户',
            '客户已电子签收，订单完成并自动进入质保服务周期（总 6 年，每年提醒一次）');
  END IF;

  RETURN v_rows > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION customer_submit_signature TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
