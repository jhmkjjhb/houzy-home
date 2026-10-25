const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const assert=require('node:assert/strict');const fs=require('node:fs');
const out=process.cwd()+'/output/playwright/customer-production';fs.mkdirSync(out,{recursive:true});
function fixture(){
 window.__customerFixture={scope:0,accepted:false,revoked:false,progressError:false,financeError:false,calls:[],writes:0};
 const f=window.__customerFixture,total=()=>171000+(f.scope?3200:0);
 const project=()=>({contract_no:'TEST-CUSTOMER-001',address:'Austin · 测试项目（模拟接口）',state:f.accepted?'accepted':'executing',scope_revision:f.scope,accepted_on:f.accepted?'2026-10-25':null,net:total(),original_net:171000,additions_total:f.scope?3200:0,lines:[{id:'01',name:'厨房定制柜体',spec:'柜体与安装 · <img src=x onerror=alert(1)>',qty:1,unit:'项',warranties:[{component:'柜体',years:3,source:'测试合同条款'}]},{id:'02',name:'赠品',qty:1,unit:'项',gift:true,warranties:[]}]});
 const terms=()=>({category:'material',name:'台面升级',contract_no:'TEST-CUSTOMER-001',address:'Austin · 测试项目',spec:'测试规格',qty:1,unit:'项',rate:3200,amount:3200,current_total:total(),after_sign_total:total()+3200,payment_node:'确认后',warranty_note:'待补充合同凭证'});
 window.supabase={createClient:()=>({rpc:async(name,args)=>{f.calls.push(name);
  if(name==='renovation_customer_view')return {data:f.revoked?null:project()};
  if(name==='renovation_customer_payment_view')return f.financeError?{error:{message:'offline'}}:{data:{scope_revision:f.scope,state:project().state,summary:{total:total(),original_total:171000,additions_total:f.scope?3200:0,paid:72750,balance:total()-72750,status:'partial'},installments:[{number:1,name:'签约',amount:42750,paid:42750,balance:0,percentage:25},{number:2,name:'进场',amount:68400,paid:30000,balance:38400,percentage:40}],entries:[{kind:'receipt',installment:1,amount:42750,method:'bank_transfer',paid_on:'2026-10-24',verified:true}]}};
  if(name==='renovation_customer_progress_view')return f.progressError?{error:{message:'PGRST202'}}:{data:{state:project().state,work_orders:[{group_name:'定制产品',status:'done',updated_at:'2026-10-25T00:00:00Z'},{group_name:'硬装施工',status:'working',updated_at:'2026-10-25T01:00:00Z'}]}};
  if(name==='renovation_customer_additions')return {data:[{id:'33333333-3333-4333-8333-333333333333',category:'material',name:'台面升级',qty:1,unit:'项',rate:3200,amount:3200,payment_node:'确认后',signature_status:'pending'}]};
  if(name==='renovation_customer_addition_sign_view')return {data:{status:'pending',terms:terms(),terms_hash:'a'.repeat(64)}};
  if(name==='renovation_customer_sign_addition'){f.writes++;return {error:{message:'测试网络错误，未保存签署'}};}
  throw new Error('Unexpected RPC: '+name);
 },functions:{invoke:async()=>({data:{url:'https://wrong.invalid/contract.pdf'}})}})};
}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1080},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1')return route.continue();if(u.pathname.endsWith('supabase.min.js'))return route.fulfill({contentType:'application/javascript',body:`(${fixture.toString()})()`});return route.abort();});
 const base=(process.env.RENO_BASE_URL||'http://127.0.0.1:8137')+'/portal/renovation-customer.html',token='11111111-1111-4111-8111-111111111111';
 page.setDefaultTimeout(15000);await page.goto(base+'?invalid=1#bad');await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('完整项目链接'));assert(await page.locator('#customer-workspace').isHidden());
 await page.goto(base+'#'+token);await page.waitForFunction(()=>document.querySelector('#payment-sync').textContent.includes('已与门店同步'));await page.screenshot({path:out+'/desktop-contract.png',fullPage:true});
 const hash=new URL(page.url()).hash;
 await page.locator('#view-signed-contract').click();assert.match(await page.locator('#contract-message').innerText(),/链接无效/);
 await page.locator('#customer-checklist').evaluate(el=>el.open=true);assert.equal(await page.locator('#lines img').count(),0);
 for(const i of [1,2,3,4]){await page.locator(`#customer-journey [data-step="${i}"]`).click();assert.equal(new URL(page.url()).hash,hash);}
 await page.locator('#customer-journey [data-step="3"]').click();assert.equal(await page.locator('.execution-item').count(),2);assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuenow'),'1');await page.screenshot({path:out+'/desktop-progress.png',fullPage:true});
 await page.evaluate(()=>window.__customerFixture.progressError=true);await page.locator('#refresh-project').click();await page.waitForFunction(()=>document.querySelector('#customer-progress').textContent.includes('无法同步'));assert.equal(await page.locator('#customer-payments .customer-line').count()>0,true);
 await page.setViewportSize({width:390,height:844});const overflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
 for(let i=0;i<5;i++){await page.locator(`#customer-journey [data-step="${i}"]`).click();await overflow();}
 await page.locator('#customer-journey [data-step="1"]').click();await page.screenshot({path:out+'/mobile-payments.png',fullPage:true});
 await page.goto(base+'?addition=33333333-3333-4333-8333-333333333333&sign=22222222-2222-4222-8222-222222222222#'+token);await page.locator('[data-submit]').waitFor();await page.waitForFunction(()=>document.querySelector('#payment-sync').textContent.includes('已与门店同步'));assert.equal(await page.locator('#customer-journey [aria-current=step]').getAttribute('data-step'),'2');
 await page.locator('[data-submit]').click();assert.match(await page.locator('[data-feedback]').innerText(),/姓名/);
 await page.locator('[data-name]').fill('Test owner');await page.locator('canvas').evaluate(el=>el.scrollIntoView({block:'center'}));let box=await page.locator('canvas').boundingBox();await page.mouse.move(box.x+20,box.y+30);await page.mouse.down();await page.mouse.move(box.x+180,box.y+90,{steps:12});await page.mouse.up();await page.locator('[data-consent]').check();
 await page.locator('[data-submit]').click();assert.match(await page.locator('[data-feedback]').innerText(),/测试网络错误/);assert.equal(await page.locator('[data-name]').inputValue(),'Test owner');assert.equal(await page.evaluate(()=>window.__customerFixture.writes),1);assert(await page.evaluate(()=>RenoAdditionSigning.isDirty()));
 await page.locator('#customer-journey [data-step="3"]').click();await page.locator('#customer-journey [data-step="2"]').click();assert.equal(await page.locator('[data-name]').inputValue(),'Test owner');
 await page.evaluate(()=>window.__customerFixture.scope=1);await page.locator('#refresh-project').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('当前签署'));assert.match(await page.locator('#project').innerText(),/171,000/);
 await page.locator('[data-reload]').click();await page.waitForFunction(()=>!RenoAdditionSigning.isDirty());await page.locator('#refresh-project').click();await page.waitForFunction(()=>document.querySelector('#project').textContent.includes('174,200'));assert.match(await page.locator('#customer-payments').innerText(),/101,450/);
 await page.screenshot({path:out+'/mobile-signature.png',fullPage:true});
 await page.evaluate(()=>{window.__customerFixture.accepted=true;});await page.locator('#refresh-project').click();await page.waitForFunction(()=>document.querySelector('#acceptance-status').textContent.includes('2026-10-25'));await page.locator('#customer-journey [data-step="4"]').click();await page.locator('#warranty-lines details').first().evaluate(el=>el.open=true);assert.match(await page.locator('#warranty-lines').innerText(),/2029-10-25/);
 await page.setViewportSize({width:320,height:740});for(let i=0;i<5;i++){await page.locator(`#customer-journey [data-step="${i}"]`).click();await overflow();}
 await page.clock.install();await page.locator('#customer-journey [data-step="0"]').click();await page.locator('#customer-tour').click();await page.clock.fastForward(9100);assert.equal(await page.locator('#customer-journey [aria-current=step]').getAttribute('data-step'),'1');await page.locator('#customer-next').click();assert.equal(await page.locator('#customer-tour').getAttribute('aria-pressed'),'false');
 await page.evaluate(()=>window.__customerFixture.revoked=true);await page.locator('#refresh-project').click();await page.waitForFunction(()=>document.querySelector('#customer-workspace').hidden);assert.deepEqual(errors,[]);
 console.log('PASS: production five-section interface, invalid/revoked links, escaping, private PDF host check, payment totals, progress fallback, real-signature-only action, failed signature preservation, navigation redraw, scope-change dirty guard, data refresh, warranties, automatic read-only tour, 390px/320px no overflow, no JS errors. All backend calls isolated mocks.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
