-- ============================================================================
-- staff_override_supplier_migration.sql
-- 用户 2026-05-20 确认：厂家甩单/拖延时，区域负责人(L3)及以上 可「代厂家操作」
--   推进进度。所有操作打 ⚠管理代行 日志(必填原因)。
-- · staff_override_mark_ready：代厂家把 in_production 商品 → ready
-- · staff_override_ship_items：代厂家把 ready 商品 → shipped，同时写
--   order_shipments(标记 override) + 物流信息
-- 改派则沿用现有「保存供应商分配」(item_status 自动重置 pending)。
-- 触发器会自动按 items 聚合主订单状态，不写全局。
-- 运行：Supabase SQL Editor → 粘贴全部 → Run
-- ============================================================================

CREATE OR REPLACE FUNCTION staff_override_mark_ready(
  p_order_id UUID, p_supplier_id UUID, p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_lvl INT; v_name TEXT; v_sup_name TEXT; v_cnt INT;
BEGIN
  v_lvl := auth_user_level();
  IF v_lvl < 3 THEN
    RETURN jsonb_build_object('ok',false,'message','需区域负责人(L3)及以上权限才能代厂家操作');
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','请填写代行原因');
  END IF;
  SELECT name INTO v_name FROM profiles WHERE id = auth.uid();
  SELECT name INTO v_sup_name FROM suppliers WHERE id = p_supplier_id;
  UPDATE order_items SET item_status='ready'
    WHERE order_id=p_order_id AND supplier_id=p_supplier_id AND item_status='in_production';
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt = 0 THEN
    RETURN jsonb_build_object('ok',false,'message','该厂家没有"生产中"的商品可代为完成');
  END IF;
  INSERT INTO order_logs (order_id,status,operator_id,operator_role,operator_name,notes)
  VALUES (p_order_id,'in_production',auth.uid(),'staff_override',COALESCE(v_name,'管理'),
          '⚠ 管理代行：代厂家「'||COALESCE(v_sup_name,'')||'」生产完成 '||v_cnt||
          ' 件；执行人 '||COALESCE(v_name,'')||'；原因：'||btrim(p_reason));
  RETURN jsonb_build_object('ok',true,'count',v_cnt);
END;
$$;

CREATE OR REPLACE FUNCTION staff_override_ship_items(
  p_order_id UUID, p_supplier_id UUID,
  p_carrier TEXT, p_tracking_no TEXT, p_method TEXT, p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_lvl INT; v_name TEXT; v_sup_name TEXT; v_cnt INT;
BEGIN
  v_lvl := auth_user_level();
  IF v_lvl < 3 THEN
    RETURN jsonb_build_object('ok',false,'message','需区域负责人(L3)及以上权限才能代厂家操作');
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','请填写代行原因');
  END IF;
  SELECT name INTO v_name FROM profiles WHERE id = auth.uid();
  SELECT name INTO v_sup_name FROM suppliers WHERE id = p_supplier_id;
  UPDATE order_items SET item_status='shipped'
    WHERE order_id=p_order_id AND supplier_id=p_supplier_id AND item_status='ready';
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt = 0 THEN
    RETURN jsonb_build_object('ok',false,'message','该厂家没有"已生产完成"的商品可代为发货');
  END IF;
  INSERT INTO order_shipments (order_id, supplier_id, carrier, tracking_no,
                               ship_method, ship_time, shipped_by, notes, updated_at)
  VALUES (p_order_id, p_supplier_id, p_carrier, p_tracking_no, p_method,
          NOW(), auth.uid(),
          '【管理代行】执行人 '||COALESCE(v_name,'')||'；原因：'||btrim(p_reason),
          NOW())
  ON CONFLICT (order_id, supplier_id) DO UPDATE SET
    carrier=COALESCE(NULLIF(btrim(p_carrier),''),     order_shipments.carrier),
    tracking_no=COALESCE(NULLIF(btrim(p_tracking_no),''),order_shipments.tracking_no),
    ship_method=COALESCE(NULLIF(btrim(p_method),''),  order_shipments.ship_method),
    ship_time=NOW(), shipped_by=auth.uid(),
    notes='【管理代行】执行人 '||COALESCE(v_name,'')||'；原因：'||btrim(p_reason),
    updated_at=NOW();
  INSERT INTO order_logs (order_id,status,operator_id,operator_role,operator_name,notes)
  VALUES (p_order_id,'shipped',auth.uid(),'staff_override',COALESCE(v_name,'管理'),
          '⚠ 管理代行：代厂家「'||COALESCE(v_sup_name,'')||'」发货 '||v_cnt||
          ' 件；执行人 '||COALESCE(v_name,'')||
          CASE WHEN NULLIF(btrim(COALESCE(p_tracking_no,'')),'') IS NOT NULL
               THEN '；物流单号 '||btrim(p_tracking_no) ELSE '' END||
          CASE WHEN NULLIF(btrim(COALESCE(p_carrier,'')),'') IS NOT NULL
               THEN '（'||btrim(p_carrier)||'）' ELSE '' END||
          '；原因：'||btrim(p_reason));
  RETURN jsonb_build_object('ok',true,'count',v_cnt);
END;
$$;

GRANT EXECUTE ON FUNCTION staff_override_mark_ready  TO authenticated;
GRANT EXECUTE ON FUNCTION staff_override_ship_items  TO authenticated;

NOTIFY pgrst, 'reload schema';
