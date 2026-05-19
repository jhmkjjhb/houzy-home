-- ============================================================================
-- backfill_warranty_info_migration.sql  (v2，重写：用 _wc 辅助函数避免深层括号)
-- 给「已到 安装中/完成/质保 但 warranty_info 为空」的老订单，按其商品明细
-- 关键词匹配 4 大质保系列（与 staff.html WARRANTY_SERIES 完全一致）补齐质保表。
-- 质保起始：取该单 after_sales 日志时间，无则订单创建时间。
-- 安全：只补 warranty_info 为空的单；可重复执行。
-- 运行：Supabase Dashboard → SQL Editor → New query → 粘贴全部 → Run
-- ============================================================================

-- 单个部件 → JSON（endIso 按日历年）
CREATE OR REPLACE FUNCTION _wc(nm TEXT, yr INT, st TIMESTAMPTZ)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('name', nm, 'years', yr,
                            'endIso', st + make_interval(years => yr));
$$;

-- 单个系列 → JSON
CREATE OR REPLACE FUNCTION _ws(sid TEXT, snm TEXT, ico TEXT, st TIMESTAMPTZ, comps jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('seriesId', sid, 'seriesName', snm, 'icon', ico,
                            'startIso', st, 'components', comps);
$$;

-- 按订单商品名匹配系列，拼出完整 warranty_info
CREATE OR REPLACE FUNCTION build_warranty_info(p_order_id UUID, p_start TIMESTAMPTZ)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v jsonb := '[]'::jsonb;
  function_hit BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = p_order_id AND (
      oi.product_name ILIKE '%厨房%' OR oi.product_name ILIKE '%橱柜%' OR oi.product_name ILIKE '%水槽%'
      OR oi.product_name ILIKE '%龙头%' OR oi.product_name ILIKE '%厨%' OR oi.product_name ILIKE '%灶%'
      OR oi.product_name ILIKE '%kitchen%')) INTO function_hit;
  IF function_hit THEN
    v := v || _ws('kitchen','厨房系列','🍳', p_start, jsonb_build_array(
      _wc('全铝合金橱柜柜体',11,p_start), _wc('橱柜门板',4,p_start), _wc('橱柜五金',6,p_start),
      _wc('台面',6,p_start), _wc('水槽',11,p_start), _wc('厨房龙头',6,p_start), _wc('抽屉系统',6,p_start)));
  END IF;

  SELECT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = p_order_id AND (
      oi.product_name ILIKE '%卫浴%' OR oi.product_name ILIKE '%淋浴%' OR oi.product_name ILIKE '%马桶%'
      OR oi.product_name ILIKE '%浴室%' OR oi.product_name ILIKE '%花洒%' OR oi.product_name ILIKE '%卫生间%'
      OR oi.product_name ILIKE '%bathroom%' OR oi.product_name ILIKE '%shower%')) INTO function_hit;
  IF function_hit THEN
    v := v || _ws('bathroom','卫浴系列','🚿', p_start, jsonb_build_array(
      _wc('淋浴房框架',6,p_start), _wc('淋浴房玻璃',6,p_start), _wc('淋浴房五金',3,p_start),
      _wc('马桶陶瓷本体',11,p_start), _wc('马桶冲水机构',4,p_start), _wc('智能马桶电路',3,p_start),
      _wc('卫浴五金PVD',4,p_start), _wc('浴室柜',4,p_start), _wc('卫浴龙头',6,p_start), _wc('花洒',4,p_start)));
  END IF;

  SELECT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = p_order_id AND (
      oi.product_name ILIKE '%门%' OR oi.product_name ILIKE '%窗%' OR oi.product_name ILIKE '%推拉%'
      OR oi.product_name ILIKE '%window%' OR oi.product_name ILIKE '%door%')) INTO function_hit;
  IF function_hit THEN
    v := v || _ws('door_window','门窗系列','🚪', p_start, jsonb_build_array(
      _wc('铝合金窗框/门框型材',11,p_start), _wc('Low-E玻璃',6,p_start), _wc('门窗五金',4,p_start),
      _wc('密封胶条',3,p_start), _wc('纱窗',3,p_start)));
  END IF;

  SELECT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = p_order_id AND (
      oi.product_name ILIKE '%瓷砖%' OR oi.product_name ILIKE '%地砖%' OR oi.product_name ILIKE '%墙砖%'
      OR oi.product_name ILIKE '%砖%' OR oi.product_name ILIKE '%tile%')) INTO function_hit;
  IF function_hit THEN
    v := v || _ws('tile','瓷砖系列','🟫', p_start, jsonb_build_array(
      _wc('瓷砖本体',11,p_start), _wc('釉面层',6,p_start), _wc('防滑性能',6,p_start)));
  END IF;

  IF jsonb_array_length(v) = 0 THEN
    v := jsonb_build_array(_ws('generic','产品质保','🛡️', p_start,
           jsonb_build_array(_wc('整体产品',1,p_start))));
  END IF;

  RETURN v::text;
END$$;

UPDATE orders o
SET warranty_info = build_warranty_info(
      o.id,
      COALESCE((SELECT MAX(l.created_at) FROM order_logs l
                  WHERE l.order_id = o.id AND l.status = 'after_sales'),
               o.created_at))
WHERE o.warranty_info IS NULL
  AND o.status IN ('after_sales','completed','installing');

NOTIFY pgrst, 'reload schema';
-- ============================================================================
