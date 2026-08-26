-- 仓库后台商品名称修正（2026-08-26）
-- 可重复执行；只修改指定 SKU，不影响其他商品。

BEGIN;

UPDATE public.products
SET name = CASE sku
  WHEN 'HH-B04-0010' THEN '普通马桶'
  WHEN 'HH-B07-0002' THEN '游涡地漏'
  ELSE name
END
WHERE sku IN ('HH-B04-0010', 'HH-B07-0002')
  AND name IS DISTINCT FROM CASE sku
    WHEN 'HH-B04-0010' THEN '普通马桶'
    WHEN 'HH-B07-0002' THEN '游涡地漏'
    ELSE name
  END;

COMMIT;

-- 执行后核对：
SELECT sku, name
FROM public.products
WHERE sku IN ('HH-B04-0010', 'HH-B07-0002')
ORDER BY sku;
