// Fulfilment: custom goods cannot be ordered without the owner's signature, whole-sub-order actions
// leave a per-line trail, and a departing employee's work moves without moving their sales credit.
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
async function setAssignee(name,p=id,who=staff,assignee='师傅'){const w=await wo(name,p),r=await rev(p);await actor(who);await db.query('SELECT renovation_command($1,$2,$3,$4::jsonb)',[p,r,'work',JSON.stringify({id:w.id,assignee,status:'assigned'})]);}
async function sign(c,last4='4567',name='Owner',relation='本人'){await actor(staff,'anon');const v=(await db.query('SELECT renovation_custom_sign_open($1,$2,$3) v',[c.id,c.signing_token,last4])).rows[0].v;if(v.status!=='pending')return v;await db.query('SELECT renovation_custom_sign($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',[c.id,c.signing_token,last4,v.terms_hash,name,relation,JSON.stringify(strokes),true]);return v;}
const latest=async w=>(await sys('SELECT * FROM renovation_custom_confirmations WHERE work_order_id=$1 ORDER BY version DESC LIMIT 1',[w]))[0];

// Existing data
ok((await sys('SELECT sales_by FROM renovation_projects WHERE id=$1',[oldId]))[0].sales_by===legacyOwner,'existing project keeps its seller');
ok((await sys('SELECT sales_by FROM renovation_projects WHERE id=$1',[id]))[0].sales_by===staff,'new project credits its creator');
const old=await items(oldId);ok(old.C1.stage==='pending'&&old.C1.legacy_eligible,'existing line is trackable');ok(old.W1.stage==='done','finished sub-order stays finished');
ok((await wo('全屋定制',oldId)).status==='working','in-progress work never moves backwards for customers');
ok((await wo('泥水',oldId)).status==='done','done status is preserved');

// One row per line with the right execution type
let it=await items();ok(Object.keys(it).length===6&&it.C1.kind==='custom'&&it.S1.kind==='stock'&&it.W1.kind==='work'&&it.G1.kind==='gift','every line tracked');
const custom=await wo('全屋定制');const orderForm={work_order_id:custom.id,supplier:'厂家A',order_no:'PO-1',ordered_on:today,expected_on:later,stock_confirmed:true};

// THE RULE: unsigned custom goods cannot be ordered, by anyone, by any route.
await reject(()=>run(staff,'place_order',orderForm),/先指定执行人/);
await setAssignee('全屋定制');
await reject(()=>run(staff,'place_order',{...orderForm,line_ids:['C1']}),/没有业主签名/);
await reject(()=>run(manager,'place_order',{...orderForm,line_ids:['C1','C2']}),/没有业主签名/);
await reject(()=>run(staff,'place_order',{...orderForm,line_ids:['S1'],stock_confirmed:false}),/勾选/);
await run(staff,'place_order',{...orderForm,line_ids:['S1'],order_no:''});
it=await items();ok(it.S1.stage==='ordered'&&it.C1.stage==='pending','stock can go ahead without a signature while custom waits');
await reject(()=>run(staff,'place_order',orderForm),/没有业主签名|没有可下单/);
ok((await sys('SELECT count(*)::int n FROM renovation_purchase_batches WHERE project_id=$1',[id]))[0].n===1,'refused orders leave no record');
await actor(staff);await reject(()=>db.query(`update renovation_work_items set stage='ordered'`),/permission denied/);

// Whole sub-order signature
await reject(()=>run(staff,'request_signature',{work_order_id:custom.id,document_path:`${id}/missing.pdf`,document_sha256:HASH}),/请先上传/);
await run(staff,'request_signature',{work_order_id:custom.id,document_path:`${id}/d1.pdf`,document_sha256:HASH});
let c=await latest(custom.id);ok(c.line_ids.length===2&&c.line_ids.includes('C1')&&c.version===1,'one signature covers all custom lines, not stock');
ok(!JSON.stringify(c.terms).includes('rate')&&!JSON.stringify(c.terms).includes('1000'),'signing page carries no prices');
await actor(staff,'anon');
let view=(await db.query('SELECT renovation_custom_sign_open($1,$2,$3) v',[c.id,c.signing_token,'0000'])).rows[0].v;ok(view.status==='wrong_phone'&&!view.terms,'wrong digits reveal nothing');
ok((await db.query('SELECT renovation_custom_sign_open($1,$2,$3) v',[c.id,'00000000-0000-4000-8000-000000000000','4567'])).rows[0].v===null,'wrong token reveals nothing');
await reject(()=>db.query('SELECT * FROM renovation_work_items'),/permission denied/);
await reject(()=>db.query('SELECT * FROM renovation_custom_confirmations'),/permission denied/);
await reject(()=>db.query('SELECT renovation_custom_sign($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',[c.id,c.signing_token,'4567','x','Owner','本人',JSON.stringify(strokes),true]),/验证已过期/);
view=(await db.query('SELECT renovation_custom_sign_open($1,$2,$3) v',[c.id,c.signing_token,'4567'])).rows[0].v;ok(view.document_path===`${id}/d1.pdf`,'owner sees the drawing after the phone check');
await reject(()=>db.query('SELECT renovation_custom_sign($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',[c.id,c.signing_token,'4567',view.terms_hash,'Owner','',JSON.stringify(strokes),true]),/关系/);
await reject(()=>db.query('SELECT renovation_custom_sign($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',[c.id,c.signing_token,'4567',view.terms_hash,'Owner','本人',JSON.stringify([[[0.1,0.1],[0.1,0.1]]]),true]),/签名/);

