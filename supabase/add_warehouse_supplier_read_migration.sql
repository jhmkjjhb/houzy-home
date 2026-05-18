-- ============================================================================
-- add_warehouse_supplier_read_migration.sql
-- 背景:auth_user_level() 未给 'warehouse' 角色定级 → 默认 0;
--       suppliers_read 策略要求 level >= 1,导致仓库账号读不到供应商名单,
--       批量入库时无法匹配供应商,永远误报"查无供应商"。
-- 方案:最小授权 —— 仅给 warehouse 角色对 suppliers 的「只读」权限。
--       不授予 INSERT/UPDATE/DELETE(保持"不放权"原则)。
-- 安全:DROP IF EXISTS + CREATE,可重复执行;只读策略,不改任何数据。
-- 运行:Supabase Dashboard → SQL Editor → 粘贴 → Run。
-- ============================================================================

DROP POLICY IF EXISTS "suppliers_warehouse_read" ON suppliers;
CREATE POLICY "suppliers_warehouse_read" ON suppliers
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'warehouse'
  ));

NOTIFY pgrst, 'reload schema';
