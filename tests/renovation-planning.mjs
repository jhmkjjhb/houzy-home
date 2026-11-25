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
// 预计 / 实时：确认前预计跟着实时走；店长确认后锁定，实时再改预计不变；改预计只有店长、必须写原因；业主只看到确认后的预计 + 完成情况
{const fm=fs.readFileSync('supabase/renovation_phase_forecast_migration.sql','utf8');await db.exec('RESET ROLE');await db.exec(fs.readFileSync('supabase/renovation_site_supervision_migration.sql','utf8'));await db.exec(fm);await db.exec(fm);
 const w=(await sys(`SELECT id FROM renovation_work_orders WHERE project_id=$1 AND group_name='泥水'`,[id]))[0].id;
 const live=(who,plan,extra={})=>call(who,'SELECT renovation_phase_plan_save($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb) v',[id,JSON.stringify(plan),'[]',extra.lines?JSON.stringify(extra.lines):null,extra.delays?JSON.stringify(extra.delays):null]);
 const proj=async()=>(await sys('SELECT phase_plan,phase_baseline,phase_baseline_locked_at,phase_delays_applied FROM renovation_projects WHERE id=$1',[id]))[0];
 const token=(await sys('SELECT customer_token FROM renovation_projects WHERE id=$1',[id]))[0].customer_token;
 const owner=async()=>{await actor(staff,'anon');return (await db.query('SELECT renovation_customer_schedule($1) v',[token])).rows[0].v;};
 await live(staff,{masonry:{start:'2026-12-10',end:'2026-12-16'}},{lines:{masonry:[[w,'W1']]}});
 let r=await proj();ok(r.phase_baseline.masonry.end==='2026-12-16','before confirmation the forecast follows the live plan');
 ok((await owner()).length===0,'owner sees no schedule until the store manager confirms it');
 await reject(()=>call(staff,'SELECT renovation_phase_baseline_confirm($1) v',[id]),/只有店长/);
 await call(manager,'SELECT renovation_phase_baseline_confirm($1) v',[id]);
 await reject(()=>call(manager,'SELECT renovation_phase_baseline_confirm($1) v',[id]),/已经确认过/);
 await live(staff,{masonry:{start:'2026-12-10',end:'2026-12-19'}});
 r=await proj();ok(r.phase_plan.masonry.end==='2026-12-19'&&r.phase_baseline.masonry.end==='2026-12-16','after confirmation live changes leave the forecast alone');
 let o=await owner();const om=o.find(x=>x.name==='泥水');
 ok(om&&om.planned_end==='2026-12-16'&&om.total===1&&om.done===0,'owner sees the confirmed forecast per phase: '+JSON.stringify(o));
 ok(!/supplier|order_no|rate|amount|assignee|note|reason/.test(JSON.stringify(o)),'owner sees no supplier, price, worker or internal notes');
 await sys(`UPDATE renovation_work_items SET stage='done' WHERE project_id=$1 AND line_id='W1'`,[id]);
 ok((await owner()).find(x=>x.name==='泥水').done===1,'owner sees the phase as done when its items are done');
 const change=(who,plan,why)=>call(who,'SELECT renovation_phase_baseline_change($1,$2::jsonb,$3) v',[id,JSON.stringify(plan),why]);
 await reject(()=>change(staff,{masonry:{start:'2026-12-10',end:'2026-12-20'}},'业主加项'),/只有店长/);
 await reject(()=>change(manager,{masonry:{start:'2026-12-10',end:'2026-12-20'}},' '),/原因/);
 await change(manager,{masonry:{start:'2026-12-10',end:'2026-12-20'}},'业主加项');
 ok((await proj()).phase_baseline.masonry.end==='2026-12-20','manager changes the forecast');
 const lg=(await sys(`SELECT payload FROM renovation_audit WHERE project_id=$1 AND action='phase_baseline_changed'`,[id]))[0].payload;
 ok(lg.reason==='业主加项'&&lg.by==='Mei'&&lg.changes[0].before_end==='2026-12-16','forecast change log keeps who, why and from-to');
 // 监理延误自动顺延：同一条延误只顺延一次（两个页面同时打开也不会重复推）
 const sup=(await sys(`INSERT INTO renovation_site_supervisors(project_id,kind,name,access_code,created_by) VALUES($1,'external','外部监理','1234','${staff}') RETURNING id`,[id]))[0].id;
 const dl=(await sys(`INSERT INTO renovation_site_entries(project_id,supervisor_id,work_order_id,kind,data,status) VALUES($1,$2,$3,'delay','{"days":3,"reason":"crew"}','open') RETURNING id`,[id,sup,w]))[0].id;
 await live(staff,{masonry:{start:'2026-12-10',end:'2026-12-22'}},{delays:[dl]});
 const again=await live(staff,{masonry:{start:'2026-12-10',end:'2026-12-25'}},{delays:[dl]});
 r=await proj();ok(again.skipped&&r.phase_plan.masonry.end==='2026-12-22'&&r.phase_delays_applied.includes(dl),'a delay is applied once only');
 ok((await sys(`SELECT payload FROM renovation_audit WHERE project_id=$1 AND action='phase_plan_saved' ORDER BY created_at DESC LIMIT 1`,[id]))[0].payload.auto_delay?.length===1,'auto shift is marked in the change log');}