// A later version replaces the earlier signature before ordering.
await sign(c,'4567','Owner Wife','配偶');c=await latest(custom.id);ok(c.status==='signed'&&c.signer_relation==='配偶'&&c.method==='electronic','family signature records who signed');
it=await items();ok(it.C1.stage==='confirmed'&&it.C2.stage==='confirmed','signature confirms all covered lines');
await reject(async()=>{await actor(staff,'anon');await db.query('SELECT renovation_custom_sign_open($1,$2,$3)',[c.id,c.signing_token,'4567']);await db.query('SELECT renovation_custom_sign($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',[c.id,c.signing_token,'4567',view.terms_hash,'X','本人',JSON.stringify(strokes),true]);},/重复签署|已过期/);
await run(staff,'request_signature',{work_order_id:custom.id,document_path:`${id}/d2.pdf`,document_sha256:HASH});
it=await items();ok(it.C1.stage==='pending'&&it.C1.confirmation_id===null,'new drawing cancels the earlier signature');
await reject(()=>run(staff,'place_order',{...orderForm,line_ids:['C1']}),/没有业主签名/);
ok((await sys('SELECT status FROM renovation_custom_confirmations WHERE work_order_id=$1 AND version=1',[custom.id]))[0].status==='signed','old signed version stays on file');
await reject(()=>run(staff,'request_signature',{work_order_id:custom.id,document_path:`${id}/d3.pdf`,document_sha256:HASH}),/已有一份/);

// Paper route needs a manager; staff cannot approve their own upload.
c=await latest(custom.id);
await run(staff,'submit_paper',{confirmation_id:c.id,paper_path:`${id}/paper.pdf`,paper_sha256:HASH,signer_name:'Owner',signer_relation:'本人'});
await reject(()=>run(staff,'review_paper',{confirmation_id:c.id,approve:true}),/店长或上级/);
await reject(()=>run(staff,'place_order',{...orderForm,line_ids:['C1']}),/没有业主签名/);
await run(manager,'review_paper',{confirmation_id:c.id,approve:true});
c=await latest(custom.id);ok(c.status==='signed'&&c.method==='paper'&&c.paper_reviewed_by===manager,'paper signature records the reviewer');

// Whole order now covers both custom lines
await reject(()=>run(staff,'place_order',{...orderForm,order_no:''}),/厂家单号/);
await reject(()=>run(staff,'place_order',{...orderForm,expected_on:'2000-01-01'}),/预计到货日/);
await run(staff,'place_order',orderForm);
it=await items();ok(it.C1.stage==='ordered'&&it.C1.batch_id===it.C2.batch_id&&it.C1.batch_id,'one action records every line under one batch');
ok((await wo('全屋定制')).status==='working','sub-order status follows its lines');

// Change after ordering
await reject(()=>run(staff,'request_signature',{work_order_id:custom.id,line_ids:['C1'],document_path:`${id}/d3.pdf`,document_sha256:HASH}),/改单内容/);
await run(staff,'request_signature',{work_order_id:custom.id,line_ids:['C1'],change_note:'改颜色',document_path:`${id}/d3.pdf`,document_sha256:HASH});
c=await latest(custom.id);ok(c.kind==='change'&&(await items()).C1.stage==='ordered'&&(await items()).C1.change_pending,'change keeps the order and flags it');

