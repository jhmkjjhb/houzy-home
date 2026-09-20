-- HitPay payment-link fields for staff-created OMS orders.
-- Keep the HitPay API key and webhook salt in Supabase Edge Function secrets;
-- these columns only store the non-sensitive payment reference and hosted URL.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS hitpay_payment_id text,
  ADD COLUMN IF NOT EXISTS hitpay_reference text,
  ADD COLUMN IF NOT EXISTS hitpay_payment_url text,
  ADD COLUMN IF NOT EXISTS hitpay_status text,
  ADD COLUMN IF NOT EXISTS hitpay_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS hitpay_currency text,
  ADD COLUMN IF NOT EXISTS hitpay_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS hitpay_paid_at timestamptz;

CREATE INDEX IF NOT EXISTS orders_hitpay_payment_id_idx
  ON public.orders (hitpay_payment_id);

