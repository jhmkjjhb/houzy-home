-- ============================================================================
-- backfill_warranty_info_migration.sql
-- 给「已到安装中/完成/质保 但 warranty_info 为空」的老订单，按其商品明细
-- 关键词匹配 4 大质保系列（与 staff.html WARRANTY_SERIES 完全一致），
-- 补齐完整部件年限质保表。匹配不到则 generic「整体产品 1 年」。
-- 质保起始：取该单 after_sales 日志时间，无则订单创建时间。
-- 安全：只补 warranty_info 为空的单，不动其它；可重复执行。
-- 运行：Supabase Dashboard → SQL Editor → New query → 粘贴全部 → Run
-- ============================================================================

CREATE OR REPLACE FUNCTION build_warranty_info(p_order_id UUID, p_start TIMESTAMPTZ)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v jsonb := '[]'::jsonb;
BEGIN
  -- 厨房系列
  IF EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = p_order_id AND (
      oi.product_name ILIKE '%厨房%' OR oi.product_name ILIKE '%橱柜%' OR oi.product_name ILIKE '%水槽%'
      OR oi.product_name ILIKE '%龙头%' OR oi.product_name ILIKE '%厨%' OR oi.product_name ILIKE '%灶%'
      OR oi.product_name ILIKE '%kitchen%')) THEN
    v := v || jsonb_build_array(jsonb_build_object(
      'seriesId','kitchen','seriesName','厨房系列','icon','🍳','startIso',p_start,
      'components', jsonb_build_array(
        jsonb_build_object('name','全铝合金橱柜柜体','years',11,'endIso',p_start+interval '11 years'),
        jsonb_build_object('name','橱柜门板','years',4,'endIso',p_start+interval '4 years'),
        jsonb_build_object('name','橱柜五金','years',6,'endIso',p_start+interval '6 years'),
        jsonb_build_object('name','台面','years',6,'endIso',p_start+interval '6 years'),
        jsonb_build_object('name','水槽','years',11,'endIso',p_start+interval '11 years'),
        jsonb_build_object('name','厨房龙头','years',6,'endIso',p_start+interval '6 years'),
        jsonb_build_object('name','抽屉系统','years',6,'endIso',p_start+interval '6 years'))));
  END IF;
  -- 卫浴系列
  IF EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = p_order_id AND (
      oi.product_name ILIKE '%卫浴%' OR oi.product_name ILIKE '%淋浴%' OR oi.product_name ILIKE '%马桶%'
      OR oi.product_name ILIKE '%浴室%' OR oi.product_name ILIKE '%花洒%' OR oi.product_name ILIKE '%卫生间%'
      OR oi.product_name ILIKE '%bathroom%' OR oi.product_name ILIKE '%shower%')) THEN
    v := v || jsonb_build_array(jsonb_build_object(
      'seriesId','bathroom','seriesName','卫浴系列','icon','🚿','startIso',p_start,
      'components', jsonb_build_array(
        jsonb_build_object('name','淋浴房框架','years',6,'endIso',p_start+interval '6 years'),
        jsonb_build_object('name','淋浴房玻璃','years',6,'endIso',p_start+interval '6 years'),
        jsonb_build_object('name','淋浴房五金','years',3,'endIso',p_start+interval '3 years'),
        jsonb_build_object('name','马桶陶瓷本体','years',11,'endIso',p_start+interval '11 years'),
        jsonb_build_object('name','马桶冲水机构','years',4,'endIso',p_start+interval '4 years'),
        jsonb_build_object('name','智能马桶电路','years',3,'endIso',p_start+interval '3 years'),
        jsonb_build_object('name','卫浴五金PVD','years',4,'endIso',p_start+interval '4 years'),
        jsonb_build_object('name','浴室柜','years',4,'endIso',p_start+interval '4 years'),
        jsonb_build_object('name','卫浴龙头','years',6,'endIso',p_start+interval '6 years'),
        jsonb_build_object('name','花洒','years',4,'endIso',p_start+interval '4 years'))));
  END IF;
  -- 门窗系列
  IF EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = p_order_id AND (
      oi.product_name ILIKE '%门%' OR oi.product_name ILIKE '%窗%' OR oi.product_name ILIKE '%推拉%'
      OR oi.product_name ILIKE '%window%' OR oi.product_name ILIKE '%door%')) THEN
    v := v || jsonb_build_array(jsonb_build_object(
      'seriesId','door_window','seriesName','门窗系列','icon','🚪','startIso',p_start,
      'components', jsonb_build_array(
        jsonb_build_object('name','铝合金窗框/门框型材','years',11,'endIso',p_start+interval '11 years'),
        jsonb_build_object('name','Low-E玻璃','years',6,'endIso',p_start+interval '6 years'),
        jsonb_build_object('name','门窗五金','years',4,'endIso',p_start+interval '4 years'),
        jsonb_build_object('name','密封胶条','years',3,'endIso',p_start+interval '3 years'),
        jsonb_build_object('name','纱窗','years',3,'endIso',p_start+interval '3 years'))));
  END IF;
  -- 瓷砖系列
  IF EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = p_order_id AND (
      oi.product_name ILIKE '%瓷砖%' OR oi.product_name ILIKE '%地砖%' OR oi.product_name ILIKE '%墙砖%'
      OR oi.product_name ILIKE '%砖%' OR oi.product_name ILIKE '%tile%')) THEN
    v := v || jsonb_build_array(jsonb_build_object(
      'seriesId','tile','seriesName','瓷砖系列','icon','🟫','startIso',p_start,
      'components', jsonb_build_array(
        jsonb_build_object('name','瓷砖本体','years',11,'endIso',p_start+interval '11 years'),
        jsonb_build_object('name','釉面层','years',6,'endIso',p_start+interval '6 years'),
        jsonb_build_object('name','防滑性能','years',6,'endIso',p_start+interval '6 years'))));
  END IF;
  -- 兜底：匹配不到任何系列
  IF jsonb_array_length(v) = 0 THEN
    v := jsonb_build_array(jsonb_build_object(
      'seriesId','generic','seriesName','产品质保','icon','🛡️','startIso',p_start,
      'components', jsonb_build_array(
        jsonb_build_object('name','整体产品','years',1,'endIso',p_start+interval '1 year'))));
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

-- 自检（可选）：select order_no, status, left(warranty_info,80) from orders
--   where status in ('after_sales','completed','installing') order by updated_at desc limit 10;
-- ============================================================================
