// 施工计划：交房日、师傅名单、跨工地撞期。
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

// 要保证：1) 交房日只有本项目员工能改，留历史；2) 师傅名单只有店长及以上能改，店长只能改本店，不能同名；
// 3) 撞期检查能查到别的项目（含别的门店）里同一位师傅、日期有计划的子单，已全部完成的不算；只给合同号、子单名、日期。
const sm=fs.readFileSync('supabase/renovation_schedule_migration.sql','utf8'),pm=fs.readFileSync('supabase/renovation_planning_migration.sql','utf8');
await db.exec('RESET ROLE');await db.exec(sm);await db.exec(pm);await db.exec(pm);checks++;
const call=async(who,sql,args)=>{await actor(who);return (await db.query(sql,args)).rows[0].v;};
ok((await call(staff,'SELECT renovation_handover_date_save($1,$2) v',[id,'2027-02-28'])).ok,'staff sets handover date');
ok((await sys('SELECT handover_on::text d FROM renovation_projects WHERE id=$1',[id]))[0].d==='2027-02-28','stored');
await reject(()=>call(outsider,'SELECT renovation_handover_date_save($1,$2) v',[id,'2027-02-28']),/无此项目权限/);
ok((await sys(`SELECT count(*)::int n FROM renovation_audit WHERE action='handover_date_saved'`))[0].n===1,'handover change in history');
// 师傅名单
await reject(()=>call(staff,'SELECT renovation_crew_save(NULL,$1::jsonb) v',[JSON.stringify({name:'阿强',trade:'泥水工'})]),/店长或上级/);
const crew=await call(manager,'SELECT renovation_crew_save(NULL,$1::jsonb) v',[JSON.stringify({name:'阿强',trade:'泥水工',phone:'012',headcount:3})]);
ok(!!crew,'manager adds a crew');
await reject(()=>call(manager,'SELECT renovation_crew_save(NULL,$1::jsonb) v',[JSON.stringify({name:' 阿强 ',trade:'泥水工'})]),/同名/);
await reject(()=>call(manager,'SELECT renovation_crew_save(NULL,$1::jsonb) v',[JSON.stringify({name:'别店',trade:'木工',store_id:other})]),/本店/);
await actor(staff);ok((await db.query('SELECT count(*)::int n FROM renovation_crews')).rows[0].n===1,'staff of the store can read the list');
await actor(staff,'anon');await reject(async()=>{await db.query('SELECT * FROM renovation_crews');},/permission denied/);
// 撞期：另一个门店的项目里也排了阿强
const p2='30000000-0000-4000-8000-000000000099';
await sys(`INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address,state,snapshot) VALUES($1,$2,$3,'OTHER-1','X','6011','Addr','executing',$4::jsonb)`,[p2,other,outsider,snap]);
await sys(`INSERT INTO renovation_work_orders(project_id,group_name,line_ids,assignee,planned_start,planned_end) VALUES($1,'泥水','["W1"]'::jsonb,'阿强','2026-12-03','2026-12-09'),($1,'拆除','["W2"]'::jsonb,'阿强','2026-11-01','2026-11-02')`,[p2]);
await sys(`UPDATE renovation_work_items SET stage='done' WHERE work_order_id=(SELECT id FROM renovation_work_orders WHERE project_id=$1 AND group_name='拆除')`,[p2]);
const busy=await call(staff,'SELECT renovation_crew_busy($1::jsonb,$2) v',[JSON.stringify(['阿强']),id]);
ok(busy.length===1&&busy[0].contract_no==='OTHER-1'&&busy[0].start==='2026-12-03','finds the other site, skips finished work');
ok(!/customer|phone|address|Owner|X'/.test(JSON.stringify(busy).replace('OTHER-1','')),'only contract no, sub-order and dates');
ok((await call(staff,'SELECT renovation_crew_busy($1::jsonb,$2) v',[JSON.stringify(['阿强']),p2])).length===0,'own project excluded');
await db.exec('RESET ROLE');await db.exec(pm);ok((await sys('SELECT count(*)::int n FROM renovation_crews'))[0].n===1,'re-run keeps crews');
// 按工序保存：一道工序一个日期；第一次保存的成为原计划，之后不变；子单日期按工序推算；每次改动记录前后日期和谁改的
{const ph=fs.readFileSync('supabase/renovation_phase_plan_migration.sql','utf8');await db.exec('RESET ROLE');await db.exec(ph);await db.exec(ph);
 const save=(who,plan,work)=>call(who,'SELECT renovation_phase_plan_save($1,$2::jsonb,$3::jsonb) v',[id,JSON.stringify(plan),JSON.stringify(work||[])]);
 const w=(await sys(`SELECT id FROM renovation_work_orders WHERE project_id=$1 AND group_name='泥水'`,[id]))[0].id;
 await reject(()=>save(outsider,{mep:{start:'2026-12-01',end:'2026-12-05'}}),/无此项目权限/);
 await reject(()=>save(staff,{roof:{start:'2026-12-01',end:'2026-12-05'}}),/不认识的工序/);
 await reject(()=>save(staff,{mep:{start:'2026-12-05',end:'2026-12-01'}}),/结束不能早于开始/);
 await save(staff,{mep:{start:'2026-12-01',end:'2026-12-05'},masonry:{start:'2026-12-07',end:'2026-12-12'}},[{work_order_id:w,start:'2026-12-07',end:'2026-12-12'}]);
 let r=(await sys('SELECT phase_plan,phase_baseline FROM renovation_projects WHERE id=$1',[id]))[0];
 ok(r.phase_plan.masonry.start==='2026-12-07'&&r.phase_baseline.masonry.end==='2026-12-12','first save is also the original plan');
 ok((await sys('SELECT planned_start::text s FROM renovation_work_orders WHERE id=$1',[w]))[0].s==='2026-12-07','sub-order dates follow the phase');
 await save(staff,{masonry:{start:'2026-12-09',end:'2026-12-14'},paint:{start:'2026-12-15',end:'2026-12-20'}});
 r=(await sys('SELECT phase_plan,phase_baseline FROM renovation_projects WHERE id=$1',[id]))[0];
 ok(r.phase_baseline.masonry.end==='2026-12-12'&&r.phase_plan.masonry.end==='2026-12-14','later changes keep the original plan');
 ok(r.phase_baseline.paint?.start==='2026-12-15','a phase planned for the first time is added to the original plan');
 const lg=(await sys(`SELECT payload FROM renovation_audit WHERE project_id=$1 AND action='phase_plan_saved' ORDER BY created_at DESC LIMIT 1`,[id]))[0].payload;
 ok(lg.by==='Ali'&&lg.changes.some(x=>x.phase==='masonry'&&x.before_end==='2026-12-12'&&x.end==='2026-12-14'),'the change log keeps who and from-to dates: '+JSON.stringify(lg));
 await save(staff,{mep:{start:'2026-12-01',end:'2026-12-05'}});
 ok((await sys(`SELECT count(*)::int n FROM renovation_audit WHERE project_id=$1 AND action='phase_plan_saved'`,[id]))[0].n===2,'saving without a change adds no log line');}
console.log(`PASS ${checks} planning checks`);
