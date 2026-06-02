-- ============================================================================
-- reports_phase1_migration.sql
-- 需求（用户 2026-06-02 确认）：3 个核心报表上线（开业前 6/7 前完成）
--   1. SST 税务报表（含税开单方案 B）
--      · orders 加 tax_inclusive BOOLEAN，开单时店员勾选含税 / 不含税
--      · 含税单：总额 ÷ 1.06 = 净售，差额 = SST
--      · 报表按月统计 净销售 / SST 应缴 / 总额
--   2. 员工提成系统
--      · commission_rates 表按品类配比例（店员 / 设计师双轨）
--      · 默认值（用户 2026-06-02 确认表）：
--          套餐 PA: 店员 1.5% / 设计师 5%
--          橱柜 CG: 1% / 3%
--          卫浴 WY / 瓷砖&地板 DB / 衣柜 DZ: 1% / 2%
--          门窗 MC: 1% / 1.5%
--          其他: 1% / 1.5%
--      · 套餐识别：order.description 含"套餐 / package" → 整单按 PA 算
--   3. 月度仪表板 7 KPI（用户选 1,2,3,5,7,9,10）
--      · 总收款 + 按支付方式拆分
--      · 订单数 / 客户数 / 客单价
--      · 5 大品类占比（CG/WY/DZ/DB/MC，其余归"其他"）
--      · 新客 vs 复购
--      · 员工业绩 TOP 5
--      · 库存滞销 TOP（60 天未动）
--      · 与上月对比 · 同比
-- 安全：所有写操作走 SECURITY DEFINER + 角色检查；读操作仅 L2+ 可见报表。
-- 可重复执行（IF NOT EXISTS / CREATE OR REPLACE）。
-- 运行：Supabase Dashboard → SQL Editor → 粘贴全部 → Run
-- ============================================================================

