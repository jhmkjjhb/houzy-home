// Addition and deduction signing links need the owner's phone last 4 digits before showing or signing anything.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();let checks=0;
const ok=(value,message)=>{assert(value,message);checks++;};
const reject=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
const store='10000000-0000-4000-8000-000000000001',staff='20000000-0000-4000-8000-000000000001',manager='20000000-0000-4000-8000-000000000002';
const id='30000000-0000-4000-8000-000000000001',full='30000000-0000-4000-8000-000000000002';
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE TABLE stores(id uuid PRIMARY KEY,name text,region text);CREATE TABLE profiles(id uuid PRIMARY KEY,name text DEFAULT '',active boolean,role text,store_id uuid,region text,phone text);
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
INSERT INTO stores VALUES('${store}','Austin','JB');INSERT INTO profiles(id,active,role,store_id,region) VALUES('${staff}',true,'staff','${store}','JB'),('${manager}',true,'store_manager','${store}','JB');`);
for(const name of ['renovation_orders','renovation_payments','renovation_payment_installments','renovation_phone_lookup','renovation_customer_orders','renovation_additions','renovation_addition_signatures','renovation_signing_link','renovation_payment_allocations','renovation_customer_progress','renovation_deductions','renovation_partial_deductions','renovation_contract_esign','renovation_installment_statements','renovation_statement_contact','renovation_prorate_installments','renovation_signing_phone_check'])
 await db.exec(fs.readFileSync(`supabase/${name}_migration.sql`,'utf8'));

// Contract RM 100,000 in four installments 30/30/30/10; no contract discount, so a deduction credit equals the line amount.
const snapshot={net:100000,discount:0,payments:[{name:'签约定金',amount:30000},{name:'水电完工',amount:30000},{name:'泥水完工',amount:30000},{name:'竣工交付',amount:10000}],lines:[
 {id:'10',name:'石英石台面',qty:1,rate:4000,kind:'material',group:'厨房',unit:'lot',warranties:[]},
 {id:'11',name:'淋浴玻璃隔断',qty:1,rate:1655.24,kind:'material',group:'浴室',unit:'lot',warranties:[]},
 {id:'12',name:'鞋柜',qty:1,rate:4000,kind:'material',group:'玄关',unit:'lot',warranties:[]},
 {id:'13',name:'其他工程',qty:1,rate:90344.76,kind:'work',group:'其他',unit:'lot',warranties:[]}]};
const project=async(pid,no)=>{
 await db.query(`INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address,state,snapshot)
  VALUES($1,$2,$3,$4,'Owner','60101234567','Test address','confirmed',$5::jsonb)`,[pid,store,staff,no,JSON.stringify(snapshot)]);
 await db.query(`INSERT INTO renovation_work_orders(project_id,group_name,line_ids,assignee,status) VALUES
  ($1,'厨房','["10"]'::jsonb,'','draft'),($1,'浴室','["11"]'::jsonb,'','draft'),($1,'玄关','["12"]'::jsonb,'','draft'),($1,'其他','["13"]'::jsonb,'工长','working')`,[pid]);
};
await project(id,'TEST-PRORATE');await project(full,'TEST-ALL-PAID');
let ref=0;
const pay=async(pid,installment,amount)=>db.query(`INSERT INTO renovation_payments(id,project_id,kind,amount,method,paid_on,reference,created_by,verified_by,verified_at,installment)
 VALUES(gen_random_uuid(),$1,'receipt',$2,'bank_transfer','2026-11-01',$3,$4,$4,now(),$5)`,[pid,amount,'REF-'+(++ref),staff,installment]);
const rev=async(pid=id)=>(await db.query('SELECT revision FROM renovation_projects WHERE id=$1',[pid])).rows[0].revision;
const token=async(pid=id)=>(await db.query('SELECT customer_token FROM renovation_projects WHERE id=$1',[pid])).rows[0].customer_token;
const actor=async(who,role='authenticated')=>db.exec(`RESET ROLE;SET request.jwt.claim.sub='${who}';SET ROLE ${role}`);
const ink=[[[0.1,0.2],[0.13,0.25],[0.2,0.3],[0.25,0.15],[0.3,0.3],[0.4,0.45],[0.5,0.3],[0.6,0.2]]];
const addition=async(entry,data,action='add',pid=id)=>(await db.query('SELECT renovation_addition_command($1,$2,$3,$4,$5::jsonb) value',[pid,await rev(pid),action,entry,JSON.stringify(data)])).rows[0].value;
// Phone 60101234567 → last 4 = 4567. A signing link shows nothing and signs nothing until the owner's
// last 4 digits pass, so a link forwarded into a group chat leaks neither amounts nor a signature.
await actor(staff);
const add=await addition(crypto.randomUUID(),{category:'work',name:'加装插座',qty:2,rate:100,unit:'个',group_name:'电',payment_node:'增项确认后'});
const ded=(await db.query('SELECT renovation_deduction_command($1,$2,$3,$4,$5::jsonb) value',[id,await rev(),'add',crypto.randomUUID(),JSON.stringify({line_id:'12',reason:'客户确认取消'})])).rows[0].value;
await actor('','anon');
const q=async(sql,args)=>(await db.query(sql,args)).rows[0].value;
const openAdd=(l4,key=add.signing_token)=>q('SELECT renovation_signing_link_open($1,$2,$3) value',[add.id,key,l4]);
const openDed=l4=>q('SELECT renovation_deduction_link_open($1,$2,$3) value',[ded.id,ded.signing_token,l4]);
const signAdd=(l4,hash)=>q('SELECT renovation_signing_link_sign($1,$2,$3,$4,$5,$6::jsonb,true) value',[add.id,add.signing_token,l4,hash,'家人',JSON.stringify(ink)]);
const signDed=(l4,hash)=>q('SELECT renovation_deduction_link_sign($1,$2,$3,$4,$5,$6::jsonb,true) value',[ded.id,ded.signing_token,l4,hash,'业主',JSON.stringify(ink)]);
const denied=async(sql,args)=>{await reject(()=>q(sql,args),/permission denied/);await actor('','anon');};

// The old entry points that needed no phone check are closed to the public.
await denied('SELECT renovation_signing_link_view($1,$2) value',[add.id,add.signing_token]);
await denied('SELECT renovation_deduction_sign_view($1,$2) value',[ded.id,ded.signing_token]);
await denied('SELECT renovation_deduction_sign($1,$2,$3,$4,$5::jsonb,true) value',[ded.id,ded.signing_token,'x','a',JSON.stringify(ink)]);
await denied('SELECT renovation_signing_link_sign($1,$2,$3,$4,$5::jsonb,true) value',[add.id,add.signing_token,'x','a',JSON.stringify(ink)]);

// Wrong digits reveal no money.
const wrong=await openAdd('0000');
ok(wrong.status==='wrong_phone'&&wrong.remaining===7&&!('terms' in wrong),'wrong digits: no terms, 7 tries left');
ok(!JSON.stringify(await openDed('1111')).includes('payment_plan'),'deduction link with wrong digits shows no plan');
ok(await openAdd('4567',crypto.randomUUID())===null,'a wrong link token opens nothing');

// Signing before any passed check is refused even with the right digits (no guessing through sign).
await reject(()=>signDed('4567','0'.repeat(64)),/重新验证/);await actor('','anon');

// Right digits open the terms.
const good=await openAdd('4567');
ok(good.status==='pending'&&good.terms.amount===200&&good.terms_hash.length===64,'right digits show the addition');
ok(good.terms.payment_plan===undefined,'addition link still hides the installment plan');
const dv=await openDed('4567');
ok(dv.status==='pending'&&Array.isArray(dv.terms.payment_plan),'deduction link shows the plan after the check');

// Signing re-checks the digits.
await reject(()=>signAdd('1234',good.terms_hash),/重新验证/);await actor('','anon');
ok((await signAdd('4567',good.terms_hash)).ok,'addition signed after the check');
const dv2=await openDed('4567');ok(dv2.terms_hash!==dv.terms_hash,'signed addition changed the deduction plan, so terms are re-read');
ok((await signDed('4567',dv2.terms_hash)).ok,'deduction signed after the check');
ok((await openDed('4567')).status==='signed','signed deduction viewable after the check');
ok((await openDed('0000')).terms===undefined,'signed deduction still hidden behind the check');

// 8 wrong tries lock the link for an hour; the right digits are refused while locked.
await actor(staff);
const add2=await addition(crypto.randomUUID(),{category:'work',name:'加装灯',qty:1,rate:50,unit:'个',group_name:'电',payment_node:'增项确认后'});
await actor('','anon');
const open2=l4=>q('SELECT renovation_signing_link_open($1,$2,$3) value',[add2.id,add2.signing_token,l4]);
let last;for(let i=0;i<8;i++)last=await open2('9999');
ok(last.status==='locked','8th wrong try locks the link');
ok((await open2('4567')).status==='locked','right digits refused while locked');
await db.exec(`RESET ROLE;UPDATE renovation_additions SET link_locked_until=now()-interval '1 minute' WHERE id='${add2.id}'`);await actor('','anon');
ok((await open2('4567')).status==='pending','opens again after the hour');

// No registered phone: nothing can be opened by guessing.
await db.exec(`RESET ROLE;UPDATE renovation_projects SET customer_phone='' WHERE id='${id}'`);await actor('','anon');
ok((await openAdd('4567')).status==='no_phone','no registered phone: nothing shown');

console.log('PASS',checks,'signing link phone checks');await db.close();
