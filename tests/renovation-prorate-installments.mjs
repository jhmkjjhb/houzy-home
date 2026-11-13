// Signed additions and deductions change the unpaid installments by the contract ratio, so the
// customer keeps paying in the same number of installments and the installments always add up
// to the project total. Paid installments never change; cents go to the last unpaid installment.
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
for(const name of ['renovation_orders','renovation_payments','renovation_payment_installments','renovation_phone_lookup','renovation_customer_orders','renovation_additions','renovation_addition_signatures','renovation_signing_link','renovation_payment_allocations','renovation_customer_progress','renovation_deductions','renovation_partial_deductions','renovation_contract_esign','renovation_installment_statements','renovation_statement_contact'])
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
const signAddition=async(a,pid=id)=>{const t=await token(pid);await actor('','anon');
 const v=(await db.query('SELECT renovation_customer_addition_sign_view($1,$2,$3) value',[t,a.id,a.signing_token])).rows[0].value;
 await db.query('SELECT renovation_customer_sign_addition($1,$2,$3,$4,$5,$6::jsonb,true)',[t,a.id,a.signing_token,v.terms_hash,'Owner',JSON.stringify(ink)]);
 await db.exec('RESET ROLE');return v;};
const deduct=async(line,amount)=>{await actor(staff);const data={line_id:line,reason:'客户确认取消'};if(amount)data.amount=amount;
 const d=(await db.query('SELECT renovation_deduction_command($1,$2,$3,$4,$5::jsonb) value',[id,await rev(),'add',crypto.randomUUID(),JSON.stringify(data)])).rows[0].value;
 await actor('','anon');const v=(await db.query('SELECT renovation_deduction_sign_view($1,$2) value',[d.id,d.signing_token])).rows[0].value;return {d,v};};
const signDeduction=async({d,v})=>{await actor('','anon');await db.query('SELECT renovation_deduction_sign($1,$2,$3,$4,$5::jsonb,true)',[d.id,d.signing_token,v.terms_hash,'Owner',JSON.stringify(ink)]);await db.exec('RESET ROLE');};
const plan=async(pid=id)=>(await db.query('SELECT adjusted_payments FROM renovation_projects WHERE id=$1',[pid])).rows[0].adjusted_payments;
const amounts=async(pid=id)=>(await plan(pid)).map(s=>Number(s.amount));
const total=async(pid=id)=>Number((await db.query('SELECT current_total FROM renovation_projects WHERE id=$1',[pid])).rows[0].current_total);
const sum=a=>Math.round(a.reduce((x,y)=>x+y,0)*100)/100;

// An addition signed under the old rules stays a separate payment node after the migration.
await actor(staff);
const before=await addition(crypto.randomUUID(),{category:'work',name:'旧增项',qty:1,rate:500,unit:'lot',group_name:'旧增项',payment_node:'增项确认后'});
await signAddition(before);
await db.exec('RESET ROLE');
const migration=fs.readFileSync('supabase/renovation_prorate_installments_migration.sql','utf8');
await db.exec(migration);await db.exec(migration);checks++;
let billing=(await db.query('SELECT _reno_billing_plan($1) value',[id])).rows[0].value;
ok(Number(billing[4].amount)===500&&billing[4].merged===false,'an addition signed before the change keeps its own RM 500 payment node');
await pay(id,5,500);

// Installments 1 and 2 are paid in full.
await pay(id,1,30000);await pay(id,2,30000);

// Deduction RM 4,000: installments 3 and 4 (30% : 10%) fall by RM 3,000 and RM 1,000.
let dd=await deduct('10');
const rows=dd.v.terms.payment_plan;
ok(rows.length===4&&rows[0].paid_off===true&&rows[1].paid_off===true,'signing page marks the two paid installments');
ok(rows[0].before===30000&&rows[0].after===30000&&rows[1].after===30000,'paid installments do not change');
ok(rows[2].before===30000&&rows[2].after===27000&&rows[3].before===10000&&rows[3].after===9000,'customer sees 30,000 → 27,000 and 10,000 → 9,000 before signing');
ok(/按合同比例/.test(dd.v.terms.note)&&/零头计入最后一期/.test(dd.v.terms.note),'deduction wording explains the ratio and where the cents go');
await signDeduction(dd);
ok(JSON.stringify(await amounts())===JSON.stringify([30000,30000,27000,9000]),'signed deduction is spread by the contract ratio, not taken from the last installment');
ok(sum(await amounts())+500===await total(),'installments plus the old addition node equal the project total');
ok((await plan()).every((s,i)=>Number(s.contract_amount)===snapshot.payments[i].amount),'each installment keeps its contract amount for the "was RM …" note');