// 子单固定总天数：有权限的员工才能改；1–365 天或留空；每次改动记下谁、从几天改到几天
{await db.exec('RESET ROLE');const dm=fs.readFileSync('supabase/renovation_work_order_days_migration.sql','utf8');await db.exec(dm);await db.exec(dm);
 const w=(await sys(`SELECT id FROM renovation_work_orders WHERE project_id=$1 AND group_name='全屋定制'`,[id]))[0].id;
 const days=(who,n)=>call(who,'SELECT renovation_work_order_days_save($1,$2) v',[w,n]);
 await reject(()=>days(outsider,45),/无此项目权限/);await reject(()=>days(staff,0),/1 到 365/);await reject(()=>days(staff,400),/1 到 365/);
 await days(staff,45);ok((await sys('SELECT fixed_days FROM renovation_work_orders WHERE id=$1',[w]))[0].fixed_days===45,'staff set 45 days');
 ok((await days(staff,45)).changed===false,'saving the same number again changes nothing');
 await days(staff,null);ok((await sys('SELECT fixed_days FROM renovation_work_orders WHERE id=$1',[w]))[0].fixed_days===null,'cleared back to not fixed');
 const lg=(await sys(`SELECT payload FROM renovation_audit WHERE project_id=$1 AND action='work_order_days_saved' ORDER BY created_at`,[id])).map(r=>r.payload);
 ok(lg.length===2&&lg[0].days===45&&lg[0].by==='Ali'&&lg[1].before===45&&lg[1].days===null,'days changes are logged: '+JSON.stringify(lg));}
// 水路、电路分开：新工序名能保存；旧项目的「水电」(mep) 照样能存；师傅名单能选水管工、电工
{await db.exec('RESET ROLE');const sm=fs.readFileSync('supabase/renovation_phase_split_mep_migration.sql','utf8');await db.exec(sm);await db.exec(sm);
 const lv=plan=>call(staff,'SELECT renovation_phase_plan_save($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb) v',[id,JSON.stringify(plan),'[]',null,null]);
 await lv({plumb:{start:'2026-12-01',end:'2026-12-04'},elec:{start:'2026-12-01',end:'2026-12-03'}});
 const pp=(await sys('SELECT phase_plan FROM renovation_projects WHERE id=$1',[id]))[0].phase_plan;
 ok(pp.plumb?.end==='2026-12-04'&&pp.elec?.end==='2026-12-03','水路 and 电路 save as two phases');
 await lv({mep:{start:'2026-12-01',end:'2026-12-05'}});ok((await sys('SELECT phase_plan FROM renovation_projects WHERE id=$1',[id]))[0].phase_plan.mep?.end==='2026-12-05','old 水电 key still accepted');
 await reject(()=>lv({water:{start:'2026-12-01',end:'2026-12-02'}}),/不认识的工序/);
 {const nm=(await sys(`SELECT _reno_phase_name('plumb') a,_reno_phase_name('elec') b,_reno_phase_name('fix_plumb') c,_reno_phase_name('fix_elec') d,_reno_phase_name('hardware') e`))[0];ok(Object.values(nm).join()==='水路预埋,电路预埋,水路安装,电路安装,五金窗帘','owner page names: '+Object.values(nm).join());}
 await lv({fix_plumb:{start:'2027-01-10',end:'2027-01-11'},fix_elec:{start:'2027-01-10',end:'2027-01-12'},hardware:{start:'2027-01-10',end:'2027-01-10'}});ok((await sys('SELECT phase_plan FROM renovation_projects WHERE id=$1',[id]))[0].phase_plan.fix_elec?.end==='2027-01-12','install phases save');
 for(const t of ['水管工','电工'])await call(manager,'SELECT renovation_crew_save(NULL,$1::jsonb) v',[JSON.stringify({name:'师傅'+t,trade:t})]);
 ok((await sys(`SELECT count(*)::int n FROM renovation_crews WHERE trade IN ('水管工','电工')`))[0].n===2,'crew list accepts 水管工 and 电工');
 await reject(()=>call(manager,'SELECT renovation_crew_save(NULL,$1::jsonb) v',[JSON.stringify({name:'乱填',trade:'厨师'})]),/./);}
