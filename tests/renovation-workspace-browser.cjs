const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');const assert=require('node:assert/strict');
const out=process.cwd()+'/output/playwright/renovation-workspace';fs.mkdirSync(out,{recursive:true});
const fixture=()=>{
 const states=['executing','draft','confirmed','accepted'];
 const projects=states.map((state,i)=>({id:`30000000-0000-4000-8000-00000000000${i}`,store_id:'store',customer_name:['林先生（演示）','陈女士（演示）','黄先生（演示）','李女士（演示）'][i],customer_phone:'60100000000',address:['Austin · 双层排屋 / Jalan Mutiara','Eco Botanic · 公寓 / Jalan Eko','Bukit Indah · 住宅 / Jalan Indah','Mount Austin · 公寓 / Jalan Austin'][i],contract_no:`HZ-RC-DEMO-00${i+1}`,state,revision:2,created_at:'2026-10-25',current_total:[171000,68400,128000,95600][i],snapshot:{net:[171000,68400,128000,95600][i],discount:0,contract_path:'demo.pdf',signed_on:'2026-10-22',payments:[{name:'签约首期款',amount:42750},{name:'施工进场',amount:68400},{name:'安装工程',amount:51300},{name:'竣工交付',amount:8550}],lines:[{id:'01',name:'全铝橱柜',spec:'厨房定制地柜 · 合同规格',qty:1,rate:171000,unit:'项',kind:'custom',group:'橱柜安装',warranties:[]}]}}));
 const rpc=async(name,args)=>{
  if(name==='get_my_profile')return {data:{id:'manager',role:'store_manager',store_id:'store'}};
  if(name==='renovation_addition_view'){const p=projects.find(p=>p.id===args.p_id);return {data:{entries:[],lines:p.snapshot.lines,plan:p.snapshot.payments,original_total:p.snapshot.net,total:p.snapshot.net,additions_total:0}};}
  if(name==='renovation_payment_view')return {data:{summary:{total:171000,paid:72750,balance:98250,status:'partial',original_total:171000},installments:[{number:1,name:'签约首期款',amount:42750,paid:42750,balance:0,percentage:25},{number:2,name:'施工进场',amount:68400,paid:30000,balance:38400,percentage:40}],entries:[]}};
  // Change orders (10-28) and contract e-signature load with every project.
  if(name==='renovation_deduction_view'){const p=projects.find(p=>p.id===args.p_id);return {data:{entries:[],lines:p.snapshot.lines,original_net:p.snapshot.net,original_gross:p.snapshot.net,deductions_total:0,current_total:p.current_total}};}
  if(name==='renovation_contract_esign_view')return {data:null};
  throw new Error('Unexpected RPC '+name);
 };
 window.supabase={createClient:()=>({rpc,auth:{getSession:async()=>({data:{session:{user:{id:'manager'}}}})},from(table){let id;const q={select(){return q},eq(k,v){if(k==='id')id=v;return q},order(){return q},limit(){return q},single(){return Promise.resolve({data:projects.find(p=>p.id===id)})},then(resolve,reject){let data=table==='stores'?[{id:'store',name:'Austin 门店'}]:table==='renovation_projects'?projects:table==='renovation_audit'?[{action:'confirm',created_at:'2026-10-24T10:00:00Z'}]:[{id:'work',group_name:'橱柜安装',line_ids:['01'],status:'draft',assignee:''}];return Promise.resolve({data}).then(resolve,reject)}};return q}})};
};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1')return route.continue();if(u.pathname.endsWith('supabase.min.js'))return route.fulfill({contentType:'application/javascript',body:`(${fixture.toString()})()`});return route.abort();});
 await page.goto((process.env.RENO_BASE_URL||'http://127.0.0.1:8140')+'/portal/renovation.html');await page.waitForFunction(()=>document.querySelector('#count-all')?.textContent==='4');
 await page.screenshot({path:out+'/desktop-list.png',fullPage:true});
 await page.locator('#project-search').fill('陈女士');assert.equal(await page.locator('#list .project:visible').count(),1);
 await page.locator('#project-filter').selectOption('executing');assert.equal(await page.locator('#list .project:visible').count(),0);await page.locator('#search-empty').waitFor({state:'visible'});
 await page.locator('#clear-project-filter').click();assert.equal(await page.locator('#list .project:visible').count(),4);
 await page.locator('[data-open]').first().click();await page.locator('#actual-payments [data-add]').waitFor();
 const hash=new URL(page.url()).hash;await page.locator('.steps a[href="#project-receipts"]').click();assert.equal(new URL(page.url()).hash,hash);await page.screenshot({path:out+'/desktop-receipts.png'});
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:out+'/desktop-project.png'});
 await page.locator('#back-list').click();await page.locator('#new-project').click();await page.locator('#editor').waitFor({state:'visible'});assert.equal(await page.locator('#create').isVisible(),true);await page.screenshot({path:out+'/desktop-new.png'});
 await page.locator('#back-list').click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/mobile-list.png',fullPage:true});
 const checkOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page has horizontal overflow');await checkOverflow();
 await page.locator('[data-open]').first().click();await page.locator('#actual-payments [data-add]').waitFor();await page.screenshot({path:out+'/mobile-project.png'});await checkOverflow();
 await page.locator('.steps a[href="#project-receipts"]').click();assert.equal(new URL(page.url()).hash,hash);await page.screenshot({path:out+'/mobile-receipts.png'});await checkOverflow();
 await page.setViewportSize({width:320,height:740});await checkOverflow();
 await page.locator('#back-list').click();await page.locator('#new-project').click();await page.screenshot({path:out+'/mobile-new.png'});await checkOverflow();
 assert.deepEqual(errors,[]);console.log('PASS: desktop and mobile list/detail/new, search, status filter, empty/reset, back navigation, section scroll retains project hash, 390px/320px no overflow, no JS errors. Mock data only; all external requests blocked.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
