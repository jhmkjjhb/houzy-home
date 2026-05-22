-- ============================================================================
-- designers_migration.sql
-- 用户 2026-05-22 决定：建合作设计师档案 + 订单关联设计师(快照式)
--
-- 模型:
--   designers 表:每位合作设计师一行,可设三种合作模式
--     · 'discount'   折扣型 —— 只让客户(客户实付 = 原价 - discount_pct)
--     · 'commission' 返点型 —— 只返设计师(客户付原价,设计师月底拿 commission_pct 返点)
--     · 'mixed'      混合型 —— 既让客户又返设计师
--   orders 加 designer_id + 快照字段:
--     · 写入时把当时的折扣/返点率写进订单,以后改设计师档案不影响历史单的财务
--     · designer_settled_at:月底对账盖章(用于"已结算/未结算"过滤)
--
-- 权限:
--   · SELECT 给 authenticated:店员要在开单时看到设计师列表
--   · INSERT/UPDATE/DELETE 给 L2+(店长及以上)
--   · anon 不可读(设计师电话是 PII)
--
-- 可重复执行。运行:Supabase SQL Editor → 粘贴全部 → Run
-- ============================================================================

CREATE TABLE IF NOT EXISTS designers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  phone           TEXT,
  studio          TEXT,
  model_type      TEXT NOT NULL DEFAULT 'discount'
                  CHECK (model_type IN ('discount','commission','mixed')),
  discount_pct    NUMERIC NOT NULL DEFAULT 0  CHECK (discount_pct >= 0   AND discount_pct <= 100),
  commission_pct  NUMERIC NOT NULL DEFAULT 0  CHECK (commission_pct >= 0 AND commission_pct <= 100),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_designers_active ON designers (active);
CREATE INDEX IF NOT EXISTS idx_designers_name   ON designers (name);

-- orders 加设计师外键 + 财务快照(写入时锁定;以后改设计师档案不影响历史财务)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS designer_id                  UUID REFERENCES designers(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS designer_discount_pct        NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS designer_commission_pct      NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS designer_commission_amount   NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS designer_settled_at          TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_designer ON orders (designer_id) WHERE designer_id IS NOT NULL;

-- RLS
ALTER TABLE designers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS designers_select ON designers;
CREATE POLICY designers_select ON designers FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS designers_insert ON designers;
CREATE POLICY designers_insert ON designers FOR INSERT TO authenticated
  WITH CHECK (auth_user_level() >= 2);

DROP POLICY IF EXISTS designers_update ON designers;
CREATE POLICY designers_update ON designers FOR UPDATE TO authenticated
  USING (auth_user_level() >= 2) WITH CHECK (auth_user_level() >= 2);

DROP POLICY IF EXISTS designers_delete ON designers;
CREATE POLICY designers_delete ON designers FOR DELETE TO authenticated
  USING (auth_user_level() >= 2);

-- 自动维护 updated_at
CREATE OR REPLACE FUNCTION _trg_designers_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_designers_touch_updated_at ON designers;
CREATE TRIGGER trg_designers_touch_updated_at
  BEFORE UPDATE ON designers
  FOR EACH ROW EXECUTE FUNCTION _trg_designers_touch_updated_at();

NOTIFY pgrst, 'reload schema';
