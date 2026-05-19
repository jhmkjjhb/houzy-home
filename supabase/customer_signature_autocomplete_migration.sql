-- ============================================================================
-- customer_signature_autocomplete_migration.sql
-- 需求（用户 2026-05-19 确认）：客户在 customer.html 电子签名并确认后，
--   订单自动完成并跳入「质保服务」周期（总 6 年，每年提醒一次），
--   无需店员再手动点「确认客户签收 → 完成订单」。
-- 做法：重写 customer_submit_signature —— 写签名的同时一并：
--   signed_at=now()、signed_by='客户电子签收'、completed_at=now()、
--   status='after_sales'、deadline_at=now()+1年（首个年度提醒），并写一条日志。
-- 安全：仍 SECURITY DEFINER + 校验手机号匹配 + 仅 installing 且未签过；
--   可重复执行（CREATE OR REPLACE）。
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
      status       = 'after_sales',                 -- 自动跳入质保服务周期
      deadline_at  = NOW() + INTERVAL '1 year',      -- 首个年度提醒（共 6 年）
      updated_at   = NOW()
  WHERE orders.id = p_order_id
    AND orders.status = 'installing'
    AND orders.sign_image IS NULL
    AND orders.customer_id IN (
      SELECT id FROM customers WHERE phone = p_phone
    );
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
