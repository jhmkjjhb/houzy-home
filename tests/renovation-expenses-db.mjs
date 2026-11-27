// 整装支出与财务：每笔必须有单据；RM 500 以下直接给财务、以上要店长批；只有财务能付款；
// 店员 / 监理只看自己的请款、看不到利润；店长只看本店；财务看全部；利润按项目和子订单算对。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const U = { staff: '11111111-1111-4111-8111-111111111111', mgr: '22222222-2222-4222-8222-222222222222', fin: '33333333-3333-4333-8333-333333333333', sup: '44444444-4444-4444-8444-444444444444', mgr2: '55555555-5555-4555-8555-555555555555', other: '66666666-6666-4666-8666-666666666666' };
const S1 = 'aaaaaaaa-0000-4000-8000-000000000001', S2 = 'aaaaaaaa-0000-4000-8000-000000000002', P1 = 'bbbbbbbb-0000-4000-8000-000000000001', W1 = 'cccccccc-0000-4000-8000-000000000001', W2 = 'cccccccc-0000-4000-8000-000000000002';
await db.exec(`
 CREATE ROLE authenticated; CREATE ROLE anon;
 CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated, anon;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
 CREATE SCHEMA storage; GRANT USAGE ON SCHEMA storage TO authenticated, anon;
 CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(), bucket_id text, name text);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT SELECT, INSERT ON storage.objects TO authenticated;
 CREATE TABLE public.stores(id uuid PRIMARY KEY, name text, region text, active boolean DEFAULT true);
 CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text NOT NULL CHECK (role IN ('staff','store_manager','regional_manager','general_manager','admin','superadmin','supervisor','customer')), store_id uuid, region text, active boolean DEFAULT true, name text DEFAULT '');
 CREATE TABLE public.renovation_projects(id uuid PRIMARY KEY, store_id uuid, created_by uuid, contract_no text, customer_name text, address text, state text, snapshot jsonb, current_total numeric, created_at timestamptz DEFAULT now());
 CREATE TABLE public.renovation_work_orders(id uuid PRIMARY KEY, project_id uuid, group_name text, line_ids jsonb, assignee text DEFAULT '', cancelled_at timestamptz);
 CREATE TABLE public.renovation_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid, kind text, amount numeric, paid_on date, voided_at timestamptz);
 CREATE TABLE public.renovation_site_supervisors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid, profile_id uuid, active boolean, kind text);
`);
const orders = await readFile(new URL('../supabase/renovation_orders_migration.sql', import.meta.url), 'utf8');
await db.exec(orders.slice(orders.indexOf('CREATE OR REPLACE FUNCTION public._reno_access'), orders.indexOf('ALTER TABLE public.renovation_projects ENABLE')));
await db.exec(`
 INSERT INTO auth.users SELECT unnest(ARRAY['${Object.values(U).join("','")}'])::uuid;
 INSERT INTO stores VALUES ('${S1}','Austin','south',true),('${S2}','Singapore','sg',true);
 INSERT INTO profiles VALUES ('${U.staff}','staff','${S1}','south',true,'阿华'),('${U.mgr}','store_manager','${S1}','south',true,''),('${U.fin}','staff',NULL,NULL,true,''),('${U.sup}','supervisor',NULL,NULL,true,''),('${U.mgr2}','store_manager','${S2}','sg',true,''),('${U.other}','staff','${S1}','south',true,'');
 INSERT INTO renovation_projects VALUES ('${P1}','${S1}','${U.staff}','C-1','Ali','JB','executing','{"net":10000,"lines":[{"id":"L1","qty":2,"rate":3000},{"id":"L2","qty":1,"rate":4000}]}',10000);
 INSERT INTO renovation_work_orders VALUES ('${W1}','${P1}','水电','["L1"]',''),('${W2}','${P1}','橱柜','["L2"]','');
 INSERT INTO renovation_payments(project_id,kind,amount,paid_on) VALUES ('${P1}','receipt',6000,'2026-11-10'),('${P1}','refund',500,'2026-11-12');
 INSERT INTO renovation_site_supervisors(project_id,profile_id,active,kind) VALUES ('${P1}','${U.sup}',true,'internal');
`);
const sql = await readFile(new URL('../supabase/renovation_expenses_migration.sql', import.meta.url), 'utf8');
await db.exec(sql); await db.exec(sql); // 可重复执行
await db.exec(`UPDATE profiles SET role='finance' WHERE id='${U.fin}'`); // 新角色能用

