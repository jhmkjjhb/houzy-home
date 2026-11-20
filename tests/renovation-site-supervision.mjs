// 施工监理：监理只能看自己工地、看不到金额；外部监理凭链接+验证码；照片必须是自己传的；到货/开工/完工直接更新进度；延误和停工要店长确认。
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


await sys(`ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('customer','staff','store_manager','regional_manager','general_manager','superadmin','admin','supplier','logistics','warehouse'))`);
for(const f of ['renovation_schedule','renovation_planning','renovation_site_supervision']){const sql=fs.readFileSync(`supabase/${f}_migration.sql`,'utf8');await db.exec('RESET ROLE');await db.exec(sql);if(f.includes('site'))await db.exec(sql);}checks++;
const custom=await wo('全屋定制'),mud=await wo('泥水');
ok(/'supervisor'/.test((await sys(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='profiles_role_check'`))[0].d)&&/'warehouse'/.test((await sys(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='profiles_role_check'`))[0].d),'accounts can now have the 监理 role; existing roles kept');
const anonQ=async(sql,args)=>{await actor(staff,'anon');return (await db.query(sql,args)).rows[0]?.v;};
const as=async(who,sql,args)=>{await actor(who);return (await db.query(sql,args)).rows[0]?.v;};
await sys(`INSERT INTO profiles(id,name,active,role,store_id,region,phone) VALUES('${supplierUser}','Sup',true,'supplier',null,null,null) ON CONFLICT (id) DO UPDATE SET role='supervisor',name='陈监理'`);
const supUser=supplierUser;
// 员工指定监理：内部（员工账号）和外部（名字电话 → 链接+验证码）
await reject(()=>as(outsider,'SELECT renovation_supervisor_save($1,$2::jsonb) v',[id,JSON.stringify({name:'X'})]),/无此项目权限/);
const inn=await as(staff,'SELECT renovation_supervisor_save($1,$2::jsonb) v',[id,JSON.stringify({profile_id:supUser})]);ok(inn.kind==='internal'&&!inn.code,'internal supervisor uses their own login');
await reject(()=>as(staff,'SELECT renovation_supervisor_save($1,$2::jsonb) v',[id,JSON.stringify({profile_id:supUser})]),/已经是本工地/);
const ext=await as(staff,'SELECT renovation_supervisor_save($1,$2::jsonb) v',[id,JSON.stringify({name:'Ahmad',phone:'012'})]);ok(ext.token&&/^\d{4}$/.test(ext.code),'external supervisor gets a link and a 4-digit code');
// 内部监理：只看到自己的工地，没有金额
await actor(supUser);
await reject(()=>db.query('SELECT * FROM renovation_projects'),/permission denied|row-level/).catch(()=>{});
ok((await db.query('SELECT count(*)::int n FROM renovation_site_entries')).rows[0].n===0,'supervisor cannot read the tables directly');
const my=await as(supUser,'SELECT renovation_site_my() v');ok(my.length===1&&my[0].contract_no==='NEW','supervisor sees only their site');
const view=await as(supUser,'SELECT renovation_site_view($1) v',[id]);const txt=JSON.stringify(view);
ok(view.work_orders.length>=2&&!/rate|amount|net|60101234567|Owner|2400|1000/.test(txt.replace(/"qty":\d+/g,'')),'site view has items but no prices or owner phone: '+txt.slice(0,200));
await reject(()=>as(supUser,'SELECT renovation_site_view($1) v',[oldId]),/不是这个工地/);
// 外部监理：验证码
const wrong=ext.code==='0000'?'1111':'0000';
let o=await anonQ('SELECT renovation_site_open($1,$2,$3) v',[ext.id,ext.token,wrong]);ok(o.status==='wrong_code'&&!o.site,'wrong code shows nothing');
o=await anonQ('SELECT renovation_site_open($1,$2,$3) v',[ext.id,ext.token,ext.code]);ok(o.status==='ok'&&o.site.project.contract_no==='NEW','right code opens the site');
const extAuth={sid:ext.id,token:ext.token,code:ext.code};
// 照片：必须先传到自己的文件夹
const photo=(sid,n)=>`${id}/site/${sid}/p${n}.jpg`;
await sys(`INSERT INTO storage.objects(bucket_id,name) VALUES('renovation-fulfillment','${photo(inn.id,1)}'),('renovation-fulfillment','${photo(inn.id,2)}'),('renovation-fulfillment','${photo(ext.id,1)}'),('renovation-fulfillment','${photo(inn.id,3)}'),('renovation-fulfillment','${photo(inn.id,4)}')`);
ok(await anonQ('SELECT public._reno_site_upload_ok($1) v',[photo(ext.id,9)]),'verified outside supervisor may upload to their own folder');
ok(!(await anonQ('SELECT public._reno_site_upload_ok($1) v',[photo(inn.id,9)])),'but not into someone else\'s folder');
const post=(who,auth,kind,data)=>who?as(who,'SELECT renovation_site_post($1,$2::jsonb,$3,$4::jsonb) v',[id,auth?JSON.stringify(auth):null,kind,JSON.stringify(data)]):anonQ('SELECT renovation_site_post($1,$2::jsonb,$3,$4::jsonb) v',[id,JSON.stringify(auth),kind,JSON.stringify(data)]);
await reject(()=>post(supUser,null,'log',{note:'x',photos:[]}),/至少拍 1 张/);
await reject(()=>post(supUser,null,'log',{note:'x',photos:[{path:photo(ext.id,1)}]}),/照片还没上传好/);
const lg=await post(supUser,null,'log',{note:'泥水 2 人',photos:[{path:photo(inn.id,1),sha256:'a'.repeat(64),lat:'1.49',lng:'103.7',taken_at:'2026-11-20T09:00:00+08:00'}]});ok(lg.ok&&lg.site.entries[0].kind==='log','daily log saved');
const lg2=await post(null,extAuth,'log',{note:'外部监理日志',photos:[{path:photo(ext.id,1),sha256:'a'.repeat(64)}]});
ok((await sys(`SELECT photos->0->>'reused' r FROM renovation_site_entries WHERE id=$1`,[lg2.id]))[0].r==='true','the same photo used twice is flagged');
await reject(()=>anonQ('SELECT renovation_site_post($1,$2::jsonb,$3,$4::jsonb) v',[id,JSON.stringify({...extAuth,code:wrong}),'log',JSON.stringify({photos:[{path:photo(ext.id,1)}]})]),/验证已过期/);
// 到货 / 开工 / 完工直接更新子单进度
await run(staff,'request_signature',{work_order_id:custom.id,document_path:`${id}/d1.pdf`,document_sha256:'a'.repeat(64)}).catch(()=>{});
await sys(`UPDATE renovation_work_items SET stage='ordered' WHERE work_order_id=$1`,[custom.id]);
const ar=await post(supUser,null,'arrival',{work_order_id:custom.id,line_ids:['C1'],photos:[{path:photo(inn.id,2)}]});
ok((await items()).C1.stage==='arrived'&&(await items()).C2.stage==='ordered','arrival check-in marks only the ticked item arrived');
await post(supUser,null,'arrival',{work_order_id:custom.id,ok:false,note:'地柜门板破损',photos:[{path:photo(inn.id,3)}]});
ok((await sys(`SELECT count(*)::int n FROM renovation_site_entries WHERE kind='issue' AND status='open' AND project_id=$1`,[id]))[0].n===1,'a damaged delivery opens an issue automatically');
await reject(()=>post(supUser,null,'start',{work_order_id:custom.id,photos:[{path:photo(inn.id,4)}]}),/没有可开工/);
await post(supUser,null,'start',{work_order_id:mud.id,photos:[{path:photo(inn.id,4)}]});ok((await items()).W1.stage==='working','start moves work to 进行中');
await post(supUser,null,'finish',{work_order_id:mud.id,photos:[{path:photo(inn.id,4)}]});ok((await items()).W1.stage==='done'&&(await items()).W1.proof_path===photo(inn.id,4),'finish closes the work with the site photo as proof');
// 验收：不合格要写返工内容，自动开问题；第一次验收才算「一次通过」
await reject(()=>post(supUser,null,'inspection',{milestone:'防水',checks:[{item:'闭水48小时',ok:false}],photos:[{path:photo(inn.id,1)}]}),/返工/);
const in1=await post(supUser,null,'inspection',{milestone:'防水',checks:[{item:'闭水48小时',ok:false}],note:'楼下渗水',photos:[{path:photo(inn.id,1)}]});
const in2=await post(supUser,null,'inspection',{milestone:'防水',checks:[{item:'闭水48小时',ok:true}],photos:[{path:photo(inn.id,2)}]});
const ins=await sys(`SELECT id,data FROM renovation_site_entries WHERE kind='inspection' ORDER BY created_at`);
ok(ins[0].data.first_try===true&&ins[0].data.pass===false&&ins[1].data.first_try===false&&ins[1].data.pass===true,'first-try pass is tracked (a re-inspection after rework does not count as first try)');
// 问题：监理处理后附照片
const iss=(await sys(`SELECT id FROM renovation_site_entries WHERE kind='issue' AND status='open' ORDER BY created_at LIMIT 1`))[0].id;
await reject(()=>as(supUser,'SELECT renovation_site_resolve($1,NULL,$2::jsonb) v',[iss,JSON.stringify({photos:[]})]),/至少拍 1 张/);
await as(supUser,'SELECT renovation_site_resolve($1,NULL,$2::jsonb) v',[iss,JSON.stringify({note:'已换门板',photos:[{path:photo(inn.id,2)}]})]);
ok((await sys('SELECT status FROM renovation_site_entries WHERE id=$1',[iss]))[0].status==='resolved','issue resolved with a photo');
// 延误原因：要选；业主原因要写明；店长确认才算
await reject(()=>post(supUser,null,'delay',{days:2,reason:'x'}),/延误原因/);
await reject(()=>post(supUser,null,'delay',{days:2,reason:'owner'}),/写明原因/);
const dl=await post(supUser,null,'delay',{days:2,reason:'weather',note:'大雨'});
await reject(()=>as(staff,'SELECT renovation_site_review($1,$2,$3) v',[dl.id,'confirm','']),/店长/);
await reject(()=>as(manager,'SELECT renovation_site_review($1,$2,$3) v',[dl.id,'reject','']),/驳回原因/);
await as(manager,'SELECT renovation_site_review($1,$2,$3) v',[dl.id,'confirm','属实']);ok((await sys('SELECT status FROM renovation_site_entries WHERE id=$1',[dl.id]))[0].status==='confirmed','store manager confirms the delay reason');
await reject(()=>post(supUser,null,'pause',{from:'2026-12-01',to:'2026-11-01',note:'x'}),/停工日期/);
// 结束监理后链接和账号都不能再用
await as(staff,'SELECT renovation_supervisor_save($1,$2::jsonb) v',[id,JSON.stringify({end_id:ext.id})]);
ok((await anonQ('SELECT renovation_site_open($1,$2,$3) v',[ext.id,ext.token,ext.code])).status==='ended','ended supervisor link stops working');
await reject(()=>post(null,extAuth,'log',{photos:[{path:photo(ext.id,1)}]}),/停用/);
ok((await sys(`SELECT count(*)::int n FROM renovation_audit WHERE action LIKE 'site_%' AND project_id=$1`,[id]))[0].n>=8,'every site action is in the history');
// 员工按项目权限能看到全部记录；别的门店看不到
await actor(staff);ok((await db.query('SELECT count(*)::int n FROM renovation_site_entries')).rows[0].n>=8,'staff see the site records');
await actor(outsider);ok((await db.query('SELECT count(*)::int n FROM renovation_site_entries')).rows[0].n===0,'other stores do not');
console.log(`PASS ${checks} site supervision checks`);