// One missing part does not hold up the rest
await run(staff,'flag_issue',{work_order_id:custom.id,line_ids:['C2'],note:'缺门板',follow_up_on:later});
await run(staff,'arrive',{work_order_id:custom.id,on:today});
it=await items();ok(it.C1.stage==='arrived'&&it.S1.stage==='arrived'&&it.C2.stage==='ordered','whole arrival skips the problem line');
await reject(()=>run(staff,'finish',{work_order_id:custom.id,line_ids:['C1'],on:today,proof_path:`${id}/photo.jpg`}),/改单确认/);
await sign(c);ok(!(await items()).C1.change_pending,'signed change clears the flag');
await reject(()=>run(staff,'finish',{work_order_id:custom.id,on:today}),/请先上传/);
await run(staff,'finish',{work_order_id:custom.id,on:today,proof_path:`${id}/photo.jpg`});
it=await items();ok(it.C1.stage==='done'&&it.S1.stage==='done'&&it.C2.stage==='ordered','finish skips unresolved line');
ok((await wo('全屋定制')).status==='working','sub-order is not done while a line is open');

// The old manual route cannot mark unfinished work done, which would unlock acceptance.
const rNow=await rev();await actor(staff);
await reject(()=>db.query('SELECT renovation_command($1,$2,$3,$4::jsonb)',[id,rNow,'work',JSON.stringify({id:custom.id,assignee:'师傅',status:'done'})]),/未完成/);
await run(staff,'resolve_issue',{work_order_id:custom.id,line_ids:['C2']});
await run(staff,'arrive',{work_order_id:custom.id,on:today});
await run(staff,'finish',{work_order_id:custom.id,on:today,proof_path:`${id}/photo.jpg`});
ok((await wo('全屋定制')).status==='done','all lines done completes the sub-order');
await actor(staff,'anon');const progress=(await db.query('SELECT renovation_customer_progress_view(customer_token) v FROM (SELECT $1::uuid customer_token) t',[(await sys('SELECT customer_token FROM renovation_projects WHERE id=$1',[id]))[0].customer_token])).rows[0];
await actor(staff,'anon');const pv=progress.v.work_orders.find(x=>x.group_name==='全屋定制');ok(pv.status==='done'&&!JSON.stringify(progress.v).includes('厂家A'),'customer sees status, never supplier');

// Construction and gift paths
const work=await wo('泥水'),gift=await wo('赠品');await setAssignee('泥水');await setAssignee('赠品');
await reject(()=>run(staff,'finish',{work_order_id:work.id,on:today,proof_path:`${id}/photo.jpg`}),/先开工/);
await run(staff,'schedule',{work_order_id:work.id,on:later});await run(staff,'start_work',{work_order_id:work.id});await run(staff,'finish',{work_order_id:work.id,on:today,proof_path:`${id}/photo.jpg`});
ok((await wo('泥水')).status==='done','construction path completes');
await run(staff,'finish',{work_order_id:gift.id,on:today});ok((await wo('赠品')).status==='done','gift needs no photo');

// Correction keeps the before and after
const batch=(await items()).C1.batch_id;await reject(()=>run(staff,'correct_batch',{batch_id:batch,supplier:'厂家B'}),/更正原因/);
await run(staff,'correct_batch',{batch_id:batch,supplier:'厂家B',reason:'填错'});
const log=(await sys(`SELECT payload FROM renovation_audit WHERE project_id=$1 AND action='fulfillment_correct_batch'`,[id]))[0].payload;ok(log.before.supplier==='厂家A'&&log.after.supplier==='厂家B','correction keeps history');

// Orders placed before this feature, only for lines that existed then
const oldWo=await wo('全屋定制',oldId),legacyForm={work_order_id:oldWo.id,supplier:'旧厂',ordered_on:today,expected_on:later,reason:'上线前已下单'};
await reject(()=>run(legacyOwner,'legacy_order',legacyForm,oldId),/店长或上级/);
await reject(()=>run(manager,'legacy_order',{work_order_id:custom.id,supplier:'x',ordered_on:today,expected_on:later,reason:'x'}),/可登记/);
await run(manager,'legacy_order',legacyForm,oldId);ok((await items(oldId)).C1.stage==='ordered','manager records a pre-launch order');
await db.exec(`RESET ROLE;INSERT INTO renovation_work_orders(project_id,group_name,line_ids,assignee) VALUES('${oldId}','新组','["C9"]'::jsonb,'x');UPDATE renovation_projects SET snapshot=jsonb_set(snapshot,'{lines}',snapshot->'lines'||'[{"id":"C9","name":"新","qty":1,"rate":1,"kind":"custom","group":"新组","unit":"x"}]') WHERE id='${oldId}';SELECT _reno_sync_work_items('${oldId}');`);
await reject(async()=>run(manager,'legacy_order',{...legacyForm,work_order_id:(await wo('新组',oldId)).id},oldId),/上线前/);

