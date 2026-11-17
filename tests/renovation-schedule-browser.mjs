// 进度表端到端：自动排期顺序、拖动改日期、手机上点名称改日期、超期变红、业主看到简版。
// 真浏览器 + 真 Postgres 引擎，页面调用的是实际的数据库函数。不碰线上。
import fs from 'node:fs';import http from 'node:http';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const db=new PGlite();const out='output/playwright/renovation-schedule';fs.mkdirSync(out,{recursive:true});
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
const L=(id,name,spec,qty,rate,kind,group,unit='lot')=>({id,name,spec,qty,rate,kind,group,unit,warranties:[]});
const lines=[L('18','主卧 A 衣柜 Master Wardrobe A','E0 板 白色 2.4m',1,8800,'custom','全屋定制'),L('19','主卧 B 衣柜 Master Wardrobe B','E0 板 白色 1.8m',1,6600,'custom','全屋定制'),L('20','主卧 C 功能收纳柜','灰色',1,3200,'custom','全屋定制'),L('21','次卧衣柜','木纹',1,5200,'custom','全屋定制'),L('22','鞋柜','白色',1,2400,'custom','全屋定制'),
 L('30','马桶 Toilet','Rigel 一体式',2,1200,'stock','卫浴洁具','pc'),L('31','浴室柜','80cm',2,1800,'stock','卫浴洁具','pc'),L('32','花洒','恒温',2,900,'stock','卫浴洁具','set'),L('33','镜柜','LED',2,650,'stock','卫浴洁具','pc'),L('34','地漏','防臭',4,60,'stock','卫浴洁具','pc'),
 L('40','厨房地柜','石英石台面 12ft',1,9800,'custom','厨房及洗衣区柜体'),L('41','厨房吊柜','8ft',1,4000,'custom','厨房及洗衣区柜体'),L('42','洗衣区柜','',1,2600,'custom','厨房及洗衣区柜体'),
 L('50','客厅铺砖','600x1200',650,9,'work','泥水','sqft'),L('51','卫生间防水','',2,850,'work','泥水','间'),L('60','全屋电线更换','',1,6500,'work','水电'),L('61','全屋墙面油漆','Nippon',1,7800,'work','油漆'),L('70','设计服务','',1,0,'gift','赠品与设计','项')];
await db.query(`INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address,state,snapshot) VALUES($1,$2,$3,'HZ-2026-031','陈先生','60101234567','Jalan Test','executing',$4::jsonb)`,[id,store,staff,JSON.stringify({net:14300,discount:0,payments:[{name:'全款',amount:14300}],lines,warnings:[],source_text:''})]);
await db.query(`INSERT INTO renovation_work_orders(project_id,group_name,line_ids) SELECT $1,g,jsonb_agg(x->>'id') FROM (SELECT x,x->>'group' g FROM jsonb_array_elements($2::jsonb) x) t GROUP BY g`,[id,JSON.stringify(lines)]);
await db.exec(fs.readFileSync('supabase/renovation_party_signoffs_migration.sql','utf8'));await db.exec(fs.readFileSync('supabase/renovation_schedule_migration.sql','utf8'));await db.exec(fs.readFileSync('supabase/renovation_planning_migration.sql','utf8'));
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

