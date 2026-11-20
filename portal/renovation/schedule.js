'use strict';
// 施工计划：开工日 + 交房日 → 按合同工程量和工序排出每张子单的日期（计算见 plan.js）；
// 进度表可拖改；下面是材料最晚下单日、验收节点（对上收款期数）、漏项检查、师傅跨工地撞期。
window.RenoSchedule=(()=>{
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const DAY=86400000;
 const parse=s=>s?new Date(String(s).slice(0,10)+'T00:00:00Z'):null;
 const iso=d=>d.toISOString().slice(0,10);
 const add=(d,n)=>new Date(d.getTime()+n*DAY);
 const diff=(a,b)=>Math.round((b-a)/DAY);
 const md=s=>s?String(s).slice(5,10).replace('-','/'):'';
 const todayIso=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'});
 const today=()=>parse(todayIso());
 const short=n=>String(n||'').replace(/^增项-[0-9a-f-]{36} · ?/i,'增项 · ');
 const money=n=>'RM'+Number(n||0).toLocaleString('en-MY',{maximumFractionDigits:0});
 function progress(w,tracking){
  const items=(tracking?.items||[]).filter(i=>i.work_order_id===w.id&&i.stage!=='cancelled'),done=items.filter(i=>i.stage==='done').length;
  return {total:items.length,done,started:items.some(i=>['ordered','arrived','scheduled','working','done'].includes(i.stage)),finished:items.length>0&&done===items.length};
 }
 // 师傅名单首页和施工计划共用一次读取；改动后清掉重读
 let crewCache=null;
 const getCrews=sb=>crewCache||(crewCache=sb.from('renovation_crews').select('*').order('trade').order('name').then(r=>{if(r.error)crewCache=null;return r;},e=>{crewCache=null;return {error:e};}));
 let state=null; // {project, plans, dirty:Set, editing, startOn, handover, handoverDirty, busy:[], crews:[], crewOpen}
 function planInput(ctx){
  const work=(ctx.work||[]).filter(w=>!w.cancelled_at);
  return {work:work.map(w=>({...w,planned_start:state.plans[w.id]?.start||null,planned_end:state.plans[w.id]?.end||null})),lines:ctx.lines||[],tracking:ctx.tracking,payments:ctx.payments||[],start:state.startOn,handover:state.handover,today:todayIso()};
 }
 function render(el,ctx){
  const work=(ctx.work||[]).filter(w=>!w.cancelled_at);
  if(!work.length){el.innerHTML='';return;}
  if(!('planned_start' in work[0])){el.innerHTML=ctx.locked?'':'<div class="sch"><p class="muted">施工计划需要先在 Supabase 运行 renovation_schedule_migration.sql。</p></div>';return;}
  if(!state||state.project!==ctx.project.id)state={project:ctx.project.id,plans:{},dirty:new Set(),editing:null,startOn:'',handover:ctx.project.handover_on?String(ctx.project.handover_on).slice(0,10):'',handoverDirty:false,busy:[],crews:[],crewOpen:false};
  if(!state.handoverDirty)state.handover=ctx.project.handover_on?String(ctx.project.handover_on).slice(0,10):state.handover;
  for(const w of work)if(!state.dirty.has(w.id))state.plans[w.id]=w.planned_start?{start:String(w.planned_start).slice(0,10),end:String(w.planned_end).slice(0,10)}:null;
  const planned0=work.filter(w=>state.plans[w.id]);
  if(!state.startOn)state.startOn=planned0.reduce((m,w)=>!m||state.plans[w.id].start<m?state.plans[w.id].start:m,'')||todayIso();
  const P=window.RenoPlan?RenoPlan.build(planInput(ctx)):null; // 用当前日期算材料、验收、漏项
  const info=new Map((P?.tasks||[]).map(t=>[t.id,t]));
  const t=today(),rows=work.map(w=>({w,p:progress(w,ctx.tracking),plan:state.plans[w.id],info:info.get(w.id)}));
  rows.sort((a,b)=>(a.plan?.start||'9999').localeCompare(b.plan?.start||'9999')||short(a.w.group_name).localeCompare(short(b.w.group_name),'zh'));
  const planned=rows.filter(r=>r.plan);
  const lastEnd=planned.reduce((m,r)=>!m||r.plan.end>m?r.plan.end:m,'');
  const doneCount=rows.filter(r=>r.p.finished).length,late=rows.filter(r=>r.plan&&!r.p.finished&&parse(r.plan.end)<t);
  // 交房日：按当前计划算余量
  let hand='';
  if(state.handover&&lastEnd){const slack=diff(add(parse(lastEnd),1),parse(state.handover));
   hand=slack>=0?`<span class="fx-chip ok">交房 ${E(md(state.handover))} · 余 ${slack} 天</span>${slack>0?`<span class="muted">最晚 ${E(md(iso(add(parse(state.startOn),slack))))} 开工还来得及</span>`:''}`:`<span class="fx-chip bad">⚠ 比交房日 ${E(md(state.handover))} 晚 ${-slack} 天</span><span class="muted">要提前开工、加派人手，或和业主改交房日</span>`;}
  // 撞期
  const clash=r=>{const who=String(r.w.assignee||'').trim().toLowerCase();if(!who||!r.plan)return [];return state.busy.filter(b=>String(b.crew||'').trim().toLowerCase()===who&&b.start<=r.plan.end&&b.end>=r.plan.start);};
  const clashes=rows.filter(r=>clash(r).length).length;
  // 一句话说清现在的状况（最严重的那条用颜色），细节放在下面的「要处理」里
  const slack=state.handover&&lastEnd?diff(add(parse(lastEnd),1),parse(state.handover)):null;
  const matIssues=(P?.materials||[]).filter(m=>['late','soon'].includes(m.status));
  const issues=[],tags=[];const push=(tag,x)=>{issues.push(x);tags.push(tag);};
  if(slack!=null&&slack<0)push('晚于交房',`比交房日 ${md(state.handover)} 晚 ${-slack} 天：要提前开工、加派人手，或和业主改交房日`);
  rows.forEach(r=>clash(r).forEach(b=>push('撞期',`撞期 ${b.contract_no}：${short(r.w.group_name)}（${String(r.w.assignee).trim()}）${md(r.plan.start)}–${md(r.plan.end)}，那边 ${b.group_name} ${md(b.start)}–${md(b.end)}`)));
  late.forEach(r=>push('超期',`超期：${short(r.w.group_name)} 计划 ${md(r.plan.end)} 完成，还有 ${r.p.total-r.p.done} 项没做完`));
  matIssues.forEach(m=>push('要下单',`${m.status==='late'?'已过':'快到'}最晚下单日：${m.name} 最晚 ${md(m.orderBy)} 下单${m.signNeeded?'（业主还没签名）':''}`));
  const headline=!lastEnd?'还没有排期':slack!=null?(slack<0?`<b class="bad">⚠ 计划 ${E(md(lastEnd))} 完工，比交房日晚 ${-slack} 天</b>`:`<b class="ok">计划 ${E(md(lastEnd))} 完工，交房前余 ${slack} 天</b>${slack>0&&parse(state.startOn)>=t?`，最晚 ${E(md(iso(add(parse(state.startOn),slack))))} 开工还来得及`:''}`):`<b>计划 ${E(md(lastEnd))} 完工</b>（填交房日可以算余量）`;
  state.summary={lastEnd,slack,issues:issues.length};
  const sumEl=document.getElementById('plan-summary');
  if(sumEl)sumEl.innerHTML=lastEnd?`计划 ${E(md(lastEnd))} 完工${slack!=null?(slack<0?` · <b class="bad">晚 ${-slack} 天</b>`:` · 余 ${slack} 天`):''}${issues.length?` · <b class="bad">⚠ ${issues.length} 件要处理</b>`:''}`:'还没排期';
  // 最上面三个数字：计划完工（比交房早或晚）、交房日、进度
  const toHand=state.handover?diff(t,parse(state.handover)):null;
  let html=`<div class="sch"><div class="sch-kpis">
   <div class="sch-kpi ${slack==null?'':slack<0?'bad':'ok'}"><small>计划完工</small><b>${lastEnd?E(md(lastEnd)):'未排期'}</b><span class="sch-headline">${slack==null?'':slack<0?`<b class="bad">⚠ 比交房日 ${E(md(state.handover))} 晚 ${-slack} 天</b>`:`<b class="ok">交房前余 ${slack} 天</b>`}</span></div>
   <div class="sch-kpi"><small>交房日</small><b>${state.handover?E(md(state.handover)):'未定'}</b><span>${toHand==null?'在右边填交房日':toHand>=0?`还有 ${toHand} 天`:`已过 ${-toHand} 天`}</span></div>
   <div class="sch-kpi"><small>进度</small><b>${doneCount} / ${rows.length}</b><span>张子单已完成</span></div>
  </div><div class="sch-head">${state.dirty.size||state.handoverDirty?`<span class="fx-chip now">有改动还没保存</span>`:'<span></span>'}`;
  if(!ctx.locked)html+=`<div class="sch-tools"><label>开工日<input type="date" data-sch-start value="${E(state.startOn)}"></label><label>交房日<input type="date" data-sch-handover value="${E(state.handover)}"></label><button type="button" class="secondary" data-sch-auto>${planned.length?'按工程量重新排':'按工程量自动排期'}</button><button type="button" data-sch-save ${state.dirty.size||state.handoverDirty?'':'disabled'}>保存计划</button></div>`;
  html+='</div>';
  // 要处理：最重要的 3 条先显示，其余收起
  const it=(x,i)=>`<li><span class="sch-tag">${E(tags[i])}</span>${E(x)}</li>`;
  if(issues.length)html+=`<div class="sch-issues"><b>要处理（${issues.length}）</b><ul>${issues.slice(0,3).map(it).join('')}</ul>${issues.length>3?`<details><summary>还有 ${issues.length-3} 条</summary><ul>${issues.slice(3).map((x,i)=>it(x,i+3)).join('')}</ul></details>`:''}</div>`;
  if(!planned.length){html+=`<p class="muted sch-empty">还没有排期。填开工日（和交房日），点「按工程量自动排期」：系统按合同工程量算每道工序要几天，按 拆除 → 水电 → 泥水 → 天花木作 → 油漆 → 定制柜 → 台面门窗玻璃 → 洁具灯具 → 清洁 排好；定制和门窗会等生产 / 复尺。排好后可以拖动调整。</p>${extras(P,ctx,rows)}</div>`;el.innerHTML=html;afterRender(el,ctx);return;}
  const ms=(P?.milestones||[]).filter(m=>m.on);
  // 赠品、设计这类不用排期的，不占甘特图的行，写在图下面一行
  const skip=rows.filter(r=>!r.info&&!r.plan),chart=rows.filter(r=>r.info||r.plan);
  const from=add([...planned.map(r=>parse(r.plan.start)),t,...ms.map(m=>parse(m.on))].reduce((a,b)=>a<b?a:b),-2);
  const to=add([...planned.map(r=>parse(r.plan.end)),t,...(state.handover?[parse(state.handover)]:[]),...ms.map(m=>parse(m.on))].reduce((a,b)=>a>b?a:b),5);
  const days=diff(from,to)+1,phone=innerWidth<=600,avail=(el.clientWidth||900)-(phone?108:160)-36;
  // 「全局」：整个工期压进一屏（手机也一样，不用左右滑）；「近 4 周」：放大看今天前后，可以拖动改期
  let view='all';try{view=localStorage.getItem('reno-plan-view')||'all';}catch(e){}
  const dw=view==="all"?Math.min(30,Math.max(0.15,(avail-42)/days)):Math.max(phone?16:20,Math.min(34,Math.floor(avail/28)));
  const monthAt=new Set();for(let i=0;i<days;i++){const d=add(from,i);if(d.getUTCDate()===1||i===0)monthAt.add(i);}
  const nearMonth=i=>dw*7<30||[...monthAt].some(m=>m!==i&&Math.abs(m-i)*dw<34);
  let ticks='';for(let i=0;i<days;i++){const d=add(from,i);const first=monthAt.has(i);if(((d.getUTCDay()===1&&!nearMonth(i))||first)&&(i*dw<days*dw-26||i===0))ticks+=`<span class="sch-tick${first?' m':''}" style="left:${i*dw}px">${first?`${d.getUTCMonth()+1}月`:''}${d.getUTCDate()}</span>`;}
  const sundays=[];for(let i=0;i<days;i++)if(add(from,i).getUTCDay()===0)sundays.push(`<i style="left:${i*dw}px;width:${dw}px"></i>`);
  // 每个工种一种颜色；状态用描边 / 深色进度 / 变淡表示
  const TRADE={'水电工':'mep','泥水工':'mason','木工':'wood','油漆工':'paint','柜体安装队':'cab','厂家安装':'fac','清洁':'clean','杂工':'misc'};
  const tradeOf=r=>r.info?.trade||'其他',tc=r=>TRADE[tradeOf(r)]||'other';
  const compact=view==='all';
  const bar=r=>{
   if(!r.plan)return '<span class="sch-none">未排期</span>';
   const s=parse(r.plan.start),e=parse(r.plan.end),left=diff(from,s)*dw,width=(diff(s,e)+1)*dw;
   const cls=r.p.finished?'done':(e<t?'late':r.p.started?'active':'wait');
   const pct=r.p.total?Math.round(100*r.p.done/r.p.total):0;
   const tip=`${short(r.w.group_name)}：${r.plan.start} → ${r.plan.end}`+(r.info?`（${r.info.days} 个工作日，${r.info.trade}${r.info.why?`；${r.info.why}`:''}）`:'');
   const n=diff(s,e)+1,inside=!compact&&width>=34,txt=width>=120?`${n}天 · ${md(r.plan.start)}–${md(r.plan.end)}`:`${n}天`;
   return `<div class="sch-bar ${cls} tr-${tc(r)}${state.dirty.has(r.w.id)?' dirty':''}${r.info?.critical&&!r.p.finished?' crit':''}" data-sch-bar="${r.w.id}" style="left:${left}px;width:${width}px" title="${E(tip)}"><i style="width:${pct}%"></i>${inside?`<span>${r.p.finished?'✓ ':''}${E(txt)}</span>`:''}${ctx.locked?'':'<b data-sch-end aria-hidden="true"></b>'}</div>${inside?'':`<span class="sch-days${cls==='late'?' bad':''}" style="left:${left+width+4}px">${r.p.finished?'✓ ':''}${n}天</span>`}`;
  };
  const sub=r=>{const who=String(r.w.assignee||'').trim();
   if(!r.info&&!r.plan)return '<small class="muted">不用排期</small>';
   return r.p.finished?'<small class="ok">✓ 已完成</small>':`<small>${who?E(who):`<span class="muted">${r.info?E(r.info.trade)+' · ':''}未定人</span>`}</small>`;};
  const dot=r=>!r.p.finished&&(clash(r).length||(r.plan&&parse(r.plan.end)<t))?'<i class="sch-dot" title="有问题，见上面「要处理」"></i>':'';
  const editor=r=>state.editing===r.w.id&&!ctx.locked?`<div class="sch-edit"><label>开始<input type="date" data-sch-es value="${E(r.plan?.start||'')}"></label><label>完成<input type="date" data-sch-ee value="${E(r.plan?.end||'')}"></label><button type="button" data-sch-ok="${r.w.id}">确定</button><button type="button" class="secondary" data-sch-cancel>取消</button></div>`:'';
  const msRow=ms.length?`<div class="sch-row sch-ms"><div class="sch-label"><span>验收节点</span><small>$ = 可收款</small></div><div class="sch-lane"><div class="sch-sun">${sundays.join('')}</div>${ms.map((m,k)=>`<span class="sch-dia${m.pay?' pay':''}${k%2?' low':''}" style="left:${diff(from,parse(m.on))*dw+dw/2}px" title="${E(m.on+' '+m.name+(m.pay?`；收款：${m.pay.name} ${money(m.pay.amount)}`:''))}">◆<em>${E(m.short||'')}${m.pay?' $':''}</em></span>`).join('')}</div></div>`:'';
  const hx=state.handover?`<div class="sch-hand" style="left:calc(var(--label) + ${diff(from,parse(state.handover))*dw+dw/2}px)" title="交房日 ${E(state.handover)}"><span>交房</span></div>`:'';
  html+=`<div class="sch-views" role="group" aria-label="看板范围"><button type="button" data-sch-view="all" aria-pressed="${view==='all'}">全局</button><button type="button" data-sch-view="near" aria-pressed="${view!=='all'}">近 4 周</button><span class="muted">${E(iso(from).replace(/-/g,'/'))} – ${E(iso(to).replace(/-/g,'/'))} · 共 ${days} 天</span></div><div class="sch-scroll${view==='all'?' sch-fit':''}"><div class="sch-grid${view==='all'?' sch-compact':''}${dw<6?' sch-tiny':''}" style="--w:${days*dw}px"><div class="sch-row sch-axis"><div class="sch-label"></div><div class="sch-lane">${ticks}</div></div>
   ${chart.map(r=>`<div class="sch-row"><button type="button" class="sch-label" data-sch-name="${r.w.id}" ${ctx.locked?'disabled':''}><span>${E(short(r.w.group_name))}${dot(r)}</span>${sub(r)}</button><div class="sch-lane"><div class="sch-sun">${sundays.join('')}</div>${bar(r)}</div></div>${editor(r)}`).join('')}${msRow}
   <div class="sch-today" style="left:calc(var(--label) + ${diff(from,t)*dw+dw/2}px)" title="今天"><span>今天</span></div>${hx}</div></div>
   ${skip.length?`<p class="muted sch-skip">不用排期：${skip.map(r=>E(short(r.w.group_name))).join('、')}</p>`:''}<p class="muted sch-hint">${ctx.locked?'':'拖动横条整体改日期，拖右端改完成日；手机上点子单名称改日期。'}${[...new Set(chart.filter(r=>r.plan).map(tradeOf))].map(x=>`<span class="sch-key tr-${TRADE[x]||'other'}"></span>${E(x)}`).join(' ')}<br><span class="sch-key late"></span>红框 = 超期 <span class="sch-key active"></span>深色 = 已做的部分 · 变淡打 ✓ = 已完成 <span class="sch-key crit"></span>卡完工的工序（它晚一天，交房就晚一天）</p>${extras(P,ctx,rows)}</div>`;
  const keep=el.querySelector('.sch-scroll')?.scrollLeft;
  el.innerHTML=html;el.dataset.dw=dw;
  // 打开时自动滚到「今天」附近；重新画图时保持原来的位置
  const sc=el.querySelector('.sch-scroll');if(sc){const lab=el.querySelector('.sch-label')?.offsetWidth||150;sc.scrollLeft=keep!=null&&state.scrolled?keep:Math.max(0,diff(from,t)*dw-lab-3*dw);state.scrolled=true;}
  afterRender(el,ctx);
 }
 // 材料下单 / 验收节点 / 漏项检查 / 师傅名单
 function extras(P,ctx){
  if(!P)return '';
  const st={arrived:['ok','已到货'],ordered:['mid','已下单'],late:['bad','⚠ 已过最晚下单日'],soon:['now','7 天内要下单'],later:['grey','未到时间']};
  const mats=P.materials.length?`<div class="sch-tablewrap"><table class="sch-table"><thead><tr><th>材料</th><th>要用</th><th>最晚下单</th><th>状态</th></tr></thead><tbody>${P.materials.map(m=>`<tr><td><b>${E(m.name)}</b><small>${E(m.label)} · 到货约 ${m.lead} 天${m.measureOn?` · ${E(md(m.measureOn))} 可复尺`:''}${m.signNeeded?' · <span class="bad">业主还没签名</span>':''}</small></td><td>${E(md(m.needBy))}</td><td><b>${E(md(m.orderBy))}</b></td><td><span class="fx-chip ${st[m.status][0]}">${st[m.status][1]}</span></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">这份合同没有要下单的材料。</p>';
  const soon=P.materials.filter(m=>['late','soon'].includes(m.status)).length;
  const msl=P.milestones.length?`<ul class="sch-list">${P.milestones.map(m=>`<li><b>${E(md(m.on))}</b> ${E(m.name)}${m.pay?`<br><small>对应收款：${E(m.pay.name)} <b>${money(m.pay.amount)}</b></small>`:''}</li>`).join('')}</ul>`:'<p class="muted">排期后显示。</p>';
  const ck=P.checks.length?`<ul class="sch-list">${P.checks.map(c=>`<li><span class="fx-chip ${c.level==='必查'?'bad':'now'}">${E(c.level)}</span> ${E(c.msg)}${c.items?.length?`<br><small>${E(c.items.join('；'))}</small>`:''}</li>`).join('')}</ul><p class="muted sch-note">只是提醒：确认合同里另有安排或业主自理就不用管。</p>`:'<p class="ok-text">✓ 没发现常见漏项</p>';
  return `<div class="sch-extras">
   <details class="sch-box" ${soon?'open':''}><summary>材料下单${soon?` <span class="fx-chip bad">${soon} 项要注意</span>`:''}</summary>${mats}</details>
   <details class="sch-box"><summary>验收节点 · ${P.milestones.length} 个</summary>${msl}</details>
   <details class="sch-box" ${P.checks.some(c=>c.level==='必查')?'open':''}><summary>漏项检查${P.checks.length?` <span class="fx-chip ${P.checks.some(c=>c.level==='必查')?'bad':'now'}">${P.checks.length} 条</span>`:' ✓'}</summary>${ck}</details>
   </div><p class="muted sch-note">执行人从「师傅名单」里选（整装首页项目列表下面），系统才能查出跨工地撞期。</p>`;
 }
 // 读师傅名单、查撞期（失败不影响页面）
 let loading=false;
 async function afterRender(el,ctx){
  let list=document.getElementById('crew-list');if(!list){list=document.createElement('datalist');list.id='crew-list';document.body.append(list);}
  list.innerHTML=state.crews.filter(c=>c.active).map(c=>`<option value="${E(c.name)}">${E(c.trade)}</option>`).join('');
  document.querySelectorAll('input[id^="assignee-"]').forEach(i=>i.setAttribute('list','crew-list'));
  const key=ctx.project.id+'|'+(ctx.work||[]).map(w=>w.assignee||'').join(',');
  if(!ctx.sb||loading||state.loadedFor===key)return;loading=true;state.loadedFor=key;
  try{
   const [c,b]=await Promise.all([getCrews(ctx.sb),
    ctx.sb.rpc('renovation_crew_busy',{p_names:[...new Set((ctx.work||[]).map(w=>String(w.assignee||'').trim()).filter(Boolean))],p_exclude:ctx.project.id})]);
   if(!c.error)state.crews=c.data||[];if(!b.error)state.busy=b.data||[];
  }catch(e){}finally{loading=false;}
  render(el,ctx);
 }
 function bind(el,ctx){
  const rerender=()=>render(el,{...ctx.data(),sb:ctx.sb});
  // 手机转横屏 / 窗口变大变小：「全局」按新宽度重画，从开工到完工始终一屏放下
  let rz=null,lastW=innerWidth;addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(()=>{if(innerWidth===lastW)return;lastW=innerWidth;let v='all';try{v=localStorage.getItem('reno-plan-view')||'all';}catch(e){}if(v==='all'&&el.querySelector('.sch-grid')&&ctx.data().project)rerender();},150);});
  const setPlan=(id,start,end)=>{state.plans[id]={start,end};state.dirty.add(id);};
  el.addEventListener('click',async e=>{
   const b=e.target.closest('button');if(!b||!el.contains(b))return;const d=b.dataset;
   try{
    if('schView' in d){try{localStorage.setItem('reno-plan-view',d.schView);}catch(err){}state.scrolled=false;rerender();return;}
    if('schAuto' in d){
     const data=ctx.data(),inp=planInput(data);
     inp.work=inp.work.map(w=>progress(w,data.tracking).finished?w:{...w,planned_start:null,planned_end:null});
     const P=RenoPlan.build(inp),todo=P.tasks.filter(x=>!x.done);
     if(!todo.length){ctx.message('没有可以排期的子单（都已完成或只有赠品）。',true);return;}
     todo.forEach(x=>setPlan(x.id,x.start,x.end));rerender();
     ctx.message(`已按工程量排好：计划 ${P.finish} 完工${P.handover?(P.handover.late?`，比交房日晚 ${-P.handover.slack} 天`:`，比交房日早 ${P.handover.slack} 天`):''}。看一下再点「保存计划」。`,!!P.handover?.late);
    }else if('schSave' in d){
     b.disabled=true;const data=ctx.data();
     if(state.dirty.size){const plans=[...state.dirty].map(id=>({work_order_id:id,start:state.plans[id]?.start||null,end:state.plans[id]?.end||null}));
      const {error}=await ctx.sb.rpc('renovation_schedule_save',{p_id:data.project.id,p_plans:plans});if(error)throw error;state.dirty.clear();}
     if(state.handoverDirty){const {error}=await ctx.sb.rpc('renovation_handover_date_save',{p_id:data.project.id,p_on:state.handover||null});if(error)throw new Error(/function|schema cache/i.test(error.message)?'交房日要先在 Supabase 运行 renovation_planning_migration.sql 才能保存；进度已保存。':error.message);state.handoverDirty=false;}
     await ctx.onChange();ctx.message('施工计划已保存，业主链接里也会显示进度计划。');
    }else if(d.schName){state.editing=state.editing===d.schName?null:d.schName;rerender();}
    else if(d.schOk){const box=b.closest('.sch-edit'),s=box.querySelector('[data-sch-es]').value,en=box.querySelector('[data-sch-ee]').value;
     if(!s||!en)throw new Error('请填开始和完成日期');if(en<s)throw new Error('完成日期不能早于开始日期');setPlan(d.schOk,s,en);state.editing=null;rerender();}
    else if('schCancel' in d){state.editing=null;rerender();}
   }catch(err){ctx.message(err.message||String(err),true);if(d.schSave!==undefined)b.disabled=false;}
  });
  el.addEventListener('change',e=>{
   if(e.target.matches('[data-sch-start]'))state.startOn=e.target.value;
   if(e.target.matches('[data-sch-handover]')){state.handover=e.target.value;state.handoverDirty=true;rerender();}
  });
  let drag=null;
  el.addEventListener('pointerdown',e=>{
   const bar=e.target.closest('[data-sch-bar]');if(!bar||ctx.data().locked||e.button!==0)return;
   const id=bar.dataset.schBar,p=state.plans[id];if(!p)return;
   drag={id,bar,x:e.clientX,mode:e.target.closest('[data-sch-end]')?'end':'move',s:parse(p.start),e:parse(p.end),dw:+el.dataset.dw||20,moved:0,left:parseFloat(bar.style.left),width:parseFloat(bar.style.width)};
   bar.setPointerCapture(e.pointerId);e.preventDefault();
  });
  el.addEventListener('pointermove',e=>{
   if(!drag)return;const n=Math.round((e.clientX-drag.x)/drag.dw);if(n===drag.moved)return;drag.moved=n;
   if(drag.mode==='move')drag.bar.style.left=(drag.left+n*drag.dw)+'px';
   else drag.bar.style.width=Math.max(drag.dw,drag.width+n*drag.dw)+'px';
  });
  const end=()=>{
   if(!drag)return;const g=drag;drag=null;if(!g.moved)return;
   if(g.mode==='move')setPlan(g.id,iso(add(g.s,g.moved)),iso(add(g.e,g.moved)));
   else{const ne=add(g.e,g.moved);setPlan(g.id,iso(g.s),iso(ne<g.s?g.s:ne));}
   rerender();
  };
  el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
 }
 // 整装首页：师傅名单（公司共用）。员工能看；店长及以上能新增、停用 / 恢复
 async function crewAdmin(el,ctx){
  if(!el)return;
  const TRADES=['水电工','泥水工','木工','油漆工','柜体安装队','厂家安装','杂工','清洁','其他'];
  const draw=async(msg='')=>{
   const r=await getCrews(ctx.sb);
   if(r.error){el.hidden=true;return;}
   el.hidden=false;const list=r.data||[];
   el.innerHTML=`<details class="panel crew-admin"${el.dataset.open?' open':''}><summary><b>师傅名单</b> <span class="muted">${list.filter(c=>c.active).length} 位在用 · 子单「执行人」从这里选，系统才能查跨工地撞期</span></summary>
    ${list.length?`<div class="sch-tablewrap"><table class="sch-table"><thead><tr><th>名称</th><th>工种</th><th>人数</th><th>电话</th><th></th></tr></thead><tbody>${list.map(c=>`<tr class="${c.active?'':'off'}"><td><b>${E(c.name)}</b></td><td>${E(c.trade)}</td><td>${c.headcount}</td><td>${E(c.phone)}</td><td>${ctx.manager()?`<button type="button" class="secondary" data-crew-toggle="${c.id}" data-on="${c.active?'0':'1'}">${c.active?'停用':'恢复'}</button>`:(c.active?'':'已停用')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">还没有师傅。</p>'}
    ${ctx.manager()?`<div class="work-controls"><label>名称<input data-crew-f="name" maxlength="60" placeholder="例：阿强泥水队"></label><label>工种<select data-crew-f="trade">${TRADES.map(x=>`<option>${x}</option>`).join('')}</select></label><label>人数<input data-crew-f="headcount" type="number" min="1" max="50" value="2"></label><label>电话<input data-crew-f="phone" maxlength="40"></label><button type="button" data-crew-add>加入名单</button></div>`:'<p class="muted">由店长或上级维护。</p>'}
    <p class="muted sch-note" data-crew-msg role="status">${E(msg)}</p></details>`;
   el.querySelector('details').addEventListener('toggle',e=>{el.dataset.open=e.target.open?'1':'';});
  };
  el.onclick=async e=>{
   const b=e.target.closest('button');if(!b)return;const f=k=>el.querySelector(`[data-crew-f="${k}"]`)?.value||'';
   try{
    if('crewAdd' in b.dataset){if(!f('name').trim())throw new Error('请填写师傅 / 队伍名称');
     const {error}=await ctx.sb.rpc('renovation_crew_save',{p_id:null,p_data:{name:f('name'),trade:f('trade'),headcount:Number(f('headcount'))||1,phone:f('phone')}});if(error)throw error;
     crewCache=null;el.dataset.open='1';await draw(`已加入「${f('name').trim()}」。`);}
    else if(b.dataset.crewToggle){const {error}=await ctx.sb.rpc('renovation_crew_save',{p_id:b.dataset.crewToggle,p_data:{name:b.closest('tr').querySelector('b').textContent,active:b.dataset.on==='1'}});if(error)throw error;crewCache=null;el.dataset.open='1';await draw('已更新。');}
   }catch(err){const m=el.querySelector('[data-crew-msg]');if(m)m.textContent=err.message||String(err);}
  };
  await draw();
 }
 return {render,bind,crewAdmin};
})();