// Signed deduction on a line nobody has started removes it from tracking
ok((await items()).W2.stage==='pending','line starts open');
const entry=crypto.randomUUID(),dr=await rev();await actor(staff);
const added=(await db.query('SELECT renovation_deduction_command($1,$2,$3,$4,$5::jsonb) v',[id,dr,'add',entry,JSON.stringify({line_id:'W2',reason:'取消'})])).rows[0].v;
const signToken=(await sys('SELECT signing_token FROM renovation_deductions WHERE id=$1',[entry]))[0].signing_token;await actor(staff,'anon');
const dv=(await db.query('SELECT renovation_deduction_sign_view($1,$2) v',[entry,signToken])).rows[0].v;
await db.query('SELECT renovation_deduction_sign($1,$2,$3,$4,$5::jsonb,true)',[entry,signToken,dv.terms_hash,'Owner',JSON.stringify(strokes)]);
ok((await items()).W2.stage==='cancelled','signed deduction closes the line');

// To-do list is scoped to who can see the project
await actor(staff);let todo=(await db.query('SELECT renovation_my_todos() v')).rows[0].v;ok(!todo.items.some(t=>t.project_id===oldId),'staff see only their own projects');
await actor(manager);todo=(await db.query('SELECT renovation_my_todos() v')).rows[0].v;ok(todo.items.some(t=>t.project_id===oldId&&t.type==='need_signature'),'manager sees the store, including unsigned custom lines');
await actor(outsider);ok((await db.query('SELECT renovation_my_todos() v')).rows[0].v.items.length===0,'other store sees nothing');
await actor(staff,'anon');await reject(()=>db.query('SELECT renovation_my_todos()'),/permission denied/);

// Handover
const hand=async(who,action,hid,data={})=>{await actor(who);return (await db.query('SELECT renovation_handover_command($1,$2,$3::jsonb) v',[action,hid,JSON.stringify(data)])).rows[0].v;};
const form={from_user:staff,to_user:colleague,project_ids:[id],note:'客户要求周五前到货'};
await reject(()=>hand(staff,'create',null,form),/店长或上级/);
await reject(()=>hand(manager,'create',null,{...form,to_user:outsider}),/门店/);
await reject(()=>hand(outsider,'create',null,form),/店长或上级/);
const h=await hand(manager,'create',null,form);ok(h.checklist[0].contract_no==='NEW'&&Array.isArray(h.checklist[0].todos),'checklist generated');
await reject(()=>hand(manager,'create',null,form),/等待接手/);
ok((await sys('SELECT created_by FROM renovation_projects WHERE id=$1',[id]))[0].created_by===staff,'nothing moves until the receiver accepts');
await reject(()=>hand(manager,'accept',h.id),/接手人本人/);
await actor(colleague);ok((await db.query('SELECT renovation_my_todos() v')).rows[0].v.handovers.length===1,'receiver is told');
await hand(colleague,'accept',h.id);
const moved=(await sys('SELECT created_by,sales_by FROM renovation_projects WHERE id=$1',[id]))[0];ok(moved.created_by===colleague,'owner moved');ok(moved.sales_by===staff,'sales credit did not move');
await actor(staff);ok((await db.query('SELECT id FROM renovation_projects WHERE id=$1',[id])).rows.length===0,'previous owner loses access');
await reject(()=>run(staff,'correct_batch',{batch_id:batch,reason:'x'}),/无此项目权限/);
await actor(colleague);ok((await db.query('SELECT id FROM renovation_projects WHERE id=$1',[id])).rows.length===1,'receiver can open it');ok((await db.query('SELECT id FROM renovation_custom_confirmations WHERE project_id=$1',[id])).rows.length>0,'and its signatures');
ok((await sys('SELECT _reno_contact_phone($1) v',[id]))[0].v==='+60 33','statement phone follows the owner');
ok((await sys(`SELECT count(*)::int n FROM renovation_audit WHERE project_id=$1 AND action='handover'`,[id]))[0].n===1,'handover is on record');
const dashboard=(await sys(`SELECT pg_get_functiondef('public._dash_kpi_period(date,date,integer,uuid,text)'::regprocedure) d`))[0].d;ok(dashboard.includes('p.sales_by AS created_by'),'dashboard credits the seller');
ok((await sys(`SELECT pg_get_functiondef('public.get_store_performance(date,date,uuid,boolean)'::regprocedure) d`))[0].d.includes('p.sales_by=a.id'),'store report credits the seller');

