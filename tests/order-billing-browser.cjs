// Real staff page in a real browser with a recording backend: the company details typed into the
// form must reach the database call, come back for returning customers, and print on the PDF.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out='output/playwright/order-billing';fs.mkdirSync(out,{recursive:true});
const stub=`(()=>{const calls=window.__calls=[];const state=window.__state={billing:null,last:null};
const profile={id:'u1',name:'Amy',role:'store_manager',store_id:'s1',active:true,region:'JB'};
const order=id=>({id,order_no:'001-20261104-0001',amount:100,currency:'MYR',status:'pending_payment',payment_status:'unpaid',store_id:'s1',staff_id:'u1',created_at:'2026-11-04T08:00:00Z',stores:{name:'Austin',code:'001'},customers:{id:'c1',name:'王先生',phone:'60167475446',address:'配送 Jalan A'},order_billing:state.billing,profiles:{name:'Amy'},suppliers:null,designers:null});
const rows={stores:[{id:'s1',name:'Austin',code:'001',active:true,region:'JB'}]};
function q(table){let single=false;const f={select(){return f},eq(){return f},neq(){return f},in(){return f},is(){return f},gte(){return f},lte(){return f},lt(){return f},gt(){return f},not(){return f},or(){return f},ilike(){return f},order(){return f},limit(){return f},range(){return f},
 single(){single=true;return f},maybeSingle(){single=true;return f},
 insert(v){calls.push({insert:table,v});return f},update(v){calls.push({update:table,v});return f},delete(){return f},upsert(){return f},
 then(ok,no){let data=rows[table]||[];if(table==='orders')data=single?order('o1'):[];else if(table==='customers')data=single?{id:'c1',name:'王先生',phone:'60167475446'}:[];else if(table==='order_billing')data=state.billing;else if(single)data=data[0]||null;return Promise.resolve({data,error:null,count:0}).then(ok,no);}};return f;}
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'u1'}}}}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({})},from:q,
 channel(){const c={on(){return c},subscribe(){return c}};return c},removeChannel(){},
 functions:{invoke:async()=>({data:null,error:null})},storage:{from:()=>({upload:async()=>({error:null}),getPublicUrl:()=>({data:{publicUrl:''}})})},
 rpc:async(name,args)=>{calls.push({rpc:name,args});
  if(name==='get_my_profile')return {data:profile,error:null};
  if(name==='generate_order_no')return {data:'001-20261104-0001',error:null};
  if(name==='find_customer_by_phone')return {data:window.__known?[{id:'c1',name:'王先生',phone:'60167475446',address:'配送 Jalan A'}]:[],error:null};
  if(name==='find_customer_billing')return {data:state.last,error:null};
  if(name==='set_order_billing'){if(args.p_data&&Object.keys(args.p_data).length){if(!args.p_data.company_name)return {data:null,error:{message:'请填写公司名称、注册号和地址'}};state.billing=args.p_data;}else state.billing=null;return {data:state.billing,error:null};}
  return {data:null,error:null};}})};})();`;