-- ─── 1. orders 加 tax_inclusive ───
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── 2. commission_rates 表 ───
CREATE TABLE IF NOT EXISTS commission_rates (
  product_type     TEXT PRIMARY KEY,
  label            TEXT NOT NULL,
  staff_rate_pct   NUMERIC NOT NULL DEFAULT 0 CHECK (staff_rate_pct >= 0 AND staff_rate_pct <= 100),
  designer_rate_pct NUMERIC NOT NULL DEFAULT 0 CHECK (designer_rate_pct >= 0 AND designer_rate_pct <= 100),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE commission_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commission_rates_select ON commission_rates;
CREATE POLICY commission_rates_select ON commission_rates FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS commission_rates_write ON commission_rates;
CREATE POLICY commission_rates_write ON commission_rates FOR ALL TO authenticated
  USING (auth_user_level() >= 3) WITH CHECK (auth_user_level() >= 3);

-- 默认提成比例（用户 2026-06-02 确认表）—— 用 ON CONFLICT 兼容重跑
INSERT INTO commission_rates (product_type, label, staff_rate_pct, designer_rate_pct) VALUES
  ('PA', '整装套餐',  1.5, 5.0),
  ('CG', '橱柜',     1.0, 3.0),
  ('DZ', '衣柜',     1.0, 2.0),
  ('WY', '卫浴',     1.0, 2.0),
  ('DB', '瓷砖/地板', 1.0, 2.0),
  ('MC', '门窗',     1.0, 1.5),
  ('JJ', '家具',     1.0, 1.5),
  ('WJ', '五金',     1.0, 1.5),
  ('DQ', '电器',     1.0, 1.5),
  ('TL', '涂料/壁纸', 1.0, 1.5),
  ('DJ', '灯具',     1.0, 1.5),
  ('QT', '其他',     1.0, 1.5)
ON CONFLICT (product_type) DO NOTHING;  -- 已存在的不改（管理员可在后台微调后保留）

-- 自动维护 updated_at
CREATE OR REPLACE FUNCTION _trg_commission_rates_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_commission_rates_touch_updated_at ON commission_rates;
CREATE TRIGGER trg_commission_rates_touch_updated_at
  BEFORE UPDATE ON commission_rates
  FOR EACH ROW EXECUTE FUNCTION _trg_commission_rates_touch_updated_at();

-- ─── 3. 套餐识别工具函数 ───
-- 订单描述含 "套餐 / package / 整装" 视为套餐订单
CREATE OR REPLACE FUNCTION _order_is_package(p_description TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_description IS NOT NULL AND (
    p_description ILIKE '%套餐%' OR
    p_description ILIKE '%package%' OR
    p_description ILIKE '%整装%'
  );
$$;

-- ─── 4. SST 报表 RPC ───
-- 按月统计：含税单 / 不含税单 / 净销售 / SST 应缴 / 总额
-- 权限：L2+ 可见
CREATE OR REPLACE FUNCTION get_sst_summary(
  p_start DATE DEFAULT NULL,
  p_end   DATE DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result JSONB; v_start DATE; v_end DATE;
BEGIN
  IF auth_user_level() < 2 THEN
    RETURN jsonb_build_object('ok', false, 'message', '需要店长以上权限');
  END IF;
  -- 默认查近 12 个月
  v_start := COALESCE(p_start, (CURRENT_DATE - INTERVAL '12 months')::DATE);
  v_end   := COALESCE(p_end,   CURRENT_DATE);

  WITH months AS (
    SELECT
      TO_CHAR(date_trunc('month', o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM') AS ym,
      COUNT(*) FILTER (WHERE o.tax_inclusive)        AS tax_inc_cnt,
      COUNT(*) FILTER (WHERE NOT o.tax_inclusive)    AS tax_exc_cnt,
      COALESCE(SUM(o.amount) FILTER (WHERE o.tax_inclusive AND o.payment_status='paid'), 0)     AS tax_inc_total,
      COALESCE(SUM(o.amount) FILTER (WHERE NOT o.tax_inclusive AND o.payment_status='paid'), 0) AS tax_exc_total
    FROM orders o
    WHERE o.created_at >= v_start
      AND o.created_at <  v_end + INTERVAL '1 day'
      AND o.status NOT IN ('cancelled', 'closed')
    GROUP BY 1
    ORDER BY 1 DESC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'month',        ym,
    'tax_inc_cnt',  tax_inc_cnt,
    'tax_exc_cnt',  tax_exc_cnt,
    'tax_inc_total', ROUND(tax_inc_total::numeric, 2),
    'tax_exc_total', ROUND(tax_exc_total::numeric, 2),
    -- 含税单按 ÷ 1.06 反推
    'net_sales',     ROUND((tax_inc_total / 1.06 + tax_exc_total)::numeric, 2),
    'sst_payable',   ROUND((tax_inc_total - tax_inc_total / 1.06)::numeric, 2),
    'gross_total',   ROUND((tax_inc_total + tax_exc_total)::numeric, 2)
  )), '[]'::JSONB)
  INTO v_result
  FROM months;

  RETURN jsonb_build_object('ok', true, 'data', v_result,
                            'range', jsonb_build_object('start', v_start, 'end', v_end));
END;
$$;
GRANT EXECUTE ON FUNCTION get_sst_summary TO authenticated;

-- ─── 5. 员工业绩 + 提成 RPC ───
-- 按月统计每个店员的：订单数 / 总成交额 / 提成（按品类分别算）
-- 权限：L2+ 可见
-- 算法：
--   订单按 staff_id 归组
--   套餐单（description 含套餐）→ 整单 1.5% 算店员
--   非套餐单 → 逐条 order_items 按 product_type 查 commission_rates 算
CREATE OR REPLACE FUNCTION get_staff_performance(
  p_start DATE DEFAULT NULL,
  p_end   DATE DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result JSONB; v_start DATE; v_end DATE;
BEGIN
  IF auth_user_level() < 2 THEN
    RETURN jsonb_build_object('ok', false, 'message', '需要店长以上权限');
  END IF;
  -- 默认本月
  v_start := COALESCE(p_start, date_trunc('month', CURRENT_DATE)::DATE);
  v_end   := COALESCE(p_end,   CURRENT_DATE);

  WITH paid_orders AS (
    SELECT o.id, o.staff_id, o.amount, o.tax_inclusive, o.description,
           _order_is_package(o.description) AS is_package
    FROM orders o
    WHERE o.created_at >= v_start
      AND o.created_at <  v_end + INTERVAL '1 day'
      AND o.payment_status = 'paid'
      AND o.status NOT IN ('cancelled', 'closed')
  ),
  -- 套餐单：整单按 PA 算店员 1.5%
  package_commissions AS (
    SELECT
      po.staff_id,
      po.id AS order_id,
      po.amount AS order_amount,
      -- 含税单先反推净销售
      CASE WHEN po.tax_inclusive
           THEN ROUND((po.amount / 1.06 * (SELECT staff_rate_pct FROM commission_rates WHERE product_type='PA') / 100)::numeric, 2)
           ELSE ROUND((po.amount * (SELECT staff_rate_pct FROM commission_rates WHERE product_type='PA') / 100)::numeric, 2)
      END AS commission_amt
    FROM paid_orders po
    WHERE po.is_package
  ),
  -- 非套餐单：逐 item 算
  item_commissions AS (
    SELECT
      po.staff_id,
      po.id AS order_id,
      COALESCE(oi.quantity * oi.unit_price, 0) AS line_amt,
      COALESCE(cr.staff_rate_pct, 1.0) AS rate_pct,
      ROUND((
        CASE WHEN po.tax_inclusive THEN COALESCE(oi.quantity * oi.unit_price, 0) / 1.06
                                   ELSE COALESCE(oi.quantity * oi.unit_price, 0)
        END * COALESCE(cr.staff_rate_pct, 1.0) / 100
      )::numeric, 2) AS commission_amt
    FROM paid_orders po
    JOIN order_items oi ON oi.order_id = po.id
    LEFT JOIN commission_rates cr ON cr.product_type = oi.product_type
    WHERE NOT po.is_package
  ),
  all_commissions AS (
    SELECT staff_id, order_id, order_amount AS line_amt, commission_amt FROM package_commissions
    UNION ALL
    SELECT staff_id, order_id, line_amt, commission_amt FROM item_commissions
  ),
  grouped AS (
    SELECT
      ac.staff_id,
      p.name AS staff_name,
      p.role AS staff_role,
      COUNT(DISTINCT ac.order_id) AS order_cnt,
      SUM(ac.line_amt) AS gross_sales,
      SUM(ac.commission_amt) AS commission_total
    FROM all_commissions ac
    LEFT JOIN profiles p ON p.id = ac.staff_id
    GROUP BY 1, 2, 3
    ORDER BY commission_total DESC NULLS LAST
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'staff_id',         staff_id,
    'staff_name',       COALESCE(staff_name, '未知'),
    'staff_role',       staff_role,
    'order_cnt',        order_cnt,
    'gross_sales',      ROUND(gross_sales::numeric, 2),
    'commission_total', ROUND(commission_total::numeric, 2)
  )), '[]'::JSONB)
  INTO v_result
  FROM grouped;

  RETURN jsonb_build_object('ok', true, 'data', v_result,
                            'range', jsonb_build_object('start', v_start, 'end', v_end));
END;
$$;
GRANT EXECUTE ON FUNCTION get_staff_performance TO authenticated;

-- ─── 6. 月度仪表板 7 KPI RPC ───
-- 输出本月数据 + 上月对比
-- 权限：L1+（店员看本店、店长以上看更广，自然走 RLS）
CREATE OR REPLACE FUNCTION get_dashboard_kpis(
  p_month DATE DEFAULT NULL  -- 输入任一月份内的日期；NULL=本月
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_curr_start DATE; v_curr_end DATE;
  v_prev_start DATE; v_prev_end DATE;
  v_curr JSONB; v_prev JSONB;
  v_top_staff JSONB; v_stale_inv JSONB;
  v_caller_role TEXT; v_caller_store UUID; v_caller_region TEXT; v_caller_level INT;
BEGIN
  IF auth_user_level() < 1 THEN
    RETURN jsonb_build_object('ok', false, 'message', '请登录');
  END IF;

  SELECT role, store_id, region INTO v_caller_role, v_caller_store, v_caller_region
    FROM profiles WHERE id = auth.uid();
  v_caller_level := auth_user_level();

  -- 本月范围（吉隆坡时区）
  v_curr_start := date_trunc('month', COALESCE(p_month, CURRENT_DATE))::DATE;
  v_curr_end   := (v_curr_start + INTERVAL '1 month')::DATE;
  v_prev_start := (v_curr_start - INTERVAL '1 month')::DATE;
  v_prev_end   := v_curr_start;

  -- 本月 KPI
  WITH scoped_orders AS (
    SELECT o.*, c.id AS cust_id
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.created_at >= v_curr_start
      AND o.created_at <  v_curr_end
      AND o.status NOT IN ('cancelled', 'closed')
      -- 数据范围按角色（与 RLS 思路一致，但需要在函数里显式）
      AND (
        v_caller_level >= 4
        OR (v_caller_level IN (1,2) AND o.store_id = v_caller_store)
        OR (v_caller_level = 3 AND o.store_id IN
            (SELECT s.id FROM stores s WHERE s.region = v_caller_region))
      )
  ),
  pay AS (
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE payment_status='paid'), 0) AS revenue_total,
      COALESCE(SUM(amount) FILTER (WHERE payment_status='paid' AND COALESCE(payment_method,'')=''),  0) AS pay_unknown,
      COALESCE(SUM(amount) FILTER (WHERE payment_status='paid' AND payment_method ILIKE '%cash%'),    0) AS pay_cash,
      COALESCE(SUM(amount) FILTER (WHERE payment_status='paid' AND (payment_method ILIKE '%tng%' OR payment_method ILIKE '%touch%')), 0) AS pay_tng,
      COALESCE(SUM(amount) FILTER (WHERE payment_status='paid' AND payment_method ILIKE '%fpx%'),     0) AS pay_fpx,
      COALESCE(SUM(amount) FILTER (WHERE payment_status='paid' AND (payment_method ILIKE '%card%' OR payment_method ILIKE '%credit%' OR payment_method ILIKE '%visa%')), 0) AS pay_card,
      COALESCE(SUM(amount) FILTER (WHERE payment_status='paid' AND payment_method ILIKE '%transfer%'), 0) AS pay_transfer,
      COUNT(*)                                AS order_cnt,
      COUNT(DISTINCT cust_id)                 AS cust_cnt
    FROM scoped_orders
  ),
  -- 5 大品类：橱柜 CG / 卫浴 WY / 衣柜 DZ / 瓷砖&地板 DB / 门窗 MC
  cat_break AS (
    SELECT
      CASE WHEN COALESCE(oi.product_type,'') IN ('CG','WY','DZ','DB','MC')
           THEN oi.product_type ELSE 'QT' END AS cat,
      COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS amt
    FROM scoped_orders so
    JOIN order_items oi ON oi.order_id = so.id
    GROUP BY 1
  ),
  -- 新客 vs 复购：本月有单的客户，看 created_at 是否在本月之前
  new_vs_returning AS (
    SELECT
      COUNT(*) FILTER (WHERE c.created_at >= v_curr_start) AS new_customers,
      COUNT(*) FILTER (WHERE c.created_at <  v_curr_start) AS returning_customers
    FROM (SELECT DISTINCT cust_id FROM scoped_orders WHERE cust_id IS NOT NULL) so2
    JOIN customers c ON c.id = so2.cust_id
  )
  SELECT jsonb_build_object(
    'revenue_total', ROUND(p.revenue_total::numeric, 2),
    'payment_breakdown', jsonb_build_object(
      'cash',     ROUND(p.pay_cash::numeric, 2),
      'tng',      ROUND(p.pay_tng::numeric, 2),
      'fpx',      ROUND(p.pay_fpx::numeric, 2),
      'card',     ROUND(p.pay_card::numeric, 2),
      'transfer', ROUND(p.pay_transfer::numeric, 2),
      'other',    ROUND(p.pay_unknown::numeric, 2)
    ),
    'order_cnt',     p.order_cnt,
    'customer_cnt',  p.cust_cnt,
    'avg_order_value', CASE WHEN p.order_cnt > 0
                            THEN ROUND((p.revenue_total / p.order_cnt)::numeric, 2)
                            ELSE 0 END,
    'category_breakdown', COALESCE((SELECT jsonb_object_agg(cat, ROUND(amt::numeric, 2)) FROM cat_break), '{}'::jsonb),
    'new_customers',       COALESCE((SELECT new_customers FROM new_vs_returning), 0),
    'returning_customers', COALESCE((SELECT returning_customers FROM new_vs_returning), 0)
  )
  INTO v_curr
  FROM pay p;

  -- 上月 KPI（同样算法，给主前端用于对比）
  WITH scoped_orders AS (
    SELECT o.*, c.id AS cust_id
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.created_at >= v_prev_start
      AND o.created_at <  v_prev_end
      AND o.status NOT IN ('cancelled', 'closed')
      AND (
        v_caller_level >= 4
        OR (v_caller_level IN (1,2) AND o.store_id = v_caller_store)
        OR (v_caller_level = 3 AND o.store_id IN
            (SELECT s.id FROM stores s WHERE s.region = v_caller_region))
      )
  )
  SELECT jsonb_build_object(
    'revenue_total', ROUND(COALESCE(SUM(amount) FILTER (WHERE payment_status='paid'), 0)::numeric, 2),
    'order_cnt',     COUNT(*),
    'customer_cnt',  COUNT(DISTINCT cust_id)
  )
  INTO v_prev
  FROM scoped_orders;

  -- 员工业绩 TOP 5（本月、本范围内）
  WITH staff_perf AS (
    SELECT
      o.staff_id,
      p.name AS staff_name,
      COUNT(*) AS order_cnt,
      COALESCE(SUM(o.amount) FILTER (WHERE o.payment_status='paid'), 0) AS gross
    FROM orders o
    LEFT JOIN profiles p ON p.id = o.staff_id
    WHERE o.created_at >= v_curr_start
      AND o.created_at <  v_curr_end
      AND o.status NOT IN ('cancelled', 'closed')
      AND o.staff_id IS NOT NULL
      AND (
        v_caller_level >= 4
        OR (v_caller_level IN (1,2) AND o.store_id = v_caller_store)
        OR (v_caller_level = 3 AND o.store_id IN
            (SELECT s.id FROM stores s WHERE s.region = v_caller_region))
      )
    GROUP BY 1, 2
    ORDER BY gross DESC
    LIMIT 5
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'staff_id',  staff_id,
    'staff_name', COALESCE(staff_name, '未知'),
    'order_cnt', order_cnt,
    'gross',     ROUND(gross::numeric, 2)
  )), '[]'::jsonb)
  INTO v_top_staff
  FROM staff_perf;

  -- 库存滞销 TOP（products 表如果存在 + 60 天未动）
  -- 注：products / inventory 表可能在不同部署有不同结构，做防御性查询
  BEGIN
    WITH stale AS (
      SELECT
        p.name,
        p.sku,
        COALESCE(SUM(i.qty_on_hand), 0) AS qty_on_hand,
        MAX(im.created_at) AS last_movement
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
      LEFT JOIN inventory_movements im ON im.product_id = p.id AND im.type = 'out'
      GROUP BY p.id, p.name, p.sku
      HAVING COALESCE(SUM(i.qty_on_hand), 0) > 0
         AND (MAX(im.created_at) IS NULL OR MAX(im.created_at) < CURRENT_DATE - INTERVAL '60 days')
      ORDER BY qty_on_hand DESC
      LIMIT 10
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', name,
      'sku',  sku,
      'qty',  qty_on_hand,
      'last_move', last_movement
    )), '[]'::jsonb)
    INTO v_stale_inv
    FROM stale;
  EXCEPTION WHEN OTHERS THEN
    v_stale_inv := '[]'::jsonb;
  END;

  RETURN jsonb_build_object(
    'ok',       true,
    'current',  v_curr,
    'previous', v_prev,
    'top_staff', v_top_staff,
    'stale_inventory', v_stale_inv,
    'period',  jsonb_build_object(
      'curr_start', v_curr_start, 'curr_end', v_curr_end,
      'prev_start', v_prev_start, 'prev_end', v_prev_end
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION get_dashboard_kpis TO authenticated;

-- 老板可能查别月：辅助方法可后续加
NOTIFY pgrst, 'reload schema';