// 泥水和铺瓷砖分开：「铺瓷砖」(tile) 能保存、业主页显示名称；师傅名单能选瓷砖工
{await db.exec('RESET ROLE');const tm=fs.readFileSync('supabase/renovation_phase_tile_migration.sql','utf8');await db.exec(tm);await db.exec(tm);
 await call(staff,'SELECT renovation_phase_plan_save($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb) v',[id,JSON.stringify({tile:{start:'2026-12-20',end:'2026-12-24'}}),'[]',null,null]);
 ok((await sys('SELECT phase_plan FROM renovation_projects WHERE id=$1',[id]))[0].phase_plan.tile?.end==='2026-12-24'&&(await sys(`SELECT _reno_phase_name('tile') n`))[0].n==='铺瓷砖','tile phase saves and is named 铺瓷砖');
 await call(manager,'SELECT renovation_crew_save(NULL,$1::jsonb) v',[JSON.stringify({name:'阿明瓷砖',trade:'瓷砖工'})]);
 ok((await sys(`SELECT count(*)::int n FROM renovation_crews WHERE trade='瓷砖工'`))[0].n===1,'crew list accepts 瓷砖工');}
// 铝窗拆装：新工序 window 能保存，业主页名称
{await db.exec('RESET ROLE');const wm=fs.readFileSync('supabase/renovation_phase_window_migration.sql','utf8');await db.exec(wm);await db.exec(wm);
 await call(staff,'SELECT renovation_phase_plan_save($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb) v',[id,JSON.stringify({window:{start:'2026-12-02',end:'2026-12-03'}}),'[]',null,null]);
 ok((await sys('SELECT phase_plan FROM renovation_projects WHERE id=$1',[id]))[0].phase_plan.window?.end==='2026-12-03'&&(await sys(`SELECT _reno_phase_name('window') n`))[0].n==='铝窗拆装','window phase saves and is named 铝窗拆装');}
// 现场手动调整（phase_setup）：员工和被指派到工地的内部监理能改；其他门店、没指派的监理、外部人员不行；格式不对拒收；每次改动有记录；业主页显示自定义工序名称
{await db.exec('RESET ROLE');const sm=fs.readFileSync('supabase/renovation_phase_setup_migration.sql','utf8');await db.exec(sm);await db.exec(sm);
 const sup='20000000-0000-4000-8000-0000000000a1',sup2='20000000-0000-4000-8000-0000000000a2';
 await sys(`INSERT INTO profiles(id,name,active,role,store_id,region,phone) VALUES($1,'监理阿德',true,'supervisor',$3,'JB',''),($2,'监理别处',true,'supervisor',$3,'JB','') ON CONFLICT DO NOTHING`,[sup,sup2,store]);
 await sys(`INSERT INTO renovation_site_supervisors(project_id,profile_id,name,kind,access_code,created_by) VALUES($1,$2,'监理阿德','internal','1234',$3)`,[id,sup,manager]);
 const setup=(who,x)=>call(who,'SELECT renovation_phase_setup_save($1,$2::jsonb) v',[id,JSON.stringify(x)]);
 const good={assign:{'w1:L1':'masonry'},custom:[{key:'c_termite',name:'防白蚁',trade:'杂工',days:2,after:'prep'}]};
 await reject(()=>setup(outsider,good),/无此项目权限/);await reject(()=>setup(sup2,good),/无此项目权限/);
 await setup(sup,good);ok((await sys('SELECT phase_setup FROM renovation_projects WHERE id=$1',[id]))[0].phase_setup.custom[0].name==='防白蚁','the assigned internal supervisor can add a phase');
 ok((await setup(sup,good)).changed===false,'saving the same setup again changes nothing');
 await setup(staff,{...good,assign:{'w1:L1':'tile'}});
 const lg=(await sys(`SELECT payload FROM renovation_audit WHERE project_id=$1 AND action='phase_setup_saved' ORDER BY created_at`,[id])).map(r=>r.payload);
 ok(lg.length===2&&lg[0].by==='监理阿德'&&lg[1].before.assign['w1:L1']==='masonry'&&lg[1].after.assign['w1:L1']==='tile','every change is logged with who and before / after');
 for(const [bad,re] of [[{custom:[{key:'prep',name:'x',days:1}]},/编号/],[{custom:[{key:'c_a',name:'',days:1}]},/名称/],[{custom:[{key:'c_a',name:'x',days:0}]},/天数/],[{assign:{'a:b':'nonsense'}},/工序不对/],[{hack:1},/格式/],[{custom:[{key:'c_a',name:'x',days:1},{key:'c_a',name:'y',days:1}]},/编号/]])await reject(()=>setup(staff,bad),re);
 await sys(`UPDATE renovation_site_supervisors SET active=false WHERE profile_id=$1`,[sup]);await reject(()=>setup(sup,good),/无此项目权限/);
 // 自定义工序能排期保存，业主页显示它的名称
 await call(staff,'SELECT renovation_phase_plan_save($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb) v',[id,JSON.stringify({c_termite:{start:'2026-12-03',end:'2026-12-04'}}),'[]',null,null]);
 await sys(`UPDATE renovation_projects SET phase_baseline=phase_plan,phase_baseline_locked_at=now() WHERE id=$1`,[id]);
 const tok=(await sys('SELECT customer_token FROM renovation_projects WHERE id=$1',[id]))[0].customer_token;
 const cs=(await sys('SELECT renovation_customer_schedule($1) v',[tok]))[0].v;
 ok(cs.some(x=>x.name==='防白蚁')&&cs.some(x=>x.name==='铺瓷砖'),'owner page shows the custom phase by its name: '+cs.map(x=>x.name).join(','));
 await reject(()=>call(staff,'SELECT renovation_phase_plan_save($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb) v',[id,JSON.stringify({'c_BAD':{start:'2026-12-03',end:'2026-12-04'}}),'[]',null,null]),/不认识的工序/);}
