-- ============================================================================
-- cost_check_rpc_migration.sql
-- 2026-05-22 用户决定:成本价要对普通店员(L1)隐藏,返点率可见。
--
-- 做法:把"卖跌破成本"检测改成服务端 RPC —— 传 [{name, price}],只回"几行跌破/
-- 几行接近成本"的计数与下标,绝不返回成本数字本身。L1 浏览器不再下载 unit_cost,
-- 由这个 RPC 在服务端比对(SECURITY DEFINER,以属主身份读 inventory 成本)。
--
-- 店长 L2+ 仍在前端用本地成本做实时红/黄边框(他们有权看成本数字)。
--
-- 可重复执行。运行:Supabase SQL Editor → 全选清空 → 粘贴 → Run
-- ============================================================================

CREATE OR REPLACE FUNCTION cost_check_lines(p_lines JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_line  JSONB;
  v_idx   INT := 0;
  v_under INT := 0;
  v_warn  INT := 0;
  v_under_idx JSONB := '[]'::jsonb;
  v_sku   TEXT; v_name TEXT; v_price NUMERIC; v_pid UUID; v_cost NUMERIC;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RETURN jsonb_build_object('under', 0, 'warn', 0, 'under_idx', '[]'::jsonb);
  END IF;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_sku   := NULLIF(btrim(COALESCE(v_line->>'sku','')),  '');
    v_name  := NULLIF(btrim(COALESCE(v_line->>'name','')), '');
    v_price := COALESCE((v_line->>'price')::numeric, 0);
    -- 解析商品:优先 SKU 唯一,其次商品名唯一
    v_pid := NULL;
    IF v_sku IS NOT NULL THEN
      SELECT id INTO v_pid FROM products WHERE sku = v_sku LIMIT 1;
    END IF;
    IF v_pid IS NULL AND v_name IS NOT NULL THEN
      SELECT id INTO v_pid FROM products WHERE name = v_name LIMIT 1;
    END IF;
    -- 取该商品"最低非零成本"(更保守)
    v_cost := NULL;
    IF v_pid IS NOT NULL THEN
      SELECT min(unit_cost) INTO v_cost FROM inventory
        WHERE product_id = v_pid AND unit_cost > 0;
    END IF;
    IF v_cost IS NOT NULL AND v_price > 0 THEN
      IF v_price < v_cost THEN
        v_under := v_under + 1;
        v_under_idx := v_under_idx || to_jsonb(v_idx);
      ELSIF v_price < v_cost * 1.1 THEN
        v_warn := v_warn + 1;
      END IF;
    END IF;
    v_idx := v_idx + 1;
  END LOOP;
  -- 只回计数与下标,不回成本数字
  RETURN jsonb_build_object('under', v_under, 'warn', v_warn, 'under_idx', v_under_idx);
END;
$$;
GRANT EXECUTE ON FUNCTION cost_check_lines TO authenticated;

NOTIFY pgrst, 'reload schema';
