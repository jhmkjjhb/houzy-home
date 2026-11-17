// 转发签字端到端：员工在后台查看业主签名、生成工厂签字链接；工厂用手机凭验证码签字；员工看到签字记录。
// 真浏览器 + 真 Postgres 引擎，页面调用的是实际的数据库函数。不碰线上。
import fs from 'node:fs';import http from 'node:http';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const db=new PGlite();const out='output/playwright/renovation-party-signoffs';fs.mkdirSync(out,{recursive:true});
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
await db.exec(fs.readFileSync('supabase/renovation_party_signoffs_migration.sql','utf8'));
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
 if(req.kind==='download'){await asUser(user);const allowed=user?true:(await db.query('SELECT public._reno_custom_doc_readable($1) OR public._reno_signoff_doc_readable($1) v',[req.path])).rows[0].v;if(!allowed)throw new Error('无权读取文件');return files.get(req.path);}
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
 await card.locator('[data-f="document"]').first().setInputFiles({name:'draw.png',mimeType:'image/png',buffer:png});
 await card.locator('[data-act="request_signature"]').click();await card.locator('[data-act="copy_link"]').waitFor();
 await card.locator('[data-act="copy_link"]').click();await page.waitForFunction(()=>document.querySelector('[data-wo] [data-feedback]').textContent.includes('已复制'));
 const ownerLink=await page.evaluate(()=>navigator.clipboard.readText());
 const owner=await open(null,ownerLink.replace(base,''),{width:390,height:844});
 await owner.locator('[data-last4]').fill('4567');await owner.locator('[data-verify]').click();await owner.locator('[data-signature]').waitFor();
 const draw=async(p,sel)=>{await p.locator(sel).scrollIntoViewIfNeeded();const b=await p.locator(sel).boundingBox();await p.mouse.move(b.x+20,b.y+30);await p.mouse.down();for(let i=1;i<25;i++)await p.mouse.move(b.x+20+i*12,b.y+30+(i%5)*20);await p.mouse.up();};
 await owner.locator('[data-name]').fill('Owner Wife');await draw(owner,'[data-signature]');await owner.locator('[data-consent]').check();
 await owner.locator('[data-submit]').click();await owner.getByText('签名成功').waitFor();

 // 1) 员工在后台点开业主签名：看到签的清单、图纸按钮和手写签名图
 await page.reload();card=await openCard(page,'全屋定制');
 await card.locator('summary',{hasText:'记录：'}).click();await card.locator('summary',{hasText:'查看业主签名'}).click();
 const ownerView=card.locator('summary',{hasText:'查看业主签名'}).locator('..');
 assert((await ownerView.innerText()).includes('主卧衣柜'),'signed lines listed');
 assert(await ownerView.locator('svg polyline').count()>0,'owner hand signature drawn');
 assert(await ownerView.locator('[data-act="view_file"]').count()>0,'drawing can be opened');
 await page.screenshot({path:out+'/staff-owner-signature.png',fullPage:true});

 // 2) 按项勾选 C1，生成「工厂确认下单内容」签字链接，带附件
 await card.locator('[data-line="C1"]').check();await card.locator('summary',{hasText:'更多操作'}).click();
 const form=card.locator('[data-form]',{has:page.locator('[data-act="signoff_create"]')});
 await form.locator('[data-act="signoff_create"]').click();await card.locator('[data-feedback]').getByText('签字方').waitFor();
 await form.locator('[data-f="purpose"]').selectOption('order');await form.locator('[data-f="party"]').fill('广州工厂');await form.locator('[data-f="so_note"]').fill('门板颜色按样板');
 await form.locator('[data-f="so_doc"]').setInputFiles({name:'spec.png',mimeType:'image/png',buffer:png});
 await form.locator('[data-act="signoff_create"]').click();
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-wo] [data-feedback]')].some(e=>e.textContent.includes('验证码')));
 const link=await page.evaluate(()=>navigator.clipboard.readText());assert(link.includes('renovation-party-sign.html'),'link copied: '+link);
 const row=(await sys('SELECT access_code FROM renovation_party_signoffs'))[0];
 card=await openCard(page,'全屋定制');const pend=await card.innerText();
 assert(pend.includes('等待工厂 / 负责人签字')&&pend.includes(row.access_code)&&pend.includes('广州工厂'),'pending link shows code for staff');
 await page.screenshot({path:out+'/staff-signoff-pending.png',fullPage:true});

 // 3) 工厂用手机打开：没验证码看不到；验证后只看到勾选的项，没有价格和业主电话
 const fac=await open(null,link.replace(base,''),{width:390,height:844});
 assert(!(await fac.locator('#party-signing').innerText()).includes('主卧衣柜'),'nothing before the code');
 await fac.locator('[data-code]').fill(row.access_code==='0000'?'1111':'0000');await fac.locator('[data-verify]').click();await fac.getByText('不正确').waitFor();
 await fac.locator('[data-code]').fill(row.access_code);await fac.locator('[data-verify]').click();await fac.locator('[data-signature]').waitFor();
 const shown=await fac.locator('#party-signing').innerText();
 assert(shown.includes('主卧衣柜')&&shown.includes('白色 2.4m')&&shown.includes('门板颜色按样板'),'factory sees line, spec and note');
 assert(!shown.includes('书房柜')&&!shown.includes('8800')&&!shown.includes('8,800')&&!shown.includes('60101234567')&&!shown.includes('Owner'),'only ticked line; no price, no owner');
 assert(await fac.locator('[data-pages] img').count()===1,'attachment shown');
 await fac.locator('[data-submit]').click();await fac.getByText('请填写姓名').waitFor();
 await fac.locator('[data-name]').fill('王厂长');await draw(fac,'[data-signature]');await fac.locator('[data-note]').fill('12月5日出货');await fac.locator('[data-consent]').check();
 await fac.screenshot({path:out+'/factory-signing-phone.png',fullPage:true});
 await fac.locator('[data-submit]').click();await fac.getByText('签字成功').waitFor();
 const ofl=await fac.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(ofl<=1,'no sideways scroll on phone: '+ofl);

 // 4) 员工看到签字：记录、备注、签名图，以及清单项上的 ✓
 await page.reload();card=await openCard(page,'全屋定制');await card.locator('summary',{hasText:'记录：'}).click();const after=await card.innerText();
 assert(after.includes('工厂 / 负责人签字 1')&&after.includes('王厂长')&&after.includes('12月5日出货'),'staff sees who signed and the note');
 assert((await card.locator('label.fx-row',{has:page.locator('[data-line="C1"]')}).innerText()).includes('✓ 工厂确认下单内容'),'line marked as factory-confirmed');
 assert(!(await card.locator('label.fx-row',{has:page.locator('[data-line="C2"]')}).innerText()).includes('✓'),'unticked line not marked');
 await card.locator('summary',{hasText:'查看签字'}).click();
 assert(await card.locator('summary',{hasText:'查看签字'}).locator('..').locator('svg polyline').count()>0,'factory signature drawn');
 await page.screenshot({path:out+'/staff-signoff-signed.png',fullPage:true});
 const stagesNow=await stages();assert.equal(stagesNow.C1,'confirmed','signing does not move progress');

 // 5) 撤销：再发一个到货验收，撤销后链接打不开
 await card.locator('[data-line="C2"]').check();await card.locator('summary',{hasText:'更多操作'}).click();
 await form.locator('[data-f="purpose"]').selectOption('arrival');await form.locator('[data-f="party"]').fill('仓库阿明');
 await form.locator('[data-act="signoff_create"]').click();
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-wo] [data-feedback]')].some(e=>e.textContent.includes('验证码')));
 const link2=await page.evaluate(()=>navigator.clipboard.readText());const code2=(await sys(`SELECT access_code FROM renovation_party_signoffs WHERE purpose='arrival'`))[0].access_code;
 card=await openCard(page,'全屋定制');await card.locator('summary',{hasText:'撤销这个链接'}).click();
 const vf=card.locator('[data-form]',{has:page.locator('[data-act="signoff_void"]')});await vf.locator('[data-f="reason"]').fill('发错人');await vf.locator('[data-act="signoff_void"]').click();
 await page.waitForFunction(()=>![...document.querySelectorAll('[data-act="signoff_void"]')].length);
 const fac2=await open(null,link2.replace(base,''),{width:390,height:844});await fac2.locator('[data-code]').fill(code2);await fac2.locator('[data-verify]').click();await fac2.getByText('已撤销').waitFor();
 assert.deepEqual(errors,[],'no page errors');
 console.log('PASS party sign-off browser flow');
}finally{await browser.close();server.close();}
