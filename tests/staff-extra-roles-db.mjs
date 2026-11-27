// 兼任职位与个人看板：员工不能给自己加职位或兼任；兼任财务 = 有财务权限；兼任监理会出现在「指定监理」名单；
// 个人看板只有总经理 / 财务 / 管理员能看，数字按月份统计。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const U = { gm: '11111111-1111-4111-8111-111111111111', xia: '22222222-2222-4222-8222-222222222222', sup: '33333333-3333-4333-8333-333333333333' };
const S1 = 'aaaaaaaa-0000-4000-8000-000000000001', P1 = 'bbbbbbbb-0000-4000-8000-000000000001', O1 = 'cccccccc-0000-4000-8000-000000000001';
await db.exec(`
 CREATE ROLE authenticated; CREATE ROLE anon;
 CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated, anon;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(), bucket_id text, name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 CREATE TABLE public.stores(id uuid PRIMARY KEY, name text, region text, active boolean DEFAULT true);
 CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text NOT NULL CHECK (role IN ('staff','store_manager','regional_manager','general_manager','admin','superadmin','supervisor','finance','customer')), store_id uuid, region text, active boolean DEFAULT true, name text DEFAULT '', phone text);
 GRANT SELECT, UPDATE ON public.profiles TO authenticated; ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
 CREATE POLICY self_all ON public.profiles FOR ALL TO authenticated USING (true) WITH CHECK (true); -- 最坏情况：表权限放得很宽，靠触发器挡
 CREATE TABLE public.customers(id uuid PRIMARY KEY, name text, phone text, address text);
 CREATE TABLE public.suppliers(id uuid PRIMARY KEY, name text, user_id uuid);
 CREATE TABLE public.orders(id uuid PRIMARY KEY, order_no text, store_id uuid, customer_id uuid, staff_id uuid, supplier_id uuid, amount numeric, payment_status text, status text, description text, currency text DEFAULT 'MYR', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), completed_at timestamptz);
 CREATE TABLE public.order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, supplier_id uuid);
 CREATE TABLE public.order_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, amount numeric, paid_at timestamptz);
 CREATE TABLE public.order_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, status text, operator_id uuid, notes text, created_at timestamptz DEFAULT now());
 CREATE TABLE public.renovation_projects(id uuid PRIMARY KEY, store_id uuid, created_by uuid, contract_no text, customer_name text, customer_phone text DEFAULT '', address text, state text, snapshot jsonb, current_total numeric, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
 CREATE TABLE public.renovation_work_orders(id uuid PRIMARY KEY, project_id uuid, group_name text, line_ids jsonb, assignee text DEFAULT '', cancelled_at timestamptz);
 CREATE TABLE public.renovation_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid, kind text, amount numeric, paid_on date, voided_at timestamptz);
 CREATE TABLE public.renovation_audit(id serial, project_id uuid, actor uuid, action text, payload jsonb, created_at timestamptz DEFAULT now());
 CREATE TABLE public.renovation_site_supervisors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid, profile_id uuid, active boolean, kind text, name text DEFAULT '');
 CREATE TABLE public.renovation_site_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid, supervisor_id uuid, kind text, on_date date, status text DEFAULT 'done');
 CREATE TABLE public.quote_shares(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid, view_count int DEFAULT 0, created_at timestamptz DEFAULT now());
 CREATE TABLE public.quote_cloud_slots(owner_id uuid, slot int, updated_at timestamptz DEFAULT now());
`);
const read = f => readFile(new URL('../supabase/' + f, import.meta.url), 'utf8');
const orders = await read('renovation_orders_migration.sql'), vis = await read('order_visibility_migration.sql');
await db.exec(orders.slice(orders.indexOf('CREATE OR REPLACE FUNCTION public._reno_access'), orders.indexOf('ALTER TABLE public.renovation_projects ENABLE')));
await db.exec(vis.slice(vis.indexOf('CREATE OR REPLACE FUNCTION public._order_row_visible'), vis.indexOf('REVOKE ALL ON FUNCTION public._order_row_visible')));
await db.exec(await read('renovation_expenses_migration.sql'));
const sql = await read('staff_extra_roles_migration.sql'); await db.exec(sql); await db.exec(sql);

