// Ordinary staff must only see orders they opened; store managers see the whole store.
// Previously only the page filtered this — any logged-in account could read every order
// (with customer names and phones) straight from the API.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const u=n=>`20000000-0000-4000-8000-00000000000${n}`;
const [amy,ben,mgr,rm,gm,sup,lgx,gone,nostore]=[1,2,3,4,5,6,7,8,9].map(u);
const supRow='50000000-0000-4000-8000-000000000001';
const o=n=>`30000000-0000-4000-8000-00000000000${n}`;
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE TABLE stores(id uuid PRIMARY KEY,region text);
CREATE TABLE profiles(id uuid PRIMARY KEY,role text,store_id uuid,region text,active bool);
CREATE FUNCTION auth_user_level() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$SELECT CASE role WHEN 'staff' THEN 1 WHEN 'store_manager' THEN 2 WHEN 'regional_manager' THEN 3 WHEN 'general_manager' THEN 4 ELSE 0 END FROM profiles WHERE id=auth.uid()$$;
CREATE TABLE suppliers(id uuid PRIMARY KEY,user_id uuid);
CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid,staff_id uuid,supplier_id uuid,status text);
CREATE TABLE order_items(order_id uuid,supplier_id uuid);
CREATE TABLE order_logs(order_id uuid,note text);
CREATE TABLE order_payments(order_id uuid,amount numeric);
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_logs ENABLE ROW LEVEL SECURITY;ALTER TABLE order_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_select" ON orders FOR SELECT USING (true);
CREATE POLICY "orders_insert" ON orders FOR INSERT WITH CHECK (auth_user_level()>=1);
CREATE POLICY "orders_update" ON orders FOR UPDATE USING (auth_user_level()>=1);
CREATE POLICY "order_items_staff" ON order_items FOR ALL USING (auth_user_level()>=1);
CREATE POLICY "order_items_supplier" ON order_items FOR SELECT USING ((SELECT role FROM profiles WHERE id=auth.uid())='supplier');
CREATE POLICY "logs_staff_admin" ON order_logs FOR ALL USING (auth_user_level()>=1);
CREATE POLICY "payments_read" ON order_payments FOR SELECT USING (auth_user_level()>=1);
CREATE POLICY "payments_manage" ON order_payments FOR ALL USING (auth_user_level()>=2);
GRANT SELECT,INSERT,UPDATE ON orders,order_items,order_logs,order_payments TO authenticated;GRANT SELECT ON profiles,stores,suppliers TO authenticated;
INSERT INTO stores VALUES('${A}','JB'),('${B}','SG');
INSERT INTO profiles VALUES('${amy}','staff','${A}','JB',true),('${ben}','staff','${A}','JB',true),('${mgr}','store_manager','${A}','JB',true),
 ('${rm}','regional_manager',null,'JB',true),('${gm}','general_manager',null,null,true),('${sup}','supplier',null,null,true),
 ('${lgx}','logistics',null,null,true),('${gone}','store_manager','${A}','JB',false),('${nostore}','staff',null,null,true);
INSERT INTO suppliers VALUES('${supRow}','${sup}');
INSERT INTO orders VALUES('${o(1)}','${A}','${amy}',null,'pending'),('${o(2)}','${A}','${ben}',null,'shipped'),('${o(3)}','${B}','${gm}','${supRow}','pending');
INSERT INTO order_items VALUES('${o(2)}','${supRow}'),('${o(1)}',null);
INSERT INTO order_logs SELECT id,'x' FROM orders;INSERT INTO order_payments SELECT id,100 FROM orders;`);
const mig=fs.readFileSync('supabase/order_visibility_migration.sql','utf8');
await db.exec(mig);await db.exec(mig);checks++;
const as=async who=>db.exec(`RESET ROLE;SET request.jwt.claim.sub='${who}';SET ROLE authenticated`);
const ids=async(who,t='orders',col='id')=>{await as(who);return (await db.query(`SELECT ${col} v FROM ${t} ORDER BY 1`)).rows.map(r=>r.v);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify([...b].sort());

ok(same(await ids(amy),[o(1)]),'staff sees only the order they opened, not a colleague’s in the same store');
ok(same(await ids(mgr),[o(1),o(2)]),'store manager sees every order in their store, nothing from other stores');
ok(same(await ids(rm),[o(1),o(2)]),'regional manager sees their region only');
ok(same(await ids(gm),[o(1),o(2),o(3)]),'general manager sees all');
ok(same(await ids(sup),[o(2),o(3)]),'supplier keeps seeing orders assigned via items or the order itself');
ok(same(await ids(lgx),[o(2)]),'logistics keeps seeing shipped orders only');
ok((await ids(gone)).length===0,'deactivated accounts see nothing');
ok(same(await ids(amy,'order_items','order_id'),[o(1)])&&same(await ids(amy,'order_payments','order_id'),[o(1)])&&same(await ids(amy,'order_logs','order_id'),[o(1)]),
  'items, payments and logs of a colleague’s order are hidden from staff too');
ok(same(await ids(sup,'order_items','order_id'),[o(1),o(2)]),'supplier item policy is unchanged by this migration');
// Creating an order reads it back (insert…select) — must still work, including for staff with no store set
await as(nostore);
const r=await db.query(`INSERT INTO orders(store_id,staff_id,status) VALUES('${A}','${nostore}','pending') RETURNING id`);
ok(r.rows.length===1,'staff can create an order and read it back immediately');
await db.exec(`INSERT INTO order_items VALUES('${r.rows[0].id}',null)`);
ok(same(await ids(nostore),[r.rows[0].id]),'staff without a store still sees their own orders');
await as(amy);
ok((await db.query(`UPDATE orders SET status='x' WHERE id='${o(2)}' RETURNING id`)).rows.length===0,'staff cannot change a colleague’s order either');
await db.exec('RESET ROLE');
ok((await db.query(`SELECT has_function_privilege('anon','_order_visible(uuid)','EXECUTE') v`)).rows[0].v===false,'helper not callable anonymously');
console.log('PASS',checks,'order visibility checks');await db.close();
