-- ============================================================================
-- order_drawings_migration.sql
-- 需求(用户 2026-05-20 确认)：图纸三方确认，防事后生产错追责。
--   · 按厂家各自(每 order×supplier 一份图纸)
--   · 厂家或运营都可上传(以最新版为准；传新版→三方确认全部作废重新确认)
--   · 客户+运营+厂家三方各自确认，每次记谁+何时
--   · 三方未齐 → 厂家不能进"生产加工"(硬卡)
-- 全走 SECURITY DEFINER 函数(供应商/客户无表写权，与本项目惯例一致)。
-- 可重复执行。运行：Supabase SQL Editor → 粘贴全部 → Run
-- ============================================================================

CREATE TABLE IF NOT EXISTS order_drawings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL,
  supplier_id   UUID NOT NULL,
  drawing_url   TEXT,
  version       INT  NOT NULL DEFAULT 1,
  uploaded_by   UUID,
  uploaded_role TEXT,
  uploaded_at   TIMESTAMPTZ,
  cust_confirmed_at  TIMESTAMPTZ,
  cust_confirmed_by  TEXT,
  staff_confirmed_at TIMESTAMPTZ,
  staff_confirmed_by UUID,
  staff_confirmed_name TEXT,
  sup_confirmed_at   TIMESTAMPTZ,
  sup_confirmed_by   UUID,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (order_id, supplier_id)
);
ALTER TABLE order_drawings ENABLE ROW LEVEL SECURITY;
-- 不开放宽表策略；一律走下面的 SECURITY DEFINER 函数

-- 调用者是否为该供应商
CREATE OR REPLACE FUNCTION _is_supplier(p_supplier_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM suppliers s
                 WHERE s.id = p_supplier_id AND s.user_id = auth.uid());
$$;

-- ── 上传图纸(厂家或运营 level>=1)；传新版 → 三方确认作废 ──
CREATE OR REPLACE FUNCTION drawing_upload(p_order_id UUID, p_supplier_id UUID, p_url TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_role TEXT; v_lvl INT; v_isup BOOLEAN; v_ver INT; v_name TEXT;
BEGIN
  IF NULLIF(btrim(COALESCE(p_url,'')),'') IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','请填写图纸链接/说明');
  END IF;
  v_lvl := auth_user_level(); v_isup := _is_supplier(p_supplier_id);
  IF v_lvl < 1 AND NOT v_isup THEN
    RETURN jsonb_build_object('ok',false,'message','无权上传该图纸');
  END IF;
  SELECT role, name INTO v_role, v_name FROM profiles WHERE id = auth.uid();
  INSERT INTO order_drawings (order_id, supplier_id, drawing_url, version,
         uploaded_by, uploaded_role, uploaded_at, updated_at)
  VALUES (p_order_id, p_supplier_id, btrim(p_url), 1,
          auth.uid(), COALESCE(v_role, CASE WHEN v_isup THEN 'supplier' ELSE 'staff' END),
          NOW(), NOW())
  ON CONFLICT (order_id, supplier_id) DO UPDATE SET
    drawing_url = btrim(p_url),
    version     = order_drawings.version + 1,
    uploaded_by = auth.uid(),
    uploaded_role = COALESCE(v_role, CASE WHEN v_isup THEN 'supplier' ELSE 'staff' END),
    uploaded_at = NOW(),
    cust_confirmed_at = NULL, cust_confirmed_by = NULL,
    staff_confirmed_at = NULL, staff_confirmed_by = NULL, staff_confirmed_name = NULL,
    sup_confirmed_at = NULL, sup_confirmed_by = NULL,
    updated_at = NOW();
  SELECT version INTO v_ver FROM order_drawings
    WHERE order_id=p_order_id AND supplier_id=p_supplier_id;
  INSERT INTO order_logs (order_id, status, operator_id, operator_role, operator_name, notes)
  VALUES (p_order_id, 'in_production', auth.uid(),
          COALESCE(v_role, CASE WHEN v_isup THEN 'supplier' ELSE 'staff' END),
          COALESCE(v_name,'操作人'),
          '📐 上传图纸 v'||v_ver||(CASE WHEN v_ver>1 THEN '（三方确认已作废，需重新确认）' ELSE '' END));
  RETURN jsonb_build_object('ok',true,'version',v_ver);
END;
$$;

-- ── 确认图纸：运营(level>=1) 或 厂家本人 ──
CREATE OR REPLACE FUNCTION drawing_confirm(p_order_id UUID, p_supplier_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_lvl INT; v_isup BOOLEAN; v_name TEXT; v_has TEXT; v_party TEXT;
BEGIN
  SELECT drawing_url INTO v_has FROM order_drawings
    WHERE order_id=p_order_id AND supplier_id=p_supplier_id;
  IF v_has IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','尚未上传图纸，无法确认');
  END IF;
  v_lvl := auth_user_level(); v_isup := _is_supplier(p_supplier_id);
  SELECT name INTO v_name FROM profiles WHERE id = auth.uid();
  IF v_isup THEN
    UPDATE order_drawings SET sup_confirmed_at=NOW(), sup_confirmed_by=auth.uid(), updated_at=NOW()
      WHERE order_id=p_order_id AND supplier_id=p_supplier_id;
    v_party := '厂家';
  ELSIF v_lvl >= 1 THEN
    UPDATE order_drawings SET staff_confirmed_at=NOW(), staff_confirmed_by=auth.uid(),
      staff_confirmed_name=COALESCE(v_name,'运营'), updated_at=NOW()
      WHERE order_id=p_order_id AND supplier_id=p_supplier_id;
    v_party := '运营';
  ELSE
    RETURN jsonb_build_object('ok',false,'message','无权确认该图纸');
  END IF;
  INSERT INTO order_logs (order_id, status, operator_id, operator_role, operator_name, notes)
  VALUES (p_order_id, 'in_production', auth.uid(),
          CASE WHEN v_isup THEN 'supplier' ELSE 'staff' END, COALESCE(v_name, v_party),
          '✅ '||v_party||'确认图纸（'||COALESCE(v_name,'')||'）');
  RETURN jsonb_build_object('ok',true,'party',v_party);
END;
$$;

-- ── 取某订单全部图纸行(运营/厂家用；厂家端前端只渲染自己那条) ──
CREATE OR REPLACE FUNCTION drawing_get_for_order(p_order_id UUID)
RETURNS SETOF order_drawings LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM order_drawings WHERE order_id = p_order_id;
$$;

-- ── 三方是否齐(硬卡生产用) ──
CREATE OR REPLACE FUNCTION drawing_ready(p_order_id UUID, p_supplier_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM order_drawings d
    WHERE d.order_id=p_order_id AND d.supplier_id=p_supplier_id
      AND d.drawing_url IS NOT NULL
      AND d.cust_confirmed_at IS NOT NULL
      AND d.staff_confirmed_at IS NOT NULL
      AND d.sup_confirmed_at IS NOT NULL
  );
$$;

-- ── 客户端(凭手机号)：看本单各厂家图纸 ──
CREATE OR REPLACE FUNCTION drawing_customer_list(p_order_id UUID, p_phone TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ok INT; v_res JSONB;
BEGIN
  SELECT count(*) INTO v_ok FROM orders o JOIN customers c ON c.id=o.customer_id
    WHERE o.id=p_order_id AND c.phone=p_phone;
  IF v_ok=0 THEN RETURN '[]'::JSONB; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'supplier_id', d.supplier_id,
    'supplier_name', s.name,
    'drawing_url', d.drawing_url,
    'version', d.version,
    'cust_confirmed_at', d.cust_confirmed_at,
    'staff_confirmed_at', d.staff_confirmed_at,
    'sup_confirmed_at', d.sup_confirmed_at) ORDER BY s.name), '[]'::JSONB)
  INTO v_res FROM order_drawings d
  LEFT JOIN suppliers s ON s.id=d.supplier_id
  WHERE d.order_id=p_order_id AND d.drawing_url IS NOT NULL;
  RETURN v_res;
