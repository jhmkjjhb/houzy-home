-- Electronic signature storage for customer sign-off
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sign_image TEXT;

-- Security-definer function so unauthenticated customer portal can submit signature
-- Verifies phone matches the order's customer before writing
CREATE OR REPLACE FUNCTION customer_submit_signature(
  p_order_id  UUID,
  p_phone     TEXT,
  p_sign_image TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rows INT;
BEGIN
  UPDATE orders o
  SET sign_image = p_sign_image
  FROM customers c
  WHERE o.id          = p_order_id
    AND o.customer_id = c.id
    AND c.phone       = p_phone
    AND o.status      = 'installing'
    AND o.sign_image  IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION customer_submit_signature TO anon, authenticated;
