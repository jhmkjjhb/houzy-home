-- ============================================================================
-- warehouse_dispatch_rpc_migration.sql
-- 需求（用户 2026-05-19 确认，出库/仓管/混合单方案 决策①④⑤）：
--   店员点「确认出库」只把现货项标记 awaiting_dispatch（待仓库发货），不扣库存；
--   仓管在 warehouse.html 看「待发货」清单，点「确认发货」才真正扣库存（防超卖）；
--   客户在 customer.html 查分批混合单时，按商品逐项看进度（决策②③）。
-- 本文件含 3 个函数：warehouse_pending_dispatch / warehouse_confirm_ship /
--   get_order_items_by_phone —— 一次性全部跑完即可。
-- 背景：auth_user_level() 未给 'warehouse' 角色定级 → 默认 0，订单 RLS 全挡。
--   不给 warehouse 开放 orders/order_items 的宽表写权（保持"不放权"原则），
--   改用本项目惯用的 SECURITY DEFINER 函数：服务端原子完成、内部校验角色。
-- 安全：
--   - 两个函数都内部校验调用者角色（warehouse 或店长及以上）。
--   - 扣库存用行锁 FOR UPDATE + 条件，库存不足/产品不唯一一律拒绝、不扣减。
--   - 幂等：商品已 shipped 再点 = no-op 友好提示（决策④防重复发货）。
--   - 订单总状态只在「全部商品已发货且当前 paid/in_production」时前进到 shipped，
--     绝不回退、不碰 arrived/installing/completed（决策②③：单一订单状态按聚合）。
-- 可重复执行（CREATE OR REPLACE）。
-- 运行：Supabase Dashboard → SQL Editor → New query → 粘贴全部 → Run
-- ============================================================================

-- 允许操作发货的角色（与 warehouse.html ALLOWED_ROLES 一致，去掉只读的）
CREATE OR REPLACE FUNCTION _wh_caller_ok()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('warehouse','store_manager','regional_manager',
                     'general_manager','admin','superadmin')
  );
$$;

