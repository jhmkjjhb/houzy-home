// Real pages in a real browser: staff can pay or share the link for the current installment, and a
// customer sees a pay button only when something is due, without being able to choose the amount.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out='output/playwright/order-payment';fs.mkdirSync(out,{recursive:true});
const stub=`(()=>{const calls=window.__calls=[];const S=window.__s={quote:{payable:true,seq:1,installments:2,pct:50,amount:500,currency:'MYR'},pay:{payable:true,seq:1,installments:2,amount:500,payment_url:'https://pay.example/r1',payment_id:'r1',customer_phone:'60167475446'}};
const profile={id:'u1',name:'Amy',role:'store_manager',store_id:'s1',active:true};
const order={id:'o1',order_no:'001-1',amount:1000,currency:'MYR',status:'pending_payment',payment_status:'unpaid',installments:2,pay_splits:[50,50],store_id:'s1',staff_id:'u1',created_at:'2026-11-04T08:00:00Z',stores:{name:'Austin',code:'001'},customers:{id:'c1',name:'王先生',phone:'60167475446',address:''},order_billing:null,profiles:{name:'Amy'}};
const rows={stores:[{id:'s1',name:'Austin',code:'001',active:true,region:'JB'}]};
function q(t){let one=false;const f={select(){return f},eq(){return f},neq(){return f},in(){return f},is(){return f},gte(){return f},lte(){return f},lt(){return f},gt(){return f},not(){return f},or(){return f},ilike(){return f},order(){return f},limit(){return f},range(){return f},single(){one=true;return f},maybeSingle(){one=true;return f},insert(){return f},update(){return f},delete(){return f},upsert(){return f},
 then(ok,no){let data=rows[t]||[];if(t==='orders')data=one?order:[order];else if(one)data=data[0]||null;return Promise.resolve({data,error:null,count:0}).then(ok,no);}};return f;}
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:window.__guest?null:{user:{id:'u1'}}}}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({})},from:q,channel(){const c={on(){return c},subscribe(){return c}};return c},removeChannel(){},
 functions:{invoke:async(n,o)=>{calls.push({fn:n,body:o.body});if(S.fail)return {data:null,error:new Error('down')};return {data:S.pay,error:null};}},storage:{from:()=>({})},
 rpc:async(n,a)=>{calls.push({rpc:n,args:a});if(n==='get_my_profile')return {data:profile,error:null};if(n==='get_payment_hold')return {data:{expires_at:new Date(Date.now()+3600e3).toISOString(),extend_count:0,expired_at:null,max_hold_days:60,max_expires_at:new Date(Date.now()+59*864e5).toISOString(),enabled:true},error:null};if(n==='extend_payment_hold'){if(S.holdFail)return {data:null,error:{message:'延期次数已用完'}};return {data:{expires_at:new Date(Date.now()+3*864e5).toISOString(),extend_count:1},error:null};}if(n==='order_customer_payment_quote')return {data:S.quote,error:null};
  if(n==='get_orders_by_phone')return {data:[{...order}],error:null};if(n==='get_order_statement_by_phone')return {data:{order,items:[],payments:[]},error:null};if(n==='get_order_detail_by_phone')return {data:{status:order.status},error:null};if(n==='get_order_timeline')return {data:[],error:null};if(n==='get_order_items_by_phone')return {data:{items:[]},error:null};
  return {data:null,error:null};}})};})();`;
const server=http.createServer((q,s)=>{const p=path.join(process.cwd(),decodeURIComponent(new URL(q.url,'http://x').pathname));fs.readFile(p,(e,b)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'content-type':p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.js')?'application/javascript':'application/octet-stream'});s.end(b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
const open=async(url,guest)=>{const c=await browser.newContext({viewport:{width:1100,height:1000}});await c.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});const page=await c.newPage();page.on('pageerror',e=>errors.push(url+': '+e.message));
 page.__dialogs=[];page.on('dialog',d=>{page.__dialogs.push(d.message());d.accept();});
 await page.addInitScript(g=>{window.__guest=g;addEventListener('DOMContentLoaded',()=>{const st=document.createElement('style');st.textContent='.hidden{display:none!important}';document.head.append(st);});},guest);
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname==='127.0.0.1')return r.continue();if(u.pathname.includes('supabase'))return r.fulfill({contentType:'application/javascript',body:stub});if(u.hostname==='cdn.tailwindcss.com')return r.fulfill({contentType:'application/javascript',body:'window.tailwind={}'});return r.abort();});
 await page.goto(base+url);return page;};
