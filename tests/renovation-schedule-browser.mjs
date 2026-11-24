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
await db.exec(fs.readFileSync('supabase/renovation_party_signoffs_migration.sql','utf8'));await db.exec(fs.readFileSync('supabase/renovation_schedule_migration.sql','utf8'));await db.exec(fs.readFileSync('supabase/renovation_planning_migration.sql','utf8'));await db.exec(fs.readFileSync('supabase/renovation_phase_plan_migration.sql','utf8'));await db.exec(fs.readFileSync('supabase/renovation_site_supervision_migration.sql','utf8'));await db.exec(fs.readFileSync('supabase/renovation_phase_forecast_migration.sql','utf8'));await db.exec(fs.readFileSync('supabase/renovation_work_order_days_migration.sql','utf8'));await db.exec(fs.readFileSync('supabase/renovation_phase_split_mep_migration.sql','utf8'));
// Every browser request runs one at a time as the logged-in person, under row-level security.
let queue=Promise.resolve();const files=new Map();
const argTypes=async fn=>{await db.exec('RESET ROLE');const r=(await db.query(`SELECT proargnames n,(SELECT array_agg(format_type(t,NULL) ORDER BY o) FROM unnest(proargtypes::oid[]) WITH ORDINALITY u(t,o)) t FROM pg_proc WHERE proname=$1 AND pronamespace='public'::regnamespace`,[fn])).rows[0];if(!r)throw new Error('函数不存在 '+fn);return r;};
const asUser=async user=>db.exec(user?`RESET ROLE;SET request.jwt.claim.sub='${user}';SET ROLE authenticated`:`RESET ROLE;SET request.jwt.claim.sub='';SET ROLE anon`);
async function handle(user,req){
 if(req.kind==='rpc'){const t=await argTypes(req.name);const keys=Object.keys(req.args||{});for(const k of keys)if(!(t.n||[]).includes(k))throw new Error(`参数名错误 ${req.name}.${k}`);
  const sql=`SELECT public.${req.name}(${keys.map((k,i)=>`${k}=>$${i+1}::${t.t[t.n.indexOf(k)]}`).join(',')}) v`;
  const vals=keys.map(k=>{const v=req.args[k];return v!==null&&typeof v==='object'?JSON.stringify(v):v;});
  await asUser(user);return (await db.query(sql,vals)).rows[0].v;}
 if(req.kind==='select'){await asUser(user);const conds=req.eq.map(([k],i)=>`${k}=$${i+1}`);const vals=req.eq.map(e=>e[1]);if(req.inn){conds.push(`${req.inn[0]}=ANY($${vals.length+1})`);vals.push(req.inn[1]);}const w=conds.join(' AND ');return (await db.query(`SELECT to_jsonb(t) v FROM public.${req.table} t ${w?'WHERE '+w:''} ${req.limit?'LIMIT '+Number(req.limit):''}`,vals)).rows.map(r=>r.v);}
 if(req.kind==='upload'){await db.exec('RESET ROLE');await db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',[req.bucket,req.path]);files.set(req.path,req.base64);return true;}
 if(req.kind==='download'){await asUser(user);const allowed=user?true:(await db.query('SELECT public._reno_custom_doc_readable($1) OR public._reno_signoff_doc_readable($1) v',[req.path])).rows[0].v;if(!allowed)throw new Error('无权读取文件');return files.get(req.path);}
 throw new Error('unknown');
}
const server=http.createServer((q,s)=>{const p=path.join(process.cwd(),decodeURIComponent(new URL(q.url,'http://x').pathname));fs.readFile(p,(e,b)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'content-type':p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.png')?'image/png':'application/octet-stream'});s.end(b);});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const stub=`window.supabase={createClient:(u,k,o)=>{const call=async r=>{const x=JSON.parse(await window.__db(JSON.stringify(r)));return x;};
 const b64=async f=>{const a=new Uint8Array(await f.arrayBuffer());let s='';for(const c of a)s+=String.fromCharCode(c);return btoa(s);};
 return {rpc:async(name,args)=>call({kind:'rpc',name,args}),auth:{getSession:async()=>({data:{session:window.__signedIn?{user:{}}:null}})},
 from(table){const r={kind:'select',table,eq:[]};let one=false;const q={select(){return q},eq(k,v){r.eq.push([k,v]);return q},in(k,v){r.inn=[k,v];return q},order(){return q},limit(n){r.limit=n;return q},single(){one=true;return q},then(ok,no){return call(r).then(x=>x.error?x:({data:one?(x.data||[])[0]:x.data,error:null})).then(ok,no);}};return q;},
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

const phasePlan=async()=>(await sys('SELECT phase_plan FROM renovation_projects WHERE id=$1',[id]))[0].phase_plan;
const setPhase=async(k,s,e)=>sys(`UPDATE renovation_projects SET phase_plan=jsonb_set(phase_plan,$2::text[],jsonb_build_object('start',$3::text,'end',$4::text)) WHERE id=$1`,[id,'{'+k+'}',s,e]);
const plans=async()=>Object.fromEntries((await sys('SELECT group_name,planned_start::text s,planned_end::text e FROM renovation_work_orders WHERE project_id=$1',[id])).map(r=>[r.group_name,r]));
const dow=s=>new Date(s+'T00:00:00Z').getUTCDay();const days=(a,b)=>Math.round((new Date(b+'T00:00:00Z')-new Date(a+'T00:00:00Z'))/864e5);
// 施工计划是单独的栏目（在「收款进度」和「履约子单」之间），不再是子单里的标签
const openPhases=async p=>{const c=p.locator('#schedule [data-sch-phase][aria-expanded="false"]');for(let i=0;i<20&&await c.count();i++)await c.first().click();};
const planTab=async p=>{await p.locator('.steps a[href="#project-plan"]').click();await p.locator('#project-plan').waitFor();};
try{
 const page=await open(staff,`/portal/renovation.html#${id}`);await page.locator('#work-orders details.work').first().waitFor();
await planTab(page);const sch=page.locator('#schedule .sch');await sch.waitFor();
 assert((await sch.innerText()).includes('还没有排期'),'empty state explains what to do');
 // 1) 自动排期：开工日 2026-12-01（周二）
 await sch.locator('[data-sch-start]').fill('2026-12-01');await sch.locator('[data-sch-auto]').click();await sch.locator('.sch-bar').first().waitFor();
 // 按工序走：一行一道工序，按施工顺序编号；同一道工序的子单合在一行
 assert.deepEqual(await sch.locator('[data-sch-phase] span').allInnerTexts(),['1. 电路预埋','2. 泥水','3. 油漆','4. 定制柜安装','5. 水路安装'],'rows are construction phases in working order');
 assert.equal(await sch.locator('.sch-phase').count(),5,'one bar per phase (the gift is not scheduled)');
 await openPhases(page);assert.equal(await sch.locator('.sch-items').count(),5,'opening a phase lists what that trade does in one visit');
 {const pi=await sch.locator('.sch-items',{hasText:'定制柜安装'}).innerText();assert(pi.includes('涉及 2 张子单')&&pi.includes('全屋定制')&&pi.includes('厨房及洗衣区柜体')&&pi.includes('履约')&&pi.includes('打开子单'),'one cabinet visit lists both sub-orders with their fulfilment: '+pi.slice(0,200));}
 assert((await sch.innerText()).includes('有改动还没保存'),'unsaved changes are flagged');
 assert.equal((await plans())['泥水'].s,null,'nothing saved before 保存');
 await sch.locator('[data-sch-save]').click();await page.waitForFunction(()=>!document.querySelector('#schedule [data-sch-save]')?.disabled===false||document.querySelector('#schedule [data-sch-save]')?.disabled);
 await page.waitForFunction(async()=>true);await new Promise(r=>setTimeout(r,800));
 let P=await plans();
 // 定制柜：安装前画一段「工厂定做」（下单到到货），名称下写「工厂定做 25天 → 柜体安装队安装」；水电这种现场活没有
 {const cab=sch.locator('.sch-phase-row',{has:page.locator('[data-sch-phase="cabinet"]')});
  assert.equal(await cab.locator('.sch-prod').count(),1,'custom cabinets show the factory production part before install');
  assert((await cab.locator('.sch-label').innerText()).includes('工厂定做 25天'),'label says made in the factory, then installed');
  const pr=await cab.locator('.sch-prod').boundingBox(),br=await cab.locator('.sch-bar').boundingBox();assert(Math.abs(pr.x+pr.width-br.x)<=2,'production ends where install starts');
  assert.equal(await sch.locator('.sch-phase-row',{has:page.locator('[data-sch-phase="elec"]')}).locator('.sch-prod').count(),0,'site-only trades have no factory part');}
 // 预计计划没确认前：提示要店长确认（员工没有确认按钮）；业主链接还看不到计划。这里模拟店长已确认（店长确认的按钮在后面测）
 await page.waitForFunction(()=>document.querySelector('#schedule')?.innerText.includes('预计计划还没确认'));
 assert((await sch.innerText()).includes('请店长确认')&&await sch.locator('[data-sch-confirm]').count()===0,'staff are told the store manager must confirm the forecast');
 await sys('UPDATE renovation_projects SET phase_baseline_locked_at=now() WHERE id=$1',[id]);
 assert(P['水电'].s==='2026-12-01','first trade starts on the start day: '+P['水电'].s);
 assert(P['泥水'].s>P['水电'].e&&P['油漆'].s>P['泥水'].e,'trades follow one after another');
 assert(days('2026-12-01',P['全屋定制'].s)>=25&&P['全屋定制'].s>P['油漆'].e,'custom waits for the factory and for painting');
 assert(P['卫浴洁具'].s>P['全屋定制'].e,'fixtures after custom install');
 assert(Object.values(P).filter(x=>x.s).every(x=>dow(x.s)!==0&&dow(x.e)!==0),'nothing starts or ends on a Sunday');
 assert.equal(P['赠品与设计'].s,null,'gift not scheduled');
 await page.screenshot({path:out+'/staff-schedule.png',fullPage:false,clip:await sch.boundingBox()});
 // 2) 拖动：泥水整条往后挪 2 天；拖右端让油漆多 1 天
 const dw=+(await page.locator('#schedule').getAttribute('data-dw'));
 const bar=sch.locator('[data-sch-bar="masonry"]');await bar.evaluate(e=>e.scrollIntoView({block:'center'}));const b=await bar.boundingBox();
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dw*2+2,b.y+b.height/2,{steps:6});await page.mouse.up();
 const end=sch.locator('[data-sch-bar="paint"] [data-sch-end]');await end.evaluate(e=>e.scrollIntoView({block:'center'}));const eb=await end.boundingBox();
 await page.mouse.move(eb.x+eb.width/2,eb.y+eb.height/2);await page.mouse.down();await page.mouse.move(eb.x+eb.width/2+dw+1,eb.y+eb.height/2,{steps:4});await page.mouse.up();
 assert.equal(await sch.locator('.sch-bar.dirty').count(),2,'both dragged bars marked unsaved');
 await sch.locator('[data-sch-save]').click();await new Promise(r=>setTimeout(r,900));
 const Q=await plans();
 assert(days(P['泥水'].s,Q['泥水'].s)===2&&days(P['泥水'].e,Q['泥水'].e)===2,'move keeps length, shifts 2 days');
 assert(Q['油漆'].s===P['油漆'].s&&days(P['油漆'].e,Q['油漆'].e)===1,'end handle adds 1 day');
 // 2a) 原计划对比：第一次保存的就是原计划；泥水往后挪 2 天后，显示「晚2天」、细灰线是原计划，并列入要处理
 await page.reload();await sch.locator('.sch-bar').first().waitFor();await page.waitForFunction(()=>document.querySelector('#schedule .sch-base'));
 {const row=sch.locator('.sch-phase-row',{has:page.locator('[data-sch-phase="masonry"]')});
  assert((await row.innerText()).includes('晚2天'),'masonry shows it is 2 days behind the original plan');
  assert(await row.locator('.sch-base').count()===1,'original plan drawn as a thin grey line');
  const iss=await sch.locator('.sch-issues').innerText().catch(()=>'');const more=await sch.locator('.sch-issues details').count();if(more)await sch.locator('.sch-issues details summary').click();
  assert((await sch.locator('.sch-issues').innerText()).includes('比预计晚'),'delay against the original plan is listed under 要处理');
  assert((await sch.locator('.sch-phase-row',{has:page.locator('[data-sch-phase="elec"]')}).innerText()).includes('按预计'),'unchanged phases say they are on the original plan');}
 // 2b) 点工序横条：弹出这道工序所有子单的日期，改了保存，留下调整记录（谁、改了什么、从几号到几号）
 await sch.locator('[data-sch-bar="cabinet"]').click();const pe=sch.locator('.sch-phase-edit');await pe.waitFor();
 assert.equal(await pe.locator('[data-sch-pe]').count(),1,'one start and one end for the whole cabinet visit');
 await pe.locator('[data-sch-es]').fill('2027-01-04');await pe.locator('[data-sch-ee]').fill('2027-01-08');
 await pe.locator('[data-sch-pok]').click();await sch.locator('[data-sch-save]').click();await new Promise(r=>setTimeout(r,900));
 const R=await plans();assert(R['全屋定制'].s==='2027-01-04'&&R['厨房及洗衣区柜体'].s==='2027-01-04'&&R['厨房及洗衣区柜体'].e==='2027-01-08','both cabinet sub-orders follow the one cabinet visit');
 assert.equal((await phasePlan()).cabinet.start,'2027-01-04','phase plan saved');
 await sch.locator('#sch-log summary').click();await page.waitForFunction(()=>document.querySelector('#schedule [data-sch-log]')?.textContent.includes('→'));
 const lg=await sch.locator('[data-sch-log]').innerText();assert(lg.includes('Ali')&&lg.includes('定制柜安装')&&lg.includes('01/04–01/08')&&lg.includes('→'),'change log says who changed what from when to when: '+lg.slice(0,200));
 // 3) 手机：点名称改日期
 const ph=await open(staff,`/portal/renovation.html#${id}`,{width:390,height:844});await ph.locator('#work-orders details.work').first().waitFor();await planTab(ph);const ps=ph.locator('#schedule .sch');await ps.locator('.sch-bar').first().waitFor();await openPhases(ph);
 await ps.locator('[data-sch-bar="elec"]').click();await ps.locator('[data-sch-es]').fill('2026-11-20');await ps.locator('[data-sch-ee]').fill('2026-11-26');await ps.locator('[data-sch-pok]').click();
 await ps.locator('[data-sch-save]').click();await new Promise(r=>setTimeout(r,900));
 assert((await plans())['水电'].s==='2026-11-20','phone date edit saved');
 const ofl=await ph.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(ofl<=1,'page does not scroll sideways on phone (chart scrolls inside): '+ofl);
 await ph.screenshot({path:out+'/phone-schedule.png',clip:await ps.boundingBox()});
 // 4) 超期：电路计划已过（今天之后的测试日期除外），且没完成 → 红色
 await setPhase('elec','2026-01-05','2026-01-09');
 await page.reload();await sch.locator('.sch-bar').first().waitFor();await openPhases(page);
 assert(await sch.locator('[data-sch-bar="elec"].late').count()===1&&(await sch.locator('.sch-issues').innerText()).includes('超期：电路'),'overdue shows red and is listed under 要处理');
 assert((await page.locator('#plan-summary').innerText()).includes('件要处理'),'tab summary says there is something to handle');
 // 4a) 智能排期：每道工序写明「等谁做完」；手动把油漆排到泥水完工之前 → 顺序冲突提醒
 assert((await sch.locator('[data-sch-phase="paint"]').innerText()).includes('等 泥水 做完'),'phase says what it waits for');
 {const pp=await phasePlan(),m={s:pp.masonry.start};const d4=new Date(new Date(m.s+'T00:00:00Z').getTime()+3*864e5).toISOString().slice(0,10);
  await setPhase('paint',m.s,d4);
  await page.reload();await sch.locator('.sch-bar').first().waitFor();
  const iss=await sch.locator('.sch-issues').innerText();if(!iss.includes('顺序冲突'))await sch.locator('.sch-issues details summary').click();
  assert((await sch.locator('.sch-issues').innerText()).includes('顺序冲突')&&(await sch.locator('.sch-issues').innerText()).includes('油漆'),'painting before masonry is done is flagged');
  await setPhase('paint',Q['油漆'].s,Q['油漆'].e);await page.reload();await sch.locator('.sch-bar').first().waitFor();}
 // 4b) 施工计划：交房日太早 → 红色提醒；材料最晚下单日；验收节点对上收款；漏项检查
 await sch.locator('[data-sch-handover]').fill('2026-12-20');await sch.locator('[data-sch-handover]').dispatchEvent('change');
 let st=await sch.innerText();assert(/比交房日 12\/20 晚 \d+ 天/.test(st),'too-early handover is flagged: '+st.slice(0,200));
 await sch.locator('[data-sch-save]').click();await new Promise(r=>setTimeout(r,900));
 assert.equal((await sys('SELECT handover_on::text d FROM renovation_projects WHERE id=$1',[id]))[0].d,'2026-12-20','handover saved');
 const mats=sch.locator('.sch-box',{hasText:'材料下单'});if(!(await mats.evaluate(e=>e.open)))await mats.locator('summary').click();
 const mt=await mats.innerText();assert(mt.includes('定制柜')&&mt.includes('最晚下单')&&mt.includes('业主还没签名'),'material order list with deadline: '+mt.slice(0,160));
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
 // 全局：整个工期一屏放下，不用左右滑；近 4 周：放大、可以左右滑；记住上次的选择
 {const fit=await page.evaluate(()=>{const s=document.querySelector('#schedule .sch-scroll');return s.scrollWidth<=s.clientWidth+1;});assert(fit,'全局 shows the whole schedule without sideways scrolling');
  await page.locator('[data-sch-zoom="in"]').click();assert(await page.evaluate(()=>{const s=document.querySelector('#schedule .sch-scroll');return s.scrollWidth>s.clientWidth;}),'放大 is still the whole schedule, just wider and scrollable');await page.locator('#schedule').screenshot({path:out+'/staff-plan-near.png'});
  // 每个工种一种颜色，横条上写天数
  {const info=await page.evaluate(()=>[...document.querySelectorAll('#schedule .sch-bar')].map(b=>[[...b.classList].find(c=>c.startsWith('tr-')),b.textContent+(b.nextElementSibling?.classList.contains('sch-days')?b.nextElementSibling.textContent:'')]));
   assert(new Set(info.map(x=>x[0])).size>=3&&info.every(x=>x[0]&&/\d+天/.test(x[1])),'bars are coloured by trade and say how many days: '+JSON.stringify(info));}
  // 点月份：放大到那个月（一屏一个月左右），那个月的 1 号在左边
  {const m=page.locator('#schedule .sch-mclick').nth(1);const i=+(await m.getAttribute('data-sch-month'));await m.click();await page.waitForTimeout(200);
   const r=await page.evaluate(()=>{const s=document.querySelector('#schedule .sch-scroll'),lab=s.querySelector('.sch-label').offsetWidth,dw=+document.getElementById('schedule').dataset.dw;return {dw,left:s.scrollLeft,days:(s.clientWidth-lab)/dw};});
   assert(r.days>=27&&r.days<=33&&Math.abs(r.left-i*r.dw)<=r.dw+1,'clicking a month zooms to that month: '+JSON.stringify(r));}
  // 滚轮：鼠标在日期那一行上滚，缩小 / 放大
  {const before=+(await page.locator('#schedule').getAttribute('data-dw'));await page.evaluate(()=>document.querySelector('#schedule .sch-axis').scrollIntoView({block:'center'}));await page.waitForTimeout(100);const ax=await page.locator('#schedule .sch-axis .sch-lane').boundingBox();
   const scb=await page.locator('#schedule .sch-scroll').boundingBox();await page.mouse.move(scb.x+scb.width*0.6,ax.y+ax.height/2);await page.mouse.wheel(0,400);await page.waitForTimeout(250);
   const after=+(await page.locator('#schedule').getAttribute('data-dw'));assert(after<before,'wheel down on the dates zooms out: '+before+' → '+after);
   await page.mouse.wheel(0,-300);await page.waitForTimeout(250);assert(+(await page.locator('#schedule').getAttribute('data-dw'))>after,'wheel up zooms in');}
  {const r=await page.evaluate(()=>{const s=document.querySelector('#schedule .sch-scroll');return {range:document.querySelector('#schedule .sch-views .muted').textContent};});assert(/共 \d+ 天/.test(r.range),'range covers the whole schedule: '+r.range);}
  await page.locator('[data-sch-zoom="fit"]').click();await page.locator('#schedule').screenshot({path:out+'/staff-plan-global.png'});
  // 时间轴上的字不能互相压住：日期之间、日期和「今天 / 交房」之间
  {const hit=await page.evaluate(()=>{const R=e=>e.getBoundingClientRect(),a=[...document.querySelectorAll('#schedule .sch-axis .sch-tick')].map(R),m=[...document.querySelectorAll('#schedule .sch-today span,#schedule .sch-hand span')].map(R);
    const x=(p,q)=>p.left<q.right-1&&q.left<p.right-1&&p.top<q.bottom-1&&q.top<p.bottom-1;const out=[];
    a.forEach((p,i)=>a.slice(i+1).forEach(q=>{if(x(p,q))out.push('tick/tick');}));a.forEach(p=>m.forEach(q=>{if(x(p,q))out.push('tick/marker');}));if(m.length===2&&x(m[0],m[1]))out.push('today/handover');return out;});
   assert.deepEqual(hit,[],'axis labels do not overlap');}}
 // 手机横屏 / 竖屏：「全局」从开工到完工都在一屏内，不用左右滑（转屏后自动按新宽度重画）
 for(const [w,h,name] of [[844,390,'landscape'],[390,844,'portrait']]){
  await page.setViewportSize({width:w,height:h});await page.waitForTimeout(500);
  const r=await page.evaluate(()=>{const s=document.querySelector('#schedule .sch-scroll'),box=s.getBoundingClientRect(),bars=[...s.querySelectorAll('.sch-bar')].map(b=>b.getBoundingClientRect());return {fit:s.scrollWidth<=s.clientWidth+1,inside:bars.every(b=>b.left>=box.left-1&&b.right<=box.right+1),n:bars.length,page:document.documentElement.scrollWidth-innerWidth};});
  assert(r.fit&&r.inside&&r.n>0&&r.page<=1,`phone ${name}: whole schedule visible on one screen `+JSON.stringify(r));
  await page.locator('#schedule .sch-scroll').screenshot({path:out+`/phone-${name}-global.png`});
 }
 await page.setViewportSize({width:1280,height:1000});
 // 4c2) 工序展开 → 子单：定总天数 45 天（设计 + 定做 + 安装），工厂定做段和最晚下单日按 45 天重算；点「打开子单」跳到那张子单
 {await openPhases(page);const wo=sch.locator('.sch-wo',{hasText:'全屋定制'});const woId=(await sys(`SELECT id FROM renovation_work_orders WHERE project_id=$1 AND group_name='全屋定制'`,[id]))[0].id;
  await wo.locator('[data-sch-days]').fill('45');await wo.locator('[data-sch-dsave]').click();
  await page.waitForFunction(()=>document.querySelector('#schedule .sch-wo')?.closest('.sch')?.innerText.includes('定 45 天'),null,{timeout:10000}).catch(async()=>{await openPhases(page);});
  assert.equal((await sys('SELECT fixed_days FROM renovation_work_orders WHERE id=$1',[woId]))[0].fixed_days,45,'fixed days saved on the sub-order');
  await openPhases(page);const txt=await sch.locator('.sch-wo',{hasText:'全屋定制'}).innerText();assert(/定 45 天：最晚 \d\d\/\d\d 开始设计 \/ 下单/.test(txt),'sub-order says when design / ordering must start: '+txt.slice(0,200));
  const lab=await sch.locator('.sch-phase-row',{has:page.locator('[data-sch-phase="cabinet"]')}).locator('.sch-label').innerText();assert(/工厂定做 \d+天/.test(lab),'factory days recalculated: '+lab);
  await sch.locator('#sch-log summary').click().catch(()=>{});await page.waitForFunction(()=>document.querySelector('#schedule [data-sch-log]')?.textContent.includes('总天数'));
  await sch.locator('.sch-wo',{hasText:'全屋定制'}).locator('[data-sch-gowo]').click();await page.waitForFunction(id=>document.querySelector(`#work-orders details.work[data-wid="${id}"]`)?.open,woId);
  await page.locator('.steps a[href="#project-plan"]').click();await sch.locator('.sch-bar').first().waitFor();}
 // 4d) 店长改预计计划：切到「预计计划」，点横条，写原因保存；员工只能看
 {const mp=await open(manager,`/portal/renovation.html#${id}`);await mp.locator('#work-orders details.work').first().waitFor();await planTab(mp);const ms=mp.locator('#schedule .sch');await ms.locator('.sch-bar').first().waitFor();
  await ms.locator('[data-sch-view="forecast"]').click();await ms.locator('[data-sch-bar="paint"]').click();const fe=ms.locator('.sch-fc-edit');await fe.waitFor();
  await fe.locator('[data-sch-es]').fill('2027-02-01');await fe.locator('[data-sch-ee]').fill('2027-02-05');await fe.locator('[data-sch-reason]').fill('业主要求延期');await fe.locator('[data-sch-bok]').click();
  await mp.waitForFunction(()=>!document.querySelector('#schedule .sch-fc-edit'));
  const pb=(await sys('SELECT phase_baseline FROM renovation_projects WHERE id=$1',[id]))[0].phase_baseline;assert.equal(pb.paint.start,'2027-02-01','manager changed the forecast');
  await ms.locator('#sch-log summary').click();await mp.waitForFunction(()=>document.querySelector('#schedule [data-sch-log]')?.textContent.includes('业主要求延期'));
  await mp.locator('#schedule').screenshot({path:out+'/manager-forecast.png'});await mp.context().close();}
 // 4e) 监理报泥水延误 3 天 → 实时计划自动顺延：泥水晚 3 天完成，油漆和后面的工序跟着往后挪，自动保存
 {const before=await phasePlan(),w=(await sys(`SELECT id FROM renovation_work_orders WHERE project_id=$1 AND group_name='泥水'`,[id]))[0].id;
  const sup=(await sys(`INSERT INTO renovation_site_supervisors(project_id,kind,name,access_code,created_by) VALUES($1,'external','外部监理','1234',$2) RETURNING id`,[id,staff]))[0].id;
  await sys(`INSERT INTO renovation_site_entries(project_id,supervisor_id,work_order_id,kind,on_date,data,status) VALUES($1,$2,$3,'delay',$4::date,'{"days":3,"reason":"crew"}','open')`,[id,sup,w,before.masonry.start]);
  await page.reload();await sch.locator('.sch-bar').first().waitFor();await page.waitForFunction(()=>document.querySelector('#schedule .sch-autonote'),null,{timeout:15000});
  const after=await phasePlan(),dd=(a,b)=>days(a,b);
  assert(dd(before.masonry.end,after.masonry.end)>=3&&after.paint.start>after.masonry.end&&after.cabinet.start>after.paint.end,'delay pushes masonry and the phases after it: '+JSON.stringify({before,after}));
  assert((await sch.locator('.sch-autonote').innerText()).includes('泥水 延误 3 天'),'board says what was pushed');
  await page.reload();await sch.locator('.sch-bar').first().waitFor();await page.waitForTimeout(1200);
  assert.deepEqual(await phasePlan(),after,'the same delay is not applied twice');}
 // 5) 业主看到简版：有名称和日期，没有厂家、价格、执行人
 const token=(await sys('SELECT customer_token FROM renovation_projects WHERE id=$1',[id]))[0].customer_token;
 const cu=await open(null,`/portal/renovation-customer.html#${token}`,{width:390,height:844});
 await cu.locator('#customer-progress .cs-schedule').waitFor({state:'attached'});
 const ct=await cu.locator('#customer-progress .cs-schedule').evaluate(e=>e.textContent);
 assert(ct.includes('泥水')&&ct.includes('预计完工')&&!ct.includes('赠品与设计'),'owner sees planned trades: '+ct.slice(0,120));
 assert(!/8800|广州|雷霆|阿强|PO-/.test(ct),'no price, supplier or worker');
 assert.deepEqual(errors,[],'no page errors');
 console.log('PASS schedule browser flow');
}finally{await browser.close();server.close();}
