-- ============================================================================
-- add_order_items_section_uom_migration.sql
-- 需求:橱柜/衣柜分模块报价 —— 订单明细行需记录「所属区块」与「计量单位」,
--       用于报价单按区分组出小计、显示尺/平方尺等单位。
-- 安全:IF NOT EXISTS,可重复执行,不改任何已有数据(老订单这两列为空,不受影响)。
-- 运行:Supabase Dashboard → SQL Editor → 粘贴 → Run。
-- ============================================================================

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS section TEXT;  -- 区块/模块大类,如:橱柜·地柜 / 台面 / 五金升级 / 人工
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS uom     TEXT;  -- 计量单位:尺 / 平方尺 / 个 / 套 / 项

NOTIFY pgrst, 'reload schema';