// 第二步：被指派的内部监理能存工序日期和现场顺序；现场页拿得到工序计划；顺序格式不对拒收；没指派的监理不行
{await db.exec('RESET ROLE');const sm=fs.readFileSync('supabase/renovation_phase_site_migration.sql','utf8');await db.exec(sm);await db.exec(sm);
 const sup='20000000-0000-4000-8000-0000000000a1',sup2='20000000-0000-4000-8000-0000000000a2';
 await sys(`UPDATE renovation_site_supervisors SET active=true WHERE profile_id=$1`,[sup]);
 const plan=(who,x)=>call(who,'SELECT renovation_phase_plan_save($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb) v',[id,JSON.stringify(x),'[]',null,null]);
 await plan(sup,{ceiling:{start:'2026-12-20',end:'2026-12-22'}});ok((await sys('SELECT phase_plan FROM renovation_projects WHERE id=$1',[id]))[0].phase_plan.ceiling.end==='2026-12-22','the assigned internal supervisor can move phase dates');
 await reject(()=>plan(sup2,{ceiling:{start:'2026-12-20',end:'2026-12-23'}}),/无此项目权限/);await reject(()=>plan(outsider,{ceiling:{start:'2026-12-20',end:'2026-12-23'}}),/无此项目权限/);
 const setup=(who,x)=>call(who,'SELECT renovation_phase_setup_save($1,$2::jsonb) v',[id,JSON.stringify(x)]);
 await setup(sup,{order:['elec','masonry','tile','ceiling','paint'],after:{ceiling:['tile']}});
 ok((await sys('SELECT phase_setup FROM renovation_projects WHERE id=$1',[id]))[0].phase_setup.order[3]==='ceiling','the dragged order is saved');
 await reject(()=>setup(sup,{order:['elec','DROP TABLE']}),/顺序不对/);await reject(()=>setup(sup,{order:'elec'}),/顺序不对/);
 const v=await call(sup,'SELECT renovation_site_view($1) v',[id]);
 ok(v.project.phase_plan.ceiling&&v.project.phase_setup.order.length===5&&'phase_locked' in v.project,'the site page gets the phase plan and on-site setup');
 ok(!/8800|amount|price/.test(JSON.stringify(v.project)),'no prices in what the site page gets');}
