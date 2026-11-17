'use strict';
// 施工计划引擎（纯计算，不读写数据库）：
//  1) 按合同工程量算每张子单要几天（有平方尺 / 尺的按工效算，「1 lot」按工种默认天数）；
//  2) 按工序先后排：同一工种默认一队人、一张接一张做；不同执行人可以同时做；
//  3) 材料：按「到货天数」和「复尺」倒推最晚下单日；定制要等生产，安装不能早于到货；
//  4) 验收节点：水电隐蔽、防水闭水、泥水瓷砖、竣工，能对上合同收款期数的一起显示；
//  5) 交房日：算出余量或差几天，以及「最晚哪天开工还来得及」；
//  6) 防漏项：按合同清单检查常见漏项，只提醒。
// 下面的工效、到货天数都是新山常见水平，店长以后可以在设置里改。
window.RenoPlan=(()=>{
 const DAY=86400000;
 const parse=s=>s?new Date(String(s).slice(0,10)+'T00:00:00Z'):null;
 const iso=d=>d.toISOString().slice(0,10);
 const add=(d,n)=>new Date(d.getTime()+n*DAY);
 const diff=(a,b)=>Math.round((b-a)/DAY);
 const work=d=>{let x=d;while(x.getUTCDay()===0)x=add(x,1);return x;};            // 周日不开工
 const endAfter=(s,days)=>{let x=work(s),left=Math.max(1,days)-1;while(left>0){x=add(x,1);if(x.getUTCDay()!==0)left--;}return x;};
 const next=d=>work(add(d,1));
 const short=n=>String(n||'').replace(/^增项-[0-9a-f-]{36} · ?/i,'增项 · ');
 // 工序：key、名称、识别关键词、工效（area 平方尺/天，length 尺/天，lot 每个 lot 天数，pc 每天装几件）、工种
 const PHASES=[
  {key:'prep',name:'拆除保护',re:/拆除|拆旧|敲|清运|保护(?!清洁)/,lot:2,trade:'杂工'},
  {key:'mep',name:'水电',re:/水电|电气|电位|布线|电线|电路|水管|管道|空调|冷气|弱电|网线/,lot:6,trade:'水电工'},
  {key:'masonry',name:'泥水',re:/泥水|泥瓦|砌|批荡|地坪|混凝土|找平|铺砖|地砖|墙砖|瓷砖|防水|门柱|围墙/,area:120,length:40,lot:2,trade:'泥水工'},
  {key:'ceiling',name:'天花木作',re:/天花|石膏|吊顶|灯槽|木作|隔墙|木工/,area:150,length:60,lot:3,trade:'木工'},
  {key:'paint',name:'油漆',re:/油漆|涂料|乳胶|漆/,area:800,lot:7,trade:'油漆工'},
  {key:'cabinet',name:'定制柜安装',re:/定制|铝柜|衣柜|橱柜|地柜|吊柜|书柜|鞋柜|电视柜|玄关柜|隐形柜|书吧|柜体/,area:60,length:15,lot:1,trade:'柜体安装队'},
  {key:'fit',name:'台面门窗玻璃',re:/台面|岩板|石英|大理石|玻璃|隔断|门窗|窗|折叠门|移门|木门|房门|门/,area:80,length:25,lot:1,trade:'厂家安装',parallel:true},
  {key:'fixture',name:'洁具灯具设备',re:/卫浴|洁具|浴室柜|马桶|花洒|龙头|灯|开关|插座|电器|热水器|窗帘|智能|锁|雨棚|车棚|五金/,pc:8,lot:2,trade:'水电工'},
  {key:'clean',name:'清洁交付',re:/清洁|开荒|保护清洁/,lot:2,trade:'清洁'}
 ];
 // 材料：到货天数（日历天）和是否要等某道工序做完才能复尺下单
 const MATERIALS=[
  {re:/铝柜|铝合金地柜|铝合金吊柜/,lead:21,label:'铝柜'},
  {re:/台面|岩板|石英|大理石/,lead:10,measure:'cabinet',label:'台面（柜装好后复尺）'},
  {re:/淋浴.*(玻璃|隔断)|隔断/,lead:14,measure:'masonry',label:'淋浴隔断（贴砖后复尺）'},
  {re:/门窗|大玻璃|铝合金窗|窗户|铝窗/,lead:21,measure:'masonry',label:'门窗玻璃（墙做好后复尺）'},
  {re:/浴室柜/,lead:21,label:'浴室柜'},
  {re:/定制|衣柜|橱柜|书柜|鞋柜|电视柜|玄关柜|隐形柜|书吧|柜/,lead:25,label:'定制柜'},
  {re:/折叠门|移门|木门|房门/,lead:14,label:'门'},
  {re:/进口砖/,lead:30,label:'进口砖'},
  {re:/瓷砖|地砖|墙砖/,lead:5,label:'瓷砖'},
  {re:/窗帘/,lead:14,measure:'paint',label:'窗帘（油漆后量尺）'},
  {re:/灯|开关|插座|电器|热水器|马桶|花洒|龙头|洁具|五金|锁/,lead:7,label:'洁具灯具'}
 ];
 const unitType=u=>{u=String(u||'').toLowerCase();if(/sq\s*ft|sqft|平方尺|ft²|front sq/.test(u))return 'area';if(/linear|^ft$|\bft\b|尺|^m$|米/.test(u))return 'length';if(/pc|pcs|set|套|个|盏|只|件|台|面|把/.test(u))return 'pc';return 'lot';};
 function phaseIndex(name,lines){
  const byName=PHASES.findIndex(p=>p.re.test(short(name)));if(byName>=0)return byName;
  const txt=lines.map(l=>l.name).join(' ');const byItems=PHASES.findIndex(p=>p.re.test(txt));if(byItems>=0)return byItems;
  if(lines.some(l=>l.kind==='custom'))return 5;if(lines.some(l=>l.kind==='stock'))return 7;return 2;
 }
 function duration(p,lines){
  let days=0;
  for(const l of lines){if(p.key==='clean'&&/保护/.test(l.name))continue; // 地面保护在开工时做，不占收尾天数
   const t=unitType(l.unit),q=Number(l.qty)||0;
   if(t==='area'&&p.area&&q>0)days+=q/p.area;else if(t==='length'&&p.length&&q>0)days+=q/p.length;
   else if(t==='pc'&&p.pc&&q>0)days+=q/p.pc;else days+=p.lot||1;}
  return Math.max(1,Math.min(45,Math.ceil(days)));
 }
 // 先按项目名称判断（「厨房地柜」规格里写了「石英石台面」，不能当成台面），名称看不出来再看规格
 const materialOf=lines=>{const g=lines.filter(l=>['custom','stock'].includes(l.kind));if(!g.length)return null;
  const names=g.map(l=>l.name).join(' '),all=g.map(l=>l.name+' '+(l.spec||'')).join(' ');
  return MATERIALS.find(m=>m.re.test(names))||MATERIALS.find(m=>m.re.test(all))||{lead:7,label:'材料'};};
 // 主计算
 function build({work:wos,lines,tracking,payments,start,handover,today}){
  const T=parse(today)||parse(new Date().toISOString()),S=work(parse(start)||T);
  const byId=new Map((lines||[]).map(l=>[String(l.id),l]));
  const items=w=>(tracking?.items||[]).filter(i=>i.work_order_id===w.id&&i.stage!=='cancelled');
  const tasks=[];
  for(const w of wos||[]){
   if(w.cancelled_at)continue;
   const ls=(w.line_ids||[]).map(id=>byId.get(String(id))).filter(Boolean);
   if(!ls.length||ls.every(l=>l.kind==='gift'))continue;
   const its=items(w),done=its.length>0&&its.every(i=>i.stage==='done');
   const k=phaseIndex(w.group_name,ls),p=PHASES[k];
   tasks.push({id:w.id,name:short(w.group_name),phase:k,phaseName:p.name,trade:p.trade,crew:String(w.assignee||'').trim()||(p.parallel?short(w.group_name):p.trade),days:duration(p,ls),lines:ls,items:its,done,material:materialOf(ls),fixed:done&&w.planned_start?{start:parse(w.planned_start),end:parse(w.planned_end)}:null});
  }
  // 按工序、同工序里工期长的先排
  tasks.sort((a,b)=>a.phase-b.phase||b.days-a.days||a.name.localeCompare(b.name,'zh'));
  const phaseEnd={},crewFree={},batches=tracking?.batches||[];
  let prevEnd=add(S,-1),prevName='';
  for(let k=0;k<PHASES.length;k++){
   const inPhase=tasks.filter(t=>t.phase===k);if(!inPhase.length)continue;
   let end=prevEnd;
   for(const t of inPhase){
    if(t.fixed){t.start=t.fixed.start;t.end=t.fixed.end;t.why='已完成';if(t.end>end)end=t.end;continue;}
    let s=next(prevEnd),why=prevName?`等「${prevName}」做完`:'开工日';
    const free=crewFree[t.crew];if(free&&next(free)>s){s=next(free);why=`同一队（${t.crew}）先做完前一张`;}
    const m=t.material;
    if(m&&t.lines.some(l=>['custom','stock'].includes(l.kind))){
     const ordered=t.items.filter(i=>['custom','stock'].includes(i.kind)).every(i=>['ordered','arrived','done'].includes(i.stage))&&t.items.length>0;
     const arrived=t.items.filter(i=>['custom','stock'].includes(i.kind)).every(i=>['arrived','done'].includes(i.stage))&&t.items.length>0;
     let ready;
     if(arrived)ready=null;
     else if(ordered){const exp=batches.filter(b=>t.items.some(i=>i.batch_id===b.id)).map(b=>parse(b.expected_on)).filter(Boolean);ready=exp.length?add(exp.reduce((a,b)=>a>b?a:b),1):null;}
     else{const measureEnd=m.measure&&phaseEnd[m.measure];const orderFrom=measureEnd?next(measureEnd):(T>S?T:S);ready=add(orderFrom,m.lead);}
     if(ready&&work(ready)>s){s=work(ready);why=ordered?'等已下单的材料到货':m.measure?`等复尺后生产 ${m.lead} 天`:`等材料生产 / 到货 ${m.lead} 天`;}
    }
    t.start=s;t.end=endAfter(s,t.days);t.why=why;crewFree[t.crew]=t.end;if(t.end>end)end=t.end;
   }
   phaseEnd[PHASES[k].key]=end;prevEnd=end;prevName=PHASES[k].name;
  }
  const finish=tasks.length?tasks.reduce((m,t)=>t.end>m?t.end:m,tasks[0].end):null;
  // 关键路线：从最后完工的一张往回找「谁决定了它的开始」
  const crit=new Set();{let cur=tasks.find(t=>finish&&+t.end===+finish);let guard=0;while(cur&&guard++<50){crit.add(cur.id);const prev=tasks.find(x=>x!==cur&&!crit.has(x.id)&&+next(x.end)===+cur.start);if(!prev)break;cur=prev;}}
  tasks.forEach(t=>t.critical=crit.has(t.id));
  // 材料下单清单
  const materials=tasks.filter(t=>t.material&&t.lines.some(l=>['custom','stock'].includes(l.kind))).map(t=>{
   const m=t.material,gi=t.items.filter(i=>['custom','stock'].includes(i.kind));
   const ordered=gi.length>0&&gi.every(i=>['ordered','arrived','done'].includes(i.stage)),arrived=gi.length>0&&gi.every(i=>['arrived','done'].includes(i.stage));
   const signNeeded=gi.some(i=>i.kind==='custom'&&i.stage==='pending');
   const orderBy=add(t.start,-m.lead),measureOn=m.measure?next(phaseEnd[m.measure]||S):null;
   const status=arrived?'arrived':ordered?'ordered':T>orderBy?'late':diff(T,orderBy)<=7?'soon':'later';
   return {id:t.id,name:t.name,label:m.label,lead:m.lead,needBy:iso(t.start),orderBy:iso(orderBy),measureOn:measureOn&&iso(measureOn),status,signNeeded,items:t.lines.filter(l=>['custom','stock'].includes(l.kind)).map(l=>l.name)};
  }).sort((a,b)=>a.orderBy.localeCompare(b.orderBy));
  // 验收节点（对上合同收款期数）
  const pay=re=>(payments||[]).find(p=>re.test(p.name||''));
  const ms=[];const pe=k=>phaseEnd[k];
  if(pe('mep'))ms.push({key:'mep',name:'水电隐蔽工程验收（打压测试、拍照）',on:iso(next(pe('mep'))),pay:pay(/水电|隐蔽/)});
  const wet=tasks.find(t=>t.phase===2&&/浴|卫生间|厕|防水|厨房/.test(t.name+' '+t.lines.map(l=>l.name).join(' ')));
  if(wet)ms.push({key:'water',name:'防水闭水试验 48 小时',on:iso(endAfter(wet.start,Math.min(3,wet.days))),pay:null});
  if(pe('masonry'))ms.push({key:'masonry',name:'泥水瓷砖工程验收',on:iso(next(pe('masonry'))),pay:pay(/泥水|瓷砖/)});
  if(finish)ms.push({key:'final',name:'竣工验收交付',on:iso(next(finish)),pay:pay(/竣工|交付/)});
  // 交房日
  const H=parse(handover);let handoverInfo=null;
  if(H&&finish){const slack=diff(next(finish),H);handoverInfo={slack,latestStart:slack>=0?iso(work(add(S,slack))):null,late:slack<0};}
  return {start:iso(S),finish:finish&&iso(finish),handover:handoverInfo,tasks:tasks.map(t=>({id:t.id,name:t.name,phase:t.phaseName,trade:t.trade,crew:t.crew,days:t.days,start:iso(t.start),end:iso(t.end),why:t.why,critical:t.critical,done:t.done})),materials,milestones:ms,checks:checklist(lines||[])};
 }
 // 防漏项：有 A 没有 B 就提醒（只提醒，不拦）
 const RULES=[
  {when:/(浴室|卫生间|厕|淋浴).*(砖|铺贴)|(砖|铺贴).*(浴室|卫生间|厕)/,need:/防水/,msg:'卫生间有铺砖，清单里没有防水'},
  {when:/厨房.*(砖|铺贴)/,need:/防水/,msg:'厨房（湿区）有铺砖，没有防水',level:'建议'},
  {when:/浴室柜|洗手台|洗手盆|面盆/,need:/龙头/,msg:'有浴室柜 / 洗手盆，没看到龙头'},
  {when:/马桶|坐厕|蹲厕/,need:/角阀|三角阀/,msg:'有马桶，没看到角阀',level:'建议'},
  {when:/地柜|橱柜/,need:/台面/,msg:'有厨房地柜，没有台面'},
  {when:/灯槽|吊柜/,need:/灯带|灯条|LED|灯/,msg:'有灯槽 / 吊柜，没看到灯带',level:'建议'},
  {when:/空调|冷气/,need:/空调.*(电源|插座|排水|铜管)|冷气.*(电源|插座|排水|铜管)|铜管/,msg:'有空调，没看到空调电源或排水 / 铜管'},
  {when:/热水器/,need:/热水器.*(电源|水管|插座)|热水管/,msg:'有热水器，没看到电源或热水管',level:'建议'},
  {when:/炉|抽油烟机|烟机/,need:/插座|电源|电位/,msg:'有炉灶 / 抽油烟机，没看到插座或电位'},
  {when:/拆除|拆旧|敲/,need:/清运|垃圾|废料/,msg:'有拆除，没有垃圾清运',level:'建议'},
  {when:/新建.*墙|砌墙|砖墙/,need:/批荡/,msg:'有新砌墙，没有批荡'},
  {when:/天花|石膏/,need:/油漆|涂料/,msg:'做了天花，没有油漆'},
  {when:/铺贴人工|铺砖人工|不含.*砖/,need:/(瓷砖|地砖|墙砖)(?!.*人工)|砖材/,msg:'有铺砖人工（不含砖），没看到砖材料由谁供应',level:'建议'},
  {when:/木门|房门|实木门|卧室门/,need:/门锁|锁|五金|门把/,msg:'有房门，没看到门锁 / 五金',level:'建议'},
  {when:/./,need:/清洁|开荒/,msg:'没有完工开荒清洁',level:'建议'},
  {when:/./,need:/保护/,msg:'没有施工地面保护',level:'建议'}
 ];
 function checklist(lines){
  // 「有 A」按单个项目判断（避免把不同项目的字拼在一起误判）；「有没有 B」看整份清单
  const each=lines.filter(l=>!l.deducted).map(l=>`${l.name||''} ${l.spec||''} ${l.group||''}`);
  if(!each.length)return [];const all=each.join('｜');
  return RULES.filter(r=>each.some(t=>r.when.test(t))&&!r.need.test(all)).map(r=>({msg:r.msg,level:r.level||'必查',items:each.filter(t=>r.when.test(t)&&r.when.source!=='.').slice(0,3).map(t=>t.split(' ')[0])}));
 }
 return {build,checklist,PHASES,MATERIALS,duration,unitType,phaseIndex};
})();
