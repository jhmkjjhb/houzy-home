-- ============================================================================
-- supplier_per_stage_migration.sql
-- 乙·Phase A：解决"一个厂家发货带飞全部厂家"的级联 bug。
-- · 新表 order_shipments(每 order×supplier 一行,本厂家发货流水)
-- · supplier_mark_ready / supplier_ship_items：只动本厂家自己的商品,
--   不直接写全局 orders.status；仅当所有商品都已发货时才聚合推进总状态
-- · supplier_shipments_for_order：店面端查各厂家发货状态/物流
-- 全 SECURITY DEFINER + 角色校验(供应商对 order_items/orders 无写权)。
-- 可重复执行。运行：Supabase SQL Editor → 粘贴全部 → Run
-- ============================================================================

CREATE TABLE IF NOT EXISTS order_shipments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL,
  supplier_id  UUID NOT NULL,
  carrier      TEXT,
  tracking_no  TEXT,
  ship_method  TEXT,
  ship_time    TIMESTAMPTZ DEFAULT NOW(),
  shipped_by   UUID,
  notes        TEXT,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (order_id, supplier_id)
);
ALTER TABLE order_shipments ENABLE ROW LEVEL SECURITY;

-- ── 厂家：本厂家生产完成(items in_production → ready) ──
CREATE OR REPLACE FUNCTION supplier_mark_ready(p_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sup_id UUID; v_sup_name TEXT; v_cnt INT;
BEGIN
  SELECT s.id, s.name INTO v_sup_id, v_sup_name
    FROM suppliers s WHERE s.user_id = auth.uid() LIMIT 1;
  IF v_sup_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','当前账号未绑定供应商');
  END IF;
  UPDATE order_items SET item_status='ready'
    WHERE order_id=p_order_id AND supplier_id=v_sup_id AND item_status='in_production';
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt = 0 THEN
    RETURN jsonb_build_object('ok',false,'message','本厂家没有"生产中"的商品可标记完成');
  END IF;
  INSERT INTO order_logs (order_id,status,operator_id,operator_role,operator_name,notes)
  VALUES (p_order_id,'in_production',auth.uid(),'supplier',COALESCE(v_sup_name,'厂家'),
          '🛠 厂家「'||COALESCE(v_sup_name,'')||'」生产完成 '||v_cnt||' 件');
  RETURN jsonb_build_object('ok',true,'count',v_cnt);
END;
$$;

-- ── 厂家：本厂家发货(items ready → shipped) + 物流入库 + 全单聚合 ──
CREATE OR REPLACE FUNCTION supplier_ship_items(
  p_order_id UUID, p_carrier TEXT, p_tracking_no TEXT,
  p_method TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sup_id UUID; v_sup_name TEXT; v_cnt INT; v_remain INT;
        v_ord_status TEXT; v_advanced BOOLEAN := false;
BEGIN
  SELECT s.id, s.name INTO v_sup_id, v_sup_name
    FROM suppliers s WHERE s.user_id = auth.uid() LIMIT 1;
  IF v_sup_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','当前账号未绑定供应商');
  END IF;
  -- 必须先有"已备货(ready)"的本厂家商品
  UPDATE order_items SET item_status='shipped'
    WHERE order_id=p_order_id AND supplier_id=v_sup_id AND item_status='ready';
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt = 0 THEN
    RETURN jsonb_build_object('ok',false,'message','本厂家没有"已生产完成"的商品可发货（先点生产完成）');
  END IF;

  -- 写本厂家发货流水(upsert)
  INSERT INTO order_shipments (order_id, supplier_id, carrier, tracking_no,
                               ship_method, ship_time, shipped_by, notes, updated_at)
  VALUES (p_order_id, v_sup_id, p_carrier, p_tracking_no,
          p_method, NOW(), auth.uid(), p_notes, NOW())
  ON CONFLICT (order_id, supplier_id) DO UPDATE SET
    carrier = COALESCE(NULLIF(btrim(p_carrier),''),     order_shipments.carrier),
    tracking_no = COALESCE(NULLIF(btrim(p_tracking_no),''), order_shipments.tracking_no),
    ship_method = COALESCE(NULLIF(btrim(p_method),''),  order_shipments.ship_method),
    ship_time = NOW(), shipped_by = auth.uid(),
    notes = COALESCE(NULLIF(btrim(p_notes),''),         order_shipments.notes),
    updated_at = NOW();

  INSERT INTO order_logs (order_id,status,operator_id,operator_role,operator_name,notes)
  VALUES (p_order_id,'shipped',auth.uid(),'supplier',COALESCE(v_sup_name,'厂家'),
          '📦 厂家「'||COALESCE(v_sup_name,'')||'」已发货 '||v_cnt||' 件'||
          CASE WHEN NULLIF(btrim(COALESCE(p_tracking_no,'')),'') IS NOT NULL
               THEN '；物流单号 '||btrim(p_tracking_no) ELSE '' END||
          CASE WHEN NULLIF(btrim(COALESCE(p_carrier,'')),'') IS NOT NULL
               THEN '（'||btrim(p_carrier)||'）' ELSE '' END);

  -- 聚合：全部商品已发/到货/破损 → 订单总状态进"已发货"(只前进、不回退)
  SELECT COALESCE(status,'') INTO v_ord_status FROM orders WHERE id=p_order_id;
  SELECT count(*) INTO v_remain FROM order_items
    WHERE order_id=p_order_id
      AND COALESCE(item_status,'pending') NOT IN ('shipped','arrived','damaged');
  IF v_remain = 0 AND v_ord_status IN ('paid','in_production','production_complete') THEN
    UPDATE orders SET status='shipped', updated_at=NOW(),
                      deadline_at=NOW()+INTERVAL '20 days'
      WHERE id=p_order_id;
    INSERT INTO order_logs (order_id,status,operator_id,operator_role,operator_name,notes)
    VALUES (p_order_id,'shipped',auth.uid(),'supplier',COALESCE(v_sup_name,'厂家'),
            '✅ 全部商品已发货，订单整单进入「已发货」阶段');
    v_advanced := true;
  END IF;
  RETURN jsonb_build_object('ok',true,'count',v_cnt,'order_advanced',v_advanced);
END;
$$;

-- ── 店面/管理：取本订单所有厂家发货流水 ──
CREATE OR REPLACE FUNCTION supplier_shipments_for_order(p_order_id UUID)
RETURNS TABLE (
  supplier_id UUID, supplier_name TEXT,
  carrier TEXT, tracking_no TEXT, ship_method TEXT, ship_time TIMESTAMPTZ
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT sh.supplier_id, s.name, sh.carrier, sh.tracking_no, sh.ship_method, sh.ship_time
    FROM order_shipments sh LEFT JOIN suppliers s ON s.id=sh.supplier_id
   WHERE sh.order_id=p_order_id
   ORDER BY sh.ship_time DESC;
$$;

GRANT EXECUTE ON FUNCTION supplier_mark_ready              TO authenticated;
GRANT EXECUTE ON FUNCTION supplier_ship_items              TO authenticated;
GRANT EXECUTE ON FUNCTION supplier_shipments_for_order     TO authenticated;

NOTIFY pgrst, 'reload schema';
