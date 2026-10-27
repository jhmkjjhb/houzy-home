const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');const assert=require('node:assert/strict');
const out=process.cwd()+'/output/playwright/lead-radar';fs.mkdirSync(out,{recursive:true});
// Replaces supabase-js in the page: every request stays in this fixture, nothing reaches the network.
const fixture=role=>{
 const now=Date.now(),ago=d=>new Date(now-d*864e5).toISOString();
 const items=[
  {id:'p1',label:'demand',score:91,service:'kitchen',platform:'facebook_group',area:'Skudai（演示）',lang:'en',keywords:['kitchen cabinet','waterproof'],found_at:ago(1),published_hint:'1 day ago',status:'new',title:'Need kitchen cabinet (demo)',snippet:'Demo post: full kitchen cabinet in Skudai, contractors pls WhatsApp me <img src=x onerror="window.__xss=1">',url:'https://example.com/demo-post-1',reason:'演示：业主找整套橱柜',suggested_reply:'Hi! HOUZY HOME can help. https://wa.me/60105898786?text=Hi',invites_contact:true,posted_contact:'+60123456821'},
  {id:'p2',label:'demand',score:72,service:'full_house',platform:'threads',area:'Mount Austin（演示）',lang:'ms',keywords:['rumah baru'],found_at:ago(3),published_hint:null,status:'new',title:'',snippet:'Demo: cari kontraktor renovate rumah baru JB',url:'https://example.com/demo-post-2',reason:'演示：新房业主找承包商',suggested_reply:'Salam! HOUZY HOME di JB.',invites_contact:false,posted_contact:null},
  {id:'p3',label:'ad',score:8,service:null,platform:'instagram',found_at:ago(1),status:'new',title:'Demo contractor ad',snippet:'We renovate',url:'https://example.com/ad',reason:'演示：同行广告'},
 ];
 const queries=[{id:'q1',query:'kitchen cabinet JB (demo)',lang:'en',active:true}];
 window.__calls=[];window.__opened=null;
 window.open=()=>({set opener(v){},location:{set href(u){window.__opened=u;}},close(){}});
 window.confirm=()=>true;
 const result=(table)=>({data:table==='lead_radar_items'?items:table==='lead_radar_queries'?queries:[{started_at:ago(0.1),status:'ok',queries_run:20,new_items:3,demand_items:2,errors:[]}],error:null});
 const query=table=>{const q={select:()=>q,gte:()=>q,neq:()=>q,order:()=>q,limit:()=>q,eq:()=>q,insert:()=>q,update:()=>q,delete:()=>q,then:(res,rej)=>Promise.resolve(result(table)).then(res,rej)};return q;};
 window.supabase={createClient:()=>({
  auth:{getSession:async()=>({data:{session:{access_token:'demo',user:{id:'u1'}}}})},
  from:query,
  rpc:async(name,args)=>{window.__calls.push({name,args});
   if(name==='get_my_profile')return {data:{id:'u1',role,active:true,name:'Demo'}};
   if(name==='lead_radar_mark'){const i=items.find(i=>i.id===args.p_item);if(args.p_status==='contacted'&&i.status==='contacted')return {error:{message:'已经联系过这位客户，请勿重复联系'}};
    return {data:{id:i.id,status:args.p_status,handled_by_name:'Demo',handled_at:new Date().toISOString(),note:null}};}
   throw new Error('Unexpected RPC '+name);}})};
};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const open=async(role,viewport)=>{const context=await browser.newContext({viewport,reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1')return route.continue();if(u.pathname.endsWith('supabase.min.js'))return route.fulfill({contentType:'application/javascript',body:`(${fixture.toString()})(${JSON.stringify(role)})`});return route.abort();});
   await page.goto((process.env.RENO_BASE_URL||'http://127.0.0.1:8141')+'/portal/lead-radar.html');await page.waitForFunction(()=>document.querySelector('#count-new')?.textContent==='2');return {page,errors,context};};

  // Manager on desktop: full queue, trends, keyword admin and manual run.
  let {page,errors,context}=await open('general_manager',{width:1440,height:1000});
  assert.equal(await page.locator('.radar-card').count(),2,'only demand posts are in the queue');
  assert.equal(await page.locator('#count-filtered').textContent(),'1');
  assert(await page.locator('#admin-section').isVisible()&&await page.locator('#run-now').isVisible(),'managers see keyword settings and manual run');
  assert.equal(await page.evaluate(()=>window.__xss),undefined,'post HTML is never executed');
  assert(await page.locator('.radar-card').first().locator('text=客户已留号').isVisible());
  assert(await page.locator('.radar-card').nth(1).locator('text=日期未验证').isVisible(),'missing date flagged');
  assert.match(await page.locator('#trend-service').textContent(),/厨房橱柜1/);
  await page.screenshot({path:out+'/desktop.png',fullPage:true});
  // Contact once: the tab opens WhatsApp only after the contact is recorded, then the button locks.
  await page.locator('[data-contact="p1"]').click();await page.waitForFunction(()=>window.__opened);
  assert.match(await page.evaluate(()=>window.__opened),/^https:\/\/wa\.me\/60123456821\?text=/);
  assert(await page.evaluate(()=>window.__calls.some(c=>c.name==='lead_radar_mark'&&c.args.p_status==='contacted')));
  await page.locator('#filter-state').selectOption('all');assert(await page.locator('[data-contact="p1"]').isDisabled(),'contact button locked after use');
  // Marking a reply moves the post out of the open queue and updates the counts.
  await page.locator('#filter-state').selectOption('open');await page.locator('[data-id="p2"][data-mark="replied"]').click();
  await page.waitForFunction(()=>document.querySelector('#count-new').textContent==='0');assert.equal(await page.locator('.radar-card').count(),0);
  assert.match(await page.locator('.radar-empty').textContent(),/全部/);
  assert.deepEqual(errors,[]);await context.close();

  // Ordinary staff on a phone: no admin controls, no sideways scrolling.
  ({page,errors,context}=await open('staff',{width:390,height:844}));
  assert(!(await page.locator('#admin-section').isVisible())&&!(await page.locator('#run-now').isVisible()),'staff cannot change keywords or start paid runs');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal scroll at 390px');
  await page.screenshot({path:out+'/mobile.png',fullPage:true});assert.deepEqual(errors,[]);await context.close();
  console.log('PASS: lead radar page — queue, filtered ads, unverified dates, escaping, contact-once flow, reply marking, trends, manager-only controls, 390px');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
