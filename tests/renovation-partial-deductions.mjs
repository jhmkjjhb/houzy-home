// Partial deductions: a line that was done, but less than contracted, must stay in scope
// (work order, progress, warranty) while the customer pays only for what was done.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();let checks=0;
const ok=(value,message)=>{assert(value,message);checks++;};
const reject=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
const store='10000000-0000-4000-8000-000000000001',staff='20000000-0000-4000-8000-000000000001',id='30000000-0000-4000-8000-000000000001';
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE TABLE stores(id uuid PRIMARY KEY,name text,region text);CREATE TABLE profiles(id uuid PRIMARY KEY,active boolean,role text,store_id uuid,region text);
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
INSERT INTO stores VALUES('${store}','Austin','JB');INSERT INTO profiles VALUES('${staff}',true,'staff','${store}','JB');`);
for(const name of ['renovation_orders','renovation_payments','renovation_payment_installments','renovation_phone_lookup','renovation_customer_orders','renovation_additions','renovation_addition_signatures','renovation_signing_link','renovation_payment_allocations','renovation_customer_progress','renovation_deductions'])
 await db.exec(fs.readFileSync(`supabase/${name}_migration.sql`,'utf8'));
// A whole-line deduction made before this migration must keep working as a full removal.
const snapshot={net:171000,discount:19371.25,payments:[{name:'定金',amount:42750},{name:'水电',amount:68400},{name:'泥水',amount:51300},{name:'交付',amount:8550}],lines:[
 {id:'20',name:'拆除并新建大门门柱',qty:1,rate:2800,kind:'work',group:'车廊',unit:'lot',warranties:[]},
 {id:'21',name:'地砖铺贴',qty:100,rate:60,kind:'work',group:'地面',unit:'m2',warranties:[]},
 {id:'22',name:'其他工程',qty:1,rate:181571.25,kind:'work',group:'其他',unit:'lot',warranties:[]}]};
await db.query(`INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address,state,snapshot)
 VALUES($1,$2,$3,'TEST-PARTIAL','Owner','60101234567','Test address','confirmed',$4::jsonb)`,[id,store,staff,JSON.stringify(snapshot)]);
await db.query(`INSERT INTO renovation_work_orders(project_id,group_name,line_ids,assignee,status) VALUES($1,'门柱','["20"]'::jsonb,'',  'draft'),($1,'地面','["21"]'::jsonb,'工长','working'),($1,'其他','["22"]'::jsonb,'','draft')`,[id]);
const rev=async()=>(await db.query('SELECT revision FROM renovation_projects WHERE id=$1',[id])).rows[0].revision;
const actor=async(who,role='authenticated')=>db.exec(`RESET ROLE;SET request.jwt.claim.sub='${who}';SET ROLE ${role}`);
const command=async(action,entry,data)=>(await db.query('SELECT renovation_deduction_command($1,$2,$3,$4,$5::jsonb) value',[id,await rev(),action,entry,JSON.stringify(data)])).rows[0].value;
await actor(staff);
const old=await command('add',crypto.randomUUID(),{line_id:'20',reason:'客户取消门柱'});
const migration=fs.readFileSync('supabase/renovation_partial_deductions_migration.sql','utf8');
await db.exec('RESET ROLE');await db.exec(migration);await db.exec(migration);checks++;
const oldRow=(await db.query('SELECT partial,line_amount FROM renovation_deductions WHERE id=$1',[old.id])).rows[0];
ok(oldRow.partial===false&&Number(oldRow.line_amount)===2800,'existing whole-line deduction is backfilled as a full removal');

await actor(staff);
// 地砖 contracted 100 m² (RM 6,000), only 70 m² laid: deduct RM 1,800 of list price while tiling is in progress.
await reject(()=>command('add',crypto.randomUUID(),{line_id:'21',reason:'整项取消',}),/已安排或开始施工/);
await reject(()=>command('add',crypto.randomUUID(),{line_id:'21',amount:6000.01,reason:'超过原项'}),/不超过该项原清单金额/);
await reject(()=>command('add',crypto.randomUUID(),{line_id:'21',amount:'1800',reason:'文字金额'}),/须为数字/);
await reject(()=>command('add',crypto.randomUUID(),{line_id:'21',amount:10.005,reason:'三位小数'}),/最多两位小数/);
const entry=crypto.randomUUID();
const part=await command('add',entry,{line_id:'21',amount:1800,reason:'实际铺贴 70 m²，少做 30 m²'});
ok(part.partial===true&&Number(part.original_amount)===1800&&Number(part.line_amount)===6000,'partial deduction records reduced and full list amounts');
ok(Number(part.discount_credit)===1616.84,'reduced amount gets the same contract discount ratio (1800 × 171000/190371.25)');
ok((await command('add',entry,{line_id:'21',amount:1800,reason:'实际铺贴 70 m²，少做 30 m²'})).id===entry,'retrying the same save is idempotent');
await reject(()=>command('add',entry,{line_id:'21',amount:1900,reason:'实际铺贴 70 m²，少做 30 m²'}),/编号已使用/);

await actor('','anon');
const v=(await db.query('SELECT renovation_deduction_sign_view($1,$2) value',[entry,part.signing_token])).rows[0].value;
ok(v.terms.partial===true&&Number(v.terms.line_amount)===6000&&/照常保留施工/.test(v.terms.note),'signer sees it is a partial reduction and the line stays');
const ink=[[[0.1,0.2],[0.13,0.25],[0.2,0.3],[0.25,0.15],[0.3,0.3],[0.4,0.45],[0.5,0.3],[0.6,0.2]]];
const signed=(await db.query('SELECT renovation_deduction_sign($1,$2,$3,$4,$5::jsonb,true) value',[entry,part.signing_token,v.terms_hash,'Owner',JSON.stringify(ink)])).rows[0].value;
ok(signed.ok,'customer can sign a partial deduction while the work is in progress');

await db.exec('RESET ROLE');
const p=(await db.query('SELECT current_total,deductions_total FROM renovation_projects WHERE id=$1',[id])).rows[0];
ok(Number(p.current_total)===169383.16&&Number(p.deductions_total)===1616.84,'project total falls by the partial credit only');
const lines=(await db.query('SELECT _reno_effective_lines($1) value',[id])).rows[0].value;
ok(lines.some(l=>l.id==='21'),'partially deducted line stays in scope for warranty and checklists');
const work=(await db.query("SELECT status FROM renovation_work_orders WHERE project_id=$1 AND group_name='地面'",[id])).rows[0];
ok(work.status==='working','partial deduction does not close the running work order');
const customerToken=(await db.query('SELECT customer_token FROM renovation_projects WHERE id=$1',[id])).rows[0].customer_token;
await actor('','anon');
const customer=(await db.query('SELECT renovation_customer_view($1) value',[customerToken])).rows[0].value;
ok(customer.lines.some(l=>l.id==='21')&&customer.deductions[0].partial===true&&Number(customer.deductions[0].line_amount)===6000,'owner sees the line plus a partial deduction record');
await db.exec('RESET ROLE');
const progress=(await db.query('SELECT renovation_customer_progress_view($1) value',[customerToken])).rows[0].value;
ok(progress.work_orders.some(w=>w.group_name==='地面'),'owner progress still shows the partially reduced work');
await actor(staff);
await reject(()=>command('add',crypto.randomUUID(),{line_id:'21',amount:100,reason:'再减'}),/已有待签或已签/);
console.log('PASS',checks,'partial deduction checks');await db.close();
