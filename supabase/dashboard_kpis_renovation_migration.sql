-- 本月经营仪表板把整装订单算进去(2026-10-29)
-- 商品订单:沿用原口径(本月建单、已付款订单的金额)。
-- 整装订单:收款 = 本月已核对、未作废的整装收款(退款为负);单数 = 本月签约的整装合同(非草稿)。
-- 两边分开返回 goods_* / renovation_*,合计放在原来的 revenue_total / order_cnt / customer_cnt。
-- 在 Supabase SQL Editor 运行。

CREATE OR REPLACE FUNCTION public._dash_kpi_period(
  p_start date, p_end date, p_level int, p_store uuid, p_region text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  WITH scoped_stores AS (
    SELECT s.id FROM stores s
    WHERE p_level >= 4
       OR (p_level IN (1,2) AND s.id = p_store)
       OR (p_level = 3 AND s.region = p_region)
  ),
  scoped_orders AS (
    SELECT o.id, o.amount, o.payment_status, o.staff_id, o.customer_id AS cust_id,
           regexp_replace(coalesce(c.phone,''), '\D', '', 'g') AS phone
    FROM orders o
    JOIN scoped_stores ss ON ss.id = o.store_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.created_at >= p_start AND o.created_at < p_end
      AND o.status NOT IN ('cancelled', 'closed')
  ),
  reno_projects AS (
    SELECT p.id, p.created_by, p.current_total, p.state,
           regexp_replace(coalesce(p.customer_phone,''), '\D', '', 'g') AS phone,
           coalesce(CASE WHEN p.snapshot->>'signed_on' ~ '^\d{4}-\d{2}-\d{2}$'
                         THEN (p.snapshot->>'signed_on')::date END,
                    p.accepted_on, p.created_at::date) AS signed_on
    FROM renovation_projects p
    JOIN scoped_stores ss ON ss.id = p.store_id
  ),
  reno_signed AS (
    SELECT * FROM reno_projects
    WHERE state <> 'draft' AND signed_on >= p_start AND signed_on < p_end
  ),
  reno_pay AS (
    SELECT rp.id AS project_id, rp.created_by, lower(coalesce(e.method,'')) AS method,
           CASE WHEN e.kind = 'refund' THEN -e.amount ELSE e.amount END AS amount
    FROM reno_projects rp
    JOIN renovation_payments e ON e.project_id = rp.id
    WHERE e.voided_at IS NULL AND e.verified_at IS NOT NULL
      AND e.paid_on >= p_start AND e.paid_on < p_end
  ),
  pay_by_method AS (
    SELECT method, sum(total) AS total FROM (
      SELECT lower(coalesce(op.method,'')) AS method, op.amount AS total
      FROM order_payments op JOIN scoped_orders so ON so.id = op.order_id
      WHERE op.paid_at IS NOT NULL
      UNION ALL
      SELECT method, amount FROM reno_pay
    ) x GROUP BY 1
  ),
  -- 客户按手机号去重,商品和整装是同一个人只算一次;没有手机号的商品客户按 customer_id 算
  cust AS (
    SELECT DISTINCT CASE WHEN phone <> '' THEN 'p:'||phone ELSE 'c:'||cust_id::text END AS k,
           phone, cust_id
    FROM scoped_orders WHERE cust_id IS NOT NULL OR phone <> ''
    UNION
    SELECT DISTINCT 'p:'||phone, phone, NULL::uuid FROM reno_signed WHERE phone <> ''
  ),
  cust_keys AS (SELECT DISTINCT k, max(phone) AS phone, max(cust_id::text)::uuid AS cust_id FROM cust GROUP BY k),
  -- 新客:本期之前既没有客户档案、也没有更早签约的整装合同
  cust_new AS (
    SELECT ck.k,
      NOT EXISTS (
        SELECT 1 FROM customers c
        WHERE c.created_at < p_start
          AND (c.id = ck.cust_id OR (ck.phone <> '' AND regexp_replace(coalesce(c.phone,''), '\D', '', 'g') = ck.phone))
      ) AND NOT EXISTS (
        SELECT 1 FROM reno_projects rp
        WHERE ck.phone <> '' AND rp.phone = ck.phone AND rp.state <> 'draft' AND rp.signed_on < p_start
      ) AS is_new
    FROM cust_keys ck
  ),
  cat_break AS (
    SELECT CASE WHEN coalesce(oi.product_type,'') IN ('CG','WY','DZ','DB','MC')
                THEN oi.product_type ELSE 'QT' END AS cat,
           coalesce(sum(oi.quantity * oi.unit_price), 0) AS amt
    FROM scoped_orders so JOIN order_items oi ON oi.order_id = so.id
    GROUP BY 1
    UNION ALL
    SELECT 'ZZ', coalesce(sum(current_total), 0) FROM reno_signed HAVING count(*) > 0
  ),
  staff_perf AS (
    SELECT staff_id, sum(cnt) AS order_cnt, sum(gross) AS gross FROM (
      SELECT staff_id, count(*) AS cnt,
             coalesce(sum(amount) FILTER (WHERE payment_status = 'paid'), 0) AS gross
      FROM scoped_orders WHERE staff_id IS NOT NULL GROUP BY 1
      UNION ALL
      SELECT created_by, count(*), 0 FROM reno_signed WHERE created_by IS NOT NULL GROUP BY 1
      UNION ALL
      SELECT created_by, 0, sum(amount) FROM reno_pay WHERE created_by IS NOT NULL GROUP BY 1
    ) x GROUP BY 1
  ),
  totals AS (
    SELECT
      (SELECT coalesce(sum(amount) FILTER (WHERE payment_status = 'paid'), 0) FROM scoped_orders) AS goods_rev,
      (SELECT coalesce(sum(amount), 0) FROM reno_pay) AS reno_rev,
      (SELECT count(*) FROM scoped_orders) AS goods_cnt,
      (SELECT count(*) FROM reno_signed) AS reno_cnt,
      (SELECT count(*) FROM cust_keys) AS cust_cnt
  )
  SELECT jsonb_build_object(
    'revenue_total', round((t.goods_rev + t.reno_rev)::numeric, 2),
    'goods_revenue', round(t.goods_rev::numeric, 2),
    'renovation_revenue', round(t.reno_rev::numeric, 2),
    'payment_breakdown', jsonb_build_object(
      'cash',     round(coalesce((SELECT sum(total) FROM pay_by_method WHERE method LIKE '%cash%'), 0)::numeric, 2),
      'tng',      round(coalesce((SELECT sum(total) FROM pay_by_method WHERE method LIKE '%tng%' OR method LIKE '%touch%'), 0)::numeric, 2),
      'fpx',      round(coalesce((SELECT sum(total) FROM pay_by_method WHERE method LIKE '%fpx%'), 0)::numeric, 2),
      'card',     round(coalesce((SELECT sum(total) FROM pay_by_method WHERE method LIKE '%card%' OR method LIKE '%credit%' OR method LIKE '%visa%'), 0)::numeric, 2),
      'transfer', round(coalesce((SELECT sum(total) FROM pay_by_method WHERE method LIKE '%transfer%'), 0)::numeric, 2),
      'other',    round(coalesce((SELECT sum(total) FROM pay_by_method WHERE method NOT LIKE '%cash%' AND method NOT LIKE '%tng%'
                    AND method NOT LIKE '%touch%' AND method NOT LIKE '%fpx%' AND method NOT LIKE '%card%' AND method NOT LIKE '%credit%'
                    AND method NOT LIKE '%visa%' AND method NOT LIKE '%transfer%'), 0)::numeric, 2)
    ),
    'order_cnt', t.goods_cnt + t.reno_cnt,
    'goods_order_cnt', t.goods_cnt,
    'renovation_cnt', t.reno_cnt,
    'customer_cnt', t.cust_cnt,
    'avg_order_value', CASE WHEN t.goods_cnt + t.reno_cnt > 0
                            THEN round(((t.goods_rev + t.reno_rev) / (t.goods_cnt + t.reno_cnt))::numeric, 2) ELSE 0 END,
    'category_breakdown', coalesce((SELECT jsonb_object_agg(cat, round(amt::numeric, 2)) FROM cat_break), '{}'::jsonb),
    'new_customers',       (SELECT count(*) FROM cust_new WHERE is_new),
    'returning_customers', (SELECT count(*) FROM cust_new WHERE NOT is_new),
    'top_staff', coalesce((
      SELECT jsonb_agg(jsonb_build_object('staff_id', sp.staff_id, 'staff_name', coalesce(pr.name, 'unknown'),
                                          'order_cnt', sp.order_cnt, 'gross', round(sp.gross::numeric, 2))
                       ORDER BY sp.gross DESC)
      FROM (SELECT * FROM staff_perf ORDER BY gross DESC LIMIT 5) sp
      LEFT JOIN profiles pr ON pr.id = sp.staff_id), '[]'::jsonb)
  ) INTO v
  FROM totals t;
  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public._dash_kpi_period(date, date, int, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_month date DEFAULT NULL::date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_curr_start date; v_curr_end date; v_prev_start date; v_prev_end date;
  v_curr jsonb; v_prev jsonb;
  v_caller_store uuid; v_caller_region text; v_caller_level int;
BEGIN
  IF auth_user_level() < 1 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'login required');
  END IF;

  SELECT store_id, region INTO v_caller_store, v_caller_region FROM profiles WHERE id = auth.uid();
  v_caller_level := auth_user_level();

  v_curr_start := date_trunc('month', coalesce(p_month, current_date))::date;
  v_curr_end   := (v_curr_start + interval '1 month')::date;
  v_prev_start := (v_curr_start - interval '1 month')::date;
  v_prev_end   := v_curr_start;

  v_curr := _dash_kpi_period(v_curr_start, v_curr_end, v_caller_level, v_caller_store, v_caller_region);
  v_prev := _dash_kpi_period(v_prev_start, v_prev_end, v_caller_level, v_caller_store, v_caller_region);

  RETURN jsonb_build_object(
    'ok', true,
    'current', v_curr - 'top_staff',
    'previous', v_prev - 'top_staff',
    'top_staff', v_curr->'top_staff',
    'stale_inventory', '[]'::jsonb,
    'period', jsonb_build_object('curr_start', v_curr_start, 'curr_end', v_curr_end,
                                 'prev_start', v_prev_start, 'prev_end', v_prev_end)
  );
END;
$function$;