// 设计图纸：店员上传效果图/施工图，换新版旧版留底；监理（内部登录 / 外部验证码有效期内）只能看自己工地登记过的最新图
{await db.exec('RESET ROLE');const dm=fs.readFileSync('supabase/renovation_design_files_migration.sql','utf8');await db.exec(dm);await db.exec(dm);checks++;
 const sup='20000000-0000-4000-8000-0000000000a1',sup2='20000000-0000-4000-8000-0000000000a2';
 const objs=async(who,role='authenticated')=>{await actor(who,role);const r=(await db.query(`SELECT name FROM storage.objects WHERE name LIKE '%/design/%'`)).rows.map(x=>x.name);await db.exec('RESET ROLE');return r;};
 const upload=async(who,name)=>{await actor(who);try{await db.query(`INSERT INTO storage.objects(bucket_id,name) VALUES('renovation-fulfillment',$1)`,[name]);}finally{await db.exec('RESET ROLE');}};
 const save=(who,d,p=id)=>call(who,'SELECT renovation_design_file_save($1,$2::jsonb) v',[p,JSON.stringify(d)]);
 await upload(staff,`${id}/design/k1.png`);await upload(staff,`${id}/design/k2.png`);await upload(staff,`${id}/design/w1.pdf`);
 await reject(()=>upload(outsider,`${id}/design/x.png`),/row-level security|policy/);
 const k1=await save(staff,{kind:'render',title:'厨房效果图',path:`${id}/design/k1.png`,mime:'image/png',size:10});
 await save(staff,{kind:'drawing',title:'水电点位图',path:`${id}/design/w1.pdf`,mime:'application/pdf',size:10});
 await reject(()=>save(outsider,{kind:'render',title:'x',path:`${id}/design/k2.png`}),/权限/);
 await reject(()=>save(staff,{kind:'render',title:'x',path:`${id}/design/none.png`}),/没上传好/);
 await reject(()=>save(staff,{kind:'render',title:'x',path:`${id}/d1.pdf`}),/没上传好/);
 const k2=await save(staff,{kind:'render',path:`${id}/design/k2.png`,mime:'image/png',replaces:k1.id});
 ok(k2.version===2,'replacing a drawing makes version 2');
 const rows=await sys('SELECT id,title,superseded_at,replaces FROM renovation_design_files WHERE project_id=$1 ORDER BY version',[id]);
 ok(rows.find(r=>r.id===k1.id).superseded_at&&rows.find(r=>r.id===k2.id).title==='厨房效果图','the old version is kept but marked replaced; the new one keeps the title');
 await reject(()=>save(staff,{kind:'render',path:`${id}/design/k2.png`,replaces:k1.id}),/新版/);
 const v=await call(sup,'SELECT renovation_site_view($1) v',[id]);
 ok(v.design.length===2&&v.design[0].kind==='render'&&v.design[0].version===2&&!v.design.some(f=>f.id===k1.id),'the site page shows only the latest version of each drawing');
 let seen=await objs(sup);ok(seen.includes(`${id}/design/k2.png`)&&seen.includes(`${id}/design/k1.png`),'the assigned internal supervisor can open the drawings');
 ok((await objs(sup2)).length===0,'a supervisor of another site cannot open them');
 ok((await objs('','anon')).length===0,'nobody without a verified link can open them');
 const ext=await call(staff,'SELECT renovation_supervisor_save($1,$2::jsonb) v',[id,JSON.stringify({name:'Ext',phone:'01'})]);
 await sys(`UPDATE renovation_site_supervisors SET verified_until=now()+interval '1 hour' WHERE id=$1`,[ext.id]);
 ok((await objs('','anon')).includes(`${id}/design/w1.pdf`),'an external supervisor who entered the code can open them');
 await sys(`UPDATE renovation_site_supervisors SET verified_until=now()-interval '1 minute' WHERE id=$1`,[ext.id]);
 ok((await objs('','anon')).length===0,'after the code expires they cannot');
 await reject(()=>save(staff,{remove_id:k1.id}),/新版/);
 await save(staff,{remove_id:k2.id});
 ok((await call(sup,'SELECT renovation_site_view($1) v',[id])).design.length===1,'a deleted drawing disappears from the site page');
 ok(!(await objs(sup)).includes(`${id}/design/k2.png`),'and the supervisor can no longer open it');
 await actor(outsider);ok((await db.query('SELECT count(*)::int n FROM renovation_design_files')).rows[0].n===0,'other stores do not see the drawing list');await db.exec('RESET ROLE');}
