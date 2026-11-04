// On a network that cannot reach the backend, registration must say so and offer a retry.
// A silent one-item dropdown looked like stores could not be chosen, and sent people in circles.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const stub=`window.__mode='down';window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}},
 rpc:async()=>({data:null,error:null}),from(){const f={select(){return f},eq(){return f},order(){if(window.__mode==='throw')return Promise.reject(new TypeError('Load failed'));if(window.__mode==='down')return Promise.resolve({data:null,error:{message:'Load failed'}});return Promise.resolve({data:[{id:'s1',name:'001 Austin'},{id:'s2',name:'新山门店'}],error:null});}};return f;}})};`;
const server=http.createServer((q,s)=>{const p=path.join(process.cwd(),decodeURIComponent(new URL(q.url,'http://x').pathname));fs.readFile(p,(e,b)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'content-type':p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.js')?'application/javascript':'application/octet-stream'});s.end(b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};const errors=[];
try{const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname==='127.0.0.1')return r.continue();if(u.pathname.includes('supabase'))return r.fulfill({contentType:'application/javascript',body:stub});if(u.hostname==='cdn.tailwindcss.com')return r.fulfill({contentType:'application/javascript',body:'window.tailwind={}'});return r.abort();});
 await page.addInitScript(()=>addEventListener('DOMContentLoaded',()=>{const st=document.createElement('style');st.textContent='.hidden{display:none!important}';document.head.append(st);}));
 await page.goto(base+'/portal/login.html');await page.waitForFunction(()=>typeof showRegister==='function');
 await page.evaluate(()=>showRegister());
 const hint=page.locator('#reg-store-load-error');await hint.waitFor({state:'visible'});
 ok((await hint.innerText()).includes('门店列表读取失败'),'a failed load is explained');ok(await page.locator('#reg-store option').count()===1,'no invented stores');
 await page.evaluate(()=>{window.__mode='throw';return loadRegisterStores();});ok(await hint.isVisible(),'a thrown network error is explained too');
 await page.evaluate(()=>{window.__mode='up';});await hint.locator('button').click();await hint.waitFor({state:'hidden'});
 ok(await page.locator('#reg-store option').count()===3,'retry fills the list once the network is back');ok(await page.locator('#reg-wh-store option').count()===3,'warehouse form too');
 await page.locator('#reg-store').selectOption('s2');await page.evaluate(()=>{window.__mode='down';return loadRegisterStores();});ok(await page.locator('#reg-store').inputValue()==='s2','a chosen store is never wiped');
 const src=fs.readFileSync('portal/login.html','utf8');ok((src.match(/err_store_load:/g)||[]).length===5&&(src.match(/btn_reload_stores:/g)||[]).length===5,'all five languages have both texts');
 ok(errors.length===0,'no page errors: '+errors.join('|'));console.log(`PASS ${checks} registration store list checks`);
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
