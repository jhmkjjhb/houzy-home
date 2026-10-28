// Contract e-signature: only the owner (phone last-4) can sign, what they signed cannot be
// changed afterwards, and the contract locks only after a store manager countersigns.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();let checks=0;
const ok=(value,message)=>{assert(value,message);checks++;};
const reject=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
const store='10000000-0000-4000-8000-000000000001',staff='20000000-0000-4000-8000-000000000001',manager='20000000-0000-4000-8000-000000000002';
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE TABLE stores(id uuid PRIMARY KEY,name text,region text);CREATE TABLE profiles(id uuid PRIMARY KEY,active boolean,role text,store_id uuid,region text);
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
INSERT INTO stores VALUES('${store}','Austin','JB');INSERT INTO profiles VALUES('${staff}',true,'staff','${store}','JB'),('${manager}',true,'store_manager','${store}','JB');`);
for(const name of ['renovation_orders','renovation_payments','renovation_payment_installments','renovation_phone_lookup','renovation_customer_orders','renovation_additions','renovation_addition_signatures','renovation_signing_link','renovation_payment_allocations','renovation_customer_progress','renovation_deductions','renovation_partial_deductions'])
 await db.exec(fs.readFileSync(`supabase/${name}_migration.sql`,'utf8'));
const migration=fs.readFileSync('supabase/renovation_contract_esign_migration.sql','utf8');
await db.exec(migration);await db.exec(migration);checks++;
const sha='a'.repeat(64),ink=[[[0.1,0.2],[0.13,0.25],[0.2,0.3],[0.25,0.15],[0.3,0.3],[0.4,0.45],[0.5,0.3],[0.6,0.2]]];
const project=async(id)=>{
 const snapshot={contract_path:`${id}/contract-${crypto.randomUUID()}.pdf`,signed_on:'',net:100000,discount:0,payments:[{name:'定金',amount:30000},{name:'完工',amount:70000}],
  lines:[{id:'1',name:'全屋',qty:1,rate:100000,kind:'work',group:'全屋',unit:'lot',warranties:[]}]};
 await db.exec('RESET ROLE');
 await db.query(`INSERT INTO storage.objects(bucket_id,name) VALUES('renovation-contracts',$1)`,[snapshot.contract_path]);
 await db.query(`INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address,state,snapshot)
  VALUES($1,$2,$3,$5,'Wei Li Li','+60 12-345 6789','35 Austin Mutiara','draft',$4::jsonb)`,[id,store,staff,JSON.stringify(snapshot),'HZ-TEST-'+id.slice(-1)]);
 return snapshot;
};
const as=async(who,role='authenticated')=>db.exec(`RESET ROLE;SET request.jwt.claim.sub='${who}';SET ROLE ${role}`);
const rev=async id=>{await db.exec('RESET ROLE');return (await db.query('SELECT revision FROM renovation_projects WHERE id=$1',[id])).rows[0].revision;};
const command=async(who,id,action,data)=>{const r=await rev(id);await as(who);return (await db.query('SELECT renovation_contract_esign_command($1,$2,$3,$4::jsonb) value',[id,r,action,JSON.stringify(data)])).rows[0].value;};
const open=async(e,key,last4)=>{await as('','anon');return (await db.query('SELECT renovation_contract_esign_open($1,$2,$3) value',[e,key,last4])).rows[0].value;};
const sign=async(e,key,last4,hash)=>{await as('','anon');return (await db.query('SELECT renovation_contract_esign_sign($1,$2,$3,$4,$5::jsonb,true) value',[e,key,last4,hash,JSON.stringify(ink)])).rows[0].value;};
const row=async id=>{await db.exec('RESET ROLE');return (await db.query('SELECT * FROM renovation_projects WHERE id=$1',[id])).rows[0];};
const readable=async path=>{await db.exec('RESET ROLE');return (await db.query('SELECT _reno_esign_pdf_readable($1) v',[path])).rows[0].v;};

const A='30000000-0000-4000-8000-00000000000a';const snapA=await project(A);
await reject(()=>command(staff,A,'request',{contract_sha256:'xyz'}),/指纹无效/);
const req=await command(staff,A,'request',{contract_sha256:sha});
ok(req.status==='pending'&&req.terms.money.net===100000&&req.terms.contract_sha256===sha,'request freezes PDF fingerprint and money terms');
await reject(()=>command(staff,A,'request',{contract_sha256:sha}),/进行中的电子签署/);
ok(!(await readable(snapA.contract_path)),'PDF is not downloadable before the phone check');
const miss=await open(req.id,req.signing_token,'0000');
ok(miss.status==='wrong_phone'&&miss.remaining===7&&!miss.terms,'wrong last-4 reveals nothing and counts the attempt');
ok(await open(req.id,crypto.randomUUID(),'6789')===null,'wrong link token reveals nothing');
const view=await open(req.id,req.signing_token,'6789');
ok(view.status==='pending'&&view.terms.customer_name==='Wei Li Li'&&view.contract_path===snapA.contract_path,'owner sees contract after phone check');
ok(await readable(snapA.contract_path),'PDF readable during verified window');
await reject(()=>sign(req.id,req.signing_token,'1234',view.terms_hash),/身份验证/);
await reject(()=>sign(req.id,req.signing_token,'6789','0'.repeat(64)),/内容已更新/);
// Store must not lock the contract while the owner has not signed.
await db.exec('RESET ROLE');await db.query(`UPDATE renovation_projects SET snapshot=snapshot||'{"signed_on":"2026-10-01"}' WHERE id=$1`,[A]);
await as(manager);await reject(async()=>db.query(`SELECT renovation_command($1,$2,'confirm','{"signed":true,"reviewed":true}'::jsonb)`,[A,(await row(A)).revision]),/电子签署尚未完成/);
const signed=await sign(req.id,req.signing_token,'6789',view.terms_hash);
ok(signed.ok&&signed.signature_hash.length===64,'owner signs with hand-drawn signature');
const afterSign=await row(A);
const today=new Date(Date.now()+8*3600e3).toISOString().slice(0,10);
ok(afterSign.snapshot.signed_on===today,'signing date is stamped as the contract signed date (Malaysia time)');
ok(!(await readable(snapA.contract_path)),'PDF link closes once signed');
await reject(()=>sign(req.id,req.signing_token,'6789',view.terms_hash),/不能重复签署/);
// After signing: transcription fixes allowed, money terms frozen.
await db.exec('RESET ROLE');
await db.query(`UPDATE renovation_projects SET snapshot=jsonb_set(snapshot,'{lines,0,name}','"全屋装修"')||'{"signed_on":""}' WHERE id=$1`,[A]);
ok((await row(A)).snapshot.signed_on===today,'re-saving lines keeps the e-signed date');
await reject(()=>db.query(`UPDATE renovation_projects SET snapshot=jsonb_set(snapshot,'{net}','90000') WHERE id=$1`,[A]),/不能再修改/);
await reject(()=>db.query(`UPDATE renovation_projects SET snapshot=jsonb_set(snapshot,'{contract_path}','"x.pdf"') WHERE id=$1`,[A]),/不能再修改/);
await as(manager);await reject(async()=>db.query(`SELECT renovation_command($1,$2,'confirm','{"signed":true,"reviewed":true}'::jsonb)`,[A,await rev(A)]),/店长会签/);
const signedPath=`${A}/signed-contract-${crypto.randomUUID()}.pdf`;
const cs={signer_name:'Store Manager',strokes:ink,signed_pdf_path:signedPath,signed_pdf_sha256:'b'.repeat(64)};
await reject(()=>command(staff,A,'countersign',cs),/店长/);
await reject(()=>command(manager,A,'countersign',cs),/尚未归档/);
await db.exec("RESET ROLE");await db.query(`INSERT INTO storage.objects(bucket_id,name) VALUES('renovation-contracts',$1)`,[signedPath]);
await reject(()=>command(manager,A,'countersign',{...cs,strokes:[[[0.1,0.1],[0.1,0.1]]]}),/签名/);
const done=await command(manager,A,'countersign',cs);
ok(done.status==='countersigned','manager countersigns with the archived signed PDF');
const afterCs=await row(A);
ok(afterCs.snapshot.contract_path===signedPath&&afterCs.snapshot.unsigned_contract_path===snapA.contract_path,'archive now opens the signed copy; unsigned original kept');
await as(manager);await db.query(`SELECT renovation_command($1,$2,'confirm','{"signed":true,"reviewed":true}'::jsonb)`,[A,await rev(A)]);
ok((await row(A)).state==='confirmed','contract confirms after owner signature and countersign');
// A deposit paid weeks before the e-signing day can still be recorded (up to 180 days earlier).
const day=n=>new Date(Date.now()+8*3600e3-n*86400e3).toISOString().slice(0,10);
const pay=async(paid_on,ref)=>{const r=await rev(A);await as(manager);return (await db.query('SELECT renovation_payment_command($1,$2,$3,$4,$5::jsonb) value',[A,r,'add',crypto.randomUUID(),JSON.stringify({kind:'receipt',amount:1000,method:'bank_transfer',paid_on,reference:ref,note:'定金',installment:1})])).rows[0].value;};
ok(Number((await pay(day(100),'DEP-100')).amount)===1000,'deposit 100 days before e-signing is accepted');
await reject(()=>pay(day(200),'DEP-200'),/180天/);

// Pending link is voided automatically when money terms change before the owner signs.
const B='30000000-0000-4000-8000-00000000000b';await project(B);
const reqB=await command(staff,B,'request',{contract_sha256:sha});
await db.exec('RESET ROLE');await db.query(`UPDATE renovation_projects SET snapshot=jsonb_set(snapshot,'{payments,0,amount}','25000')||'{"net":95000}' WHERE id=$1`,[B]);
ok((await open(reqB.id,reqB.signing_token,'6789')).status==='voided','changing amounts voids an unsigned link');
await reject(()=>sign(reqB.id,reqB.signing_token,'6789','x'),/作废/);
// Eight wrong guesses lock the link, even for the right digits afterwards.
const reqB2=await command(staff,B,'request',{contract_sha256:sha});
for(let i=0;i<8;i++)await open(reqB2.id,reqB2.signing_token,String(1000+i));
ok((await open(reqB2.id,reqB2.signing_token,'6789')).status==='locked','8 wrong phone checks lock the link');
// The verified window expires.
await command(staff,B,'void',{reason:'重发'});const reqB3=await command(staff,B,'request',{contract_sha256:sha});
const vB=await open(reqB3.id,reqB3.signing_token,'6789');
await db.exec('RESET ROLE');await db.query(`UPDATE renovation_contract_esigns SET verified_until=now()-interval '1 minute' WHERE id=$1`,[reqB3.id]);
await reject(()=>sign(reqB3.id,reqB3.signing_token,'6789',vB.terms_hash),/身份验证已过期/);
// Signed but not countersigned: only a manager may void.
await open(reqB3.id,reqB3.signing_token,'6789');const vB3=await open(reqB3.id,reqB3.signing_token,'6789');await sign(reqB3.id,reqB3.signing_token,'6789',vB3.terms_hash);
await reject(()=>command(staff,B,'void',{reason:'改合同'}),/须由店长作废/);
ok((await command(manager,B,'void',{reason:'改合同'})).status==='voided','manager can void a signed, not yet countersigned contract');
// Paper contracts (no e-sign) confirm as before.
const C='30000000-0000-4000-8000-00000000000c';await project(C);await db.exec('RESET ROLE');await db.query(`UPDATE renovation_projects SET snapshot=snapshot||'{"signed_on":"2026-10-01"}' WHERE id=$1`,[C]);
await as(manager);await db.query(`SELECT renovation_command($1,$2,'confirm','{"signed":true,"reviewed":true}'::jsonb)`,[C,await rev(C)]);
ok((await row(C)).state==='confirmed','paper contract flow unchanged');
console.log('PASS',checks,'contract e-sign checks');await db.close();
