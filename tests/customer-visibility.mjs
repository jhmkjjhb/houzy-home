// Customer phones/addresses must follow order visibility: a staff member sees customers of
// their own orders (or ones they created), not the whole company list; any supplier could
// previously read every customer and every order's line items.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
const A='10000000-0000-4000-8000-000000000001';
const u=n=>`20000000-0000-4000-8000-00000000000${n}`;
const [amy,ben,mgr,gm,sup,sup2,lgx]=[1,2,3,4,5,6,7].map(u);
const S1='50000000-0000-4000-8000-000000000001',S2='50000000-0000-4000-8000-000000000002';
const c=n=>`40000000-0000-4000-8000-00000000000${n}`,o=n=>`30000000-0000-4000-8000-00000000000${n}`;
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE TABLE stores(id uuid PRIMARY KEY,region text);
CREATE TABLE profiles(id uuid PRIMARY KEY,role text,store_id uuid,region text,active bool);
CREATE FUNCTION auth_user_level() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$SELECT CASE role WHEN 'staff' THEN 1 WHEN 'store_manager' THEN 2 WHEN 'regional_manager' THEN 3 WHEN 'general_manager' THEN 4 ELSE 0 END FROM profiles WHERE id=auth.uid()$$;
CREATE TABLE suppliers(id uuid PRIMARY KEY,user_id uuid);
CREATE TABLE customers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,name text,phone text,address text,created_at timestamptz DEFAULT now());
CREATE TABLE orders(id uuid PRIMARY KEY,store_id uuid,staff_id uuid,supplier_id uuid,customer_id uuid,status text);
CREATE TABLE order_items(order_id uuid,supplier_id uuid);
CREATE TABLE order_logs(order_id uuid);CREATE TABLE order_payments(order_id uuid);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;ALTER TABLE orders ENABLE ROW LEVEL SECURITY;ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers_self" ON customers FOR SELECT USING (user_id=auth.uid());
CREATE POLICY "customers_staff" ON customers FOR ALL USING (auth_user_level()>=1);
CREATE POLICY "customers_supplier" ON customers FOR SELECT USING (EXISTS(SELECT 1 FROM suppliers WHERE user_id=auth.uid()));
CREATE POLICY "order_items_staff" ON order_items FOR ALL USING (auth_user_level()>=1);
CREATE POLICY "order_items_supplier" ON order_items FOR SELECT USING ((SELECT role FROM profiles WHERE id=auth.uid())='supplier');
GRANT SELECT,INSERT,UPDATE,DELETE ON customers,orders,order_items TO authenticated;GRANT SELECT ON profiles,stores,suppliers TO authenticated;
INSERT INTO stores VALUES('${A}','JB');
INSERT INTO profiles VALUES('${amy}','staff','${A}','JB',true),('${ben}','staff','${A}','JB',true),('${mgr}','store_manager','${A}','JB',true),
 ('${gm}','general_manager',null,null,true),('${sup}','supplier',null,null,true),('${sup2}','supplier',null,null,true),('${lgx}','logistics',null,null,true);
INSERT INTO suppliers VALUES('${S1}','${sup}'),('${S2}','${sup2}');
INSERT INTO customers(id,name,phone) VALUES('${c(1)}','Amy cust','601111'),('${c(2)}','Ben cust','602222'),('${c(3)}','No order','603333');
INSERT INTO orders VALUES('${o(1)}','${A}','${amy}',null,'${c(1)}','pending'),('${o(2)}','${A}','${ben}',null,'${c(2)}','shipped');
INSERT INTO order_items VALUES('${o(2)}','${S1}'),('${o(2)}','${S2}');`);
for(const f of ['order_visibility_migration.sql','customer_visibility_migration.sql','customer_visibility_migration.sql'])
  await db.exec(fs.readFileSync('supabase/'+f,'utf8'));checks++;
const as=w=>db.exec(`RESET ROLE;SET request.jwt.claim.sub='${w}';SET ROLE authenticated`);
const q=async(w,sql)=>{await as(w);return (await db.query(sql)).rows;};
const custs=async w=>(await q(w,'SELECT id FROM customers ORDER BY id')).map(r=>r.id);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify([...b].sort());

ok(same(await custs(amy),[c(1)]),'staff sees only customers of their own orders');
ok(same(await custs(mgr),[c(1),c(2)]),'store manager sees customers of store orders');
ok(same(await custs(gm),[c(1),c(2),c(3)]),'general manager sees every customer, incl. ones without orders');
ok(same(await custs(sup),[c(2)]),'supplier sees only customers of orders assigned to them, not the whole list');
ok(same(await custs(lgx),[c(2)]),'logistics sees customers of shipped orders it delivers');
const f=await q(amy,`SELECT * FROM find_customer_by_phone('602222')`);
ok(f.length===1&&f[0].id===c(2),'new-order phone lookup still finds a colleague\\u2019s returning customer');
ok((await q(amy,`SELECT * FROM find_customer_by_phone('')`)).length===0,'blank phone finds nothing');
ok((await q(sup,`SELECT * FROM find_customer_by_phone('602222')`)).length===0,'suppliers cannot use the phone lookup');
const n=await q(amy,`INSERT INTO customers(name,phone) VALUES('New','609999') RETURNING id,created_by`);
ok(n.length===1&&n[0].created_by===amy,'staff can create a customer and read it back before any order exists');
ok((await custs(ben)).every(id=>id!==n[0].id),'a colleague cannot see that new customer');
ok(same((await q(sup,'SELECT supplier_id v FROM order_items')).map(r=>r.v),[S1]),'supplier sees only its own line items, not another supplier\\u2019s on the same order');
ok((await q(amy,'SELECT * FROM order_items')).length===0,'staff still cannot see items of a colleague\\u2019s order');
await db.exec('RESET ROLE');
ok((await db.query(`SELECT has_function_privilege('anon','find_customer_by_phone(text)','EXECUTE') v`)).rows[0].v===false,'lookup not callable anonymously');
console.log('PASS',checks,'customer visibility checks');await db.close();
