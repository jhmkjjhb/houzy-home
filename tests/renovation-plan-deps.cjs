// 智能排期：按工序先后关系排。没有先后关系的工序同期施工（泥水 / 天花木作；定制柜 / 台面门窗），
// 有先后的要等前一道全部做完（油漆等泥水和天花都完；洁具等柜子和台面门窗都完）。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={window:{}};vm.runInNewContext(fs.readFileSync('portal/renovation/plan.js','utf8'),ctx);const P=ctx.window.RenoPlan;
const L=(id,name,kind,unit='lot',qty=1)=>({id,name,spec:'',qty,unit,kind});
const lines=[L('1','拆除旧地砖','work'),L('2','全屋电线更换','work'),L('3','客厅铺砖','work','sqft',300),L('4','石膏板天花','work','sqft',200),L('5','全屋墙面油漆','work'),L('6','厨房地柜','custom'),L('7','铝窗','custom'),L('8','马桶','stock','pc',2),L('9','开荒清洁','work')];
const groups=[['拆除','1'],['水电','2'],['泥水','3'],['天花','4'],['油漆','5'],['全屋定制','6'],['门窗','7'],['卫浴洁具','8'],['清洁','9']];
const work=groups.map(([g,l],i)=>({id:'w'+i,group_name:g,line_ids:[l],assignee:''}));
// 材料都已到货，不受生产等待影响，只看工序关系
const items=work.map(w=>({work_order_id:w.id,line_id:w.line_ids[0],kind:lines.find(l=>l.id===w.line_ids[0]).kind,stage:['custom','stock'].includes(lines.find(l=>l.id===w.line_ids[0]).kind)?'arrived':'pending'}));
const R=P.build({work,lines,tracking:{items,batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21'});
const T=Object.fromEntries(R.tasks.map(t=>[t.name,t]));let n=0;const ok=(v,m)=>{assert(v,m);n++;};
ok(T['水电'].start>T['拆除'].end,'水电 after 拆除');
ok(T['泥水'].start>T['水电'].end&&T['天花'].start>T['水电'].end,'泥水 and 天花 both wait for 水电');
ok(T['泥水'].start===T['天花'].start,'泥水 and 天花 run at the same time (different trades, no dependency): '+T['泥水'].start+' / '+T['天花'].start);
ok(T['油漆'].start>T['泥水'].end&&T['油漆'].start>T['天花'].end,'油漆 waits for both 泥水 and 天花');
ok(T['全屋定制'].start===T['门窗'].start&&T['全屋定制'].start>T['油漆'].end,'定制柜 and 门窗 run together after 油漆');
ok(T['卫浴洁具'].start>T['全屋定制'].end&&T['卫浴洁具'].start>T['门窗'].end,'洁具 waits for cabinets and windows');
ok(T['清洁'].start>T['卫浴洁具'].end,'清洁 last');
ok(/天花木作/.test(T['油漆'].why)||/泥水/.test(T['油漆'].why),'the reason names what it waited for: '+T['油漆'].why);
const rel=P.relations(['mep','masonry','ceiling','paint','cabinet','fit','fixture']);
ok(rel.masonry.parallel.includes('ceiling')&&rel.ceiling.parallel.includes('masonry'),'relations: 泥水 ∥ 天花');
ok(JSON.stringify(rel.paint.after.sort())===JSON.stringify(['ceiling','masonry']),'relations: 油漆 waits for 泥水 and 天花');
ok(rel.cabinet.parallel.includes('fit')&&!rel.paint.parallel.length,'relations: 柜 ∥ 台面门窗; 油漆 has nothing parallel');
ok(JSON.stringify(P.relations(['mep','paint']).paint.after)==='["mep"]','missing phases are skipped: 油漆 directly after 水电 when there is no 泥水 / 天花');
// GB 50327 第 14.1.2 条：地面铺装宜在吊顶完成后进行 —— 天花工期比泥水长时，泥水（地面铺砖）顺延到天花之后结束
{const lines2=lines.map(l=>l.id==='4'?{...l,qty:1500}:l);const R2=P.build({work,lines:lines2,tracking:{items,batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21'});
 const T2=Object.fromEntries(R2.tasks.map(t=>[t.name,t]));
 ok(T2['泥水'].start===T2['天花'].start,'wall work and waterproofing still start together with the ceiling');
 ok(T2['泥水'].end>T2['天花'].end&&/14\.1\.2/.test(T2['泥水'].why),'floor tiling is pushed after the ceiling, citing the standard: '+T2['泥水'].end+' > '+T2['天花'].end);
 ok(T2['油漆'].start>T2['泥水'].end,'painting still waits for the floor');}
console.log(`PASS ${n} plan dependency checks`);
