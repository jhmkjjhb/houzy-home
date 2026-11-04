// Billing an order to a company: staff can record it, suppliers and logistics cannot read it,
// the customer's own PDF carries it, and every change leaves a log line.
import fs from 'node:fs';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();let checks=0;
const ok=(v,m)=>{assert(v,m);checks++;};const reject=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
const A='10000000-0000-4000-8000-000000000001',u=n=>`20000000-0000-4000-8000-00000000000${n}`,[amy,ben,mgr,sup,lgx]=[1,2,3,4,5].map(u);
const o1='30000000-0000-4000-8000-000000000001',o2='30000000-0000-4000-8000-000000000002',c1='40000000-0000-4000-8000-000000000001',s1='50000000-0000-4000-8000-000000000001';
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
CREATE TABLE stores(id uuid PRIMARY KEY,name text,region text);
CREATE TABLE profiles(id uuid PRIMARY KEY,name text,role text,store_id uuid,region text,active bool);
CREATE FUNCTION auth_user_level() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$SELECT CASE role WHEN 'staff' THEN 1 WHEN 'store_manager' THEN 2 ELSE 0 END FROM profiles WHERE id=auth.uid()$$;
CREATE TABLE suppliers(id uuid PRIMARY KEY,user_id uuid);
CREATE TABLE customers(id uuid PRIMARY KEY,name text,phone text,address text);
CREATE TABLE orders(id uuid PRIMARY KEY,order_no text,amount numeric,payment_status text,status text,description text,created_at timestamptz DEFAULT now(),hitpay_status text,hitpay_amount numeric,hitpay_paid_at timestamptz,customer_id uuid,store_id uuid,staff_id uuid,supplier_id uuid);
CREATE TABLE order_items(order_id uuid,supplier_id uuid,product_name text,model_spec text,quantity numeric,uom text,unit text,unit_price numeric,total_price numeric,sort_order int,created_at timestamptz,id uuid);
CREATE TABLE order_logs(id uuid DEFAULT gen_random_uuid(),order_id uuid,status text,operator_id uuid,operator_role text,operator_name text,notes text,created_at timestamptz DEFAULT now());
CREATE TABLE order_payments(order_id uuid,amount numeric,method text,paid_at timestamptz,verified_at timestamptz,seq int,id uuid);
INSERT INTO stores VALUES('${A}','Austin','JB');
INSERT INTO profiles VALUES('${amy}','Amy','staff','${A}','JB',true),('${ben}','Ben','staff','${A}','JB',true),('${mgr}','Mei','store_manager','${A}','JB',true),('${sup}','Sup','supplier',NULL,NULL,true),('${lgx}','Lgx','logistics',NULL,NULL,true);
INSERT INTO suppliers VALUES('${s1}','${sup}');INSERT INTO customers VALUES('${c1}','王先生','60167475446','配送地址');
INSERT INTO orders(id,order_no,amount,payment_status,status,customer_id,store_id,staff_id,supplier_id,created_at) VALUES('${o1}','H-1',100,'unpaid','shipped','${c1}','${A}','${amy}','${s1}',now()-interval '1 day'),('${o2}','H-2',100,'unpaid','pending_payment','${c1}','${A}','${amy}',NULL,now());
GRANT SELECT ON orders TO authenticated;`);
await db.exec(fs.readFileSync('supabase/order_visibility_migration.sql','utf8'));
await db.exec(fs.readFileSync('supabase/order_statement_customer_migration.sql','utf8'));
const migration=fs.readFileSync('supabase/order_billing_migration.sql','utf8');await db.exec(migration);await db.exec(migration);checks++;
const as=async(who,role='authenticated')=>db.exec(`RESET ROLE;SET request.jwt.claim.sub='${who}';SET ROLE ${role}`);
const set=async(who,order,data)=>{await as(who);return (await db.query('SELECT set_order_billing($1,$2::jsonb) v',[order,JSON.stringify(data)])).rows[0].v;};
const logs=async order=>{await db.exec('RESET ROLE');return (await db.query('SELECT notes FROM order_logs WHERE order_id=$1 ORDER BY created_at',[order])).rows.map(r=>r.notes);};
const SPACE={company_name:'SpaceMade Interior Design Sdn Bhd',registration_no:'202501014187 (1615601-X)',address:'28B Jalan Pendekar 17, Taman Ungku Tun Aminah, 81300 Skudai, Johor',phone:'016-7475446'};

await reject(()=>set(amy,o1,{...SPACE,company_name:' '}),/公司名称/);
await reject(()=>set(amy,o1,{...SPACE,registration_no:''}),/公司名称/);
await reject(()=>set(amy,o1,{...SPACE,address:''}),/公司名称/);
await reject(()=>set(ben,o1,SPACE),/无此订单权限/);
await reject(()=>set(sup,o1,SPACE),/无此订单权限/);
await reject(()=>set(lgx,o1,SPACE),/无此订单权限/);
await as(amy);await reject(()=>db.query(`INSERT INTO order_billing(order_id,company_name,registration_no,address) VALUES('${o2}','x','x','x')`),/permission denied/);
const saved=await set(amy,o1,SPACE);ok(saved.company_name===SPACE.company_name&&saved.phone===SPACE.phone,'staff saves exactly what was entered');
ok((await logs(o1)).length===1&&(await logs(o1))[0].includes('SpaceMade'),'first save is logged');
await set(amy,o1,SPACE);ok((await logs(o1)).length===1,'saving the same details adds no noise');

// Visibility: a supplier and logistics may read this order row, but never its company details.
const read=async who=>{await as(who);return (await db.query('SELECT company_name FROM order_billing')).rows.length;};
ok(await read(amy)===1,'the order owner reads it');ok(await read(mgr)===1,'store manager reads it');ok(await read(ben)===0,'another staff member does not');
await as(sup);ok((await db.query('SELECT id FROM orders WHERE id=$1',[o1])).rows.length===1,'supplier does see the order');ok(await read(sup)===0,'but not the company');
await as(lgx);ok((await db.query('SELECT id FROM orders WHERE id=$1',[o1])).rows.length===1,'logistics does see the shipped order');ok(await read(lgx)===0,'but not the company');
await as(amy,'anon');await reject(()=>db.query('SELECT * FROM order_billing'),/permission denied/);
await reject(()=>db.query(`SELECT find_customer_billing('60167475446')`),/permission denied/);

// Customer's PDF data
await as(amy,'anon');const statement=async(phone,order=o1)=>(await db.query('SELECT get_order_statement_by_phone($1,$2) v',[order,phone])).rows[0].v;
let st=await statement('60167475446');ok(st.order.order_billing.registration_no===SPACE.registration_no,'customer PDF carries the company');
ok(!('updated_by' in st.order.order_billing),'staff identity is not exposed');
ok(await statement('60100000000')===null,'wrong phone gets nothing');
ok((await statement('60167475446',o2)).order.order_billing===null,'an individual order stays individual');

// Returning customer: the newest order decides.
await as(ben);let last=(await db.query(`SELECT find_customer_billing('60167475446') v`)).rows[0].v;ok(last===null,'latest order billed to individual brings nothing back');
await set(amy,o2,{...SPACE,company_name:'Second Sdn Bhd'});
await as(ben);last=(await db.query(`SELECT find_customer_billing('60167475446') v`)).rows[0].v;ok(last.company_name==='Second Sdn Bhd','a colleague gets the latest company');
await as(sup);ok((await db.query(`SELECT find_customer_billing('60167475446') v`)).rows[0].v===null,'supplier cannot look it up');

// Orders keep their own copy
ok((await (async()=>{await as(amy,'anon');return statement('60167475446');})()).order.order_billing.company_name===SPACE.company_name,'an issued order keeps its company when a later one differs');

// Changes are logged with before and after; going back to individual too.
await set(amy,o1,{...SPACE,address:'New address'});const trail=await logs(o1);ok(trail.at(-1).includes(SPACE.address)&&trail.at(-1).includes('New address'),'edit log keeps old and new');
ok((await set(amy,o1,{}))===null,'empty data returns to individual');ok((await logs(o1)).at(-1).includes('改回开单给个人'),'and says so');
await as(amy);ok((await db.query('SELECT 1 FROM order_billing WHERE order_id=$1',[o1])).rows.length===0,'company removed');
await set(amy,o1,{});ok((await logs(o1)).filter(n=>n.includes('改回')).length===1,'no extra log when already individual');
console.log(`PASS ${checks} order billing checks`);