END;
$$;

-- ── 客户端(凭手机号)：确认某厂家图纸 ──
CREATE OR REPLACE FUNCTION drawing_customer_confirm(p_order_id UUID, p_phone TEXT, p_supplier_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ok INT; v_has TEXT;
BEGIN
  SELECT count(*) INTO v_ok FROM orders o JOIN customers c ON c.id=o.customer_id
    WHERE o.id=p_order_id AND c.phone=p_phone;
  IF v_ok=0 THEN RETURN jsonb_build_object('ok',false,'message','订单核验失败'); END IF;
  SELECT drawing_url INTO v_has FROM order_drawings
    WHERE order_id=p_order_id AND supplier_id=p_supplier_id;
  IF v_has IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','该厂家尚未上传图纸');
  END IF;
  UPDATE order_drawings SET cust_confirmed_at=NOW(), cust_confirmed_by='客户', updated_at=NOW()
    WHERE order_id=p_order_id AND supplier_id=p_supplier_id;
  INSERT INTO order_logs (order_id, status, operator_id, operator_role, operator_name, notes)
  VALUES (p_order_id, 'in_production', NULL, 'customer', '客户', '✅ 客户确认图纸');
  RETURN jsonb_build_object('ok',true);
END;
$$;

GRANT EXECUTE ON FUNCTION _is_supplier            TO authenticated;
GRANT EXECUTE ON FUNCTION drawing_upload          TO authenticated;
GRANT EXECUTE ON FUNCTION drawing_confirm         TO authenticated;
GRANT EXECUTE ON FUNCTION drawing_get_for_order   TO authenticated;
GRANT EXECUTE ON FUNCTION drawing_ready           TO authenticated;
GRANT EXECUTE ON FUNCTION drawing_customer_list   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION drawing_customer_confirm TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
