// 开单选产品：开单页每次打开都重新读产品档案（仓库后来新建的产品要搜得到）；
// 商品价目的成本是最新一批入库价（不是任意一条、也不是最低价）；选中后显示实时可用库存；没定零售价的不能拿成本价顶替（否则会按进货价卖出去），只提示手填。
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const stub=`(()=>{const calls=window.__calls=[];
const profile={id:'u1',name:'Amy',role:'store_manager',store_id:'s1',active:true,region:'JB'};
const rows=window.__rows={stores:[{id:'s1',name:'Austin',code:'001',active:true,region:'JB'}],
 products:[{id:'p1',sku:'HH-B01-0001',name:'熔岩白',unit:'片',category:'CZ',price:12},{id:'p2',sku:'HH-WJ-0002',name:'铰链',unit:'个',category:'WJ',price:null}],
 inventory:[{product_id:'p1',qty_on_hand:8,qty_reserved:3,unit_cost:5,cost_at:'2026-10-01T00:00:00Z'},{product_id:'p1',warehouse_id:'w3',qty_on_hand:2,qty_reserved:0,unit_cost:6,cost_at:null},{product_id:'p1',warehouse_id:'w2',qty_on_hand:0,qty_reserved:0,unit_cost:4,cost_at:'2026-11-20T00:00:00Z'},{product_id:'p2',qty_on_hand:0,qty_reserved:0,unit_cost:7}]};
function q(table){const eqs={};const f={select(){return f},eq(k,v){eqs[k]=v;return f},neq(){return f},in(){return f},is(){return f},gte(){return f},lte(){return f},lt(){return f},gt(){return f},not(){return f},or(){return f},ilike(){return f},order(){return f},limit(){return f},range(){return f},
 single(){f.s=1;return f},maybeSingle(){f.s=1;return f},insert(){return f},update(){return f},delete(){return f},upsert(){return f},
 then(ok,no){let data=(rows[table]||[]).filter(r=>Object.entries(eqs).every(([k,v])=>!(k in r)||r[k]===v));if(f.s)data=data[0]||null;return Promise.resolve({data,error:null,count:0}).then(ok,no);}};return f;}
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'u1'}}}}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({})},from:q,
 channel(){const c={on(){return c},subscribe(){return c}};return c},removeChannel(){},functions:{invoke:async()=>({data:null,error:null})},
 storage:{from:()=>({upload:async()=>({error:null}),getPublicUrl:()=>({data:{publicUrl:''}})})},
 rpc:async(name)=>{calls.push({rpc:name});if(name==='get_my_profile')return {data:profile,error:null};return {data:null,error:null};}})};})();`;
const server=http.createServer((q,s)=>{const p=path.join(process.cwd(),decodeURIComponent(new URL(q.url,'http://x').pathname));fs.readFile(p,(e,b)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'content-type':p.endsWith('.html')?'text/html; charset=utf-8':'application/javascript'});s.end(b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname==='127.0.0.1')return r.continue();if(u.pathname.includes('supabase'))return r.fulfill({contentType:'application/javascript',body:stub});if(u.hostname==='cdn.tailwindcss.com')return r.fulfill({contentType:'application/javascript',body:'window.tailwind={}'});return r.abort();});
 await page.goto(base+'/portal/staff.html');await page.waitForFunction(()=>typeof goto==='function'&&window.__calls?.some(c=>c.rpc==='get_my_profile'));await page.waitForTimeout(600);
 // 仓库在后台开着的时候新建了一个产品
 await page.evaluate(()=>window.__rows.products.push({id:'p3',sku:'HH-DQ-0003',name:'新到热水器',unit:'台',category:'DQ',price:899}));
 await page.evaluate(()=>goto('create'));
 await page.waitForFunction(()=>staffProducts.some(p=>p.sku==='HH-DQ-0003'));
 ok(true,'opening the order form picks up products created in the warehouse after login');
 const pick=async(sku)=>{const id=await page.evaluate(()=>{addItemRow();return Math.max(...[...document.querySelectorAll('[id^="item-name-"]')].map(e=>+e.id.split('-').pop()).filter(n=>n>=0))});
  await page.fill(`#item-name-${id}`,sku);await page.waitForFunction(i=>!document.getElementById('item-stock-'+i).classList.contains('hidden'),id);
  return {id,stock:await page.textContent(`#item-stock-${id}`),price:await page.inputValue(`#item-price-${id}`)};};
 const a=await pick('HH-B01-0001');
 ok(/可用库存 7 片/.test(a.stock),'shows available stock across warehouses (8-3 + 0 + 2): '+a.stock);
 ok(a.price==='12.00'&&!/未定价/.test(a.stock),'priced product fills its retail price');
 const b=await pick('HH-WJ-0002');
 ok(b.price==='','unpriced product is NOT filled with the cost price (got '+b.price+')');
 ok(/仓库无库存/.test(b.stock)&&/未定价，请手填单价/.test(b.stock),'unpriced product warns to enter a price: '+b.stock);
 const c=await pick('HH-DQ-0003');
 ok(c.price==='899.00','newly created product can be ordered with its price');
 await page.fill(`#item-name-${a.id}`,'随便手写的东西');await page.waitForTimeout(300);
 ok(await page.locator(`#item-stock-${a.id}`).evaluate(e=>e.classList.contains('hidden')),'stock line clears when the name is no longer a catalogue product');
 await page.evaluate(()=>goto('pricing'));await page.waitForFunction(()=>_pricingAll.length>0);
 ok(await page.evaluate(()=>_pricingAll.find(p=>p.sku==='HH-B01-0001')._cost)===4,'pricing page shows the latest stock-in cost (4, Nov 20), not the first row or an undated one');
 ok(/4\.00/.test(await page.locator('#pricing-table').innerText()),'latest cost is what the table prints');
 ok(!errors.length,'no page errors: '+errors.join(' | '));
 console.log('order item stock: '+checks+' checks passed');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
