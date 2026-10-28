// The phone printed on a payment statement belongs to the staff account that owns the order;
// with no phone (or a deactivated account) the PDF falls back to the store number.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();let checks=0;
const ok=(v,m)=>{assert(v,m);checks++;};const reject=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
const store='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',staff='20000000-0000-4000-8000-000000000001',outsider='20000000-0000-4000-8000-000000000009',id='30000000-0000-4000-8000-000000000001';
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE TABLE stores(id uuid PRIMARY KEY,name text,region text);CREATE TABLE profiles(id uuid PRIMARY KEY,active boolean,role text,store_id uuid,region text,phone text);
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
INSERT INTO stores VALUES('${store}','Austin','JB'),('${other}','Other','JB');
INSERT INTO profiles VALUES('${staff}',true,'staff','${store}','JB','+60 12-888 0001'),('${outsider}',true,'staff','${other}','JB',null);`);
for(const name of ['renovation_orders','renovation_payments','renovation_payment_installments','renovation_phone_lookup','renovation_customer_orders','renovation_additions','renovation_addition_signatures','renovation_signing_link','renovation_payment_allocations','renovation_customer_progress','renovation_deductions','renovation_installment_statements'])
 await db.exec(fs.readFileSync(`supabase/${name}_migration.sql`,'utf8'));
const migration=fs.readFileSync('supabase/renovation_statement_contact_migration.sql','utf8');await db.exec(migration);await db.exec(migration);checks++;
const snapshot={net:1000,discount:0,payments:[{name:'Deposit',amount:500},{name:'Handover',amount:500}],lines:[{id:'A',name:'Work',qty:1,rate:1000,kind:'work',group:'Base',unit:'lot',warranties:[]}]};
await db.query(`INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address,state,snapshot)
 VALUES($1,$2,$3,'PHONE-TEST','Owner','60101234567','Site','confirmed',$4::jsonb)`,[id,store,staff,JSON.stringify(snapshot)]);
const token=(await db.query('SELECT customer_token FROM renovation_projects WHERE id=$1',[id])).rows[0].customer_token;
const as=async(who,role='authenticated')=>db.exec(`RESET ROLE;SET request.jwt.claim.sub='${who}';SET ROLE ${role}`);
const customer=async()=>{await as('','anon');return (await db.query('SELECT renovation_customer_installment_statement($1,1) value',[token])).rows[0].value;};
const staffView=async(who=staff)=>{await as(who);return (await db.query('SELECT renovation_statement_contact($1) value',[id])).rows[0].value;};
ok((await customer()).contact_phone==='+60 12-888 0001','customer statement shows the order owner phone');
ok((await staffView()).contact_phone==='+60 12-888 0001','staff download gets the same phone');
await reject(()=>staffView(outsider),/无此项目权限/);
await db.exec('RESET ROLE');await db.query(`UPDATE profiles SET phone='  ' WHERE id=$1`,[staff]);
ok((await customer()).contact_phone===null,'blank phone falls back (null) so the PDF uses the store number');
await db.exec('RESET ROLE');await db.query(`UPDATE profiles SET phone='+60 12-888 0001',active=false WHERE id=$1`,[staff]);
ok((await customer()).contact_phone===null,'deactivated staff phone is not printed');
console.log('PASS',checks,'statement contact phone checks');await db.close();
