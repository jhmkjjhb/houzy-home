-- ============================================================================
-- signoff_require_full_payment_migration.sql
-- 用户 2026-05-19 决策（Step C·乙）：尾款不卡"安装中"，但**尾款未收齐时
-- 客户不能电子签收 / 订单不能完成**。
-- 做法：在 customer_submit_signature 的 WHERE 再加一条硬关卡——
--   该单"已计入收款"百分比合计 ≥ 100 才放行。
--   已计入 = 电子方式(transfer/ewallet/card) 或 已店长核对的现金
--   (与 Step B 的计入口径完全一致)。
-- 其它逻辑（自动完成→质保、写日志等）与 customer_signature_autocomplete
--   版本完全一致，仅多这一条关卡。可重复执行（CREATE OR REPLACE）。
-- 运行：Supabase Dashboard → SQL Editor → New query → 粘贴全部 → Run
-- ============================================================================

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
    AND orders.status = 'installing'
    AND orders.sign_image IS NULL
    AND orders.customer_id IN (
      SELECT id FROM customers WHERE phone = p_phone
    )
    -- Step C·乙 硬关卡：尾款（全部已计入收款）必须收齐 ≥ 100%
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
