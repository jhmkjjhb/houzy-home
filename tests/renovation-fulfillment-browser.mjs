// End-to-end in a real browser against a real Postgres engine: the page calls the actual database
// functions, so a wrong parameter name or a broken rule fails here. Nothing touches production.
import fs from 'node:fs';import http from 'node:http';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const db=new PGlite();const out='output/playwright/renovation-fulfillment';fs.mkdirSync(out,{recursive:true});
const store='10000000-0000-4000-8000-000000000001',staff='20000000-0000-4000-8000-000000000001',manager='20000000-0000-4000-8000-000000000002',colleague='20000000-0000-4000-8000-000000000003',id='30000000-0000-4000-8000-000000000001';
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth,storage TO authenticated,anon;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
CREATE TABLE stores(id uuid PRIMARY KEY,name text,region text,active boolean DEFAULT true);CREATE TABLE profiles(id uuid PRIMARY KEY,name text DEFAULT '',active boolean,role text,store_id uuid,region text,phone text);
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON stores,profiles TO authenticated;
INSERT INTO stores VALUES('${store}','Austin','JB');
INSERT INTO profiles(id,name,active,role,store_id,region,phone) VALUES('${staff}','Ali',true,'staff','${store}','JB','+60 11'),('${manager}','Mei',true,'store_manager','${store}','JB','+60 22'),('${colleague}','Bo',true,'staff','${store}','JB','+60 33');
CREATE FUNCTION public.get_my_profile() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$SELECT to_jsonb(p) FROM profiles p WHERE id=auth.uid()$$;
CREATE FUNCTION public._dash_kpi_period(date,date,integer,uuid,text) RETURNS text LANGUAGE plpgsql AS $f$BEGIN RETURN 'SELECT p.id, p.created_by, p.current_total';END$f$;
CREATE FUNCTION public.get_store_performance(date,date,uuid,boolean) RETURNS text LANGUAGE plpgsql AS $f$BEGIN RETURN 'OR p.created_by=a.id';END$f$;`);
for(const name of ['renovation_orders','renovation_payments','renovation_payment_installments','renovation_phone_lookup','renovation_customer_orders','renovation_additions','renovation_addition_signatures','renovation_signing_link','renovation_payment_allocations','renovation_customer_progress','renovation_deductions','renovation_partial_deductions','renovation_contract_esign','renovation_installment_statements','renovation_statement_contact','renovation_fulfillment'])
 await db.exec(fs.readFileSync(`supabase/${name}_migration.sql`,'utf8'));
const lines=[{id:'C1',name:'主卧衣柜',spec:'白色 2.4m',qty:1,rate:8800,kind:'custom',group:'全屋定制',unit:'lot',warranties:[]},{id:'C2',name:'书房柜',spec:'灰色',qty:1,rate:5100,kind:'custom',group:'全屋定制',unit:'lot',warranties:[]},{id:'S1',name:'柜门拉手',qty:10,rate:30,kind:'stock',group:'全屋定制',unit:'pc',warranties:[]},{id:'W1',name:'铺砖',qty:1,rate:100,kind:'work',group:'泥水',unit:'lot',warranties:[]}];
await db.query(`INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address,state,snapshot) VALUES($1,$2,$3,'HZ-E2E','Owner','60101234567','Jalan Test','executing',$4::jsonb)`,[id,store,staff,JSON.stringify({net:14300,discount:0,payments:[{name:'全款',amount:14300}],lines,warnings:[],source_text:''})]);
await db.query(`INSERT INTO renovation_work_orders(project_id,group_name,line_ids) VALUES($1,'全屋定制','["C1","C2","S1"]'::jsonb),($1,'泥水','["W1"]'::jsonb)`,[id]);
// Every browser request runs one at a time as the logged-in person, under row-level security.
let queue=Promise.resolve();const files=new Map();
const argTypes=async fn=>{await db.exec('RESET ROLE');const r=(await db.query(`SELECT proargnames n,(SELECT array_agg(format_type(t,NULL) ORDER BY o) FROM unnest(proargtypes::oid[]) WITH ORDINALITY u(t,o)) t FROM pg_proc WHERE proname=$1 AND pronamespace='public'::regnamespace`,[fn])).rows[0];if(!r)throw new Error('函数不存在 '+fn);return r;};
const asUser=async user=>db.exec(user?`RESET ROLE;SET request.jwt.claim.sub='${user}';SET ROLE authenticated`:`RESET ROLE;SET request.jwt.claim.sub='';SET ROLE anon`);
async function handle(user,req){
 if(req.kind==='rpc'){const t=await argTypes(req.name);const keys=Object.keys(req.args||{});for(const k of keys)if(!(t.n||[]).includes(k))throw new Error(`参数名错误 ${req.name}.${k}`);
  const sql=`SELECT public.${req.name}(${keys.map((k,i)=>`${k}=>$${i+1}::${t.t[t.n.indexOf(k)]}`).join(',')}) v`;
  const vals=keys.map(k=>{const v=req.args[k];return v!==null&&typeof v==='object'?JSON.stringify(v):v;});
  await asUser(user);return (await db.query(sql,vals)).rows[0].v;}
 if(req.kind==='select'){await asUser(user);const w=req.eq.map(([k],i)=>`${k}=$${i+1}`).join(' AND ');return (await db.query(`SELECT to_jsonb(t) v FROM public.${req.table} t ${w?'WHERE '+w:''} ${req.limit?'LIMIT '+Number(req.limit):''}`,req.eq.map(e=>e[1]))).rows.map(r=>r.v);}
 if(req.kind==='upload'){await db.exec('RESET ROLE');await db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',[req.bucket,req.path]);files.set(req.path,req.base64);return true;}
 if(req.kind==='download'){await asUser(user);const allowed=user?true:(await db.query('SELECT public._reno_custom_doc_readable($1) v',[req.path])).rows[0].v;if(!allowed)throw new Error('无权读取文件');return files.get(req.path);}
 throw new Error('unknown');
}
const server=http.createServer((q,s)=>{const p=path.join(process.cwd(),decodeURIComponent(new URL(q.url,'http://x').pathname));fs.readFile(p,(e,b)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'content-type':p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.png')?'image/png':'application/octet-stream'});s.end(b);});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const stub=`window.supabase={createClient:(u,k,o)=>{const call=async r=>{const x=JSON.parse(await window.__db(JSON.stringify(r)));return x;};
 const b64=async f=>{const a=new Uint8Array(await f.arrayBuffer());let s='';for(const c of a)s+=String.fromCharCode(c);return btoa(s);};
 return {rpc:async(name,args)=>call({kind:'rpc',name,args}),auth:{getSession:async()=>({data:{session:window.__signedIn?{user:{}}:null}})},
 from(table){const r={kind:'select',table,eq:[]};let one=false;const q={select(){return q},eq(k,v){r.eq.push([k,v]);return q},order(){return q},limit(n){r.limit=n;return q},single(){one=true;return q},then(ok,no){return call(r).then(x=>x.error?x:({data:one?(x.data||[])[0]:x.data,error:null})).then(ok,no);}};return q;},
 storage:{from:bucket=>({upload:async(path,file)=>call({kind:'upload',bucket,path,base64:await b64(file)}),download:async path=>{const x=await call({kind:'download',bucket,path});if(x.error)return x;const s=atob(x.data),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return {data:new Blob([a],{type:'image/png'}),error:null};},createSignedUrl:async()=>({data:{signedUrl:'about:blank'},error:null})})}};}};`;
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];
const open=async(user,url,viewport={width:1280,height:1000})=>{const c=await browser.newContext({viewport});await c.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});const page=await c.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await c.exposeFunction('__db',r=>{const req=JSON.parse(r);const job=queue.then(()=>handle(user,req)).then(data=>JSON.stringify({data,error:null}),e=>JSON.stringify({data:null,error:{message:e.message}}));queue=job.catch(()=>{});return job;});
 await c.addInitScript(`window.__signedIn=${!!user}`);
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname==='127.0.0.1')return r.continue();if(u.pathname.endsWith('supabase.min.js'))return r.fulfill({contentType:'application/javascript',body:stub});return r.abort();});
 await page.goto(base+url);return page;};
const sys=async(sql,a=[])=>{const j=queue.then(async()=>{await db.exec('RESET ROLE');return (await db.query(sql,a)).rows;});queue=j.catch(()=>{});return j;};
const stages=async()=>Object.fromEntries((await sys('SELECT line_id,stage FROM renovation_work_items WHERE project_id=$1',[id])).map(r=>[r.line_id,r.stage]));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==','base64');
const openCard=async(page,name)=>{const card=page.locator('details.work',{hasText:name});await card.waitFor();if(!(await card.evaluate(e=>e.open)))await card.locator('summary').first().click();return card;};
try{
 let page=await open(staff,`/portal/renovation.html#${id}`);
 let card=await openCard(page,'全屋定制');
 assert((await card.locator('summary').first().innerText()).includes('待发起业主签名'),'headline says what is next');
 assert((await card.innerText()).includes('还有 2 项定制未签名'),'staff are told custom lines will not be ordered');
 await card.locator('[id^="assignee-"]').fill('张师傅');await card.locator('[data-work]').click();await page.waitForTimeout(800);
 card=await openCard(page,'全屋定制');assert.equal(await card.locator('[id^="assignee-"]').inputValue(),'张师傅');
 card=await openCard(page,'全屋定制');
 await card.locator('[data-f="document"]').first().setInputFiles({name:'draw.png',mimeType:'image/png',buffer:png});
 await card.locator('[data-act="request_signature"]').click();
 await card.locator('[data-act="copy_link"]').waitFor();
 assert((await card.locator('summary').first().innerText()).includes('等待业主签名'));
 await card.locator('[data-act="copy_link"]').click();await page.waitForFunction(()=>document.querySelector('[data-wo] [data-feedback]').textContent.includes('已复制'));
 const link=await page.evaluate(()=>navigator.clipboard.readText());assert(link.includes('renovation-custom-sign.html'));
 await page.screenshot({path:out+'/staff-waiting-signature.png',fullPage:true});
 // Stock may be ordered now; custom lines must stay behind.
 await card.locator('[data-act="place_order"]').waitFor();const before=(await card.locator('[data-act="place_order"]').innerText());assert(before.includes('1项'),'order button counts stock only: '+before);
 // Owner signs on a phone without logging in.
 const owner=await open(null,link.replace(base,''),{width:390,height:844});
 await owner.locator('[data-last4]').fill('0000');await owner.locator('[data-verify]').click();await owner.getByText('不正确').waitFor();
 await owner.locator('[data-last4]').fill('4567');await owner.locator('[data-verify]').click();
 await owner.locator('[data-signature]').waitFor();const shown=await owner.locator('#custom-signing').innerText();
 assert(shown.includes('主卧衣柜')&&shown.includes('白色 2.4m'),'owner sees spec');assert(!shown.includes('8800')&&!shown.includes('8,800')&&!shown.includes('柜门拉手'),'no price, no stock lines');
 await owner.locator('[data-submit]').click();await owner.getByText('请填写姓名').waitFor();
 await owner.locator('[data-name]').fill('Owner Wife');await owner.locator('[data-relation]').selectOption('配偶');
 const box=await owner.locator('[data-signature]').boundingBox();await owner.locator('[data-signature]').scrollIntoViewIfNeeded();const b2=await owner.locator('[data-signature]').boundingBox();
 await owner.mouse.move(b2.x+20,b2.y+30);await owner.mouse.down();for(let i=1;i<25;i++)await owner.mouse.move(b2.x+20+i*12,b2.y+30+(i%5)*20);await owner.mouse.up();
 await owner.locator('[data-consent]').check();await owner.screenshot({path:out+'/owner-signing-phone.png',fullPage:true});
 await owner.locator('[data-submit]').click();await owner.getByText('签名成功').waitFor();
 assert.deepEqual((await stages()).C1,'confirmed');
 // Whole sub-order order
 await page.reload();card=await openCard(page,'全屋定制');
 const history=await card.innerText();assert(history.includes('Owner Wife')&&history.includes('配偶'),'signature history shown');
 const form=card.locator('[data-form]',{has:page.locator('[data-act="place_order"]')});
 await form.locator('[data-f="supplier"]').fill('厂家A');await form.locator('[data-f="order_no"]').fill('PO-1');await form.locator('[data-f="expected_on"]').fill('2099-01-01');
 await form.locator('[data-act="place_order"]').click();await card.locator('[data-feedback]').getByText('勾选').waitFor();
 await form.locator('[data-f="stock_confirmed"]').check();await form.locator('[data-act="place_order"]').click();
 await card.locator('[data-act="arrive"]').waitFor();let s=await stages();assert(s.C1==='ordered'&&s.C2==='ordered'&&s.S1==='ordered','one click orders all three');
 // Exception: one line missing
 card=await openCard(page,'全屋定制');await card.locator('details.work-terms>summary',{hasText:'按项查看'}).click();
 await card.locator('[data-line="C2"]').check();const issue=card.locator('[data-form]',{has:page.locator('[data-act="flag_issue"]')});
 await issue.locator('[data-f="note"]').fill('缺门板');await issue.locator('[data-f="follow_up_on"]').fill('2099-01-01');await issue.locator('[data-act="flag_issue"]').click();
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-wo]')].some(e=>e.textContent.includes('缺门板')));
 card=await openCard(page,'全屋定制');assert((await card.locator('[data-act="arrive"]').innerText()).includes('2项'),'arrival skips the problem line');
 await card.locator('[data-act="arrive"]').click();await card.locator('[data-act="finish"]').waitFor();s=await stages();assert(s.C1==='arrived'&&s.C2==='ordered','partial arrival');
 await page.screenshot({path:out+'/staff-partial-arrival.png',fullPage:true});
 // To-do and handover
 await page.goto(base+'/portal/renovation.html');await page.locator('#my-todos').getByText('有问题待处理').waitFor();await page.screenshot({path:out+'/staff-todos.png',fullPage:true});
 const boss=await open(manager,'/portal/renovation.html');await boss.locator('#my-todos summary',{hasText:'员工交接'}).click();
 await boss.locator('[data-from]').selectOption(staff);await boss.locator('[data-project]').first().waitFor();await boss.locator('[data-to]').selectOption(colleague);await boss.locator('[data-note]').fill('客户要求周五到货');await boss.locator('[data-create]').click();
 await boss.getByText('等待 Bo').waitFor({state:'attached'});await boss.screenshot({path:out+'/manager-handover.png',fullPage:true});
 assert.equal((await sys('SELECT created_by FROM renovation_projects WHERE id=$1',[id]))[0].created_by,staff,'nothing moved yet');
 const next=await open(colleague,'/portal/renovation.html');await next.locator('[data-accept]').waitFor();const handText=await next.locator('#my-todos').innerText();assert(handText.includes('客户要求周五到货')&&handText.includes('HZ-E2E')&&handText.includes('有问题待处理'),'receiver sees the checklist');
 await next.locator('[data-accept]').click();await next.locator('[data-accept]').waitFor({state:'detached'});
 const moved=(await sys('SELECT created_by,sales_by FROM renovation_projects WHERE id=$1',[id]))[0];assert.equal(moved.created_by,colleague);assert.equal(moved.sales_by,staff,'credit stays');
 await next.locator('[data-open-project]').first().click();card=await openCard(next,'全屋定制');assert((await card.textContent()).includes('缺门板'),'receiver can work the project');
 const mobile=await open(colleague,`/portal/renovation.html#${id}`,{width:390,height:844});card=await openCard(mobile,'全屋定制');await mobile.screenshot({path:out+'/mobile-suborder.png',fullPage:true});
 const overflow=await mobile.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=1,'no sideways scroll on phone: '+overflow);
 assert.deepEqual(errors,[],'no page errors');
 console.log('PASS fulfilment browser flow');
}finally{await browser.close();server.close();}
