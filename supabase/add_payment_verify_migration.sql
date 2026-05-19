-- ============================================================================
-- add_payment_verify_migration.sql
-- 用户 2026-05-19 决策（Step B）：现金收款需店长核对；未核对的现金不计入
-- 「已收」，不参与状态推进（待付款→已付款）。电子方式(转账/电子钱包/刷卡)
-- 因本身可追溯，记账即视为已核对、直接计入。
-- 做法：order_payments 加 verified_by / verified_at。
-- 历史数据：一律回填为"已核对"(verified_at = paid_at)，不追溯旧单、不破坏
--   既有"已付款"判断。
-- 安全：ADD COLUMN IF NOT EXISTS + 回填，可重复执行。
-- 运行：Supabase Dashboard → SQL Editor → New query → 粘贴全部 → Run
-- ============================================================================

ALTER TABLE order_payments
  ADD COLUMN IF NOT EXISTS verified_by  UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS verified_at  TIMESTAMPTZ;

-- 历史记录全部视为已核对（不追溯，避免旧单被卡在"待核对"）
UPDATE order_payments
   SET verified_at = COALESCE(verified_at, paid_at, NOW())
 WHERE verified_at IS NULL;

NOTIFY pgrst, 'reload schema';