const SPACE={company_name:'SpaceMade Interior Design Sdn Bhd',registration_no:'202501014187 (1615601-X)',address:'28B Jalan Pendekar 17, Taman Ungku Tun Aminah, 81300 Skudai, Johor',phone:'016-7475446',tax_id:''};
const server=http.createServer((q,s)=>{const p=path.join(process.cwd(),decodeURIComponent(new URL(q.url,'http://x').pathname));fs.readFile(p,(e,b)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'content-type':p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.js')?'application/javascript':'application/octet-stream'});s.end(b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname==='127.0.0.1')return r.continue();if(u.pathname.includes('supabase'))return r.fulfill({contentType:'application/javascript',body:stub});if(u.hostname==='cdn.tailwindcss.com')return r.fulfill({contentType:'application/javascript',body:'window.tailwind={}'});return r.abort();});
 await page.addInitScript(()=>{addEventListener('DOMContentLoaded',()=>{const st=document.createElement('style');st.textContent='.hidden{display:none!important}';document.head.append(st);});});
 await page.goto(base+'/portal/staff.html');await page.waitForFunction(()=>typeof goto==='function'&&window.__calls?.some(c=>c.rpc==='get_my_profile'));await page.waitForTimeout(600);
 await page.evaluate(()=>goto('create'));await page.locator('#c-phone').waitFor({state:'visible'});
 ok(await page.locator('input[name="bill-to"][value="individual"]').isChecked(),'individual is the default');ok(!(await page.locator('#b-company').isVisible()),'company fields stay out of the way');
 // Company chosen but incomplete: stops before any order exists.
 await page.locator('#c-country').selectOption('60');await page.locator('#c-phone').fill('16-7475446');await page.locator('#c-name').fill('王先生');
 await page.locator('input[name="bill-to"][value="company"]').check();ok(await page.locator('#b-company').isVisible(),'choosing company shows the fields');
 await page.evaluate(()=>{const s=document.getElementById('o-store');s.value='s1';if(!s.value){s.innerHTML='<option value="s1">Austin</option>';s.value='s1';}});
 await page.locator('#o-amount').fill('100');await page.evaluate(()=>submitOrder());await page.getByText('开单给公司：请填写').first().waitFor();
 ok(!(await page.evaluate(()=>__calls.some(c=>c.insert==='orders'))),'incomplete company details create no order');
 // Complete: reaches the save call unchanged, after the order exists.
 await page.locator('#b-company').fill(SPACE.company_name);await page.locator('#b-reg').fill(SPACE.registration_no);await page.locator('#b-address').fill(SPACE.address);await page.locator('#b-phone').fill(SPACE.phone);
 await page.screenshot({path:out+'/create-form.png',fullPage:false});
 await page.evaluate(()=>{addItemRow({product_name:'衣柜',quantity:1,unit_price:100});document.querySelectorAll('.item-row').forEach(r=>{if(!r.querySelector('input')?.value)r.remove();});});
 await page.evaluate(()=>submitOrder());
 await page.waitForFunction(()=>__calls.some(c=>c.rpc==='set_order_billing'),null,{timeout:8000});
 const sent=await page.evaluate(()=>__calls.find(c=>c.rpc==='set_order_billing').args);ok(sent.p_order==='o1','saved against the new order');ok(sent.p_data.company_name===SPACE.company_name&&sent.p_data.registration_no===SPACE.registration_no&&sent.p_data.address===SPACE.address&&sent.p_data.phone===SPACE.phone,'all fields sent as typed');
 // Detail shows the company, safely.
 await page.evaluate(s=>{__state.billing=s;},{...SPACE,company_name:'Evil <img src=x onerror=window.__pwned=1> Sdn Bhd'});await page.evaluate(()=>openDetail('o1','orders'));
 await page.getByText('Reg. No.: 202501014187').first().waitFor();await page.waitForTimeout(200);ok(!(await page.evaluate(()=>window.__pwned)),'company text cannot run as code');
 ok((await page.locator('#db-company_name').inputValue()).startsWith('Evil <img'),'edit form shows the raw text');
 // Editing an existing order
 await page.locator('summary',{hasText:'修改开单资料'}).click();await page.locator('#db-company_name').fill(SPACE.company_name);await page.getByRole('button',{name:'保存开单资料'}).click();
 await page.getByText('SpaceMade Interior Design Sdn Bhd').first().waitFor();await page.screenshot({path:out+'/order-detail.png',fullPage:true});
 await page.getByText('修改开单资料').click();await page.getByRole('button',{name:'改回开单给个人'}).click();
 await page.waitForFunction(()=>__state.billing===null);await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.textContent.includes('改回开单给个人')));checks++;
 // Returning customer: details come back and can still be switched off.
 await page.evaluate(s=>{window.__known=true;__state.last=s;goto('create');},SPACE);await page.locator('#c-country').selectOption('60');await page.locator('#c-phone').fill('16-7475446');await page.waitForFunction(()=>document.getElementById('b-company').value!=='',null,{timeout:5000});
 ok(await page.locator('input[name="bill-to"][value="company"]').isChecked(),'previous company is pre-selected');ok(await page.locator('#billing-prefill-note').isVisible(),'staff are asked to check it');
 await page.evaluate(()=>{__state.last=null;});await page.locator('#c-phone').fill('');await page.locator('#c-phone').fill('16-7475447');await page.waitForFunction(()=>document.getElementById('b-company').value==='',null,{timeout:5000});
 ok(await page.locator('input[name="bill-to"][value="individual"]').isChecked(),'another customer does not inherit the company');
 // Typed details survive a later lookup.
 await page.locator('input[name="bill-to"][value="company"]').check();await page.locator('#b-company').fill('Typed Sdn Bhd');await page.locator('#c-phone').fill('16-7475448');await page.waitForTimeout(800);ok(await page.locator('#b-company').inputValue()==='Typed Sdn Bhd','a lookup never overwrites what staff typed');
 // English labels
 await page.evaluate(()=>StaffPhrases.apply('en'));await page.waitForTimeout(150);const eng=await page.locator('#step-customer').innerText();ok(eng.includes('Bill to company')&&eng.includes('Company name')&&!eng.includes('开单给'),'form is translated');await page.evaluate(()=>StaffPhrases.apply('zh-CN'));
 // PDF layout
 const pdf=await browser.newPage({viewport:{width:800,height:1100}});
 await pdf.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await pdf.setContent('<!doctype html><meta charset="utf-8"><body></body>');await pdf.addScriptTag({url:base+'/portal/order-pdf-company.js'});await pdf.addScriptTag({url:base+'/portal/order-pdf.js'});
 await pdf.evaluate(s=>{document.body.innerHTML=HouzyOrderPDF.render({id:'1',order_no:'001-20261104-0001',amount:100,currency:'MYR',status:'pending_payment',payment_status:'unpaid',created_at:'2026-11-04',customers:{name:'王先生',phone:'60167475446',address:'配送 Jalan A'},order_billing:s},[{product_name:'衣柜',quantity:1,unit_price:100,total_price:100}],[],window.HOUZY_PDF_COMPANY);},SPACE);
 const text=await pdf.locator('body').innerText();ok(text.includes('SpaceMade Interior Design Sdn Bhd')&&text.includes('202501014187 (1615601-X)')&&text.includes('016-7475446'),'PDF prints every company field');await pdf.screenshot({path:out+'/pdf.png'});
 ok(errors.length===0,'no page errors: '+errors.join(' | '));
 console.log(`PASS ${checks} order billing browser checks`);
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