// 第 2 批：看图链接（师傅 / 厂家打开就看全部最新图，竣工验收或停用后失效）+ 业主档案页只看效果图
{await db.exec('RESET ROLE');const sm=fs.readFileSync('supabase/renovation_design_share_migration.sql','utf8');await db.exec(sm);await db.exec(sm);checks++;
 const objs=async()=>{await actor('','anon');const r=(await db.query(`SELECT name FROM storage.objects WHERE name LIKE '%/design/%'`)).rows.map(x=>x.name);await db.exec('RESET ROLE');return r;};
 const anon=async(sql,args)=>{await actor('','anon');try{return (await db.query(sql,args)).rows[0].v;}finally{await db.exec('RESET ROLE');}};
 await actor(staff);await db.query(`INSERT INTO storage.objects(bucket_id,name) VALUES('renovation-fulfillment',$1)`,[`${id}/design/k3.png`]);await db.exec('RESET ROLE');
 await call(staff,'SELECT renovation_design_file_save($1,$2::jsonb) v',[id,JSON.stringify({kind:'render',title:'客厅效果图',path:`${id}/design/k3.png`,mime:'image/png'})]);
 const share=(who,d)=>call(who,'SELECT renovation_design_share_save($1,$2::jsonb) v',[id,JSON.stringify(d)]);
 await reject(()=>share(outsider,{label:'木工'}),/权限/);
 await reject(()=>share(staff,{label:' '}),/给谁看/);
 const a=await share(staff,{label:'木工 张师傅'});ok(a.token&&!a.code,'staff get a link with no code');
 ok((await objs()).length===0,'before anyone opens the link nothing is readable');
 const open=()=>anon('SELECT renovation_design_share_open($1,$2) v',[a.id,a.token]);
 ok(await anon('SELECT renovation_design_share_open($1,$2) v',[a.id,'00000000-0000-4000-8000-000000000000'])===null,'a forged link token gets nothing');
 const v=await open();
 ok(v.status==='ok'&&v.files.length===2&&v.files.every(f=>[`${id}/design/w1.pdf`,`${id}/design/k3.png`].includes(f.path)),'the worker opening the link sees the latest drawing and render, not old or deleted ones');
 ok(!/8800|amount|price|phone/.test(JSON.stringify(v)),'the worker page gets no prices or phone numbers');
 let seen=await objs();ok(seen.includes(`${id}/design/w1.pdf`)&&seen.includes(`${id}/design/k3.png`)&&!seen.includes(`${id}/design/k1.png`),'the worker can open the latest files but not replaced versions');
 await actor(outsider);ok((await db.query('SELECT count(*)::int n FROM renovation_design_shares')).rows[0].n===0,'other stores cannot see the share links or codes');await db.exec('RESET ROLE');
 await share(staff,{revoke_id:a.id});
 ok((await objs()).length===0,'after staff stop the link the worker cannot open anything');
 ok((await open()).status==='revoked','and the page says the link is stopped');
 const b=await share(staff,{label:'橱柜厂'});ok((await anon('SELECT renovation_design_share_open($1,$2) v',[b.id,b.token])).status==='ok'&&(await objs()).length===2,'a second link works on its own');
 const st=(await sys('SELECT state FROM renovation_projects WHERE id=$1',[id]))[0].state;await sys(`UPDATE renovation_projects SET state='accepted' WHERE id=$1`,[id]);
 ok((await objs()).length===0,'once the project is accepted (finished) the worker link stops reading files at once');
 ok((await anon('SELECT renovation_design_share_open($1,$2) v',[b.id,b.token])).status==='finished','and the page says the project is finished');
 await reject(()=>share(staff,{label:'泥水'}),/竣工/);
 await sys('UPDATE renovation_projects SET state=$2 WHERE id=$1',[id,st]);await share(staff,{revoke_id:b.id});
 const tok=(await sys('SELECT customer_token FROM renovation_projects WHERE id=$1',[id]))[0].customer_token;
 const mine=await anon('SELECT renovation_customer_design($1) v',[tok]);
 ok(mine.length===1&&mine[0].kind==='render'&&mine[0].path===`${id}/design/k3.png`,'the owner page lists only the latest renders, not construction drawings');
 seen=await objs();ok(seen.includes(`${id}/design/k3.png`)&&!seen.includes(`${id}/design/w1.pdf`),'the owner can open renders but not construction drawings');
 ok((await anon('SELECT renovation_customer_design($1) v',['00000000-0000-4000-8000-000000000000'])).length===0,'a wrong customer link gets nothing');
 await sys(`UPDATE renovation_design_shares SET verified_until=now()-interval '1 minute' WHERE kind='owner'`);
 ok((await objs()).length===0,'the owner window closes after it expires');}
console.log(`PASS ${checks} planning checks`);