const plans=async()=>Object.fromEntries((await sys('SELECT group_name,planned_start::text s,planned_end::text e FROM renovation_work_orders WHERE project_id=$1',[id])).map(r=>[r.group_name,r]));
const dow=s=>new Date(s+'T00:00:00Z').getUTCDay();const days=(a,b)=>Math.round((new Date(b+'T00:00:00Z')-new Date(a+'T00:00:00Z'))/864e5);
const planTab=async p=>{await p.locator('.fx-tabs [role=tab][data-fxtab="plan"]').click();};
try{
 const page=await open(staff,`/portal/renovation.html#${id}`);await page.locator('#work-orders details.work').first().waitFor();
 assert(await page.locator('#schedule').isHidden(),'opens on 子单执行 by default');await planTab(page);const sch=page.locator('#schedule .sch');await sch.waitFor();
 assert((await sch.innerText()).includes('还没有排期'),'empty state explains what to do');
 // 1) 自动排期：开工日 2026-12-01（周二）
 await sch.locator('[data-sch-start]').fill('2026-12-01');await sch.locator('[data-sch-auto]').click();await sch.locator('.sch-bar').first().waitFor();
 assert.equal(await sch.locator('.sch-bar').count(),6,'every sub-order except the gift gets a bar');
 assert((await sch.innerText()).includes('有改动还没保存'),'unsaved changes are flagged');
 assert.equal((await plans())['泥水'].s,null,'nothing saved before 保存');
 await sch.locator('[data-sch-save]').click();await page.waitForFunction(()=>!document.querySelector('#schedule [data-sch-save]')?.disabled===false||document.querySelector('#schedule [data-sch-save]')?.disabled);
 await page.waitForFunction(async()=>true);await new Promise(r=>setTimeout(r,800));
 let P=await plans();
 assert(P['水电'].s==='2026-12-01','first trade starts on the start day: '+P['水电'].s);
 assert(P['泥水'].s>P['水电'].e&&P['油漆'].s>P['泥水'].e,'trades follow one after another');
 assert(days('2026-12-01',P['全屋定制'].s)>=25&&P['全屋定制'].s>P['油漆'].e,'custom waits for the factory and for painting');
 assert(P['卫浴洁具'].s>P['全屋定制'].e,'fixtures after custom install');
 assert(Object.values(P).filter(x=>x.s).every(x=>dow(x.s)!==0&&dow(x.e)!==0),'nothing starts or ends on a Sunday');
 assert.equal(P['赠品与设计'].s,null,'gift not scheduled');
 await page.screenshot({path:out+'/staff-schedule.png',fullPage:false,clip:await sch.boundingBox()});
 // 2) 拖动：泥水整条往后挪 2 天；拖右端让油漆多 1 天
 const dw=+(await page.locator('#schedule').getAttribute('data-dw'));
 const bar=sch.locator('.sch-row',{has:page.locator('.sch-label>span',{hasText:/^泥水$/})}).locator('.sch-bar');const b=await bar.boundingBox();
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dw*2+2,b.y+b.height/2,{steps:6});await page.mouse.up();
 const end=sch.locator('.sch-row',{has:page.locator('.sch-label>span',{hasText:/^油漆$/})}).locator('[data-sch-end]');const eb=await end.boundingBox();
 await page.mouse.move(eb.x+eb.width/2,eb.y+eb.height/2);await page.mouse.down();await page.mouse.move(eb.x+eb.width/2+dw+1,eb.y+eb.height/2,{steps:4});await page.mouse.up();
 assert.equal(await sch.locator('.sch-bar.dirty').count(),2,'both dragged bars marked unsaved');
 await sch.locator('[data-sch-save]').click();await new Promise(r=>setTimeout(r,900));
 const Q=await plans();
 assert(days(P['泥水'].s,Q['泥水'].s)===2&&days(P['泥水'].e,Q['泥水'].e)===2,'move keeps length, shifts 2 days');
 assert(Q['油漆'].s===P['油漆'].s&&days(P['油漆'].e,Q['油漆'].e)===1,'end handle adds 1 day');
 // 3) 手机：点名称改日期
 const ph=await open(staff,`/portal/renovation.html#${id}`,{width:390,height:844});await ph.locator('#work-orders details.work').first().waitFor();await planTab(ph);const ps=ph.locator('#schedule .sch');await ps.locator('.sch-bar').first().waitFor();
 await ps.locator('[data-sch-name]',{has:ph.locator('span',{hasText:/^水电$/})}).click();await ps.locator('[data-sch-es]').fill('2026-11-20');await ps.locator('[data-sch-ee]').fill('2026-11-26');await ps.locator('[data-sch-ok]').click();
 await ps.locator('[data-sch-save]').click();await new Promise(r=>setTimeout(r,900));
 assert((await plans())['水电'].s==='2026-11-20','phone date edit saved');
 const ofl=await ph.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(ofl<=1,'page does not scroll sideways on phone (chart scrolls inside): '+ofl);
 await ph.screenshot({path:out+'/phone-schedule.png',clip:await ps.boundingBox()});
 // 4) 超期：水电计划已过（今天之后的测试日期除外），且没完成 → 红色
 await sys(`UPDATE renovation_work_orders SET planned_start='2026-01-05',planned_end='2026-01-09' WHERE project_id=$1 AND group_name='水电'`,[id]);
 await page.reload();await sch.locator('.sch-bar').first().waitFor();
 assert(await sch.locator('.sch-row',{has:page.locator('.sch-label>span',{hasText:/^水电$/})}).locator('.sch-bar.late').count()===1&&(await sch.locator('.sch-issues').innerText()).includes('超期：水电'),'overdue shows red and is listed under 要处理');
 assert((await page.locator('#plan-summary').innerText()).includes('件要处理'),'tab summary says there is something to handle');
 // 4b) 施工计划：交房日太早 → 红色提醒；材料最晚下单日；验收节点对上收款；漏项检查
 await sch.locator('[data-sch-handover]').fill('2026-12-20');await sch.locator('[data-sch-handover]').dispatchEvent('change');
 let st=await sch.innerText();assert(/比交房日 12\/20 晚 \d+ 天/.test(st),'too-early handover is flagged: '+st.slice(0,200));
 await sch.locator('[data-sch-save]').click();await new Promise(r=>setTimeout(r,900));
 assert.equal((await sys('SELECT handover_on::text d FROM renovation_projects WHERE id=$1',[id]))[0].d,'2026-12-20','handover saved');
 const mats=sch.locator('.sch-box',{hasText:'材料下单'});if(!(await mats.evaluate(e=>e.open)))await mats.locator('summary').click();
 const mt=await mats.innerText();assert(mt.includes('全屋定制')&&mt.includes('最晚下单')&&mt.includes('业主还没签名'),'material order list with deadline: '+mt.slice(0,160));
 assert(await sch.locator('.sch-ms .sch-dia').count()>=3,'inspection points on the chart');
 const chk=await sch.locator('.sch-box',{hasText:'漏项检查'}).innerText();assert(chk.includes('漏项检查'),'missing-item check shown');
 // 4c) 师傅名单 + 撞期：店长加「阿强」，另一个工地同一时间也排了阿强
 // 师傅名单在整装首页（公司共用），不在每个项目里
 const boss=await open(manager,'/portal/renovation.html');const ca=boss.locator('#crew-admin');await ca.locator('summary').waitFor();
 await ca.locator('summary').click();await ca.locator('[data-crew-f="name"]').fill('阿强');await ca.locator('[data-crew-f="trade"]').selectOption('泥水工');await ca.locator('[data-crew-add]').click();
 await boss.waitForFunction(()=>document.querySelector('#crew-admin')?.innerText.includes('已加入'));
 assert((await ca.innerText()).includes('阿强'),'crew listed on the home page');
 await ca.locator('[data-crew-toggle]').click();await boss.waitForFunction(()=>document.querySelector('#crew-admin')?.innerText.includes('恢复'));await ca.locator('[data-crew-toggle]').click();await boss.waitForFunction(()=>document.querySelector('#crew-admin [data-crew-toggle]')?.textContent==='停用');
 assert.equal(await page.locator('#schedule .sch-box',{hasText:'师傅名单'}).count(),0,'no crew list inside each project');
 const ni=(await plans())['泥水'];const p2='30000000-0000-4000-8000-000000000077';
 await sys(`INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address,state,snapshot) VALUES($1,$2,$3,'JALAN-9','X','6011','Addr','executing','{"lines":[]}'::jsonb)`,[p2,store,staff]);
 await sys(`INSERT INTO renovation_work_orders(project_id,group_name,line_ids,assignee,planned_start,planned_end) VALUES($1,'泥水','[]'::jsonb,'阿强',$2,$3)`,[p2,ni.s,ni.e]);
 await sys(`UPDATE renovation_work_orders SET assignee='阿强' WHERE project_id=$1 AND group_name='泥水'`,[id]);
 await page.reload();await sch.locator('.sch-bar').first().waitFor();await page.waitForFunction(()=>document.querySelector('#schedule')?.innerText.includes('撞期'));
 assert((await sch.innerText()).includes('撞期 JALAN-9'),'crew clash with the other site shown');
 assert.equal(await page.locator('input[id^="assignee-"]').first().getAttribute('list'),'crew-list','worker field suggests names from the list');
 await page.locator('#schedule').screenshot({path:out+'/staff-plan.png'});
 // 5) 业主看到简版：有名称和日期，没有厂家、价格、执行人
 const token=(await sys('SELECT customer_token FROM renovation_projects WHERE id=$1',[id]))[0].customer_token;
 const cu=await open(null,`/portal/renovation-customer.html#${token}`,{width:390,height:844});
 await cu.locator('#customer-progress .cs-schedule').waitFor({state:'attached'});
 const ct=await cu.locator('#customer-progress .cs-schedule').evaluate(e=>e.textContent);
 assert(ct.includes('泥水')&&ct.includes('计划完工')&&!ct.includes('赠品与设计'),'owner sees planned trades: '+ct.slice(0,120));
 assert(!/8800|广州|雷霆|阿强|PO-/.test(ct),'no price, supplier or worker');
 assert.deepEqual(errors,[],'no page errors');
 console.log('PASS schedule browser flow');
}finally{await browser.close();server.close();}
