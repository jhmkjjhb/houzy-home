import fs from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();let checks=0;
const ok=(v,m)=>{assert(v,m);checks++;};const reject=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
const store='10000000-0000-4000-8000-000000000001',staff='20000000-0000-4000-8000-000000000001',id='30000000-0000-4000-8000-000000000001';
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE TABLE stores(id uuid PRIMARY KEY,name text,region text);CREATE TABLE profiles(id uuid PRIMARY KEY,active boolean,role text,store_id uuid,region text);
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
INSERT INTO stores VALUES('${store}','Austin','JB');INSERT INTO profiles VALUES('${staff}',true,'staff','${store}','JB');`);
for(const name of ['renovation_orders','renovation_payments','renovation_payment_installments','renovation_phone_lookup','renovation_customer_orders','renovation_additions','renovation_addition_signatures','renovation_signing_link','renovation_payment_allocations','renovation_customer_progress','renovation_deductions'])
 await db.exec(fs.readFileSync(`supabase/${name}_migration.sql`,'utf8'));
const migration=fs.readFileSync('supabase/renovation_installment_statements_migration.sql','utf8');await db.exec(migration);await db.exec(migration);checks++;
const snapshot={net:1000,discount:0,payments:[{name:'Deposit',amount:500},{name:'Handover',amount:500}],lines:[{id:'A',name:'Work',qty:1,rate:1000,kind:'work',group:'Base',unit:'lot',warranties:[]}]};
await db.query(`INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address,state,snapshot)
 VALUES($1,$2,$3,'STAGE-TEST','Owner','60101234567','Test site','confirmed',$4::jsonb)`,[id,store,staff,JSON.stringify(snapshot)]);
const token=(await db.query('SELECT customer_token FROM renovation_projects WHERE id=$1',[id])).rows[0].customer_token;
async function role(who='',name='anon'){await db.exec(`RESET ROLE;SET request.jwt.claim.sub='${who}';SET ROLE ${name}`);}
const statement=async(stage=1,key=token)=>(await db.query('SELECT renovation_customer_installment_statement($1,$2) value',[key,stage])).rows[0].value;
await role();let s=await statement();
ok(s.status==='unpaid'&&Number(s.amount)===500&&Number(s.balance)===500,'unpaid stage shows due amount');
ok(s.customer_name==='Owner'&&s.contract_no==='STAGE-TEST'&&s.stage_name==='Deposit'&&s.entries.length===0,'document has customer, contract and stage details');
ok(!JSON.stringify(s).includes(token)&&!('customer_phone' in s)&&!('signing_token' in s),'statement omits project token, phone and signing secrets');
await reject(()=>statement(3),/付款期数不在/);await reject(()=>statement(1,crypto.randomUUID()),/客户链接无效/);
await db.exec('RESET ROLE');
const add=async({amount,method='bank_transfer',verified=true,installment=1,allocations=null,kind='receipt',reference})=>{
 await db.query(`INSERT INTO renovation_payments(id,project_id,kind,amount,method,paid_on,reference,note,created_by,verified_by,verified_at,installment,allocations)
 VALUES($1,$2,$3,$4,$5,current_date,$6,'',$7,$8,CASE WHEN $8::uuid IS NOT NULL THEN now() END,$9,$10::jsonb)`,
 [crypto.randomUUID(),id,kind,amount,method,reference,staff,verified?staff:null,allocations?null:installment,allocations?JSON.stringify(allocations):null]);
};
await add({amount:200,reference:'R-200'});await role();s=await statement();
ok(s.status==='partial'&&Number(s.paid)===200&&Number(s.balance)===300,'re-download after partial payment updates balance');
await db.exec('RESET ROLE');await add({amount:300,reference:'R-300'});await role();s=await statement();
ok(s.status==='paid'&&Number(s.balance)===0&&s.entries.length===2,'re-download after full payment reads paid in full');
await db.exec('RESET ROLE');await add({amount:100,kind:'refund',reference:'RF-100'});await role();s=await statement();
ok(s.status==='partial'&&Number(s.refunded)===100&&Number(s.balance)===100,'refund reopens stage balance');
await db.exec('RESET ROLE');await add({amount:50,installment:null,reference:'UNASSIGNED-50'});await role();s=await statement();
ok(s.status==='review'&&Number(s.unassigned_paid)===50&&Number(s.paid)===400,'unallocated money is flagged without falsely marking the stage paid');
await db.exec('RESET ROLE');await add({amount:50,method:'cash',verified:false,installment:2,reference:'CASH-50'});await role();const second=await statement(2);
ok(second.status==='review'&&Number(second.pending)===50&&Number(second.paid)===0,'unverified cash does not count as paid');
await db.exec('RESET ROLE');await add({amount:100,allocations:[{installment:1,amount:50},{installment:2,amount:50}],reference:'SPLIT-100'});await role();s=await statement();
ok(s.entries.at(-1).amount===50&&Number(s.paid)===450,'one split receipt contributes only its allocated amount to stage one');
await db.exec('RESET ROLE');
await db.exec(`SET request.jwt.claim.sub='${staff}';SET ROLE authenticated`);
const pending=crypto.randomUUID(),revision=(await db.query('SELECT revision FROM renovation_projects WHERE id=$1',[id])).rows[0].revision;
await db.query('SELECT renovation_addition_command($1,$2,$3,$4,$5::jsonb)',[id,revision,'add',pending,JSON.stringify({category:'work',name:'Extra',spec:'',qty:1,unit:'lot',rate:100,group_name:'Extra',payment_node:'After sign'})]);
await role();await reject(()=>statement(3),/待签或已撤销/);
console.log('PASS',checks,'installment statement database checks');await db.close();
