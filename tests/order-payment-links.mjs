// The HitPay rules that protect real money: the server decides the amount, a repeat notice is never
// counted twice, a wrong amount is never marked paid, and order progress never moves backwards.
import fs from 'node:fs';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();let checks=0;
const ok=(v,m)=>{assert(v,m);checks++;};const reject=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
const staff='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon,service_role;
CREATE TABLE stores(id uuid PRIMARY KEY,region text);CREATE TABLE profiles(id uuid PRIMARY KEY,role text,store_id uuid,region text,active bool);
CREATE FUNCTION auth_user_level() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$SELECT CASE role WHEN 'staff' THEN 1 ELSE 0 END FROM profiles WHERE id=auth.uid()$$;
CREATE TABLE suppliers(id uuid PRIMARY KEY,user_id uuid);CREATE TABLE customers(id uuid PRIMARY KEY,name text,phone text);
CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_no text,amount numeric,status text,payment_status text,description text,customer_id uuid,store_id uuid,staff_id uuid,supplier_id uuid,currency text,installments int,pay_splits jsonb,hitpay_payment_id text,hitpay_payment_url text,hitpay_reference text,hitpay_status text,hitpay_amount numeric,hitpay_currency text,hitpay_paid_at timestamptz);
CREATE TABLE order_items(order_id uuid,supplier_id uuid);
CREATE TABLE order_logs(id uuid DEFAULT gen_random_uuid(),order_id uuid,status text NOT NULL,operator_id uuid,operator_role text NOT NULL,operator_name text,notes text,created_at timestamptz DEFAULT now());
CREATE TABLE order_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,seq int,pct numeric,amount numeric,method text,paid_at timestamptz,recorded_by uuid NOT NULL,verified_by uuid,verified_at timestamptz);
INSERT INTO profiles VALUES('${staff}','staff',NULL,NULL,true),('${other}','staff',NULL,NULL,true);INSERT INTO customers VALUES('40000000-0000-4000-8000-000000000001','王','60167475446');
GRANT SELECT ON orders TO authenticated;`);
await db.exec(fs.readFileSync('supabase/order_visibility_migration.sql','utf8'));
const migration=fs.readFileSync('supabase/order_payment_links_migration.sql','utf8');await db.exec(migration);await db.exec(migration);checks++;
const C='40000000-0000-4000-8000-000000000001';
const mk=async(fields)=>{await db.exec('RESET ROLE');const k=Object.keys(fields);const r=await db.query(`INSERT INTO orders(order_no,customer_id,staff_id,payment_status,${k.join(',')}) VALUES('H-'||gen_random_uuid(),$1,$2,'unpaid',${k.map((_,i)=>`$${i+3}`).join(',')}) RETURNING id`,[C,staff,...k.map(x=>typeof fields[x]==='object'?JSON.stringify(fields[x]):fields[x])]);return r.rows[0].id;};
const svc=()=>db.exec(`RESET ROLE;SET ROLE service_role`);
const prepare=async id=>{await svc();return (await db.query('SELECT hitpay_link_prepare($1) v',[id])).rows[0].v;};
let reqN=0;const save=async(id,q,source='staff')=>{await svc();const rq='req-'+(++reqN);return {rq,saved:(await db.query('SELECT hitpay_link_save($1,$2,$3,$4,$5,$6,$7,NULL) v',[id,q.seq,q.pct,q.amount,rq,'https://pay/'+rq,source])).rows[0].v};};
const record=async(rq,amount,ref=null)=>{await svc();return (await db.query('SELECT hitpay_record_payment($1,$2,$3) v',[rq,ref,amount])).rows[0].v;};
const row=async id=>{await db.exec('RESET ROLE');return (await db.query('SELECT * FROM orders WHERE id=$1',[id])).rows[0];};
const pays=async id=>{await db.exec('RESET ROLE');return (await db.query('SELECT seq,pct,amount::float,method FROM order_payments WHERE order_id=$1 ORDER BY seq',[id])).rows;};

// Installments charge one installment, not the whole order.
const inst=await mk({amount:10000,status:'pending_payment',installments:3,pay_splits:[30,40,30]});
let q=await prepare(inst);ok(q.payable&&q.seq===1&&Number(q.amount)===3000,'first installment is 30%, not the whole order');
const a=await save(inst,q);ok(a.saved.payment_url==='https://pay/'+a.rq,'link saved');
// Shared link: staff and customer get the same one.
q=await prepare(inst);ok(q.link.payment_request_id===a.rq,'a second request reuses the open link');
const race=await save(inst,q,'customer');ok(race.saved.payment_request_id===a.rq,'if two people create at once, both end up with the first link');
// Customer sees only what the button needs, and only with the right phone.
await db.exec("RESET ROLE;SET request.jwt.claim.sub='';SET ROLE anon");
let cq=(await db.query('SELECT order_customer_payment_quote($1,$2) v',[inst,'60167475446'])).rows[0].v;ok(Number(cq.amount)===3000&&cq.seq===1&&!('order_no' in cq),'customer quote');
ok((await db.query('SELECT order_customer_payment_quote($1,$2) v',[inst,'60100000000'])).rows[0].v===null,'wrong phone learns nothing');
for(const f of ['hitpay_link_prepare($1)','hitpay_open_links($1)','_order_payment_quote($1)'])await reject(()=>db.query(`SELECT ${f}`,[inst]),/permission denied/);
await reject(()=>db.query('SELECT hitpay_record_payment($1,NULL,$2)',[a.rq,3000]),/permission denied/);
await reject(()=>db.query('SELECT * FROM order_payment_links'),/permission denied/);
await db.exec(`RESET ROLE;SET request.jwt.claim.sub='${staff}';SET ROLE authenticated`);
await reject(()=>db.query('SELECT hitpay_record_payment($1,NULL,$2)',[a.rq,3000]),/permission denied/);
ok((await db.query('SELECT 1 FROM order_payment_links WHERE order_id=$1',[inst])).rows.length===1,'staff who own the order can see its link');
await db.exec(`RESET ROLE;SET request.jwt.claim.sub='${other}';SET ROLE authenticated`);ok((await db.query('SELECT 1 FROM order_payment_links WHERE order_id=$1',[inst])).rows.length===0,'other staff cannot');

// Paying
ok((await record(a.rq,3000)).result==='recorded','payment recorded');
let o=await row(inst);ok(o.payment_status==='partial'&&o.status==='paid','deposit moves the order to paid, payment partial');ok(o.hitpay_status==='partial'&&o.hitpay_paid_at===null,'one installment does not look like the whole order');
ok((await pays(inst)).length===1&&(await pays(inst))[0].method==='hitpay','payment appears in the ledger');
ok((await record(a.rq,3000)).result==='duplicate','HitPay retry');ok((await pays(inst)).length===1,'a repeat notice is not counted twice');
// Next installment; a later stage must not move backwards.
await db.exec(`RESET ROLE;UPDATE orders SET status='shipped' WHERE id='${inst}'`);
q=await prepare(inst);ok(q.seq===2&&Number(q.amount)===4000,'next installment');
const b=await save(inst,q);await record(b.rq,4000);ok((await row(inst)).status==='shipped','shipped order stays shipped');
q=await prepare(inst);const c=await save(inst,q);ok(Number(q.amount)===3000,'last installment takes the remainder');await record(c.rq,3000);
o=await row(inst);ok(o.payment_status==='paid'&&o.hitpay_status==='completed'&&o.hitpay_paid_at,'all paid');ok(o.status==='shipped','still shipped');
ok(!(await prepare(inst)).payable,'nothing left to pay');

// Rounding: 3 equal thirds still total the order.
const third=await mk({amount:100,status:'pending_payment',installments:3});
for(let i=0;i<3;i++){const p=await prepare(third);const l=await save(third,p);await record(l.rq,Number(p.amount));}
ok(Math.abs((await pays(third)).reduce((s,p)=>s+p.amount,0)-100)<0.001,'installments add up exactly');ok((await row(third)).payment_status==='paid','and the order is paid');

// Wrong amount: flagged, never paid.
const wrong=await mk({amount:500,status:'pending_payment'});q=await prepare(wrong);const w=await save(wrong,q);
ok((await record(w.rq,1)).result==='review','wrong amount flagged');o=await row(wrong);ok(o.payment_status==='unpaid'&&o.status==='pending_payment','not marked paid');ok((await pays(wrong)).length===0,'not in the ledger');ok(o.hitpay_status==='review','staff are alerted');
ok((await prepare(wrong)).reason==='review','no more links until checked');ok((await record(w.rq,500)).result==='review','a later notice cannot clear a review');
await db.exec('RESET ROLE');ok((await db.query('SELECT notes FROM order_logs WHERE order_id=$1',[wrong])).rows[0].notes.includes('不符'),'log explains why');

// Order total changed: the old link retires, and paying it anyway is flagged.
const changed=await mk({amount:800,status:'pending_payment'});q=await prepare(changed);const old=await save(changed,q);
await db.exec(`RESET ROLE;UPDATE orders SET amount=900 WHERE id='${changed}'`);q=await prepare(changed);ok(!q.link&&Number(q.amount)===900,'old amount is not reused');const fresh=await save(changed,q);
ok((await record(old.rq,800)).result==='review','paying a retired link is flagged');await db.exec(`RESET ROLE;UPDATE orders SET hitpay_status=NULL WHERE id='${changed}'`);ok((await pays(changed)).length===0,'not counted');
ok((await record(fresh.rq,900)).result==='recorded','the current link works');

// Blocked states
const cancelled=await mk({amount:100,status:'cancelled'});ok((await prepare(cancelled)).reason==='closed','cancelled');
const sgd=await mk({amount:100,status:'pending_payment',currency:'SGD'});ok((await prepare(sgd)).reason==='currency','SGD is not charged as MYR');
const cash=await mk({amount:100,status:'pending_payment',installments:2});await db.exec(`RESET ROLE;INSERT INTO order_payments(order_id,seq,pct,amount,method,paid_at,recorded_by) VALUES('${cash}',1,50,50,'cash',now(),'${staff}')`);ok((await prepare(cash)).reason==='pending_verify','unverified cash waits, so nobody pays twice');

// Older whole-order links still pay correctly.
const legacyWhole=await mk({amount:1000,status:'pending_payment',installments:2,pay_splits:[50,50],hitpay_payment_id:'legacy-1',hitpay_payment_url:'https://pay/old',hitpay_status:'pending'});
ok((await record('legacy-1',1000)).result==='recorded','old full link recorded');ok((await pays(legacyWhole)).length===2&&(await row(legacyWhole)).payment_status==='paid','credits every installment');ok((await record('legacy-1',1000)).result==='duplicate','and only once');
const legacyPart=await mk({amount:1000,status:'pending_payment',hitpay_payment_id:'legacy-2',hitpay_status:'pending'});ok((await record('legacy-2',1)).result==='review','old link with a wrong amount is flagged');
await db.exec('RESET ROLE');ok((await record('nothing',5,'no-such-order')).result==='ignored','unknown payment is ignored');
console.log(`PASS ${checks} payment link checks`);
