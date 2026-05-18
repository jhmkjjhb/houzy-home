-- ============================================================================
-- add_supplier_missing_cols_migration.sql
-- 背景:suppliers 表在早期创建,后续 schema.sql 新增的列未补到线上库,
--       导致"添加供应商"报错:Could not find the 'tier' column ...
-- 安全:全部 IF NOT EXISTS,可重复执行,不会破坏已有数据。
-- 运行:Supabase Dashboard → SQL Editor → 粘贴本文件全部内容 → Run。
-- ============================================================================

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tier         INTEGER DEFAULT 2;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS categories   TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS product_types TEXT[] DEFAULT '{}';

-- tier 取值约束 1/2/3(若约束已存在则跳过)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_tier_check'
  ) THEN
    ALTER TABLE suppliers
      ADD CONSTRAINT suppliers_tier_check CHECK (tier IN (1,2,3));
  END IF;
END $$;

-- 让 PostgREST 立即刷新表结构缓存(否则错误可能还会提示一会儿)
NOTIFY pgrst, 'reload schema';
