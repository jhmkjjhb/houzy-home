-- ============================================================================
-- recompute_and_reject_migration.sql
-- 乙·Phase A 收尾(用户 2026-05-20 确认 A/B/C)：
--   · recompute_order_status：order.status 由 items 聚合派生(只前进、不回退、
--     不碰 cancelled/closed/completed/after_sales)
--   · AFTER UPDATE of item_status 触发器：任何改 item 都自动同步主状态
--   · supplier_reject_order：厂家拒单只动本厂家 items(supplier_id=NULL +
--     item_status='pending')，不写 orders.status，靠聚合函数兜底
--   · markArrived(店面端)将改为只批量更新 items(代码端)，全局靠聚合自动到位
-- 可重复执行。运行：Supabase SQL Editor → 粘贴全部 → Run
-- ============================================================================

CREATE OR REPLACE FUNCTION recompute_order_status(p_order_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cur TEXT;
  v_total INT; v_pending INT; v_inprod INT; v_ready INT;
  v_shipped INT; v_arr INT; v_dmg INT; v_awaiting INT;
  v_target TEXT;
  v_step_cur INT; v_step_target INT;
BEGIN
  SELECT status INTO v_cur FROM orders WHERE id = p_order_id;
  IF v_cur IS NULL OR v_cur IN ('cancelled','closed','completed','after_sales',
                                 'pending_payment','installing') THEN
    RETURN;   -- 终态/特殊态/未付款/安装中 由专属流程驱动，不被自动聚合
  END IF;

  SELECT count(*),
    count(*) FILTER (WHERE COALESCE(item_status,'pending')='pending'),
    count(*) FILTER (WHERE item_status='in_production'),
    count(*) FILTER (WHERE item_status='ready'),
    count(*) FILTER (WHERE item_status='awaiting_dispatch'),
    count(*) FILTER (WHERE item_status='shipped'),
    count(*) FILTER (WHERE item_status='arrived'),
    count(*) FILTER (WHERE item_status='damaged')
    INTO v_total, v_pending, v_inprod, v_ready, v_awaiting, v_shipped, v_arr, v_dmg
    FROM order_items WHERE order_id = p_order_id;
  IF v_total = 0 THEN RETURN; END IF;

  -- "最慢项"决定派生目标
  IF v_pending > 0 OR v_awaiting > 0 THEN
    v_target := 'paid';                  -- 还有未接单/未发的现货 → 整单待生产/待发
  ELSIF v_inprod > 0 THEN
    v_target := 'in_production';
  ELSIF v_ready > 0 THEN
    v_target := 'production_complete';
  ELSIF v_shipped > 0 THEN
    v_target := 'shipped';
  ELSE                                    -- 全部 arrived / damaged
    v_target := 'arrived';
  END IF;

  v_step_cur := CASE v_cur
    WHEN 'paid' THEN 1 WHEN 'in_production' THEN 2
    WHEN 'production_complete' THEN 3 WHEN 'shipped' THEN 4
    WHEN 'arrived' THEN 5 ELSE 0 END;
  v_step_target := CASE v_target
    WHEN 'paid' THEN 1 WHEN 'in_production' THEN 2
    WHEN 'production_complete' THEN 3 WHEN 'shipped' THEN 4
    WHEN 'arrived' THEN 5 ELSE 0 END;

  IF v_step_target > v_step_cur THEN
    UPDATE orders SET status = v_target, updated_at = NOW(),
      deadline_at = COALESCE(deadline_at, NOW() + CASE v_target
        WHEN 'paid' THEN INTERVAL '2 hours'
        WHEN 'in_production' THEN INTERVAL '600 hours'
        WHEN 'production_complete' THEN INTERVAL '24 hours'
        WHEN 'shipped' THEN INTERVAL '480 hours'
        WHEN 'arrived' THEN INTERVAL '24 hours'
        ELSE INTERVAL '24 hours' END)
    WHERE id = p_order_id;
  END IF;
END;
$$;

-- 触发器：任何 item_status 改变都自动同步主状态
CREATE OR REPLACE FUNCTION _trg_recompute_order_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM recompute_order_status(NEW.order_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_recompute_order_status ON order_items;
CREATE TRIGGER trg_recompute_order_status
  AFTER INSERT OR UPDATE OF item_status, supplier_id ON order_items
  FOR EACH ROW EXECUTE FUNCTION _trg_recompute_order_status();

-- 厂家拒单：只动本厂家 items（不再写全局 orders.status）
CREATE OR REPLACE FUNCTION supplier_reject_order(p_order_id UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sup_id UUID; v_sup_name TEXT; v_cnt INT;
BEGIN
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','请填写拒绝原因');
  END IF;
  SELECT s.id, s.name INTO v_sup_id, v_sup_name
    FROM suppliers s WHERE s.user_id = auth.uid() LIMIT 1;
  IF v_sup_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','当前账号未绑定供应商');
  END IF;
  -- 解除本厂家所有 items 的归属，状态退回 pending(给店面重新派单)
  UPDATE order_items
    SET supplier_id = NULL, item_status = 'pending'
    WHERE order_id = p_order_id AND supplier_id = v_sup_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt = 0 THEN
    RETURN jsonb_build_object('ok',false,'message','本厂家无可拒绝的商品');
  END IF;
  INSERT INTO order_logs (order_id,status,operator_id,operator_role,operator_name,notes)
  VALUES (p_order_id, COALESCE((SELECT status FROM orders WHERE id=p_order_id),'paid'),
          auth.uid(),'supplier', COALESCE(v_sup_name,'厂家'),
          '❌ 厂家「'||COALESCE(v_sup_name,'')||'」拒接 '||v_cnt||' 件，原因：'||btrim(p_reason)||'（已退给店面重新派单）');
  RETURN jsonb_build_object('ok',true,'count',v_cnt);
END;
$$;

GRANT EXECUTE ON FUNCTION recompute_order_status     TO authenticated;
GRANT EXECUTE ON FUNCTION _trg_recompute_order_status TO authenticated;
GRANT EXECUTE ON FUNCTION supplier_reject_order      TO authenticated;

NOTIFY pgrst, 'reload schema';
