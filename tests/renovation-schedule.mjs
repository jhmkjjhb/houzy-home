// 履约进度表：计划日期的保存规则、业主看到的简版进度表、下单不再要求执行人。
import fs from 'node:fs';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();let checks=0;
const ok=(v,m)=>{assert(v,m);checks++;};const reject=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
const store='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const staff='20000000-0000-4000-8000-000000000001',manager='20000000-0000-4000-8000-000000000002',colleague='20000000-0000-4000-8000-000000000003',outsider='20000000-0000-4000-8000-000000000004',legacyOwner='20000000-0000-4000-8000-000000000005',customerUser='20000000-0000-4000-8000-000000000006',supplierUser='20000000-0000-4000-8000-000000000007';
const id='30000000-0000-4000-8000-000000000001',oldId='30000000-0000-4000-8000-000000000002';
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth,storage TO authenticated,anon;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
CREATE TABLE stores(id uuid PRIMARY KEY,name text,region text);CREATE TABLE profiles(id uuid PRIMARY KEY,name text DEFAULT '',active boolean,role text,store_id uuid,region text,phone text);
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT SELECT,INSERT ON storage.objects TO authenticated,anon;
INSERT INTO stores VALUES('${store}','Austin','JB'),('${other}','Other','KL');
INSERT INTO profiles(id,name,active,role,store_id,region,phone) VALUES('${staff}','Ali',true,'staff','${store}','JB','+60 11'),('${manager}','Mei',true,'store_manager','${store}','JB','+60 22'),('${colleague}','Bo',true,'staff','${store}','JB','+60 33'),('${outsider}','Out',true,'staff','${other}','KL',null),('${legacyOwner}','Old',true,'staff','${store}','JB',null),('${customerUser}','Cust',true,'customer',null,null,null),('${supplierUser}','Sup',true,'supplier',null,null,null);`);
for(const name of ['renovation_orders','renovation_payments','renovation_payment_installments','renovation_phone_lookup','renovation_customer_orders','renovation_additions','renovation_addition_signatures','renovation_signing_link','renovation_payment_allocations','renovation_customer_progress','renovation_deductions','renovation_partial_deductions','renovation_contract_esign','renovation_installment_statements','renovation_statement_contact'])
 await db.exec(fs.readFileSync(`supabase/${name}_migration.sql`,'utf8'));
// Performance reports need tables outside this test, so they are stubbed. The real files must still contain the text the migration patches.
ok(fs.readFileSync('supabase/dashboard_kpis_renovation_migration.sql','utf8').includes('SELECT p.id, p.created_by, p.current_total'),'KPI patch target exists');
ok(fs.readFileSync('supabase/store_performance_renovation_migration.sql','utf8').includes('OR p.created_by=a.id'),'performance patch target exists');
await db.exec(`CREATE FUNCTION public._dash_kpi_period(date,date,integer,uuid,text) RETURNS text LANGUAGE plpgsql AS $f$BEGIN RETURN 'SELECT p.id, p.created_by, p.current_total';END$f$;
CREATE FUNCTION public.get_store_performance(date,date,uuid,boolean) RETURNS text LANGUAGE plpgsql AS $f$BEGIN RETURN 'OR p.created_by=a.id';END$f$;`);
const lines=[{id:'C1',name:'衣柜',spec:'白色',qty:1,rate:1000,kind:'custom',group:'全屋定制',unit:'lot',warranties:[]},{id:'C2',name:'地柜',spec:'灰色',qty:2,rate:500,kind:'custom',group:'全屋定制',unit:'lot',warranties:[]},{id:'S1',name:'龙头',qty:1,rate:100,kind:'stock',group:'全屋定制',unit:'pc',warranties:[]},{id:'W1',name:'铺砖',qty:1,rate:100,kind:'work',group:'泥水',unit:'lot',warranties:[]},{id:'G1',name:'设计',qty:1,rate:0,kind:'gift',group:'赠品',unit:'项',warranties:[]},{id:'W2',name:'拆除',qty:1,rate:200,kind:'work',group:'拆除',unit:'lot',warranties:[]}];
const snap=JSON.stringify({net:2400,discount:0,payments:[{name:'全款',amount:2400}],lines});
// A project already running before the migration, with an order placed outside the system.
await db.query(`INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address,state,snapshot) VALUES($1,$2,$3,'OLD','Owner','60101234567','Addr','executing',$4::jsonb)`,[oldId,store,legacyOwner,JSON.stringify({net:1000,discount:0,payments:[{name:'全款',amount:1000}],lines:[lines[0],lines[3]]})]);
await db.query(`INSERT INTO renovation_work_orders(project_id,group_name,line_ids,assignee,status) VALUES($1,'全屋定制','["C1"]'::jsonb,'师傅','working'),($1,'泥水','["W1"]'::jsonb,'工长','done')`,[oldId]);
const migration=fs.readFileSync('supabase/renovation_fulfillment_migration.sql','utf8');await db.exec(migration);await db.exec(migration);checks++;
await db.exec(`INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address,state,snapshot) VALUES('${id}','${store}','${staff}','NEW','Owner','60101234567','Addr','executing','${snap}'::jsonb);
INSERT INTO renovation_work_orders(project_id,group_name,line_ids) VALUES('${id}','全屋定制','["C1","C2","S1"]'::jsonb),('${id}','泥水','["W1"]'::jsonb),('${id}','赠品','["G1"]'::jsonb),('${id}','拆除','["W2"]'::jsonb);
INSERT INTO storage.objects(bucket_id,name) VALUES('renovation-fulfillment','${id}/d1.pdf'),('renovation-fulfillment','${id}/d2.pdf'),('renovation-fulfillment','${id}/d3.pdf'),('renovation-fulfillment','${id}/paper.pdf'),('renovation-fulfillment','${id}/photo.jpg');`);
const HASH='a'.repeat(64),today=(await db.query("select (now() at time zone 'Asia/Kuala_Lumpur')::date::text d")).rows[0].d,later='2099-01-01';
const strokes=[[[0.1,0.1],[0.2,0.2],[0.3,0.3],[0.4,0.4],[0.5,0.5],[0.6,0.6],[0.7,0.7],[0.8,0.8],[0.9,0.9]]];
const actor=async(who,role='authenticated')=>db.exec(`RESET ROLE;SET request.jwt.claim.sub='${who}';SET ROLE ${role}`);
const sys=async(sql,args=[])=>{await db.exec('RESET ROLE');return (await db.query(sql,args)).rows;};
const rev=async(p=id)=>(await sys('SELECT revision FROM renovation_projects WHERE id=$1',[p]))[0].revision;
const wo=async(name,p=id)=>(await sys('SELECT * FROM renovation_work_orders WHERE project_id=$1 AND group_name=$2',[p,name]))[0];
const items=async(p=id)=>Object.fromEntries((await sys('SELECT * FROM renovation_work_items WHERE project_id=$1',[p])).map(i=>[i.line_id,i]));
async function run(who,action,data,p=id){const r=await rev(p);await actor(who);return (await db.query('SELECT renovation_fulfillment_command($1,$2,$3,$4::jsonb) v',[p,r,action,JSON.stringify(data)])).rows[0].v;}

// 要保证：1) 只有本项目有权限的员工能改计划；2) 日期必须成对、完成不早于开始；3) 业主看到的只有名称、日期和完成项数，没有厂家、单号、价格；
// 4) 下单不再卡执行人，但排期、完工仍然要执行人（师傅是谁要清楚）；5) 迁移可以重复跑，不重复改函数。
const sm=fs.readFileSync('supabase/renovation_schedule_migration.sql','utf8');await db.exec('RESET ROLE');await db.exec(sm);await db.exec(sm);checks++;
const custom=await wo('全屋定制'),masonry=await wo('泥水');
async function save(who,plans){await actor(who);return (await db.query('SELECT renovation_schedule_save($1,$2::jsonb) v',[id,JSON.stringify(plans)])).rows[0].v;}
ok((await save(staff,[{work_order_id:masonry.id,start:'2026-12-01',end:'2026-12-10'},{work_order_id:custom.id,start:'2026-12-15',end:'2026-12-18'}])).count===2,'staff saves plans');
ok((await wo('泥水')).planned_end.toISOString().slice(0,10)==='2026-12-10','plan stored');
await reject(()=>save(outsider,[{work_order_id:masonry.id,start:'2026-12-01',end:'2026-12-02'}]),/无此项目权限/);
await reject(()=>save(staff,[{work_order_id:masonry.id,start:'2026-12-10',end:'2026-12-01'}]),/不能早于开始/);
await reject(()=>save(staff,[{work_order_id:masonry.id,start:'2026-12-10'}]),/同时填/);
await reject(()=>save(staff,[{work_order_id:masonry.id,start:'2026-13-40',end:'2026-12-01'}]),/格式不对/);
await reject(()=>save(staff,[{work_order_id:'00000000-0000-4000-8000-000000000000',start:'2026-12-01',end:'2026-12-02'}]),/不存在/);
await reject(async()=>{await actor(staff,'anon');await db.query(`SELECT renovation_schedule_save($1,'[]'::jsonb)`,[id]);},/permission denied/);
ok((await save(staff,[{work_order_id:custom.id,start:null,end:null}])).count===1&&(await wo('全屋定制')).planned_start===null,'plan can be cleared');
ok((await sys(`SELECT count(*)::int n FROM renovation_audit WHERE action='schedule_saved'`))[0].n===2,'every save is in the history');
// 业主简版
await run(staff,'request_signature',{work_order_id:custom.id,document_path:`${id}/d1.pdf`,document_sha256:HASH});
const token=(await sys('SELECT customer_token FROM renovation_projects WHERE id=$1',[id]))[0].customer_token;
await actor(staff,'anon');const view=(await db.query('SELECT renovation_customer_schedule($1) v',[token])).rows[0].v;
ok(view.length===4&&view[0].name==='泥水'&&view[0].planned_start==='2026-12-01'&&view[0].total===1&&view[0].done===0,'owner sees plan per sub-order, planned first');
ok(!/supplier|order_no|rate|amount|assignee|note/.test(JSON.stringify(view)),'owner sees no supplier, order no, price, worker or notes');
await actor(staff,'anon');ok((await db.query('SELECT renovation_customer_schedule($1) v',['00000000-0000-4000-8000-000000000000'])).rows[0].v.length===0,'wrong link shows nothing');
// 下单不再要求执行人；排期仍要求
ok(!(await wo('全屋定制')).assignee,'test starts without a worker');
await run(staff,'place_order',{work_order_id:custom.id,line_ids:['S1'],supplier:'厂家A',order_no:'',ordered_on:today,expected_on:later,stock_confirmed:true});
ok((await items()).S1.stage==='ordered','stock ordered without a worker');
await reject(()=>run(staff,'schedule',{work_order_id:masonry.id,on:later}),/先指定执行人/);
await reject(()=>run(staff,'place_order',{work_order_id:custom.id,line_ids:['C1'],supplier:'厂家A',order_no:'X',ordered_on:today,expected_on:later}),/业主签名/);
const fn=(await sys(`SELECT pg_get_functiondef('public.renovation_fulfillment_command(uuid,integer,text,jsonb)'::regprocedure) d`))[0].d;
ok((fn.match(/先指定执行人/g)||[]).length===2,'only the order check removed; schedule and finish keep theirs');
await db.exec('RESET ROLE');await db.exec(sm);const fn2=(await sys(`SELECT pg_get_functiondef('public.renovation_fulfillment_command(uuid,integer,text,jsonb)'::regprocedure) d`))[0].d;ok((fn2.match(/先指定执行人/g)||[]).length===2&&(await wo('泥水')).planned_end!==null,'re-run keeps plans and does not re-patch');
console.log(`PASS ${checks} schedule checks`);
