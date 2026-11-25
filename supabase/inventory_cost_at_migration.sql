-- inventory_cost_at_migration.sql
-- 2026-11-25「商品价目」成本按最新一批显示。
-- inventory 每个(产品, 仓库)一行，入库时覆盖 unit_cost；但出库也会改 updated_at，
-- 分不出哪一行的成本是最近入库的。这里加 cost_at：只在 unit_cost 变化时记下时间。
-- 触发器自动维护，仓库前端不用改；旧数据用 updated_at 估一个。
-- 同价补货不改 unit_cost，所以「库存增加」也算一次新批次，不然别的仓库的旧价会排在前面。
-- 可重复执行。运行：Supabase SQL Editor → 粘贴全部 → Run

ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS cost_at timestamptz;

UPDATE public.inventory
   SET cost_at = COALESCE(updated_at, now())
 WHERE cost_at IS NULL AND unit_cost IS NOT NULL;

CREATE OR REPLACE FUNCTION public._inventory_cost_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.unit_cost IS NOT NULL AND (TG_OP = 'INSERT'
      OR NEW.unit_cost IS DISTINCT FROM OLD.unit_cost
      OR COALESCE(NEW.qty_on_hand,0) > COALESCE(OLD.qty_on_hand,0)) THEN
    NEW.cost_at := now();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.cost_at := OLD.cost_at;   -- 出库/调整不动成本时间，前端也改不了它
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_inventory_cost_at ON public.inventory;
CREATE TRIGGER trg_inventory_cost_at
  BEFORE INSERT OR UPDATE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public._inventory_cost_at();
