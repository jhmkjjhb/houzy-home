// The monthly business dashboard must count renovation contracts alongside goods orders:
// managers were seeing RM 0 for a month in which renovation money was collected.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
const austin='10000000-0000-4000-8000-000000000001',sg='10000000-0000-4000-8000-000000000002';
const mgr='20000000-0000-4000-8000-000000000001',amy='20000000-0000-4000-8000-000000000002',gm='20000000-0000-4000-8000-000000000003';
const p1='30000000-0000-4000-8000-000000000001',p2='30000000-0000-4000-8000-000000000002',p3='30000000-0000-4000-8000-000000000003',p4='30000000-0000-4000-8000-000000000004';
const c1='40000000-0000-4000-8000-000000000001';
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE TABLE stores(id uuid PRIMARY KEY,name text,region text);
CREATE TABLE profiles(id uuid PRIMARY KEY,name text,role text,store_id uuid,region text,lvl int);
CREATE FUNCTION auth_user_level() RETURNS int LANGUAGE sql AS $$SELECT coalesce((SELECT lvl FROM profiles WHERE id=auth.uid()),0)$$;
CREATE TABLE customers(id uuid PRIMARY KEY,phone text,created_at timestamptz);
CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid,staff_id uuid,customer_id uuid,amount numeric,payment_status text,status text,created_at timestamptz);
CREATE TABLE order_items(order_id uuid,product_type text,quantity numeric,unit_price numeric);
CREATE TABLE order_payments(order_id uuid,method text,amount numeric,paid_at timestamptz);
CREATE TABLE renovation_projects(id uuid PRIMARY KEY,store_id uuid,created_by uuid,customer_phone text,state text,snapshot jsonb,accepted_on date,current_total numeric,created_at timestamptz);
CREATE TABLE renovation_payments(project_id uuid,kind text,amount numeric,method text,paid_on date,verified_at timestamptz,voided_at timestamptz);
INSERT INTO stores VALUES('${austin}','001 Austin','JB'),('${sg}','002 SG','SG');
INSERT INTO profiles VALUES('${mgr}','Boss','store_manager','${austin}','JB',2),('${amy}','Amy','staff','${austin}','JB',1),('${gm}','GM','general_manager',null,null,4);
-- a returning goods customer who also signs a renovation contract this month
INSERT INTO customers VALUES('${c1}','+60 12-345 6789','2026-01-01');
INSERT INTO orders(store_id,staff_id,customer_id,amount,payment_status,status,created_at) VALUES('${austin}','${amy}','${c1}',1000,'paid','completed','2026-10-05');
INSERT INTO order_items SELECT id,'CG',1,1000 FROM orders;
INSERT INTO order_payments SELECT id,'cash',1000,'2026-10-05' FROM orders;
-- p1: imported in Oct but signed in June; its Oct receipt counts as Oct money, not as an Oct contract
-- p2: signed in Oct by Amy, same phone as the goods customer
-- p3: other store; p4: still a draft
INSERT INTO renovation_projects VALUES
 ('${p1}','${austin}','${mgr}','0101111111','executing','{"signed_on":"2026-06-20"}',null,500000,'2026-10-28'),
 ('${p2}','${austin}','${amy}','60123456789','executing','{"signed_on":"2026-10-10"}',null,80000,'2026-10-10'),
 ('${p3}','${sg}','${gm}','0199999999','executing','{"signed_on":"2026-10-11"}',null,90000,'2026-10-11'),
 ('${p4}','${austin}','${amy}','0188888888','draft','{}',null,70000,'2026-10-12');
INSERT INTO renovation_payments VALUES
 ('${p1}','receipt',8550,'bank_transfer','2026-10-23','2026-10-23',null),
 ('${p2}','receipt',20000,'bank_transfer','2026-10-12','2026-10-12',null),
 ('${p2}','receipt',5000,'cash','2026-10-13',null,null),               -- not yet verified: excluded
 ('${p2}','receipt',3000,'cash','2026-10-14','2026-10-14','2026-10-15'),-- voided: excluded
 ('${p2}','refund',500,'bank_transfer','2026-10-20','2026-10-20',null),
 ('${p1}','receipt',89568.45,'bank_transfer','2026-09-15','2026-09-15',null),
 ('${p3}','receipt',9999,'bank_transfer','2026-10-15','2026-10-15',null);`);
const migration=fs.readFileSync('supabase/dashboard_kpis_renovation_migration.sql','utf8');
await db.exec(migration);await db.exec(migration);checks++;
await db.exec('GRANT EXECUTE ON FUNCTION get_dashboard_kpis(date) TO authenticated');
const kpis=async who=>{await db.exec(`RESET ROLE;SET request.jwt.claim.sub='${who}';SET ROLE authenticated`);return (await db.query(`SELECT get_dashboard_kpis('2026-10-15') v`)).rows[0].v;};

const d=await kpis(mgr),cur=d.current;
ok(Number(cur.goods_revenue)===1000,'goods revenue keeps the original order basis');
ok(Number(cur.renovation_revenue)===8550+20000-500,'renovation revenue = verified, unvoided Oct receipts minus refunds, own store only');
ok(Number(cur.revenue_total)===1000+28050,'headline revenue includes renovation');
ok(cur.renovation_cnt===1&&cur.goods_order_cnt===1&&cur.order_cnt===2,'only contracts signed this month count; imported old contracts and drafts do not');
ok(cur.customer_cnt===1,'the same phone across goods and renovation is one customer');
ok(cur.returning_customers===1&&cur.new_customers===0,'customer known before this month is returning');
ok(Number(cur.category_breakdown.ZZ)===80000,'renovation appears as its own category by contract value');
ok(Number(cur.payment_breakdown.transfer)===28050&&Number(cur.payment_breakdown.cash)===1000,'renovation money shows in the payment-method bars');
ok(Number(d.previous.revenue_total)===89568.45,'last month comparison includes renovation too');
const amyRow=d.top_staff.find(s=>s.staff_name==='Amy'),boss=d.top_staff.find(s=>s.staff_name==='Boss');
ok(Number(amyRow.gross)===1000+19500&&amyRow.order_cnt===2,'staff ranking adds renovation receipts and signed contracts');
ok(Number(boss.gross)===8550&&boss.order_cnt===0,'collecting on an older contract credits its owner without counting a new order');
const g=(await kpis(gm)).current;
ok(Number(g.renovation_revenue)===28050+9999&&g.renovation_cnt===2,'company-wide view sees every store');
await db.exec('RESET ROLE');
ok((await db.query(`SELECT has_function_privilege('authenticated','_dash_kpi_period(date,date,int,uuid,text)','EXECUTE') v`)).rows[0].v===false,'scope helper is not callable directly');
console.log('PASS',checks,'dashboard renovation checks');await db.close();
