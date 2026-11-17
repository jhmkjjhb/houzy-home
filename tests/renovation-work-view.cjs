const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');const ctx={window:{}};vm.runInNewContext(fs.readFileSync('portal/renovation/work-view.js','utf8'),ctx);const V=ctx.window.RenoWorkView;
const snapshot={lines:[{id:'1',name:'地柜<script>',spec:'20.5 ft / 铝合金',qty:20.5,rate:765,unit:'ft',kind:'custom',warranties:[{component:'柜体',years:11,source:'合同第7条'}]},{id:'2',name:'铺砖人工，不含砖',qty:100,rate:10,unit:'sq ft',kind:'work'},{id:'G1',name:'设计服务',qty:1,rate:0,unit:'项',kind:'gift'}]};const work=[{group_name:'泥水',status:'working',assignee:'师傅',line_ids:['2']},{group_name:'铝柜',status:'draft',assignee:'',line_ids:['1']},{group_name:'赠品',status:'draft',line_ids:['G1']}];
const before=JSON.stringify({snapshot,work}),html=V.render(work,snapshot,false);assert(html.indexOf('材料与产品')<html.indexOf('硬装施工'));assert(html.includes('20.5 ft'));assert(html.includes('15,682.50'));assert(html.includes('11年'));assert(html.includes('地柜&lt;script&gt;'));assert(html.includes('assignee-0'));assert(html.includes('data-work="0"'));assert(html.includes('铺砖人工，不含砖'));assert(html.includes('赠品与设计服务'));assert.equal(JSON.stringify({snapshot,work}),before);
const mixed=V.render([{group_name:'混合',status:'draft',line_ids:['1','2','missing']}],snapshot,true);assert(mixed.includes('含多类内容的执行单'));assert(mixed.includes('missing'));assert(mixed.includes('disabled'));assert(!mixed.includes('value="undefined"'));console.log('PASS: material/construction/gift separation, detailed quantities/specs/prices/warranties, escaping, original progress indexes, mixed and missing lines, locked state, no data mutation');
// 增项子单在数据库里叫「增项-<编号> · 分组」：员工看到的应是真正的项目名称，而不是一串编号
{const s={lines:[{id:'ADD-1',name:'书房吸顶灯',qty:2,rate:100,unit:'pc',kind:'stock'},{id:'ADD-2',name:'插座',qty:1,rate:1,unit:'pc',kind:'stock'},{id:'ADD-3',name:'开关',qty:1,rate:1,unit:'pc',kind:'stock'}]};
 const h=V.render([{group_name:'增项-155232e6-c75a-41c4-a0d9-ef6b32abd4e6 · 新增材料',status:'draft',line_ids:['ADD-1','ADD-2','ADD-3']}],s,false);
 assert(!h.includes('155232e6'),'no id in the title');assert(h.includes('增项：书房吸顶灯、插座 等3项'),'title shows the real items');console.log('PASS: addition sub-orders show item names, not ids');}
{const s={lines:[{id:'ADD-9',name:'【增项材料】车棚雨棚增加项',qty:1,rate:1,unit:'lot',kind:'stock'}]};const h=V.render([{group_name:'增项-155232e6-c75a-41c4-a0d9-ef6b32abd4e6 · 新增材料',status:'draft',line_ids:['ADD-9']}],s,false);
 assert(h.includes('<b>增项：车棚雨棚增加项</b>'),'增项 said once: '+h.match(/<b>增项[^<]*<\/b>/)?.[0]);console.log('PASS: addition title says 增项 once');}
// 增项子单是业主签了增项才生成的：标题要让人看出「签名已经做完」，下一步是下单，而不是再去签一次
{const c={window:{}};vm.runInNewContext(fs.readFileSync('portal/renovation/fulfillment.js','utf8'),c);const F=c.window.RenoFulfillment;
 const w={id:'w1',group_name:'增项-155232e6-c75a-41c4-a0d9-ef6b32abd4e6 · 新增材料'},t={items:[{work_order_id:'w1',line_id:'ADD-9',kind:'stock',stage:'pending'}],confirmations:[],batches:[],signoffs:[]};
 const b=F.badges(w,t);assert(b.includes('fx-chip ok step">✓ 业主已签增项'),'signed tag shown');assert(b.indexOf('业主已签增项')<b.indexOf('待下单'),'signed comes before ordering');
 assert(!F.badges({id:'w2',group_name:'全屋定制'},{...t,items:[{...t.items[0],work_order_id:'w2'}]}).includes('业主已签增项'),'normal sub-orders not tagged');console.log('PASS: addition sub-orders show the owner already signed');}
// 标题行按钮 = 下一步：只剩等业主签名时是「复制签名链接」；有问题先处理问题；全部完成没有按钮
{const c={window:{}};vm.runInNewContext(fs.readFileSync('portal/renovation/fulfillment.js','utf8'),c);const F=c.window.RenoFulfillment;
 const w={id:'w1',group_name:'全屋定制'},it=(stage,kind='custom',x={})=>({work_order_id:'w1',line_id:'L'+Math.random(),kind,stage,...x}),T=(items,conf=[])=>({items,confirmations:conf,batches:[],signoffs:[]});
 assert.equal(F.primary(w,T([it('pending')])).label,'发起业主签名');
 const live=F.primary(w,T([it('pending')],[{id:'c1',work_order_id:'w1',status:'pending',signing_token:'t1'}]));assert(live.label==='复制签名链接'&&live.copy.id==='c1'&&live.copy.token==='t1','waiting: copy link');
 assert.equal(F.primary(w,T([it('pending'),it('pending','stock')],[{id:'c1',work_order_id:'w1',status:'pending',signing_token:'t1'}])).label,'下单','stock can be ordered while waiting');
 assert.equal(F.primary(w,T([it('ordered')])).label,'到货');assert.equal(F.primary(w,T([it('pending','work')])).label,'排期');assert.equal(F.primary(w,T([it('scheduled','work')])).label,'开工');
 assert.equal(F.primary(w,T([it('working','work')])).label,'完工');assert.equal(F.primary(w,T([it('pending','gift')])).label,'交付');
 assert.equal(F.primary(w,T([it('ordered','custom',{issue_note:'缺件'})])).label,'处理问题');assert.equal(F.primary(w,T([it('done')])),null);assert.equal(F.primary(w,T([it('pending')]),{locked:true}),null,'accepted project has no buttons');
 console.log('PASS: title button is the next step');}