await db.exec(`
 INSERT INTO stores VALUES ('${S1}','Austin','south',true);
 INSERT INTO profiles(id,role,store_id,name) VALUES ('${U.gm}','general_manager',NULL,'老板'),('${U.xia}','staff','${S1}','小霞'),('${U.sup}','staff','${S1}','阿强');
 INSERT INTO customers VALUES ('dddddddd-0000-4000-8000-000000000001','Tan','0123','JB');
 INSERT INTO orders(id,order_no,store_id,customer_id,staff_id,amount,payment_status,status,created_at) VALUES ('${O1}','001-1','${S1}','dddddddd-0000-4000-8000-000000000001','${U.xia}',5000,'paid','in_production','2026-11-05'),
  ('cccccccc-0000-4000-8000-000000000002','001-2','${S1}','dddddddd-0000-4000-8000-000000000001','${U.xia}',900,'unpaid','completed','2026-10-05');
 INSERT INTO order_payments(order_id,amount,paid_at) VALUES ('${O1}',3000,'2026-11-06T10:00:00+08');
 INSERT INTO order_logs(order_id,status,operator_id,notes,created_at) VALUES ('${O1}','assigned','${U.xia}','派给希雅','2026-11-06');
 INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,address,state,snapshot,current_total) VALUES ('${P1}','${S1}','${U.xia}','C-9','Ali','JB','executing','{"signed_on":"2026-11-10","net":80000}',80000);
 INSERT INTO renovation_payments(project_id,kind,amount,paid_on) VALUES ('${P1}','receipt',24000,'2026-11-11');
 INSERT INTO quote_shares(owner_id,view_count,created_at) VALUES ('${U.xia}',3,'2026-11-12'),('${U.xia}',0,'2026-11-13'),('${U.xia}',5,'2026-10-01');
 INSERT INTO renovation_site_supervisors(id,project_id,profile_id,active,kind) VALUES ('99999999-0000-4000-8000-000000000001','${P1}','${U.sup}',true,'internal');
 INSERT INTO renovation_site_entries(project_id,supervisor_id,kind,on_date,status) VALUES ('${P1}','99999999-0000-4000-8000-000000000001','log','2026-11-14','done'),('${P1}','99999999-0000-4000-8000-000000000001','log','2026-11-15','done'),('${P1}','99999999-0000-4000-8000-000000000001','issue','2026-11-15','open');
`);
const as = who => db.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '${who}';`);
const q1 = (sqlText, args = []) => db.query(sqlText, args).then(r => r.rows[0]);

await assert.rejects(db.query(`UPDATE profiles SET extra_roles='{admin}' WHERE id='${U.xia}'`), /extra_roles_check/, '兼任只能是财务或监理');
// 员工不能给自己加兼任、改职位
await as(U.xia);
await assert.rejects(db.query(`UPDATE profiles SET extra_roles='{finance}' WHERE id='${U.xia}'`), /只有总经理/);
await assert.rejects(db.query(`UPDATE profiles SET role='general_manager' WHERE id='${U.xia}'`), /只有总经理/);
await db.query(`UPDATE profiles SET phone='0123' WHERE id='${U.xia}'`); // 改别的资料不受影响
assert.equal((await q1('SELECT public._is_finance() f')).f, false);
await assert.rejects(q1('SELECT public.staff_person_overview($1) r', [U.xia]), /只有总经理/, '普通员工看不到个人看板');
// 总经理给小霞加「兼任财务」、给阿强加「兼任监理」
await as(U.gm);
await db.query(`UPDATE profiles SET extra_roles='{finance}' WHERE id='${U.xia}'`);
await db.query(`UPDATE profiles SET extra_roles='{supervisor}' WHERE id='${U.sup}'`);
await as(U.xia); assert.equal((await q1('SELECT public._is_finance() f')).f, true, '兼任财务有财务权限');
assert.ok((await q1('SELECT public.renovation_supervisor_candidates() r')).r.some(x => x.id === U.sup), '兼任监理出现在指定名单');
await as(U.sup); assert.equal((await q1('SELECT public._reno_plan_editor($1) r', [P1])).r, true, '被指定工地的兼任监理能调整施工计划');

// 个人看板（11 月）
await as(U.gm);
const v = (await q1('SELECT public.staff_person_overview($1,$2) r', [U.xia, '2026-11-20'])).r;
assert.equal(v.month, '2026-11'); assert.deepEqual(v.person.extra_roles, ['finance']);
assert.equal(v.goods.created, 1, '只算 11 月开的单'); assert.equal(v.goods.open, 1, '已完成的不算进行中');
assert.equal(Number(v.goods_amount.MYR), 5000); assert.equal(Number(v.goods_received.MYR), 3000);
assert.equal(v.renovation.signed, 1); assert.equal(Number(v.renovation.signed_amount), 80000); assert.equal(Number(v.renovation.received), 24000);
assert.equal(v.quotes.links, 2); assert.equal(v.quotes.opened, 1); assert.equal(Number(v.quotes.views), 3);
assert.ok(v.recent.some(r => r.text.includes('001-1')), '最近动态有订单记录');
const s = (await q1('SELECT public.staff_person_overview($1,$2) r', [U.sup, '2026-11-01'])).r;
assert.equal(s.supervision.sites, 1); assert.equal(s.supervision.log_days, 2); assert.equal(s.supervision.open_issues, 1);
const list = (await q1('SELECT public.staff_people_list() r')).r; assert.equal(list.length, 3);
await db.close();
console.log('staff extra roles: only GM changes roles, extra finance/supervisor work, person dashboard by month passed');
