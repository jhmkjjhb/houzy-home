// 履约子单转发签字（工厂 / 负责人）。
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

// 转发签字：工厂 / 负责人凭「链接 + 4 位验证码」签字。要保证的是：
// 1) 链接里没有价格、没有业主姓名电话（工厂不该看到）；2) 没有验证码看不到内容，猜错 8 次锁定；
// 3) 只有本项目有权限的员工能发起和撤销；4) 签过的不能被改签、撤销的不能再签；5) 签字只是凭证，不改清单进度。
const so=fs.readFileSync('supabase/renovation_party_signoffs_migration.sql','utf8');await db.exec('RESET ROLE');await db.exec(so);await db.exec(so);checks++;const op=fs.readFileSync('supabase/renovation_signoff_owner_proof_migration.sql','utf8');await db.exec(op);await db.exec(op);
const custom=await wo('全屋定制');
async function cmd(who,action,data){await actor(who);return (await db.query('SELECT renovation_signoff_command($1,$2,$3::jsonb) v',[id,action,JSON.stringify(data)])).rows[0].v;}
const anonQ=async(sql,args)=>{await actor(staff,'anon');return (await db.query(sql,args)).rows[0]?.v;};
const open=(s,code)=>anonQ('SELECT renovation_signoff_open($1,$2,$3) v',[s.id,s.token,code]);
const signIt=(s,code,hash,extra={})=>anonQ('SELECT renovation_signoff_sign($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) v',[s.id,s.token,code,hash,extra.name??'王师傅',extra.company??'广州工厂',extra.note??'',JSON.stringify(extra.strokes??strokes),extra.accept??true]);

// 发起：只签勾选的两项，带图纸
const s1=await cmd(staff,'create',{work_order_id:custom.id,purpose:'order',party:'广州工厂',note:'请按图纸生产',line_ids:['C1','C2'],document_path:`${id}/d1.pdf`,document_sha256:HASH});
ok(/^\d{4}$/.test(s1.code)&&s1.token,'staff gets a link token and a 4-digit code');
const row1=(await sys('SELECT * FROM renovation_party_signoffs WHERE id=$1',[s1.id]))[0];
ok(JSON.stringify(row1.line_ids)==='["C1","C2"]','only the ticked lines go to the factory');
const termsText=JSON.stringify(row1.terms);
ok(!/rate|price|amount|1000|Owner|60101234567/.test(termsText),'factory never sees prices or the owner name/phone');
ok(row1.terms.lines[0].name==='衣柜'&&row1.terms.lines[0].spec==='白色','factory sees name and spec');

// 权限
await reject(()=>cmd(outsider,'create',{work_order_id:custom.id,purpose:'order',party:'X'}),/无此项目权限/);
await reject(()=>cmd(staff,'create',{work_order_id:custom.id,purpose:'order',party:'X',line_ids:['W1']}),/不属于这张子单/);
await reject(()=>cmd(staff,'create',{work_order_id:custom.id,purpose:'order',party:''}),/签字方/);
await reject(()=>cmd(staff,'create',{work_order_id:custom.id,purpose:'issue',party:'X',line_ids:['C1']}),/问题处理签字/);
await reject(async()=>{await actor(staff,'anon');await db.query('SELECT access_code FROM renovation_party_signoffs');},/permission denied/);
await reject(async()=>{await actor(staff,'anon');await db.query(`SELECT renovation_signoff_command($1,'create','{}'::jsonb)`,[id]);},/permission denied/);
await actor(outsider);ok((await db.query('SELECT count(*)::int n FROM renovation_party_signoffs')).rows[0].n===0,'other stores cannot read codes');

