-- ============================================================================
-- security_hardening_migration.sql
-- 2026-05-22 代码审查发现的数据库门禁漏洞修复:
--   F1: orders 对匿名公网可读 → 设计师返点(commission)字段泄露,前端脱敏被架空
--   F2: inventory 对匿名公网可读 → 全部成本价 unit_cost 泄露
--   #6: orders 的 UPDATE 策略 = auth_user_level()>=1 → L1 店员能改任意列,
--       包括 designer_settled_at / designer_commission_*(篡改返点、私自盖结算章)
--
-- 修法:
--   ① REVOKE 匿名对 orders / inventory 的直读权(客户端改走 SECURITY DEFINER RPC,
--      RPC 以属主身份执行,不受 REVOKE 影响,客户查询照常)
--   ② 新增 get_order_detail_by_phone:客户订单详情脱敏 RPC(绝不含 commission)
--   ③ 触发器守卫:designer 返点/结算/折扣等财务快照字段仅 L2+ 可改
--
-- 可重复执行。运行:Supabase SQL Editor → 全选清空 → 粘贴全部 → Run
-- ============================================================================

-- ① 撤销匿名直读(确保登录员工 authenticated 读权不受影响)
GRANT  SELECT ON orders    TO authenticated;
GRANT  SELECT ON inventory TO authenticated;
REVOKE SELECT ON orders    FROM anon;
REVOKE SELECT ON inventory FROM anon;

-- ② 客户订单详情 RPC —— 只回客户该看的字段,脱敏(无任何 commission 字段)
CREATE OR REPLACE FUNCTION get_order_detail_by_phone(p_order_id UUID, p_phone TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v JSONB;
BEGIN
  SELECT to_jsonb(t) INTO v FROM (
    SELECT o.status, o.sign_image, o.signed_at, o.signed_by,
           o.warranty_info, o.needs_install,
           o.designer_discount_pct,   -- 客户可见的"专享折扣率"(返点率/金额绝不下发)
           o.amount                    -- 客户实付
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = p_order_id AND c.phone = p_phone
  ) t;
  RETURN v;   -- 手机号不匹配 / 订单不存在 → NULL
END;
$$;
GRANT EXECUTE ON FUNCTION get_order_detail_by_phone TO anon, authenticated;

-- ③ 守卫触发器:设计师返点/结算/折扣/归属 等财务快照字段,仅 L2+ 可改
--    L1 即便直连数据库 UPDATE 这些列也会被挡(下单 INSERT 时设置不受影响)
CREATE OR REPLACE FUNCTION _guard_order_designer_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (NEW.designer_settled_at        IS DISTINCT FROM OLD.designer_settled_at
   OR NEW.designer_commission_amount IS DISTINCT FROM OLD.designer_commission_amount
   OR NEW.designer_commission_pct    IS DISTINCT FROM OLD.designer_commission_pct
   OR NEW.designer_discount_pct      IS DISTINCT FROM OLD.designer_discount_pct
   OR NEW.designer_id                IS DISTINCT FROM OLD.designer_id)
   AND COALESCE(auth_user_level(), 0) < 2 THEN
    RAISE EXCEPTION '设计师返点/结算字段仅店长(L2+)可修改';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_order_designer_fields ON orders;
CREATE TRIGGER trg_guard_order_designer_fields
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION _guard_order_designer_fields();

NOTIFY pgrst, 'reload schema';
