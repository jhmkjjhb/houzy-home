-- ============================================================================
-- supplier_accept_rpc_migration.sql
-- 背景(乙·多厂家)：厂家「接单」需把分给自己的 pending 商品 → in_production，
--   但 order_items 对 supplier 角色只有 SELECT 策略、无 UPDATE → 直接改被
--   RLS 静默拒绝（"确认接单按了没反应"）。
-- 方案：SECURITY DEFINER 函数，内部校验调用者就是该供应商(suppliers.user_id
--   = auth.uid())，只动它自己的商品；订单总状态绝不回退；写日志。
-- 安全：只改本厂家 pending 商品；可重复执行。
-- 运行：Supabase Dashboard → SQL Editor → New query → 粘贴全部 → Run
-- ============================================================================

CREATE OR REPLACE FUNCTION supplier_accept_order(p_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sup_id   UUID;
  v_sup_name TEXT;
  v_cnt      INT;
  v_ord      orders%ROWTYPE;
BEGIN
  SELECT s.id, s.name INTO v_sup_id, v_sup_name
    FROM suppliers s WHERE s.user_id = auth.uid() LIMIT 1;
  IF v_sup_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_supplier',
      'message', '当前账号未绑定供应商，无法接单');
  END IF;

  -- 只把"分给我、待接单(pending/空)"的商品 → 生产中
  UPDATE order_items SET item_status = 'in_production'
   WHERE order_id = p_order_id
     AND supplier_id = v_sup_id
     AND COALESCE(item_status, 'pending') = 'pending';
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'nothing',
      'message', '没有分给本厂家、待接单的商品（可能已接单或未分配给你）');
  END IF;

  SELECT * INTO v_ord FROM orders WHERE id = p_order_id;
  -- 订单总状态绝不回退：仅当还在接单前阶段才推进
  UPDATE orders SET status = 'in_production', updated_at = NOW()
   WHERE id = p_order_id
     AND status IN ('pending_payment','paid','assigned','accepted');

  INSERT INTO order_logs (order_id, status, operator_id, operator_role,
                          operator_name, notes)
  VALUES (p_order_id, 'in_production', auth.uid(), 'supplier',
          COALESCE(v_sup_name, '厂家'),
          '厂家「' || COALESCE(v_sup_name, '') || '」已接单，' ||
          v_cnt || ' 件商品进入生产');

  RETURN jsonb_build_object('ok', true, 'count', v_cnt);
END;
$$;

GRANT EXECUTE ON FUNCTION supplier_accept_order TO authenticated;

NOTIFY pgrst, 'reload schema';
