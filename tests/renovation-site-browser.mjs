// 施工监理手机页端到端：内部监理登录、外部监理凭链接+验证码；拍照自动印水印（时间、位置、工地、监理）；到货点收更新进度；看不到任何金额。
// 真浏览器 + 真 Postgres 引擎，页面调用的是实际的数据库函数。不碰线上。
import fs from 'node:fs';import http from 'node:http';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const db=new PGlite();const out='output/playwright/renovation-site';fs.mkdirSync(out,{recursive:true});
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
await db.exec(fs.readFileSync('supabase/renovation_party_signoffs_migration.sql','utf8'));await db.exec(fs.readFileSync('supabase/renovation_signoff_owner_proof_migration.sql','utf8'));await db.exec(fs.readFileSync('supabase/renovation_signoff_schedule_migration.sql','utf8'));await db.exec(fs.readFileSync('supabase/renovation_schedule_migration.sql','utf8'));
for(const f of ['renovation_schedule','renovation_planning','renovation_site_supervision'])await db.exec(fs.readFileSync(`supabase/${f}_migration.sql`,'utf8'));
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
 if(req.kind==='upload'){if(req.path.includes('/site/')){await asUser(user);if(!(await db.query('SELECT public._reno_site_upload_ok($1) v',[req.path])).rows[0].v)throw new Error('new row violates row-level security policy');}await db.exec('RESET ROLE');await db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',[req.bucket,req.path]);files.set(req.path,req.base64);return true;}
 if(req.kind==='download'){await asUser(user);const allowed=user?true:(await db.query('SELECT public._reno_custom_doc_readable($1) OR public._reno_signoff_doc_readable($1) v',[req.path])).rows[0].v;if(!allowed)throw new Error('无权读取文件');return files.get(req.path);}
 throw new Error('unknown');
}
const server=http.createServer((q,s)=>{const p=path.join(process.cwd(),decodeURIComponent(new URL(q.url,'http://x').pathname));fs.readFile(p,(e,b)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'content-type':p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.png')?'image/png':'application/octet-stream'});s.end(b);});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const stub=`window.supabase={createClient:(u,k,o)=>{const call=async r=>{const x=JSON.parse(await window.__db(JSON.stringify(r)));return x;};
 const b64=async f=>{const a=new Uint8Array(await f.arrayBuffer());let s='';for(const c of a)s+=String.fromCharCode(c);return btoa(s);};
 return {rpc:async(name,args)=>call({kind:'rpc',name,args}),auth:{getSession:async()=>({data:{session:window.__signedIn?{user:{}}:null}})},
 from(table){const r={kind:'select',table,eq:[]};let one=false;const q={select(){return q},eq(k,v){r.eq.push([k,v]);return q},order(){return q},limit(n){r.limit=n;return q},single(){one=true;return q},then(ok,no){return call(r).then(x=>x.error?x:({data:one?(x.data||[])[0]:x.data,error:null})).then(ok,no);}};return q;},
 storage:{from:bucket=>({upload:async(path,file)=>call({kind:'upload',bucket,path,base64:await b64(file)}),download:async path=>{const x=await call({kind:'download',bucket,path});if(x.error)return x;const s=atob(x.data),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return {data:new Blob([a],{type:'image/png'}),error:null};},createSignedUrl:async path=>({data:{signedUrl:'${base}/portal/renovation.html?signed='+encodeURIComponent(path)},error:null}),createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:'${base}/portal/renovation.html?signed='+encodeURIComponent(path),error:null})),error:null})})}};}};`;
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];
const open=async(user,url,viewport={width:1280,height:1000})=>{const c=await browser.newContext({viewport,geolocation:{latitude:1.4927,longitude:103.7414,accuracy:12},permissions:['geolocation']});await c.grantPermissions(['clipboard-read','clipboard-write','geolocation'],{origin:base});const page=await c.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await c.exposeFunction('__db',r=>{const req=JSON.parse(r);const job=queue.then(()=>handle(user,req)).then(data=>JSON.stringify({data,error:null}),e=>JSON.stringify({data:null,error:{message:e.message}}));queue=job.catch(()=>{});return job;});
 await c.addInitScript(`window.__signedIn=${!!user}`);
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname==='127.0.0.1')return r.continue();if(u.pathname.endsWith('supabase.min.js'))return r.fulfill({contentType:'application/javascript',body:stub});return r.abort();});
 await page.goto(base+url);return page;};
const sys=async(sql,a=[])=>{const j=queue.then(async()=>{await db.exec('RESET ROLE');return (await db.query(sql,a)).rows;});queue=j.catch(()=>{});return j;};
const stages=async()=>Object.fromEntries((await sys('SELECT line_id,stage FROM renovation_work_items WHERE project_id=$1',[id])).map(r=>[r.line_id,r.stage]));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==','base64');
const openCard=async(page,name)=>{const card=page.locator('details.work',{hasText:name});await card.waitFor();if(!(await card.evaluate(e=>e.open)))await card.locator('summary').first().click();return card;};
const pickMode=async card=>{if(!(await card.locator('.fulfillment.picking').count()))await card.locator('[data-fxpick]').click();};

const sup='20000000-0000-4000-8000-000000000009';
const asQ=async(who,sql,a=[])=>{const j=queue.then(async()=>{await db.exec(`RESET ROLE;SET request.jwt.claim.sub='${who}';SET ROLE authenticated`);return (await db.query(sql,a)).rows[0]?.v;});queue=j.catch(()=>{});return j;};
const photo=fs.readFileSync('tests/fixtures/site-photo.jpg');
try{
 const t=(await sys(`SELECT (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date::text d`))[0].d;
 await sys(`INSERT INTO profiles(id,name,active,role,store_id,region,phone) VALUES('${sup}','陈监理',true,'supervisor',null,null,'012')`);
 const cw=(await sys(`SELECT id FROM renovation_work_orders WHERE project_id=$1 AND group_name='全屋定制'`,[id]))[0].id,mw=(await sys(`SELECT id FROM renovation_work_orders WHERE project_id=$1 AND group_name='泥水'`,[id]))[0].id;
 const b=(await sys(`INSERT INTO renovation_purchase_batches(project_id,work_order_id,supplier,supplier_order_no,ordered_on,expected_on,created_by) VALUES($1,$2,'广州工厂','PO-1',$3,$3,$4) RETURNING id`,[id,cw,t,staff]))[0].id;
 await sys(`UPDATE renovation_work_items SET stage='ordered',batch_id=$2 WHERE work_order_id=$1`,[cw,b]);
 await sys(`UPDATE renovation_work_orders SET planned_start=$2::date-1,planned_end=$2::date+5,assignee='泥水阿强' WHERE id=$1`,[mw,t]);
 await sys(`UPDATE renovation_projects SET handover_on=$2::date+40 WHERE id=$1`,[id,t]);
 await asQ(staff,'SELECT renovation_supervisor_save($1,$2::jsonb) v',[id,JSON.stringify({profile_id:sup})]);
 // 1) 内部监理登录：只有一个工地，直接进工地；看不到金额
 const pg=await open(sup,'/portal/renovation-site.html',{width:390,height:844});
 await pg.getByText('今天要做').waitFor();const all=await pg.locator('#site').innerText();
 assert(all.includes('HZ-E2E')&&all.includes('到货点收：全屋定制')&&all.includes('开工：泥水'),'today list shows the arrival and the start due: '+all.slice(0,300));
 assert(!/RM|8800|8,800|5100|60101234567|Owner/.test(all),'no prices or owner details on the supervisor page');
 await pg.screenshot({path:out+'/site-home-phone.png',fullPage:true});
 // 2) 到货点收：拍照 → 自动印水印 → 只勾衣柜 → 提交 → 子单进度更新
 await pg.locator('.site-task',{hasText:'到货点收'}).click();
 const sheet=pg.locator('#sheet');await sheet.locator('[data-line]').first().waitFor();
 await sheet.locator('[data-line][value="C2"]').uncheck();await sheet.locator('[data-line][value="S1"]').uncheck();
 await sheet.locator('[data-shot="camera"]').setInputFiles({name:'a.jpg',mimeType:'image/jpeg',buffer:photo});
 await sheet.locator('[data-thumbs] img').waitFor();
 await pg.screenshot({path:out+'/site-arrival-sheet.png'});
 await sheet.locator('[data-submit]').click();await pg.getByText('到货点收已保存').waitFor();
 const st=await stages();assert(st.C1==='arrived'&&st.C2==='ordered','only the ticked item is marked arrived: '+JSON.stringify(st));
 const e1=(await sys(`SELECT photos FROM renovation_site_entries WHERE kind='arrival'`))[0].photos[0];
 assert(Math.abs(e1.lat-1.4927)<1e-3&&Math.abs(e1.lng-103.7414)<1e-3&&e1.source==='camera'&&/^[0-9a-f]{64}$/.test(e1.sha256),'photo keeps location, time and fingerprint: '+JSON.stringify(e1));
 const img=Buffer.from(files.get(e1.path),'base64');fs.writeFileSync(out+'/watermarked.jpg',img);
 assert(img[0]===0xFF&&img[1]===0xD8,'uploaded photo is the watermarked JPEG');
 // 水印确实印上：比较原图和上传图左下角的像素
 const changed=await pg.evaluate(async b64=>{const bm=await createImageBitmap(await (await fetch('data:image/jpeg;base64,'+b64)).blob());const c=document.createElement('canvas');c.width=bm.width;c.height=bm.height;const g=c.getContext('2d');g.drawImage(bm,0,0);const d=g.getImageData(40,bm.height-60,1,1).data;return [bm.width,d[0],d[1],d[2]];},img.toString('base64'));
 assert(changed[0]===1200&&changed[1]<120,'bottom-left has the dark watermark box: '+changed);
 // 3) 日志：拍照 + 一句话
 await pg.locator('.site-task',{hasText:'交今天的工地日志'}).click();
 await sheet.locator('[data-f="note"]').fill('泥水 2 人，客厅铺砖 70%');
 await sheet.locator('[data-submit]').click();assert((await sheet.locator('[data-sheet-msg]').innerText()).includes('至少拍 1 张'),'a log needs a photo');
 await sheet.locator('[data-shot="album"]').setInputFiles({name:'b.jpg',mimeType:'image/jpeg',buffer:photo});await sheet.locator('[data-thumbs] img').waitFor();
 await sheet.locator('[data-submit]').click();await pg.getByText('工地日志已保存').waitFor();
 assert((await pg.locator('.site-task.ok').innerText()).includes('今天的工地日志已交'),'log done for today');
 const lg=(await sys(`SELECT photos FROM renovation_site_entries WHERE kind='log'`))[0].photos[0];assert(lg.source==='album'&&lg.reused===true,'album photo is marked, and the same photo used twice is flagged');
 // 4) 延误：选原因
 await pg.locator('[data-act="delay"]').click();await sheet.locator('[data-reason="weather"]').click();await sheet.locator('[data-f="note"]').fill('大雨');
 await sheet.locator('[data-submit]').click();await pg.getByText('延误已保存').waitFor();
 assert((await pg.locator('.site-log').innerText()).includes('天气 1 天 · 等店长确认'),'delay waits for the store manager');
 // 5) 开工
 await pg.locator('.site-task',{hasText:'开工：泥水'}).click();await sheet.locator('[data-shot="camera"]').setInputFiles({name:'c.jpg',mimeType:'image/jpeg',buffer:photo});await sheet.locator('[data-thumbs] img').waitFor();
 await sheet.locator('[data-submit]').click();await pg.getByText('开工已保存').waitFor();assert((await stages()).W1==='working','start moves work to 施工中');
 const ofl=await pg.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(ofl<=1,'no sideways scroll on phone: '+ofl);
 // 6) 外部监理：链接 + 验证码
 const ext=await asQ(staff,'SELECT renovation_supervisor_save($1,$2::jsonb) v',[id,JSON.stringify({name:'Ahmad',phone:'013'})]);
 const xp=await open(null,`/portal/renovation-site.html?site=${ext.id}&t=${ext.token}`,{width:390,height:844});
 await xp.locator('[data-code]').fill(ext.code==='0000'?'1111':'0000');await xp.locator('[data-verify]').click();await xp.getByText('验证码不正确').waitFor();
 await xp.locator('[data-code]').fill(ext.code);await xp.locator('[data-verify]').click();await xp.getByText('今天要做').waitFor();
 assert((await xp.locator('.site-head').innerText()).includes('Ahmad'),'outside supervisor sees their name');
 await xp.locator('.site-task',{hasText:'交今天的工地日志'}).click();const xs=xp.locator('#sheet');
 await xs.locator('[data-shot="camera"]').setInputFiles({name:'d.jpg',mimeType:'image/jpeg',buffer:photo});await xs.locator('[data-thumbs] img').waitFor();
 await xs.locator('[data-submit]').click();await xp.getByText('工地日志已保存').waitFor();
 assert((await sys(`SELECT count(*)::int n FROM renovation_site_entries e JOIN renovation_site_supervisors s ON s.id=e.supervisor_id WHERE s.kind='external'`))[0].n===1,'outside supervisor log saved with their own photo');
 assert.deepEqual(errors,[],'no page errors');
 console.log('PASS site supervision browser flow');
}finally{await browser.close();server.close();}
