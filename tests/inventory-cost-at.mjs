// 「商品价目」成本按最新一批：数据库在入库时记下 cost_at，出库不动它。
// 同价补货也要算最新（否则别的仓库更早的另一个价会被当成最新）。
import assert from 'node:assert/strict'; import fs from 'node:fs';
const { PGlite } = await import(process.env.RENO_PGLITE_MODULE);
const db = new PGlite(); let n = 0; const ok = (v, m) => { assert(v, m); n++; };
const wait = () => new Promise(r => setTimeout(r, 15));
await db.exec(`create table public.inventory(id serial primary key, product_id text, warehouse_id text, qty_on_hand int, qty_reserved int default 0, unit_cost numeric, updated_at timestamptz);
 insert into public.inventory(product_id,warehouse_id,qty_on_hand,unit_cost,updated_at) values ('old','w1',5,9,'2026-01-01'),('old','w2',5,null,'2026-02-01');`);
const sql = fs.readFileSync('supabase/inventory_cost_at_migration.sql', 'utf8');
await db.exec(sql); await db.exec(sql);
ok(true, 'migration runs twice');
const at = async (p, w) => (await db.query(`select cost_at from inventory where product_id=$1 and warehouse_id=$2`, [p, w])).rows[0].cost_at;
ok(String(await at('old', 'w1')).includes('2026'), 'old rows with a cost get an estimated time');
ok(await at('old', 'w2') === null, 'rows without a cost stay empty');
await db.query(`insert into inventory(product_id,warehouse_id,qty_on_hand,unit_cost) values ('p','A',10,10)`); await wait();
await db.query(`insert into inventory(product_id,warehouse_id,qty_on_hand,unit_cost) values ('p','B',10,12)`); await wait();
const latest = async () => (await db.query(`select unit_cost from inventory where product_id='p' and unit_cost>0 order by cost_at desc limit 1`)).rows[0].unit_cost;
ok(Number(await latest()) === 12, 'newest stock-in (warehouse B, 12) is the latest cost');
const a0 = await at('p', 'A');
await db.query(`update inventory set qty_on_hand=qty_on_hand-3, updated_at=now() where product_id='p' and warehouse_id='A'`); await wait();
ok(+await at('p', 'A') === +a0, 'stock-out does not move the cost time');
await db.query(`update inventory set cost_at='2000-01-01' where product_id='p' and warehouse_id='A'`);
ok(+await at('p', 'A') === +a0, 'the cost time cannot be faked by a client update');
await db.query(`update inventory set qty_on_hand=qty_on_hand+5, unit_cost=10, updated_at=now() where product_id='p' and warehouse_id='A'`);
ok(Number(await latest()) === 10, 'restock at the same price in warehouse A becomes the latest cost');
await wait();
await db.query(`update inventory set unit_cost=11 where product_id='p' and warehouse_id='B'`);
ok(Number(await latest()) === 11, 'a cost change counts as the latest');
console.log(`inventory cost_at: ${n} checks passed`);