const as = async who => db.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '${who}';`);
const root = () => db.exec('RESET ROLE');
const doc = async (who, n = 'r1.jpg') => { await root(); const p = `${who}/${n}`; await db.query(`INSERT INTO storage.objects(bucket_id,name) VALUES ('renovation-expenses',$1)`, [p]); return p; };
const submit = d => db.query('SELECT r.* FROM public.renovation_expense_submit($1::jsonb) r', [JSON.stringify(d)]).then(r => r.rows[0]);
const act = (id, a, d = {}) => db.query('SELECT r.* FROM public.renovation_expense_act($1,$2,$3::jsonb) r', [id, a, JSON.stringify(d)]).then(r => r.rows[0]);
const overview = () => db.query('SELECT public.renovation_finance_overview() AS r').then(r => r.rows[0].r);
const count = () => db.query('SELECT count(*)::int n FROM public.renovation_expenses').then(r => r.rows[0].n);

// 店员给自己的单请款：没单据交不了
const sdoc = await doc(U.staff); await as(U.staff);
await assert.rejects(submit({ project_id: P1, work_order_id: W1, category: 'material', payee: '五金店', amount: 300, doc_type: 'receipt', docs: [] }), /必须上传/);
await assert.rejects(submit({ project_id: P1, category: 'material', payee: 'X', amount: 300, doc_type: 'receipt', docs: [`${U.other}/x.jpg`] }), /还没上传好/, '不能用别人的单据');
const small = await submit({ project_id: P1, work_order_id: W1, category: 'material', payee: '五金店', amount: 300, doc_type: 'receipt', docs: [sdoc] });
assert.equal(small.status, 'approved', 'RM 500 以下直接给财务');
const bdoc = await doc(U.staff, 'inv.jpg'); await as(U.staff);
const big = await submit({ project_id: P1, work_order_id: W2, category: 'subcontract', payee: '橱柜厂', amount: 3000, sst: 180, doc_type: 'invoice', docs: [bdoc] });
assert.equal(big.status, 'pending', '超过 RM 500 要店长批');
await assert.rejects(act(big.id, 'approve'), /店长/, '店员不能自己批');
await assert.rejects(act(small.id, 'pay', { paid_ref: 'x' }), /只有财务/, '店员不能标付款');
await assert.rejects(submit({ store_id: S1, category: 'overhead', payee: '房东', amount: 3000, doc_type: 'invoice', docs: [sdoc] }), /店长或财务/, '店员不能记门店开销');
assert.deepEqual(await overview(), { projects: [], months: [] }, '店员看不到利润');

// 同一张单据拆成两笔 RM 400：合计 800，两笔都要店长批
const sdoc2 = await doc(U.staff, 'r2.jpg'); await as(U.staff);
const s1 = await submit({ project_id: P1, work_order_id: W1, category: 'material', payee: '瓷砖店', amount: 400, doc_type: 'receipt', docs: [sdoc2] });
assert.equal(s1.status, 'approved');
const s2 = await submit({ project_id: P1, work_order_id: W2, category: 'material', payee: '瓷砖店', amount: 400, doc_type: 'receipt', docs: [sdoc2] });
assert.equal(s2.status, 'pending', '拆开的第二笔要批');
assert.equal((await db.query('SELECT status FROM public.renovation_expenses WHERE id=$1', [s1.id])).rows[0].status, 'pending', '第一笔也改回待批');
await act(s1.id, 'void'); await act(s2.id, 'void');
// 别的店员看不到这些请款；监理能给自己的工地请款
const odoc = await doc(U.other); await as(U.other); assert.equal(await count(), 0);
await assert.rejects(submit({ project_id: P1, category: 'material', payee: 'X', amount: 10, doc_type: 'receipt', docs: [odoc] }), /没有这个项目的权限/, '不是自己的单不能请款');
const vdoc = await doc(U.sup); await as(U.sup);
const lab = await submit({ project_id: P1, work_order_id: W1, category: 'labour', payee: '阿明', amount: 400, doc_type: 'voucher', docs: [vdoc] });
assert.equal(lab.status, 'approved'); assert.equal(await count(), 1, '监理只看到自己的');

// 别店店长批不了；本店店长能批，能记门店开销
await as(U.mgr2); await assert.rejects(act(big.id, 'approve'), /店长/); assert.equal(await count(), 0, '别店店长看不到');
const mdoc = await doc(U.mgr); await as(U.mgr);
assert.equal((await act(big.id, 'approve')).status, 'approved');
const rent = await submit({ store_id: S1, payee: '房东', amount: 3500, doc_type: 'invoice', docs: [mdoc] });
assert.equal(rent.category, 'overhead');
await as(U.mgr); await assert.rejects(act(rent.id, 'pay', { paid_ref: 'x' }), /只有财务/, '店长不能标付款');
await act(rent.id, 'approve');

// 财务付款：要凭证
await as(U.fin); assert.equal(await count(), 6, '财务看到所有请款（含 2 笔已撤回）');
await assert.rejects(act(big.id, 'pay', {}), /转账截图|参考号/);
assert.equal((await act(big.id, 'pay', { paid_ref: 'MBB123', paid_on: '2026-11-20' })).status, 'paid');
await assert.rejects(act(big.id, 'void'), /不能撤回/, '已付的不能撤回');

// 财务直接登记已付的材料款：不用批，直接已付；店员不能这样登记
const fdoc = await doc(U.fin, 'mat.jpg'); await as(U.fin);
await assert.rejects(submit({ project_id: P1, work_order_id: W2, category: 'material', payee: '板材厂', amount: 2000, doc_type: 'invoice', docs: [fdoc], paid: true }), /参考号/);
const direct = await submit({ project_id: P1, work_order_id: W2, category: 'material', payee: '板材厂', amount: 2000, doc_type: 'invoice', docs: [fdoc], paid: true, paid_ref: 'CIMB9', paid_on: '2026-11-21' });
assert.equal(direct.status, 'paid'); assert.equal(direct.paid_ref, 'CIMB9');
const sdoc3 = await doc(U.staff, 'x3.jpg'); await as(U.staff);
await assert.rejects(submit({ project_id: P1, category: 'material', payee: 'X', amount: 100, doc_type: 'receipt', docs: [sdoc3], paid: true, paid_ref: 'x' }), /只有财务/);
await as(U.fin);
const o = await overview(), p = o.projects[0];
assert.equal(Number(p.contract), 10000); assert.equal(Number(p.received), 5500, '已收 = 收款 − 退款');
assert.equal(Number(p.committed), 5700, '支出 = 300 + 3000 + 400 + 财务直付 2000'); assert.equal(Number(p.paid), 5000);
const w1 = p.work_orders.find(w => w.name === '水电'), w2 = p.work_orders.find(w => w.name === '橱柜');
assert.equal(Number(w1.contract), 6000); assert.equal(Number(w1.committed), 700);
assert.equal(Number(w2.contract), 4000); assert.equal(Number(w2.committed), 5000);
const m = o.months.find(x => x.store_id === S1);
assert.equal(Number(m.overhead), 3500, '门店开销单独一栏'); assert.equal(Number(m.income), 5500);

// 列表：店长只看到本店待批的；财务待付里没有已付的；店员 mine 只有自己的

const list = (scope) => db.query('SELECT public.renovation_expense_list($1) AS r', [scope]).then(r => r.rows[0].r);
await as(U.fin); assert.ok((await list('pay')).every(x => x.status === 'approved')); assert.equal((await list('all')).length, 7);
await as(U.mgr2); assert.equal((await list('all')).length, 0);
await as(U.staff); assert.ok((await list('mine')).every(x => x.created_by === U.staff)); assert.equal((await list('approve')).length, 0);
// 单据照片：财务能看，别的店员看不到
await as(U.fin); assert.equal((await db.query('SELECT count(*)::int n FROM storage.objects WHERE bucket_id=$1', ['renovation-expenses'])).rows[0].n >= 3, true);
await as(U.other); assert.equal((await db.query(`SELECT count(*)::int n FROM storage.objects WHERE name LIKE '${U.staff}/%'`)).rows[0].n, 0);
await db.close();
console.log('renovation expenses: receipts required, RM500 approval, finance-only pay, store/role isolation, profit by project and sub-order passed');