// Addition RM 8,000 is added to installments 3 and 4 the same way.
await actor(staff);
const add1=await addition(crypto.randomUUID(),{category:'material',name:'岛台',qty:1,rate:8000,unit:'lot',group_name:'厨房',payment_node:'增项确认后'});
const sv=await signAddition(add1);
ok(sv.terms.payment_node==='按合同比例并入未付清的各期','addition terms say it is added to the unpaid installments');
ok(sv.terms.payment_plan[2].after===33000&&sv.terms.payment_plan[3].after===11000,'customer sees 27,000 → 33,000 and 9,000 → 11,000 before signing the addition');
ok(JSON.stringify(await amounts())===JSON.stringify([30000,30000,33000,11000]),'signed addition is spread by the contract ratio');
billing=(await db.query('SELECT _reno_billing_plan($1) value',[id])).rows[0].value;
const node=billing.find(s=>s.addition_id===add1.id);
ok(node.merged===true&&Number(node.amount)===0,'a merged addition is not a payable node of its own');
ok(sum(await amounts())+500===await total(),'still adds up after the addition');
await db.exec('BEGIN');
await reject(async()=>{await pay(id,billing.indexOf(node)+1,1);await db.query('SELECT _reno_check_installment_totals($1)',[id]);},/超过本期应付金额/);
await db.exec('ROLLBACK');

// A second addition voided by the store manager comes back out exactly.
await actor(staff);
const add2=await addition(crypto.randomUUID(),{category:'work',name:'加装灯带',qty:1,rate:2000,unit:'lot',group_name:'灯光',payment_node:'增项确认后'});
await signAddition(add2);
ok(JSON.stringify(await amounts())===JSON.stringify([30000,30000,34500,11500]),'RM 2,000 addition adds RM 1,500 and RM 500');
await actor(manager);
await addition(add2.id,{reason:'客户改主意'},'void');
await db.exec('RESET ROLE');
ok(JSON.stringify(await amounts())===JSON.stringify([30000,30000,33000,11000]),'voiding a merged addition takes it back out of the same installments');

// Cents: RM 1,655.24 → installment 3 changes by a whole RM 1,241, the last installment takes RM 414.24.
dd=await deduct('11');
ok(dd.v.terms.payment_plan[2].after===31759&&dd.v.terms.payment_plan[3].after===10585.76,'whole ringgit on installment 3, cents on the last installment');
await signDeduction(dd);
ok(JSON.stringify(await amounts())===JSON.stringify([30000,30000,31759,10585.76]),'signed amounts match what the customer saw');
ok(sum(await amounts())+500===await total(),'adds up to the cent');

// Installment 3 is paid RM 31,000 of 31,759; a RM 4,000 deduction cannot push it below RM 31,000.
await pay(id,3,31000);
dd=await deduct('12');
ok(dd.v.terms.payment_plan[2].after===31000&&dd.v.terms.payment_plan[3].after===7344.76,'a part-paid installment stops at what was paid; the rest comes off the last');
await signDeduction(dd);
ok(JSON.stringify(await amounts())===JSON.stringify([30000,30000,31000,7344.76])&&sum(await amounts())+500===await total(),'signed and still adds up');

// Statement for installment 3 shows the contract amount next to the current one.
const tk=await token();await actor('','anon');
const st=(await db.query('SELECT renovation_customer_installment_statement($1,3) value',[tk])).rows[0].value;
ok(Number(st.amount)===31000&&Number(st.contract_amount)===30000,'installment statement carries the contract amount');
await db.exec('RESET ROLE');
await actor(staff);
const view=(await db.query('SELECT renovation_payment_view($1) value',[id])).rows[0].value;
const third=view.installments[2];
ok(Number(third.contract_amount)===30000&&Number(third.percentage)===30&&Number(third.amount)===31000,'staff view: contract 30% · was RM 30,000 · now RM 31,000');
ok(view.installments.find(s=>s.merged)?.merged===true,'staff view flags merged addition rows so they are hidden');
await db.exec('RESET ROLE');

// Family signing link keeps hiding money totals, and now the installment plan too.
await actor(staff);
const add3=await addition(crypto.randomUUID(),{category:'work',name:'加装插座',qty:2,rate:100,unit:'个',group_name:'电',payment_node:'增项确认后'});
await actor('','anon');
const link=(await db.query('SELECT renovation_signing_link_view($1,$2) value',[add3.id,add3.signing_token])).rows[0].value;
ok(link.terms.payment_plan===undefined&&link.terms.current_total===undefined,'family signing link does not show the installment plan');
await db.exec('RESET ROLE');

// Every installment already paid: an addition falls back to its own payment node.
await pay(full,1,30000);await pay(full,2,30000);await pay(full,3,30000);await pay(full,4,10000);
await actor(staff);
const late=await addition(crypto.randomUUID(),{category:'work',name:'竣工后加做',qty:1,rate:1200,unit:'lot',group_name:'补做',payment_node:'增项确认后'},'add',full);
const lv=await signAddition(late,full);
ok(lv.terms.payment_plan===null&&lv.terms.payment_node==='增项确认后','with nothing unpaid the customer signs a separate payment node');
billing=(await db.query('SELECT _reno_billing_plan($1) value',[full])).rows[0].value;
ok(Number(billing[4].amount)===1200&&billing[4].merged===false&&(await plan(full))===null,'contract installments stay untouched and the addition is its own RM 1,200 node');

// A deduction larger than everything still unpaid is refused when the store enters it, as before.
await db.exec('RESET ROLE');
await reject(()=>deduct('13',8000),/超过项目总额/);
await db.exec('RESET ROLE');
ok(JSON.stringify(await amounts())===JSON.stringify([30000,30000,31000,7344.76]),'refused deduction leaves the installments unchanged');
console.log(`PASS ${checks} installment proration checks`);