-- ── 1. 待发货清单：现货项已被店员「确认出库」、等仓库实际发货 ──
CREATE OR REPLACE FUNCTION warehouse_pending_dispatch()
RETURNS TABLE (
  item_id          UUID,
  order_id         UUID,
  order_no         TEXT,
  customer_name    TEXT,
  fulfillment_mode TEXT,
  product_name     TEXT,
  model_spec       TEXT,
  quantity         NUMERIC,
  unit             TEXT,
  created_at       TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT _wh_caller_ok() THEN
    RAISE EXCEPTION '无仓库发货权限';
  END IF;
  RETURN QUERY
    SELECT oi.id, o.id, o.order_no,
           c.name, COALESCE(o.fulfillment_mode, 'all_together'),
           oi.product_name, oi.model_spec,
           oi.quantity::numeric, oi.unit, o.created_at
    FROM order_items oi
    JOIN orders o   ON o.id = oi.order_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE oi.item_status = 'awaiting_dispatch'
      AND COALESCE(oi.fulfillment_type, 'custom') = 'stock'
      AND o.status NOT IN ('cancelled', 'closed')
    ORDER BY o.created_at ASC;
END;
$$;

-- ── 2. 确认发货：扣库存 + 标记 shipped + 写流水/日志 + 按模式聚合订单状态 ──
CREATE OR REPLACE FUNCTION warehouse_confirm_ship(
  p_item_id      UUID,
  p_warehouse_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role     TEXT;
  v_name     TEXT;
  v_oi       order_items%ROWTYPE;
  v_ord      orders%ROWTYPE;
  v_prod_id  UUID;
  v_prod_cnt INT;
  v_inv_id   UUID;
  v_on_hand  NUMERIC;
  v_qty      NUMERIC;
  v_remain   INT;
  v_advanced BOOLEAN := false;
BEGIN
  SELECT role, name INTO v_role, v_name FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('warehouse','store_manager',
        'regional_manager','general_manager','admin','superadmin') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden',
                              'message', '无仓库发货权限');
  END IF;

  -- 锁定该商品行（防并发重复发货）
  SELECT * INTO v_oi FROM order_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found',
                              'message', '找不到该商品明细');
  END IF;

  -- 幂等：只有 awaiting_dispatch 才发；已发过/其它态 → 友好提示，不重复扣
  IF v_oi.item_status <> 'awaiting_dispatch' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_pending',
      'message', '该商品已处理（当前：' || COALESCE(v_oi.item_status,'') ||
                 '），无需重复发货');
  END IF;

  v_qty := COALESCE(v_oi.quantity, 0)::numeric;
  IF v_qty <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_qty',
                              'message', '商品数量为 0，无法发货');
  END IF;

  SELECT * INTO v_ord FROM orders WHERE id = v_oi.order_id;

  -- 产品精确匹配（仅按产品名唯一匹配，0 或多条均拒绝，与店员端一致、不猜）
  SELECT count(*) INTO v_prod_cnt FROM products
    WHERE name = btrim(v_oi.product_name);
  IF v_prod_cnt <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'product_ambiguous',
      'message', '无法唯一匹配产品档案（' ||
        CASE WHEN v_prod_cnt = 0 THEN '查无此产品' ELSE '有多条同名' END ||
        '），请用「出库/调整」手工处理');
  END IF;
  SELECT id INTO v_prod_id FROM products WHERE name = btrim(v_oi.product_name);

  -- 锁定库存行，校验充足
  SELECT id, qty_on_hand INTO v_inv_id, v_on_hand
    FROM inventory
    WHERE product_id = v_prod_id AND warehouse_id = p_warehouse_id
    FOR UPDATE;
  IF v_inv_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'no_inventory',
      'message', '该仓库无此产品库存，无法发货');
  END IF;
  v_on_hand := COALESCE(v_on_hand, 0);
  IF v_on_hand < v_qty THEN
    RETURN jsonb_build_object('ok', false, 'code', 'insufficient',
      'message', '库存不足（在库 ' || v_on_hand || ' / 需 ' || v_qty || '）');
  END IF;

  -- 扣库存（行已锁，原子安全）+ 写出库流水
  UPDATE inventory SET qty_on_hand = v_on_hand - v_qty, updated_at = NOW()
    WHERE id = v_inv_id;
  INSERT INTO inventory_movements (product_id, warehouse_id, type, qty,
                                   notes, operator_id)
  VALUES (v_prod_id, p_warehouse_id, 'out', v_qty,
          '订单发货：' || COALESCE(v_oi.product_name,'') ||
          '（单号 ' || COALESCE(v_ord.order_no,'') || '）', auth.uid());

  -- 商品标记已发货
  UPDATE order_items SET item_status = 'shipped' WHERE id = p_item_id;
  INSERT INTO order_logs (order_id, status, operator_id, operator_role,
                          operator_name, notes)
  VALUES (v_oi.order_id, COALESCE(v_ord.status,'paid'), auth.uid(),
          v_role, v_name,
          '仓库确认发货：' || COALESCE(v_oi.product_name,'') ||
          '，已扣减库存 ' || v_qty);

  -- 聚合：全部商品都已发/到货/破损 且 订单还在 paid/in_production → 整单进「已发货」
  -- （决策②③：订单单一状态，跟最慢项；分批单的分项进度由客户端按 item 展示）
  SELECT count(*) INTO v_remain FROM order_items
    WHERE order_id = v_oi.order_id
      AND COALESCE(item_status,'pending') NOT IN ('shipped','arrived','damaged');
  IF v_remain = 0 AND COALESCE(v_ord.status,'') IN ('paid','in_production') THEN
    UPDATE orders
      SET status = 'shipped', updated_at = NOW(),
          deadline_at = NOW() + INTERVAL '20 days'   -- = calcDeadline('shipped')
      WHERE id = v_oi.order_id;
    INSERT INTO order_logs (order_id, status, operator_id, operator_role,
                            operator_name, notes)
    VALUES (v_oi.order_id, 'shipped', auth.uid(), v_role, v_name,
            '全部商品已发货，订单整单进入「已发货」阶段');
    v_advanced := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'message', '已确认发货并扣减库存 ' || v_qty,
    'order_advanced', v_advanced,
    'order_status', CASE WHEN v_advanced THEN 'shipped'
                         ELSE COALESCE(v_ord.status,'') END
  );
END;
$$;

-- ── 3. 客户端按手机号查本单各商品进度（混合单 分批 决策②③ 客户端展示）──
-- 客户端用 anon key，order_items 受 RLS 保护读不到 → 凭手机号校验归属后返回。
CREATE OR REPLACE FUNCTION get_order_items_by_phone(p_order_id UUID, p_phone TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ok    INT;
  v_mode  TEXT;
  v_items JSONB;
BEGIN
  SELECT count(*) INTO v_ok
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.id = p_order_id AND c.phone = p_phone;
  IF v_ok = 0 THEN RETURN '{}'::JSONB; END IF;

  SELECT COALESCE(o.fulfillment_mode, 'all_together') INTO v_mode
    FROM orders o WHERE o.id = p_order_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_name',     oi.product_name,
           'fulfillment_type', COALESCE(oi.fulfillment_type, 'custom'),
           'item_status',      COALESCE(oi.item_status, 'pending'),
           'quantity',         oi.quantity,
           'unit',             oi.unit
         ) ORDER BY oi.sort_order), '[]'::JSONB)
    INTO v_items
    FROM order_items oi WHERE oi.order_id = p_order_id;

  RETURN jsonb_build_object('fulfillment_mode', v_mode, 'items', v_items);
END;
$$;

GRANT EXECUTE ON FUNCTION _wh_caller_ok              TO authenticated;
GRANT EXECUTE ON FUNCTION warehouse_pending_dispatch TO authenticated;
GRANT EXECUTE ON FUNCTION warehouse_confirm_ship     TO authenticated;
GRANT EXECUTE ON FUNCTION get_order_items_by_phone   TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
