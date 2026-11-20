// 员工后台：订单列表先显示 50 张，滑到底自动显示下一批；筛选后从头显示；样式用提前生成的 staff-tw.css（不再用 cdn.tailwindcss.com）。
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const stub=`(()=>{const calls=window.__calls=[];const state=window.__state={billing:null,last:null};
const profile={id:'u1',name:'Amy',role:'store_manager',store_id:'s1',active:true,region:'JB'};
const order=id=>({id,order_no:'001-20261104-0001',amount:100,currency:'MYR',status:'pending_payment',payment_status:'unpaid',store_id:'s1',staff_id:'u1',created_at:'2026-11-04T08:00:00Z',stores:{name:'Austin',code:'001'},customers:{id:'c1',name:'王先生',phone:'60167475446',address:'配送 Jalan A'},order_billing:state.billing,profiles:{name:'Amy'},suppliers:null,designers:null});
const rows={stores:[{id:'s1',name:'Austin',code:'001',active:true,region:'JB'}],products:[{sku:'HH-B01-0023',name:'熔岩白（10面随机/哑光）'}],order_items:[{id:'i1',order_id:'o1',product_name:'熔岩白（10面随机/哑光）',model_spec:'熔岩白',quantity:260,unit:'片',unit_price:1,total_price:260,fulfillment_type:'stock'},{id:'i2',order_id:'o1',product_name:'手写商品',quantity:1,unit:'套',unit_price:1,total_price:1}]};
function q(table){let single=false;const f={select(){return f},eq(){return f},neq(){return f},in(){return f},is(){return f},gte(){return f},lte(){return f},lt(){return f},gt(){return f},not(){return f},or(){return f},ilike(){return f},order(){return f},limit(){return f},range(){return f},
 single(){single=true;return f},maybeSingle(){single=true;return f},
 insert(v){calls.push({insert:table,v});return f},update(v){calls.push({update:table,v});return f},delete(){return f},upsert(){return f},
 then(ok,no){let data=rows[table]||[];if(table==='orders')data=single?order('o1'):Array.from({length:120},(_,k)=>({...order('o'+k),order_no:'001-2026-'+String(k).padStart(4,'0'),created_at:new Date(Date.UTC(2026,10,4)-k*36e5).toISOString()}));else if(table==='customers')data=single?{id:'c1',name:'王先生',phone:'60167475446'}:[{id:'c1',name:'王先生',phone:'60167475446',created_at:'2026-11-01T00:00:00Z'},{id:'c2',name:'Lim',phone:'60123456789',created_at:'2026-11-02T00:00:00Z'}];else if(table==='order_billing')data=state.billing;else if(single)data=data[0]||null;return Promise.resolve({data,error:null,count:0}).then(ok,no);}};return f;}
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
const server=http.createServer((q,s)=>{const p=path.join(process.cwd(),decodeURIComponent(new URL(q.url,'http://x').pathname));fs.readFile(p,(e,b)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'content-type':p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});s.end(b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};


try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
 const asked=[];page.on('request',r=>asked.push(r.url()));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname==='127.0.0.1')return r.continue();if(u.pathname.includes('supabase'))return r.fulfill({contentType:'application/javascript',body:stub});return r.abort();});
 await page.goto(base+'/portal/staff.html');await page.waitForFunction(()=>typeof goto==='function'&&window.__calls?.some(c=>c.rpc==='get_my_profile'));await page.waitForTimeout(800);
 ok(!asked.some(u=>u.includes('cdn.tailwindcss.com')),'no in-browser style engine');
 ok(await page.evaluate(()=>getComputedStyle(document.querySelector('.hidden')).display==='none'&&getComputedStyle(document.body).backgroundColor==='rgb(251, 248, 241)'),'pre-built styles applied (hidden, brand background)');
 await page.evaluate(()=>goto('orders'));await page.waitForTimeout(500);
 const cards=()=>page.locator('.ord-mobile > div').count();
 ok(await cards()===50,'first 50 orders only');ok((await page.locator('#orders-more').innerText()).includes('还有 70 张'),'says how many are left');
 await page.locator('#orders-more').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelectorAll('.ord-mobile > div').length>=100);
 ok(true,'scrolling near the end shows the next 50');
 if(await page.locator('#orders-more').count())await page.locator('#orders-more').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelectorAll('.ord-mobile > div').length===120);
 ok((await page.locator('#orders-table').innerText()).includes('已显示全部 120 张'),'says when everything is shown');
 await page.evaluate(()=>renderOrdersTable(filterGetCurrent()));ok(await cards()===120,'a refresh with the same filter keeps what was shown');
 await page.fill('#f-search','001-2026-01');await page.evaluate(()=>filterOrders());await page.waitForTimeout(300);
 ok(await cards()===20&&!(await page.locator('#orders-more').count()),'a new search starts from the top and shows all matches when few');
 ok(errors.length===0,'no page errors: '+errors.join(' | '));
 console.log(`PASS ${checks} staff order paging / pre-built style checks`);
}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
