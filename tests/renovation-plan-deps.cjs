// 智能排期：按工序先后关系排。没有先后关系的工序同期施工（泥水 / 天花木作；定制柜 / 台面门窗），
// 有先后的要等前一道全部做完（油漆等泥水和天花都完；洁具等柜子和台面门窗都完）。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={window:{}};vm.runInNewContext(fs.readFileSync('portal/renovation/plan.js','utf8'),ctx);const P=ctx.window.RenoPlan;
const L=(id,name,kind,unit='lot',qty=1)=>({id,name,spec:'',qty,unit,kind});
const lines=[L('1','拆除旧地砖','work'),L('2','全屋电线更换','work'),L('3','客厅铺砖','work','sqft',300),L('4','石膏板天花','work','sqft',200),L('5','全屋墙面油漆','work'),L('6','厨房地柜','custom'),L('7','卧室木门','custom'),L('8','马桶','stock','pc',2),L('9','开荒清洁','work'),L('10','卫生间防水','work')];
const groups=[['拆除','1'],['水电','2'],['泥水','3'],['天花','4'],['油漆','5'],['全屋定制','6'],['木门','7'],['卫浴洁具','8'],['清洁','9'],['卫生间','10']];
const work=groups.map(([g,l],i)=>({id:'w'+i,group_name:g,line_ids:[l],assignee:''}));
// 材料都已到货，不受生产等待影响，只看工序关系
const items=work.map(w=>({work_order_id:w.id,line_id:w.line_ids[0],kind:lines.find(l=>l.id===w.line_ids[0]).kind,stage:['custom','stock'].includes(lines.find(l=>l.id===w.line_ids[0]).kind)?'arrived':'pending'}));
const R=P.build({work,lines,tracking:{items,batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21'});
const T=Object.fromEntries(R.tasks.map(t=>[t.name,t]));const next=d=>{let x=new Date(d+'T00:00:00Z');do x=new Date(+x+864e5);while(x.getUTCDay()===0);return x.toISOString().slice(0,10);};let n=0;const ok=(v,m)=>{assert(v,m);n++;};
ok(T['电路预埋'].start>T['拆除保护'].end,'电路预埋 after 拆除');
ok(T['泥水'].start>T['电路预埋'].end&&T['天花木作'].start>T['电路预埋'].end,'泥水 and 天花 both wait for 电路预埋');
ok(T['泥水'].start===T['天花木作'].start,'泥水 and 天花 run at the same time (different trades, no dependency): '+T['泥水'].start+' / '+T['天花木作'].start);
ok(T['油漆'].start>T['泥水'].end&&T['油漆'].start>T['天花木作'].end,'油漆 waits for both 泥水 and 天花');
// 马来西亚泥水和铺砖是两班人：防水归泥水，铺砖单独一道「铺瓷砖」，紧接泥水，不等天花
ok(T['泥水'].lines.map(l=>l.name).join()==='卫生间防水'&&T['铺瓷砖'].lines.map(l=>l.name).join()==='客厅铺砖','waterproofing stays with 泥水, tiling is its own phase');
ok(T['铺瓷砖'].trade==='瓷砖工'&&T['铺瓷砖'].start>T['泥水'].end,'tiling comes after 泥水');
ok(T['油漆'].start>T['铺瓷砖'].end,'油漆 after tiling');
ok(T['定制柜安装'].start===T['台面门窗玻璃'].start&&T['定制柜安装'].start>T['油漆'].end,'定制柜 and 门窗 run together after 油漆');
ok(T['水路安装'].start>T['定制柜安装'].end&&T['水路安装'].start>T['台面门窗玻璃'].end,'水路安装 (toilets) waits for cabinets and windows');
ok(T['清洁交付'].start>T['水路安装'].end,'清洁 last');
ok(/天花木作|泥水|铺瓷砖/.test(T['油漆'].why),'the reason names what it waited for: '+T['油漆'].why);
const rel=P.relations(['mep','masonry','ceiling','paint','cabinet','fit','fixture']);
ok(rel.masonry.parallel.includes('ceiling')&&rel.ceiling.parallel.includes('masonry'),'relations: 泥水 ∥ 天花');
ok(JSON.stringify(rel.paint.after.sort())===JSON.stringify(['ceiling','masonry']),'relations: 油漆 waits for 泥水 and 天花');
ok(rel.cabinet.parallel.includes('fit')&&!rel.paint.parallel.length,'relations: 柜 ∥ 台面门窗; 油漆 has nothing parallel');
ok(JSON.stringify(P.relations(['mep','paint']).paint.after)==='["mep"]','missing phases are skipped: 油漆 directly after 水电 when there is no 泥水 / 天花');
// GB 50327 第 14.1.2 条：地面铺装宜在吊顶完成后进行 —— 天花工期比泥水长时，泥水（地面铺砖）顺延到天花之后结束
{const lines2=lines.map(l=>l.id==='4'?{...l,qty:1500}:l);const N2=P.build({work,lines:lines2,tracking:{items,batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21'});
 const n2=Object.fromEntries(N2.tasks.map(t=>[t.key,t]));ok(n2.tile.start<=n2.ceiling.end&&n2.tile.start===next(n2.masonry.end)&&!/14\.1\.2/.test(n2.masonry.why),'new projects: tiling follows 泥水 straight away, a long ceiling does not hold it up');
 ok(n2.paint.start>n2.ceiling.end&&n2.paint.start>n2.tile.end,'painting still waits for both the ceiling and the tiles');
 // 旧项目（瓷砖还在泥水里）：沿用原来的做法，泥水最后一段顺延到天花之后
 const R2=P.build({work,lines:lines2,tracking:{items,batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21',mepCombined:true});
 const T2=Object.fromEntries(R2.tasks.map(t=>[t.name,t]));
 ok(T2['泥水'].start===T2['天花木作'].start,'wall work and waterproofing still start together with the ceiling');
 ok(T2['泥水'].end>T2['天花木作'].end&&/14\.1\.2/.test(T2['泥水'].why),'floor tiling is pushed after the ceiling, citing the standard: '+T2['泥水'].end+' > '+T2['天花木作'].end);
 ok(T2['油漆'].start>T2['泥水'].end,'painting still waits for the floor');}
// 按工序 → 工种：项目分在哪张子单不影响。「天花」子单里的「全屋油漆」归到「油漆」，一个工种一次进场
{const lines3=[L('1','全屋电线更换','work'),L('2','石膏板天花','work','sqft',200),L('3','全屋油漆','work','sqft',1600),L('4','客厅铺砖','work','sqft',300),L('5','厨房铺砖','work','sqft',80)];
 const work3=[{id:'a',group_name:'电气',line_ids:['1'],assignee:''},{id:'b',group_name:'天花',line_ids:['2','3'],assignee:''},{id:'c',group_name:'客厅泥水',line_ids:['4'],assignee:''},{id:'d',group_name:'厨房',line_ids:['5'],assignee:''}];
 const R3=P.build({work:work3,lines:lines3,tracking:{items:[],batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21'});
 const T3=Object.fromEntries(R3.tasks.map(t=>[t.name,t]));
 ok(T3['油漆']&&T3['油漆'].lines.some(l=>l.name==='全屋油漆'&&l.group==='天花'),'paint inside the 天花 sub-order becomes its own 油漆 phase');
 ok(T3['天花木作'].lines.length===1,'the ceiling phase keeps only ceiling work');
 ok(T3['铺瓷砖'].lines.length===2&&R3.tasks.filter(t=>t.name==='铺瓷砖').length===1,'tiling from two sub-orders is one 铺瓷砖 phase (one visit): '+T3['铺瓷砖'].lines.map(l=>l.group).join(','));
 ok(T3['铺瓷砖'].days===Math.ceil(380/120),'days come from the combined quantity');
 ok(T3['油漆'].start>T3['铺瓷砖'].end&&T3['油漆'].start>T3['天花木作'].end,'paint after tiling and ceiling');
 ok(P.PHASES[P.phaseOfLine({name:'窗帘',kind:'stock'},'软装')].key==='hardware'&&P.PHASES[P.phaseOfLine({name:'智能门锁',kind:'stock'},'五金')].key==='hardware','curtains and smart locks are fixtures, not doors / windows');}
// 子单定了总天数（设计 + 定做 + 安装，从开始下单算到装好）：工厂定做天数 = 总天数 − 安装天数；没下单时，柜子最早要等这么多天才能装
{const its=items.map(i=>i.work_order_id==='w5'?{...i,stage:'pending'}:i);
 const base=P.build({work,lines,tracking:{items:its,batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21'});
 const fx=P.build({work:work.map(w=>w.id==='w5'?{...w,fixed_days:45}:w),lines,tracking:{items:its,batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21'});
 const cb=base.tasks.find(x=>x.key==='cabinet'),cf=fx.tasks.find(x=>x.key==='cabinet'),mf=fx.materials.find(m=>m.id==='cabinet');
 ok(cf.fixedDays===45&&mf.lead===45-cf.days&&mf.fixedDays===45,'45 days = factory part + install days: '+JSON.stringify(mf));
 ok(cf.start>cb.start&&mf.label.includes('45'),'a longer fixed total pushes the cabinet install later and is named in the material list');
 const sit=P.build({work:work.map(w=>w.id==='w2'?{...w,fixed_days:12}:w),lines,tracking:{items,batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21'});
 ok(sit.tasks.find(x=>x.key==='tile').days===12,'for site work the fixed total is the phase length');}
// 水路、电路分两道工序：水管工和电工不是同一批人，拆除后同期进场；泥水、天花要等两样都做完（封槽前要水电隐蔽验收）
{const ln=[L('1','拆除旧地砖','work'),L('2','给排水管改造','work','点位',8),L('3','水管打压测试','work'),L('4','电路开槽穿管布线','work','点位',30),L('5','配电箱更换','work'),L('6','卫生间防水','work'),L('7','石膏板天花','work','sqft',150),L('8','热水管保温','work')];
 const wk=[{id:'a',group_name:'拆除',line_ids:['1']},{id:'b',group_name:'水电改造',line_ids:['2','3','4','5','8']},{id:'c',group_name:'泥水',line_ids:['6']},{id:'d',group_name:'天花',line_ids:['7']}];
 const R=P.build({work:wk,lines:ln,tracking:{items:[],batches:[]},payments:[{name:'第二期 水电隐蔽验收后'}],start:'2026-12-01',today:'2026-11-21'});
 const T=Object.fromEntries(R.tasks.map(t=>[t.key,t]));
 ok(T.plumb&&T.elec&&!T.mep,'one 水电 sub-order becomes two phases, 水路 and 电路: '+R.tasks.map(t=>t.name).join(','));
 ok(T.plumb.lines.map(l=>l.id).join()==='2,3,8'&&T.elec.lines.map(l=>l.id).join()==='4,5','pipes and pressure test go to 水路, wiring and the DB box to 电路');
 ok(T.plumb.trade!==T.elec.trade&&T.plumb.start===T.elec.start,'different trades start together after demolition: '+T.plumb.start+' / '+T.elec.start);
 ok(T.plumb.end>T.elec.end,'this case has 水路 finishing later than 电路');const mepDone=T.plumb.end;
 ok(T.masonry.start>mepDone&&T.ceiling.start>mepDone,'泥水 and 天花 wait for the later of 水路 / 电路');
 const ms=R.milestones.find(m=>m.key==='mep');ok(ms&&ms.on>mepDone&&ms.pay,'one 水电隐蔽验收 after both, still tied to the payment stage');
 const rel=P.relations(Object.keys(T));ok(rel.plumb.parallel.includes('elec'),'relations: 水路 ∥ 电路');
 // 旧项目（已经保存过「水电」一条计划，业主可能已看到）：继续合成一条，不打乱已确认的日期
 const old=P.build({work:wk,lines:ln,tracking:{items:[],batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21',mepCombined:true});
 ok(old.tasks.filter(t=>['plumb','elec'].includes(t.key)).length===0&&old.tasks.find(t=>t.key==='mep').lines.length===5,'mepCombined keeps a single 水电 phase for projects already planned that way');}
// 后期水、电各自再进场安装：洁具归水路安装（水管工），灯具开关归电路安装（电工），窗帘门锁归五金；都在柜子、门窗之后，彼此同期
{const ln=[L('1','厨房地柜','custom'),L('2','马桶','stock','pc',2),L('3','龙头','stock','pc',3),L('4','LED 筒灯','stock','pc',12),L('5','开关插座面板','stock','pc',20),L('6','窗帘','stock','pc',4),L('7','开荒清洁','work')];
 const wk=[{id:'a',group_name:'全屋定制',line_ids:['1']},{id:'b',group_name:'卫浴洁具',line_ids:['2','3']},{id:'c',group_name:'灯具',line_ids:['4','5','6']},{id:'d',group_name:'清洁',line_ids:['7']}];
 const its=ln.filter(l=>l.kind!=='work').map(l=>({work_order_id:wk.find(w=>w.line_ids.includes(l.id)).id,line_id:l.id,kind:l.kind,stage:'arrived'}));
 const R=P.build({work:wk,lines:ln,tracking:{items:its,batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21'});
 const T=Object.fromEntries(R.tasks.map(t=>[t.key,t]));
 ok(T.fix_plumb?.lines.map(l=>l.id).join()==='2,3'&&T.fix_elec?.lines.map(l=>l.id).join()==='4,5'&&T.hardware?.lines.map(l=>l.id).join()==='6','toilets/taps → 水路安装, lights/switches → 电路安装, curtains → 五金 (even inside one 灯具 sub-order)');
 ok(T.fix_plumb.trade==='水管工'&&T.fix_elec.trade==='电工','install is done by the same trades as the rough-in');
 ok(T.fix_plumb.start>T.cabinet.end&&T.fix_elec.start>T.cabinet.end&&T.fix_plumb.start===T.fix_elec.start,'both installs come after the cabinets and go in together');
 ok(T.clean.start>T.fix_plumb.end&&T.clean.start>T.fix_elec.end&&T.clean.start>T.hardware.end,'cleaning waits for every install');
 const old=P.build({work:wk,lines:ln,tracking:{items:its,batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21',mepCombined:true});
 ok(old.tasks.find(t=>t.key==='fixture')?.lines.length===5&&!old.tasks.some(t=>['fix_plumb','fix_elec','hardware'].includes(t.key)),'old projects keep one 洁具灯具设备 phase');}
// 铝窗：同一班人拆旧装新一次装完，泥水再塞缝批荡 → 排在泥水之前，不用等拆除（可同期）；旧窗还在，开工前量尺下单，不等泥水复尺
{const ln=[L('1','拆除旧地砖','work'),L('2','拆除旧窗+安装新铝窗','custom','pc',4),L('3','全屋电线更换','work'),L('4','卫生间防水','work'),L('5','卫生间铺砖','work','sqft',120),L('6','淋浴隔断','custom'),L('7','全屋油漆','work')];
 const wk=[{id:'a',group_name:'拆除',line_ids:['1']},{id:'b',group_name:'铝窗',line_ids:['2']},{id:'c',group_name:'水电',line_ids:['3']},{id:'d',group_name:'卫生间',line_ids:['4','5','6']},{id:'e',group_name:'油漆',line_ids:['7']}];
 const R=P.build({work:wk,lines:ln,tracking:{items:[],batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21'});
 const T=Object.fromEntries(R.tasks.map(t=>[t.key,t]));
 ok(T.window?.lines.map(l=>l.id).join()==='2'&&!T.fit?.lines.some(l=>l.id==='2'),'removing the old window and fitting the new one is one 铝窗拆装 phase');
 ok(T.masonry.start>T.window.end,'泥水 waits for the windows (frame in before plastering, JGJ 214 7.3.2)');
 const mw=R.materials.find(m=>m.id==='window');ok(mw&&!mw.measureOn&&mw.orderBy<'2026-12-01','windows are measured and ordered before work starts, not after 泥水: '+JSON.stringify(mw));
 const ms=R.materials.find(m=>/淋浴/.test(m.label));ok(ms&&ms.measureOn===next(T.tile.end),'shower screen is measured after the tiles: '+JSON.stringify(ms));
 // 不贴砖：淋浴隔断直接量直接做
 const R2=P.build({work:wk.map(w=>w.id==='d'?{...w,line_ids:['4','6']}:w),lines:ln,tracking:{items:[],batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21'});
 const ms2=R2.materials.find(m=>/淋浴/.test(m.label));ok(ms2&&!ms2.measureOn&&!R2.tasks.some(t=>t.key==='tile'),'no tiling: the shower screen is measured straight away');
 // 旧项目：窗还在「台面门窗玻璃」里
 const old=P.build({work:wk,lines:ln,tracking:{items:[],batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21',mepCombined:true});
 ok(!old.tasks.some(t=>t.key==='window')&&old.tasks.find(t=>t.key==='fit').lines.some(l=>l.id==='2'),'old projects keep windows in 台面门窗玻璃');}
// 现场手动调整：监理 / 店里把清单项改到别的工序，自动规则不再改回去；手动加的工序接在选定工序后面开工
{const ln=[L('1','拆除旧地砖','work'),L('2','窗台石','work'),L('3','卫生间防水','work'),L('4','卫生间铺砖','work','sqft',120),L('5','全屋油漆','work'),L('6','开荒清洁','work')];
 const wk=[{id:'a',group_name:'拆除',line_ids:['1']},{id:'b',group_name:'卫生间',line_ids:['2','3','4']},{id:'c',group_name:'油漆',line_ids:['5']},{id:'d',group_name:'清洁',line_ids:['6']}];
 const base={work:wk,lines:ln,tracking:{items:[],batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21'};
 const auto=P.build(base);ok(!auto.tasks.find(t=>t.key==='masonry').lines.some(l=>l.id==='2'),'by default 窗台石 is not 泥水 work');
 const R=P.build({...base,setup:{assign:{'b:2':'masonry'},custom:[{key:'c_termite',name:'防白蚁',trade:'杂工',days:2,after:'prep'}]}});
 const T=Object.fromEntries(R.tasks.map(t=>[t.key,t]));
 ok(T.masonry.lines.some(l=>l.id==='2'&&l.manual),'a manually moved item sits in the chosen phase and is marked manual');
 ok(T.c_termite&&T.c_termite.name==='防白蚁'&&T.c_termite.days===2&&T.c_termite.custom,'a hand-added phase appears with its own name and days, even with no items');
 ok(T.c_termite.start>T.prep.end,'it starts after the phase it was put behind');
 ok(T.clean.start>T.c_termite.end,'cleaning still waits for it');
 ok(R.phases.findIndex(p=>p.key==='c_termite')===R.phases.findIndex(p=>p.key==='prep')+1,'listed right after its anchor phase');
 ok(P.relations(Object.keys(T),R.deps).c_termite.after.join()==='prep','relations know what the new phase waits for');
 const bad=P.build({...base,setup:{assign:{'b:2':'nonsense'},custom:[{key:'prep',name:'x',after:'prep'},{key:'BAD KEY',name:'x'}]}});
 ok(bad.tasks.find(t=>t.key==='fit'||t.key==='masonry')&&!bad.tasks.some(t=>t.name==='x'),'unknown phases and malformed custom phases are ignored');}
// 现场拖动改顺序：监理把「天花木作」拖到「铺瓷砖」下面 → 天花等铺砖做完；原来的规则里排在它后面的不再算（不会互相等成死循环）
{const ln=[L('1','全屋电线更换','work'),L('2','卫生间防水','work'),L('3','客厅铺砖','work','sqft',240),L('4','石膏板天花','work','sqft',150),L('5','全屋油漆','work')];
 const wk=[{id:'a',group_name:'水电',line_ids:['1']},{id:'b',group_name:'泥水',line_ids:['2','3']},{id:'c',group_name:'天花',line_ids:['4']},{id:'d',group_name:'油漆',line_ids:['5']}];
 const base={work:wk,lines:ln,tracking:{items:[],batches:[]},payments:[],start:'2026-12-01',today:'2026-11-21'};
 const A=Object.fromEntries(P.build(base).tasks.map(t=>[t.key,t]));ok(A.ceiling.start===A.masonry.start,'by default 天花 runs alongside 泥水');
 const order=['elec','masonry','tile','ceiling','paint'];
 const R=P.build({...base,setup:{order,after:{ceiling:['tile']}}});const T=Object.fromEntries(R.tasks.map(t=>[t.key,t]));
 ok(T.ceiling.start>T.tile.end,'dragged below 铺瓷砖, 天花 now waits for it: '+T.ceiling.start+' > '+T.tile.end);
 ok(T.paint.start>T.ceiling.end&&T.tile.start>T.masonry.end,'the rest still follows its rules');
 ok(R.phases.map(p=>p.key).filter(k=>order.includes(k)).join()===order.join(),'phases are listed in the dragged order');
 // 拖到前面：铺瓷砖拖到泥水上面 → 不再等泥水（现场说了算），也不会死循环
 const R2=P.build({...base,setup:{order:['elec','tile','masonry','ceiling','paint']}});const T2=Object.fromEntries(R2.tasks.map(t=>[t.key,t]));
 ok(T2.tile.start<=T2.masonry.start&&T2.paint.start>T2.tile.end,'moving 铺瓷砖 above 泥水 drops that wait, painting still waits for both');}
// 改顺序后按「现在的实际日期」往后推：前面的工序被手动拉长过，后面要等它的跟着往后挪，工期不变
{const plan={paint:{start:'2026-12-10',end:'2026-12-20'},tile:{start:'2026-12-15',end:'2026-12-18'}};
 const out=P.pushAfter(plan,['tile'],{...P.DEPS,tile:['paint']});
 ok(out.tile.start>out.paint.end&&out.tile.start==='2026-12-21'&&out.tile.end==='2026-12-24','tile moves to start after the real end of painting, same length: '+JSON.stringify(out.tile));
 ok(out.paint.end==='2026-12-20'&&plan.tile.start==='2026-12-15','earlier phases and the input are not changed');}
console.log(`PASS ${n} plan dependency checks`);