// 验证码
const wrong=s1.code==='0000'?'1111':'0000';
let v=await open(s1,wrong);ok(v.status==='wrong_code'&&!v.terms&&v.remaining===7,'wrong code reveals nothing');
ok(await open({...s1,token:'00000000-0000-4000-8000-000000000000'},s1.code)===null,'wrong link reveals nothing');
await reject(()=>signIt(s1,s1.code,'x'),/验证已过期/);
v=await open(s1,s1.code);ok(v.status==='pending'&&v.document_path===`${id}/d1.pdf`&&v.terms.lines.length===2,'right code shows the lines and drawing');
ok((await anonQ('SELECT public._reno_signoff_doc_readable($1) v',[`${id}/d1.pdf`]))===true,'drawing readable after the code check');
await reject(()=>signIt(s1,s1.code,'0'.repeat(64)),/内容已更新/);
await reject(()=>signIt(s1,s1.code,v.terms_hash,{company:''}),/所属工厂/);
await reject(()=>signIt(s1,s1.code,v.terms_hash,{accept:false}),/勾选确认/);
const stagesBefore=JSON.stringify(Object.values(await items()).map(i=>[i.line_id,i.stage]));
const r=await signIt(s1,s1.code,v.terms_hash,{note:'颜色按样板'});ok(r.ok&&r.signature_hash,'factory signs');
ok(JSON.stringify(Object.values(await items()).map(i=>[i.line_id,i.stage]))===stagesBefore,'signing is a record only: item progress unchanged');
const signed=(await sys('SELECT * FROM renovation_party_signoffs WHERE id=$1',[s1.id]))[0];
ok(signed.status==='signed'&&signed.signer_company==='广州工厂'&&signed.signer_note==='颜色按样板'&&signed.verified_until===null,'signature, company and note are kept');
ok((await anonQ('SELECT public._reno_signoff_doc_readable($1) v',[`${id}/d1.pdf`]))===false,'drawing closed again after signing');
await reject(()=>signIt(s1,s1.code,v.terms_hash),/已签过/);
v=await open(s1,s1.code);ok(v.status==='signed'&&v.signer_name==='王师傅'&&!v.document_path,'reopening shows who signed');
await reject(()=>cmd(staff,'void',{signoff_id:s1.id,reason:'x'}),/只有等待签字/);
ok((await sys(`SELECT count(*)::int n FROM renovation_audit WHERE action IN ('signoff_created','signoff_signed')`))[0].n===2,'audit trail');

// 不勾选 = 整张子单；撤销后不能再签
const s2=await cmd(staff,'create',{work_order_id:custom.id,purpose:'arrival',party:'仓库阿明'});
ok((await sys('SELECT jsonb_array_length(line_ids) n FROM renovation_party_signoffs WHERE id=$1',[s2.id]))[0].n===3,'no ticks = whole sub-order');
await reject(()=>cmd(staff,'void',{signoff_id:s2.id,reason:''}),/撤销原因/);
await reject(()=>cmd(colleague,'void',{signoff_id:s2.id,reason:'x'}),/无此项目权限/);await cmd(manager,'void',{signoff_id:s2.id,reason:'发错人'});
ok((await open(s2,s2.code)).status==='voided','voided link shows nothing');
await reject(()=>signIt(s2,s2.code,'x'),/已撤销/);

// 猜 8 次锁定，之后正确验证码也打不开
const s3=await cmd(staff,'create',{work_order_id:custom.id,purpose:'install',party:'安装队'});
const bad=s3.code==='0000'?'1111':'0000';
for(let i=0;i<8;i++)v=await open(s3,bad);
ok(v.status==='locked','8 wrong codes lock the link');
ok((await open(s3,s3.code)).status==='locked','locked even with the right code');

// 问题处理：带上已标记的问题
await run(staff,'flag_issue',{work_order_id:custom.id,line_ids:['C2'],note:'门板破损',follow_up_on:later});
const s4=await cmd(staff,'create',{work_order_id:custom.id,purpose:'issue',party:'广州工厂',line_ids:['C2']});
ok((await sys('SELECT terms FROM renovation_party_signoffs WHERE id=$1',[s4.id]))[0].terms.lines[0].issue==='门板破损','issue sign-off carries the flagged problem');

