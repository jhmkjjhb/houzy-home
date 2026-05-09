-- One-time cleanup: link orphan supplement orders to their parent
-- Orphan = parent_order_id is null but description references an original order
UPDATE orders AS child
SET parent_order_id = parent.id
FROM orders AS parent
WHERE child.parent_order_id IS NULL
  AND child.description LIKE '补件单 — 关联原单 %'
  AND parent.order_no = substring(child.description from '补件单 — 关联原单 (.+)$');