try{
 // Staff
 const staff=await open('/portal/staff.html',false);await staff.waitForFunction(()=>typeof openDetail==='function'&&window.__calls?.some(c=>c.rpc==='get_my_profile'));await staff.waitForTimeout(500);
 await staff.evaluate(()=>openDetail('o1','orders'));await staff.locator('#pay-share-1').waitFor({state:'attached'});
 await staff.evaluate(()=>{document.querySelector('[data-fold-key="pay"] details,[data-fold-key="pay"]')?.setAttribute('open','');document.querySelector('#pay-share-1').scrollIntoView();});
 await staff.evaluate(()=>shareHitPayLink('o1',1,false));
 const sent=await staff.evaluate(()=>__calls.filter(c=>c.fn==='hitpay-payment').at(-1).body);ok(sent.action==='link'&&sent.seq===1&&sent.order_id==='o1','copy asks for this installment link');ok(!('amount' in sent),'the page never sends an amount');
 ok(await staff.evaluate(()=>navigator.clipboard.readText())==='https://pay.example/r1','the link is on the clipboard');ok(staff.__dialogs.at(-1).includes('500.00'),'staff see the amount they are sending');
 const [popup]=await Promise.all([staff.context().waitForEvent('page'),staff.evaluate(()=>shareHitPayLink('o1',1,true))]);await popup.waitForTimeout(300);
 await staff.evaluate(()=>{const s=document.getElementById('pay-method-1');s.value='cash';updatePaymentAction(1);});ok(await staff.locator('#pay-share-1').isHidden(),'share buttons hide for cash');ok((await staff.locator('#pay-action-1').innerText()).includes('确认收款'),'button becomes record receipt');
 await staff.evaluate(()=>{const s=document.getElementById('pay-method-1');s.value='hitpay';updatePaymentAction(1);});ok(await staff.locator('#pay-share-1').isVisible(),'share buttons return');
 await staff.screenshot({path:out+'/staff.png',fullPage:false});
 const before=await staff.evaluate(()=>__calls.filter(c=>c.fn==='hitpay-payment').length);await staff.evaluate(()=>{__s.fail=true;return shareHitPayLink('o1',1,false);});ok(staff.__dialogs.at(-1).includes('down')||staff.__dialogs.at(-1).includes('失败'),'a failure is reported');ok(await staff.evaluate(()=>__calls.filter(c=>c.fn==='hitpay-payment').length)===before+1,'tried once');
 // Extending the order also brings the sent link along.
 await staff.evaluate(()=>{__s.fail=false;});ok((await staff.getByText(/延期挂单（还可 2 次/).count())>0,'unpaid order offers an extension');
 await staff.evaluate(()=>{window.houzyPrompt=async()=>({days:'3',reason:'客户下周付款'});return extendPaymentHold('o1');});
 const extCalls=await staff.evaluate(()=>__calls.filter(c=>c.rpc==='extend_payment_hold'||c.fn==='hitpay-close-links').map(c=>c.rpc||c.fn));ok(extCalls.join()==='extend_payment_hold,hitpay-close-links','the order extends first, then the link is updated: '+extCalls);
 ok((await staff.evaluate(()=>__calls.find(c=>c.rpc==='extend_payment_hold').args.p_days))===3,'with the days staff chose');ok(staff.__dialogs.at(-1).includes('已延期'),'staff are told');
 const syncs=await staff.evaluate(()=>__calls.filter(c=>c.fn==='hitpay-close-links').length);await staff.evaluate(()=>{__s.holdFail=true;return extendPaymentHold('o1');});ok(await staff.evaluate(()=>__calls.filter(c=>c.fn==='hitpay-close-links').length)===syncs,'a refused extension changes nothing');ok(staff.__dialogs.at(-1).includes('延期失败'),'and says why');
 // Customer
 const customer=await open('/portal/customer.html?hitpay=return',true);await customer.locator('#hitpay-return-note').waitFor({state:'attached'});ok((await customer.locator('#hitpay-return-note').innerText()).includes('正在确认'),'returning says confirming, not paid');ok(!customer.url().includes('hitpay='),'the notice does not repeat on refresh');
 const phone=customer.locator('input[type="tel"]').first();await phone.fill('167475446');await customer.locator('#search-btn').click();
 await customer.getByText('001-1').first().click();await customer.locator('#customer-pay-btn').waitFor();
 ok((await customer.locator('#customer-pay-btn').innerText()).includes('RM 500.00'),'button shows the amount due');ok((await customer.locator('#customer-pay-btn').innerText()).includes('第1期'),'and which installment');await customer.screenshot({path:out+'/customer.png',fullPage:true});
 const qArgs=await customer.evaluate(()=>__calls.find(c=>c.rpc==='order_customer_payment_quote').args);ok(qArgs.p_order==='o1','quote is for this order');
 await customer.evaluate(()=>{__s.fail=true;return startCustomerPayment('o1');});ok((await customer.locator('#customer-pay-msg').innerText()).includes('暂时无法'),'failure is explained');ok(!(await customer.locator('#customer-pay-btn').isDisabled()),'and can be retried');
 const body=await customer.evaluate(()=>__calls.filter(c=>c.fn==='hitpay-customer-payment').at(-1).body);ok(Object.keys(body).sort().join()==='order_id,phone','only order and phone are sent');ok(body.phone.startsWith('60'),'registered phone format');
 await customer.evaluate(()=>{__s.fail=false;__s.pay={payable:false,message:'有一笔现金正等店长核对'};return startCustomerPayment('o1');});ok((await customer.locator('#customer-pay-msg').innerText()).includes('现金'),'server reason is shown');
 let target=null;await customer.route('https://pay.example/**',r=>{target=r.request().url();r.fulfill({contentType:'text/html',body:'paid'});});await customer.evaluate(()=>{__s.pay={payable:true,payment_url:'https://pay.example/r1'};startCustomerPayment('o1');});await customer.waitForURL('https://pay.example/**');ok(target==='https://pay.example/r1','goes to the shared link');
 const noPay=await open('/portal/customer.html',true);await noPay.evaluate(()=>{window.__nothing=true;});await noPay.evaluate(()=>{__s.quote={payable:false,reason:'paid'};});await noPay.locator('input[type="tel"]').first().fill('167475446');await noPay.locator('#search-btn').click();await noPay.getByText('001-1').first().click();await noPay.getByText('下载最新订单 PDF').waitFor();ok(await noPay.locator('#customer-pay-btn').count()===0,'no button when nothing is due');
 ok(errors.length===0,'no page errors: '+errors.join(' | '));
 console.log(`PASS ${checks} payment page checks`);
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