// Cannot switch off someone still holding work; urgent route moves it first.
await db.exec('RESET ROLE');await reject(()=>db.query('UPDATE profiles SET active=false WHERE id=$1',[colleague]),/办理交接/);
ok((await sys('SELECT active FROM profiles WHERE id=$1',[colleague]))[0].active===true,'account stays on');
const offboard=async(who,user,to,note='紧急离职')=>{await actor(who);return (await db.query('SELECT renovation_offboard_user($1,$2,$3) v',[user,to,note])).rows[0].v;};
await reject(()=>offboard(staff,colleague,manager),/无权/);
await reject(()=>offboard(manager,colleague,manager,' '),/写明/);
await reject(()=>offboard(manager,colleague,outsider),/接手人/);
await reject(()=>offboard(manager,manager,colleague),/不能停用自己/);
ok((await offboard(manager,colleague,manager)).projects>=1,'urgent departure moves projects');
const after=(await sys('SELECT created_by,sales_by FROM renovation_projects WHERE id=$1',[id]))[0];ok(after.created_by===manager&&after.sales_by===staff,'work to manager, credit unchanged');
ok((await sys('SELECT active FROM profiles WHERE id=$1',[colleague]))[0].active===false,'account off');
ok((await sys(`SELECT forced FROM renovation_handovers WHERE from_user=$1 ORDER BY created_at DESC LIMIT 1`,[colleague]))[0].forced===true,'marked as forced');
await db.exec(`RESET ROLE;UPDATE profiles SET active=false WHERE id='${outsider}'`);checks++; // no work: normal disable still fine

// Internal detail stays internal, even for a customer or supplier who has a login.
for(const outside of [customerUser,supplierUser]){
 await actor(outside);
 for(const table of ['renovation_work_items','renovation_custom_confirmations','renovation_purchase_batches','renovation_handovers','renovation_audit','renovation_work_orders'])
  ok((await db.query(`SELECT * FROM ${table}`)).rows.length===0,`${table} hidden from non-staff`);
 ok((await db.query(`SELECT * FROM storage.objects WHERE bucket_id='renovation-fulfillment'`)).rows.length===0,'files hidden from non-staff');
 const seen=(await db.query('SELECT renovation_my_todos() v')).rows[0].v;ok(seen.items.length===0&&seen.handovers.length===0,'no to-dos for non-staff');
 ok((await db.query('SELECT renovation_handover_people() v')).rows[0].v.length===0,'no staff list for non-staff');
 await reject(()=>db.query('SELECT renovation_fulfillment_command($1,0,$2,$3::jsonb)',[id,'arrive','{}']),/无此项目权限/);
}
// The customer's two views carry only these fields: no assignee, supplier, order number, price, problem note or staff.
await actor(staff,'anon');
const customerProgress=(await db.query('SELECT renovation_customer_progress_view(t) v FROM (SELECT $1::uuid t) x',[(await (async()=>{const r=await sys('SELECT customer_token FROM renovation_projects WHERE id=$1',[id]);await actor(staff,'anon');return r;})())[0].customer_token])).rows[0].v;
ok(customerProgress.work_orders.every(w=>Object.keys(w).sort().join()==='group_name,status,updated_at'),'customer progress: group, status, date only');
const signedCopy=(await sys('SELECT terms FROM renovation_custom_confirmations WHERE work_order_id=$1 ORDER BY version LIMIT 1',[custom.id]))[0].terms;
ok(Object.keys(signedCopy).sort().join()==='address,change_note,contract_no,customer_name,document_sha256,group_name,lines,note,version','signing page fields are fixed');
ok(signedCopy.lines.every(l=>Object.keys(l).sort().join()==='id,name,qty,spec,unit'),'signing lines carry no price, supplier or stage');
await actor(staff,'anon');const reopened=(await db.query('SELECT renovation_custom_sign_open($1,$2,$3) v',[(await (async()=>{const r=await latest(custom.id);await actor(staff,'anon');return r;})()).id,(await (async()=>{const r=await latest(custom.id);await actor(staff,'anon');return r;})()).signing_token,'4567'])).rows[0].v;
ok(Object.keys(reopened).every(k=>['status','terms','terms_hash','document_path','signed_at','signer_name','signer_relation','signature_hash'].includes(k)),'signing response has no internal fields');

// Re-running keeps everything
const before=(await sys('SELECT count(*)::int n FROM renovation_work_items'))[0].n;await db.exec('RESET ROLE');await db.exec(migration);ok((await sys('SELECT count(*)::int n FROM renovation_work_items'))[0].n===before,'re-run keeps tracking data');
ok((await items()).C1.stage==='done','re-run keeps progress');
console.log(`PASS ${checks} fulfilment checks`);