// 重跑迁移不丢数据
await db.exec('RESET ROLE');await db.exec(so);await db.exec(op);ok((await sys('SELECT count(*)::int n FROM renovation_party_signoffs'))[0].n===4,'re-run keeps sign-offs');
// 工厂确认下单时带上业主签名确认的证据：每一项取业主最新一版已签名的确认（图纸 + 电子签名或纸质确认单），
// 工厂能看清业主确认了什么；业主姓名电话仍不给；到货 / 安装签字不带；验证码前和签完后都读不到这些文件。
{const P=await sys('SELECT 1');void P;
 await sys(`INSERT INTO storage.objects(bucket_id,name) VALUES('renovation-fulfillment','${id}/own1.pdf'),('renovation-fulfillment','${id}/own2.png'),('renovation-fulfillment','${id}/ownpaper.jpg'),('renovation-fulfillment','${id}/ownpending.pdf')`);
 const base=`INSERT INTO renovation_custom_confirmations(project_id,work_order_id,version,kind,line_ids,terms,document_path,document_sha256,status,method,signer_name,signer_relation,signed_at,signed_terms_hash,signature_strokes,signature_hash,paper_path,paper_sha256,paper_reviewed_by,created_by)`;
 await sys(base+` VALUES($1,$2,11,'confirm','["C1","C2"]','{}',$3,$4,'signed','paper','Owner','本人',now()-interval '2 day',NULL,NULL,NULL,$5,$4,$6,$6)`,[id,custom.id,`${id}/own1.pdf`,HASH,`${id}/ownpaper.jpg`,staff]);
 await sys(base+` VALUES($1,$2,12,'change','["C1"]','{}',$3,$4,'signed','electronic','Owner','本人',now()-interval '1 day',$4,$5::jsonb,$4,NULL,NULL,NULL,$6)`,[id,custom.id,`${id}/own2.png`,HASH,JSON.stringify(strokes),staff]);
 await sys(base+` VALUES($1,$2,13,'change','["C2"]','{}',$3,$4,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$5)`,[id,custom.id,`${id}/ownpending.pdf`,HASH,staff]);
 const o=await cmd(staff,'create',{work_order_id:custom.id,purpose:'order',party:'佛山工厂',line_ids:['C1','C2']});
 const readable=f=>anonQ('SELECT public._reno_signoff_doc_readable($1) v',[`${id}/${f}`]);
 ok(await readable('own2.png')===false,'owner drawing closed before the code check');
 const ov=await open(o,o.code),pr=ov.owner_proofs;
 ok(pr.length===2,'one proof per latest owner sign-off: '+JSON.stringify(pr.map(x=>x.version)));
 const c1=pr.find(x=>x.version===12),c2=pr.find(x=>x.version===11);
 ok(c1&&JSON.stringify(c1.lines)==='["衣柜"]'&&c1.method==='electronic'&&c1.strokes?.length===1&&c1.document_path===`${id}/own2.png`,'衣柜 shows the newest change drawing and the owner hand signature');
 ok(c2&&JSON.stringify(c2.lines)==='["地柜"]'&&c2.method==='paper'&&c2.paper_path===`${id}/ownpaper.jpg`&&!c2.strokes,'地柜 shows the earlier drawing and the signed paper form');
 ok(!/Owner|60101234567|本人/.test(JSON.stringify(ov)),'still no owner name, relation or phone');
 ok(await readable('own2.png')&&await readable('own1.pdf')&&await readable('ownpaper.jpg'),'owner drawing and paper form readable after the code check');
 ok(await readable('ownpending.pdf')===false,'an unsigned owner drawing is never shown');
 const a=await cmd(staff,'create',{work_order_id:custom.id,purpose:'arrival',party:'仓库'});ok((await open(a,a.code)).owner_proofs.length===0,'arrival links do not carry owner proofs');
 await signIt(o,o.code,ov.terms_hash);ok(await readable('own2.png')===false,'closed again once the factory has signed');checks++;}
console.log(`PASS ${checks} party sign-off checks`);
