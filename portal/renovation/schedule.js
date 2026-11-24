'use strict';
// 施工计划：按「工序 → 工种 → 流程」排——合同里同一工序的项目一个工种一次进场，每道工序一个日期（计算见 plan.js）；
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
 let state=null; // {project, plans:{工序:{start,end}}, dirty:Set(工序), startOn, handover, ...}
 const ORDER=['prep','plumb','elec','mep','masonry','ceiling','tile','paint','cabinet','fit','fix_plumb','fix_elec','hardware','fixture','clean'];
 const TRADE={'水管工':'plumb','电工':'elec','瓷砖工':'tile','水电工':'mep','泥水工':'mason','木工':'wood','油漆工':'paint','柜体安装队':'cab','厂家安装':'fac','清洁':'clean','杂工':'misc'};
 const STAGE={pending:'待处理',confirmed:'待下单',ordered:'已下单',arrived:'已到货',scheduled:'已排期',working:'施工中',done:'已完成'};
 // 11-24 前保存过「水电」/「洁具灯具设备」计划的旧项目，继续合成一条
 const mepCombined=p=>!!p&&[p.phase_plan,p.phase_baseline].some(x=>x&&('mep' in x||'fixture' in x));
 function planInput(ctx){
  const work=(ctx.work||[]).filter(w=>!w.cancelled_at);
  return {work,lines:ctx.lines||[],tracking:ctx.tracking,payments:ctx.payments||[],start:state.startOn,handover:state.handover,today:todayIso(),fixed:state.plans,mepCombined:mepCombined(ctx.project)};
 }
 // 子单日期 = 它所含工序的起止（监理「今天要做」、业主进度、师傅撞期都用子单日期）
 function workWindows(P){
  const out={};for(const tk of P.tasks){const pl=state.plans[tk.key];if(!pl)continue;for(const id of tk.workOrders||[]){const w=out[id]||(out[id]={start:pl.start,end:pl.end});if(pl.start<w.start)w.start=pl.start;if(pl.end>w.end)w.end=pl.end;}}
  return out;
 }
 const phaseLines=P=>Object.fromEntries(P.tasks.map(tk=>[tk.key,(tk.lines||[]).map(l=>[l.work_order_id,String(l.id)])]));
 const saveLive=(sb,args)=>sb.rpc('renovation_phase_plan_save',args).then(r=>r.error&&/p_lines|p_delays|function|schema cache/i.test(r.error.message)&&!args.p_delays?sb.rpc('renovation_phase_plan_save',{p_id:args.p_id,p_plan:args.p_plan,p_work:args.p_work}):r);
 // 监理报延误 → 实时计划自动顺延：延误的那道工序推迟完成，后面要等它的工序整体往后挪（同期的不动），然后自动保存
 function autoShift(ctx,P,work){
  const applied=new Set(ctx.project.phase_delays_applied||[]);
  const todo=(state.delays||[]).filter(e=>e.status!=='rejected'&&!applied.has(e.id)&&!(state.shiftSent||new Set()).has(e.id));
  if(!todo.length||state.shifting)return;
  const plan=JSON.parse(JSON.stringify(state.plans)),done=new Set(P.tasks.filter(tk=>tk.done).map(tk=>tk.key)),notes=[],moved=new Set();
  const shift=(k,n)=>{const q=plan[k];q.start=iso(add(parse(q.start),n));q.end=iso(add(parse(q.end),n));if(parse(q.start).getUTCDay()===0){q.start=iso(add(parse(q.start),1));q.end=iso(add(parse(q.end),1));}moved.add(k);};
  for(const e of todo){const n=Math.max(0,Math.min(120,Math.round(+e.data?.days||0)));if(!n)continue;const on=String(e.on_date).slice(0,10);
   const cand=P.tasks.filter(tk=>plan[tk.key]&&!done.has(tk.key)&&(!e.work_order_id||(tk.workOrders||[]).includes(e.work_order_id)));
   const tk=cand.find(x=>plan[x.key].start<=on&&plan[x.key].end>=on)||cand.filter(x=>plan[x.key].end>=on).sort((a,b)=>plan[a.key].start.localeCompare(plan[b.key].start))[0];
   if(!tk)continue;plan[tk.key].end=iso(add(parse(plan[tk.key].end),n));if(parse(plan[tk.key].end).getUTCDay()===0)plan[tk.key].end=iso(add(parse(plan[tk.key].end),1));moved.add(tk.key);notes.push(`${tk.name} 延误 ${n} 天`);}
  const keys=Object.keys(plan).filter(k=>plan[k]),rel=RenoPlan.relations?RenoPlan.relations(keys):{};
  for(let pass=0;pass<12;pass++){let ch=false;for(const k of ORDER){if(!plan[k]||done.has(k))continue;for(const d of rel[k]?.after||[]){if(plan[d]&&plan[k].start<=plan[d].end){shift(k,diff(parse(plan[k].start),parse(plan[d].end))+1);ch=true;}}}if(!ch)break;}
  const after=[...moved].filter(k=>!notes.some(x=>x.startsWith(P.tasks.find(t=>t.key===k)?.name+' '))).map(k=>P.tasks.find(t=>t.key===k)?.name).filter(Boolean);
  const changed=Object.fromEntries([...moved].map(k=>[k,plan[k]]));
  state.shifting=true;state.shiftSent=new Set([...(state.shiftSent||[]),...todo.map(e=>e.id)]);
  const Q=RenoPlan.build({...planInput(ctx),fixed:plan}),ww={};for(const tk of Q.tasks){const pl=plan[tk.key];if(!pl)continue;for(const id of tk.workOrders||[]){const w=ww[id]||(ww[id]={start:pl.start,end:pl.end});if(pl.start<w.start)w.start=pl.start;if(pl.end>w.end)w.end=pl.end;}}
  ctx.sb.rpc('renovation_phase_plan_save',{p_id:ctx.project.id,p_plan:changed,p_work:work.filter(w=>ww[w.id]).map(w=>({work_order_id:w.id,start:ww[w.id].start,end:ww[w.id].end})),p_lines:phaseLines(Q),p_delays:todo.map(e=>e.id)}).then(({error})=>{
   state.shifting=false;if(error){state.autoNote=`监理报了延误（${notes.join('、')}），但自动顺延没保存成功：${error.message}。请手动调整后保存。`;state._rerender?.();return;}
   ctx.project.phase_plan={...(ctx.project.phase_plan||{}),...changed};if(!ctx.project.phase_baseline_locked_at)ctx.project.phase_baseline={...ctx.project.phase_plan};
   ctx.project.phase_delays_applied=[...(ctx.project.phase_delays_applied||[]),...todo.map(e=>e.id)];
   for(const w of work)if(ww[w.id]){w.planned_start=ww[w.id].start;w.planned_end=ww[w.id].end;}
   Object.assign(state.plans,changed);state.log=null;
   state.autoNote=notes.length?`监理报 ${notes.join('、')}：实时计划已自动顺延${after.length?`（${after.join('、')} 跟着往后挪）`:''}，已保存并记入调整记录；不合适可以再拖动调整。`:'';
   state._rerender?.();});
 }
 function render(el,ctx){
  const work=(ctx.work||[]).filter(w=>!w.cancelled_at);
  if(!work.length){el.innerHTML='';return;}
  if(!('planned_start' in work[0])){el.innerHTML=ctx.locked?'':'<div class="sch"><p class="muted">施工计划需要先在 Supabase 运行 renovation_schedule_migration.sql。</p></div>';return;}
  const hasPhaseCol='phase_plan' in (ctx.project||{});
  if(!state||state.project!==ctx.project.id)state={project:ctx.project.id,plans:{},dirty:new Set(),startOn:'',handover:'',handoverDirty:false,busy:[],crews:[],open:new Set(),editingPhase:null,log:null,siteActual:{},delays:[],view:'live',z:1};
  if(!state.handoverDirty)state.handover=ctx.project.handover_on?String(ctx.project.handover_on).slice(0,10):'';
  // 已保存的工序计划；还没有（旧项目 / 还没跑 SQL）就按子单日期推一个出来
  const saved=hasPhaseCol?(ctx.project.phase_plan||{}):{};
  state.baseline=hasPhaseCol?(ctx.project.phase_baseline||{}):{};
  const hasFc='phase_baseline_locked_at' in (ctx.project||{}),fcLocked=!!ctx.project.phase_baseline_locked_at;
  if(!fcLocked)state.view='live';const fv=state.view==='forecast';
  let P=window.RenoPlan?RenoPlan.build({...planInput(ctx),fixed:{}}):null;
  if(!P){el.innerHTML='';return;}
  const fromWork={};for(const tk of P.tasks){const ws=work.filter(w=>(tk.workOrders||[]).includes(w.id)&&w.planned_start);if(ws.length)fromWork[tk.key]={start:ws.map(w=>String(w.planned_start).slice(0,10)).sort()[0],end:ws.map(w=>String(w.planned_end).slice(0,10)).sort().pop()};}
  for(const tk of P.tasks)if(!state.dirty.has(tk.key))state.plans[tk.key]=saved[tk.key]||(Object.keys(saved).length?null:fromWork[tk.key])||null;
  if(!state.startOn)state.startOn=Object.values(state.plans).filter(Boolean).map(x=>x.start).sort()[0]||todayIso();
  P=RenoPlan.build(planInput(ctx)); // 用当前计划算材料、验收、漏项
  if(hasFc&&!ctx.locked&&!state.dirty.size&&Object.keys(saved).length)autoShift(ctx,P,work);
  const t=today(),phases=P.tasks.slice().sort((a,b)=>ORDER.indexOf(a.key)-ORDER.indexOf(b.key));
  const prog=tk=>{const ls=tk.lines||[],done=ls.filter(l=>l.stage==='done').length;return {total:ls.length,done,started:ls.some(l=>['ordered','arrived','scheduled','working','done'].includes(l.stage)),finished:ls.length>0&&done===ls.length};};
  const planned=phases.filter(tk=>state.plans[tk.key]);
  const lastEnd=planned.reduce((m,tk)=>!m||state.plans[tk.key].end>m?state.plans[tk.key].end:m,'');
  const slack=state.handover&&lastEnd?diff(add(parse(lastEnd),1),parse(state.handover)):null;
  const NAME=Object.fromEntries(phases.map(tk=>[tk.key,tk.name]));
  // 撞期：这道工序里各子单的执行人，在别的工地同一段时间有没有活
  const clash=tk=>{const pl=state.plans[tk.key];if(!pl)return [];const who=new Set(work.filter(w=>(tk.workOrders||[]).includes(w.id)).map(w=>String(w.assignee||'').trim().toLowerCase()).filter(Boolean));return state.busy.filter(b=>who.has(String(b.crew||'').trim().toLowerCase())&&b.start<=pl.end&&b.end>=pl.start);};
  const issues=[],tags=[];const push=(tag,x)=>{issues.push(x);tags.push(tag);};
  if(slack!=null&&slack<0)push('晚于交房',`比交房日 ${md(state.handover)} 晚 ${-slack} 天：要提前开工、加派人手，或和业主改交房日`);
  phases.forEach(tk=>clash(tk).forEach(b=>push('撞期',`撞期 ${b.contract_no}：${tk.name} ${md(state.plans[tk.key].start)}–${md(state.plans[tk.key].end)}，${b.crew} 那边 ${b.group_name} ${md(b.start)}–${md(b.end)}`)));
  phases.forEach(tk=>{const pl=state.plans[tk.key],g=prog(tk);if(pl&&!g.finished&&parse(pl.end)<t)push('超期',`超期：${tk.name} 计划 ${md(pl.end)} 完成，还有 ${g.total-g.done} 项没做完`);});
  (P.materials||[]).filter(m=>['late','soon'].includes(m.status)).forEach(m=>push('要下单',`${m.status==='late'?'已过':'快到'}最晚下单日：${m.name}（${m.label}）最晚 ${md(m.orderBy)} 下单${m.signNeeded?'（业主还没签名）':''}`));
  const span={};for(const tk of phases){const pl=state.plans[tk.key];if(pl)span[tk.key]={s:pl.start,e:pl.end,done:prog(tk).finished};}
  const rel=RenoPlan.relations?RenoPlan.relations(Object.keys(span)):{};
  if(mepCombined(ctx.project)&&span.masonry&&span.ceiling&&!span.masonry.done&&span.masonry.e<=span.ceiling.e)push('顺序冲突',`泥水 ${md(span.masonry.e)} 就做完，但天花 ${md(span.ceiling.e)} 才做完：地面铺砖要等天花完成（GB 50327 第 14.1.2 条），泥水要排到天花之后结束`);
  for(const [k,v] of Object.entries(rel))for(const d of v.after){if(span[k]&&span[d]&&!span[k].done&&span[k].s<=span[d].e)push('顺序冲突',`${NAME[k]} ${md(span[k].s)} 开始，但「${NAME[d]}」${md(span[d].e)} 才做完：要等它做完，或者把「${NAME[k]}」往后挪`);}
  phases.forEach(tk=>{const pl=state.plans[tk.key];if(!pl)return;for(const id of tk.workOrders||[]){const w=work.find(x=>x.id===id),fx=+w?.fixed_days||0;if(!fx)continue;
   const ls=tk.lines.filter(l=>l.work_order_id===id);if(ls.some(l=>['ordered','arrived','scheduled','working','done'].includes(l.stage)))continue;
   const fs=iso(add(parse(pl.end),-(fx-1)));if(fs<=iso(add(t,7)))push('子单天数',`${short(w.group_name)} 定 ${fx} 天（设计 + 定做 + 安装）：要在 ${md(pl.end)} 装好，最晚 ${md(fs)} 就要开始设计下单${fs<iso(t)?'，已经过了':''}`);}});
  // 预计对比：预计 = 店长确认的预计计划（没确认前跟实时一样）；实际 = 监理开工记录 / 这道工序全部做完的日期
  const cmp={};for(const tk of phases){const b=state.baseline?.[tk.key],g=prog(tk),its=(ctx.tracking?.items||[]).filter(i=>(tk.lines||[]).some(l=>l.work_order_id===i.work_order_id&&String(l.id)===String(i.line_id)));
   const siteS=(tk.workOrders||[]).map(id=>state.siteActual?.[id]?.start).filter(Boolean).sort()[0];
   const as=siteS||its.filter(i=>i.scheduled_on&&['working','done'].includes(i.stage)).map(i=>String(i.scheduled_on).slice(0,10)).sort()[0]||null;
   const ae=g.finished?(its.map(i=>i.done_on&&String(i.done_on).slice(0,10)).filter(Boolean).sort().pop()||null):null;
   const end=g.finished&&ae?ae:state.plans[tk.key]?.end;const delta=b?.end&&end?diff(parse(b.end),parse(end)):null;
   cmp[tk.key]={bs:b?.start,be:b?.end,as,ae,all:g.finished,delta};
   if(delta>0&&!g.finished)push('比预计晚',`${tk.name} 预计 ${md(b.end)} 完成，现在 ${md(end)}，晚 ${delta} 天`);}
  state.summary={lastEnd,slack,issues:issues.length};
  const sumEl=document.getElementById('plan-summary');
  if(sumEl)sumEl.innerHTML=lastEnd?`计划 ${E(md(lastEnd))} 完工${slack!=null?(slack<0?` · <b class="bad">晚 ${-slack} 天</b>`:` · 余 ${slack} 天`):''}${issues.length?` · <b class="bad">⚠ ${issues.length} 件要处理</b>`:''}`:'还没排期';
  const toHand=state.handover?diff(t,parse(state.handover)):null,doneN=phases.filter(tk=>prog(tk).finished).length;
  const be=Object.values(state.baseline||{}).map(b=>b.end).sort().pop();
  let html=`<div class="sch"><div class="sch-kpis">
   <div class="sch-kpi ${slack==null?'':slack<0?'bad':'ok'}"><small>${fv?'预计完工':'实时完工'}</small><b>${fv&&be?E(md(be)):lastEnd?E(md(lastEnd)):'未排期'}</b><span class="sch-headline">${!fv&&be&&lastEnd&&be!==lastEnd?`预计 ${E(md(be))} · `:fv&&lastEnd&&be!==lastEnd?`实时 ${E(md(lastEnd))} · `:''}${slack==null?'':slack<0?`<b class="bad">⚠ 比交房日 ${E(md(state.handover))} 晚 ${-slack} 天</b>`:`<b class="ok">交房前余 ${slack} 天</b>`}</span></div>
   <div class="sch-kpi"><small>交房日</small><b>${state.handover?E(md(state.handover)):'未定'}</b><span>${toHand==null?'在右边填交房日':toHand>=0?`还有 ${toHand} 天`:`已过 ${-toHand} 天`}</span></div>
   <div class="sch-kpi"><small>进度</small><b>${doneN} / ${phases.length}</b><span>道工序已完成</span></div>
  </div><div class="sch-head">${state.dirty.size||state.handoverDirty?`<span class="fx-chip now">有改动还没保存</span>`:'<span></span>'}`;
  if(!ctx.locked)html+=`<div class="sch-tools"><label>开工日<input type="date" data-sch-start value="${E(state.startOn)}"></label><label>交房日<input type="date" data-sch-handover value="${E(state.handover)}"></label><button type="button" class="secondary" data-sch-auto>${planned.length?'按工序重新排':'按工序自动排期'}</button><button type="button" data-sch-save ${state.dirty.size||state.handoverDirty?'':'disabled'}>保存计划</button></div>`;
  html+='</div>';
  if(hasFc&&planned.length&&!ctx.locked){
   const who=ctx.project.phase_baseline_locked_at?String(ctx.project.phase_baseline_locked_at).slice(5,10).replace('-','/'):'';
   html+=fcLocked?`<div class="sch-fc"><div class="sch-views" role="tablist" aria-label="哪一套计划"><button type="button" data-sch-view="live" aria-pressed="${!fv}">实时计划（现场）</button><button type="button" data-sch-view="forecast" aria-pressed="${fv}">预计计划（业主看）</button></div><span class="muted">${fv?`预计计划 ${E(who)} 已确认锁定，业主链接显示的就是它。${ctx.manager?'点横条可以改（要写原因）。':'只有店长能改。'}`:'实时计划：现场在跑的计划，店里随时调；监理报延误后，后面的工序自动顺延。灰线是预计计划。'}</span></div>`
    :`<div class="sch-fc warn"><span>预计计划还没确认：现在预计 = 实时。确认后锁定，业主链接显示确认的预计计划；之后实时计划随现场变，预计计划只有店长能改。</span>${ctx.manager?`<button type="button" data-sch-confirm ${state.dirty.size?'disabled title="先保存计划"':''}>确认预计计划</button>`:'<b>请店长确认</b>'}</div>`;}
  if(state.autoNote)html+=`<p class="sch-autonote">${E(state.autoNote)}</p>`;
  if(!hasPhaseCol&&!ctx.locked)html+='<p class="warning">按工序保存要先在 Supabase 运行 renovation_phase_plan_migration.sql（现在显示的是按子单日期推算的计划）。</p>';
  const it=(x,i)=>`<li><span class="sch-tag">${E(tags[i])}</span>${E(x)}</li>`;
  if(issues.length)html+=`<div class="sch-issues"><b>要处理（${issues.length}）</b><ul>${issues.slice(0,3).map(it).join('')}</ul>${issues.length>3?`<details><summary>还有 ${issues.length-3} 条</summary><ul>${issues.slice(3).map((x,i)=>it(x,i+3)).join('')}</ul></details>`:''}</div>`;
  if(!planned.length){html+=`<p class="muted sch-empty">还没有排期。填开工日（和交房日），点「按工序自动排期」：系统把合同项目按工序归类（同一工序一个工种一次进场），按 拆除 → 水路 / 电路预埋（同期） → 泥水 / 天花 → 铺瓷砖 → 油漆 → 定制柜 / 台面门窗 → 水路 / 电路安装、五金窗帘 → 清洁 的先后排好；定制和门窗会等生产 / 复尺。排好后可以拖动调整。</p>${extras(P)}</div>`;el.innerHTML=html;afterRender(el,ctx);return;}
  const ms=(P.milestones||[]).filter(m=>m.on);
  const bl=Object.values(state.baseline||{}).filter(x=>x?.start);
  const from=add([...planned.map(tk=>parse(state.plans[tk.key].start)),...(P.materials||[]).filter(m=>m.orderBy).map(m=>parse(m.orderBy)),...bl.map(x=>parse(x.start)),t,...ms.map(m=>parse(m.on))].reduce((a,b)=>a<b?a:b),-2);
  const to=add([...planned.map(tk=>parse(state.plans[tk.key].end)),...bl.map(x=>parse(x.end)),t,...(state.handover?[parse(state.handover)]:[]),...ms.map(m=>parse(m.on))].reduce((a,b)=>a>b?a:b),5);
  const days=diff(from,to)+1,phone=innerWidth<=600,avail=(el.clientWidth||900)-(phone?108:160)-36;
  // 始终画全周期。z=1 压进一屏；放大（＋ / 滚轮 / 点月份）还是全周期，只是拉宽、可左右滑
  const fit=Math.min(30,Math.max(0.15,(avail-(Object.keys(state.baseline||{}).length?100:42))/days));
  const z=Math.max(1,Math.min(state.z||1,64/fit));state.z=z;const dw=fit*z,view=z<=1.001?'all':'zoom',compact=dw<10;
  const monthAt=new Set();for(let i=0;i<days;i++){const d=add(from,i);if(d.getUTCDate()===1)monthAt.add(i);}
  {const firstM=[...monthAt][0];if(firstM===undefined||firstM*dw>=48)monthAt.add(0);}
  const nearMonth=i=>dw*7<30||[...monthAt].some(m=>m!==i&&Math.abs(m-i)*dw<46);
  let ticks='';for(let i=0;i<days;i++){const d=add(from,i);const first=monthAt.has(i);if(((d.getUTCDay()===1&&!nearMonth(i))||first)&&(i*dw<days*dw-26||i===0))ticks+=first&&d.getUTCDate()===1?`<span class="sch-tick m sch-mclick" style="left:${i*dw}px" data-sch-month="${i}" data-sch-mdays="${new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()}" role="button" tabindex="0" title="点一下放大看 ${d.getUTCMonth()+1} 月">${d.getUTCMonth()+1}月${d.getUTCDate()}</span>`:`<span class="sch-tick${first?' m':''}" style="left:${i*dw}px">${first?`${d.getUTCMonth()+1}月`:''}${d.getUTCDate()}</span>`;}
  const sundays=[];for(let i=0;i<days;i++)if(add(from,i).getUTCDay()===0)sundays.push(`<i style="left:${i*dw}px;width:${dw}px"></i>`);
  // 表格虚线：每周一一条细虚线，每月 1 号一条深一点的虚线
  for(let i=1;i<days;i++){const d=add(from,i);if(d.getUTCDate()===1)sundays.push(`<b class="m" style="left:${i*dw}px"></b>`);else if(d.getUTCDay()===1&&dw*7>=14)sundays.push(`<b style="left:${i*dw}px"></b>`);}
  const matsBy=new Map((P.materials||[]).map(m=>[m.id,m]));
  const relText=tk=>{const r=rel[tk.key];if(!r)return '';const par=r.parallel.filter(x=>span[x]).map(x=>NAME[x]);return par.length?`<b class="sch-par" title="${tk.key==='masonry'||tk.key==='ceiling'?'砌墙、批荡、防水可与天花同期；铺瓷砖要等泥水和天花都完成（GB 50327 第 14.1.2 条）':''}">可与 ${E(par.join('、'))} 同期${tk.key==='masonry'&&!span.tile?'（地面铺砖等天花完）':''}</b>`:r.after.length?`等 ${E(r.after.map(x=>NAME[x]).join('、'))} 做完`:'先做';};
  // 一行一道工序：横条是这道工序的计划（一个工种一次进场）；展开看这道工序要做的全部项目和来自哪张子单
  const row=(tk,k)=>{
   const pl=(fv?state.baseline:state.plans)[tk.key],g=prog(tk),c=cmp[tk.key]||{};
   const bad=clash(tk).length||(pl&&!g.finished&&parse(pl.end)<t);
   let barHtml='<span class="sch-none">未排期</span>';
   if(pl){const s0=parse(pl.start),e0=parse(pl.end),left=diff(from,s0)*dw,width=(diff(s0,e0)+1)*dw,n=diff(s0,e0)+1,cls=g.finished?'done':e0<t?'late':g.started?'active':'wait',inside=!compact&&width>=34,pct=g.total?Math.round(100*g.done/g.total):0;
    const txt=width>=120?`${n}天 · ${md(pl.start)}–${md(pl.end)}`:`${n}天`;
    barHtml=`<div class="sch-bar sch-phase ${cls} tr-${TRADE[tk.trade]||'other'}${state.dirty.has(tk.key)?' dirty':''}${tk.critical&&!g.finished?' crit':''}" data-sch-bar="${tk.key}" style="left:${left}px;width:${width}px" title="${E(tk.name)}（${E(tk.trade)}）：${pl.start} → ${pl.end}，按工程量约 ${tk.days} 个工作日${tk.why?`；${E(tk.why)}`:''}。点一下调整日期，拖动整条挪，拖右端改完成日"><i style="width:${pct}%"></i>${inside?`<span>${g.finished?'✓ ':''}${E(txt)}</span>`:''}${ctx.locked||fv?'':'<b data-sch-end aria-hidden="true"></b>'}</div>${inside?'':`<span class="sch-days${cls==='late'?' bad':''}" style="left:${left+width+4}px">${g.finished?'✓ ':''}${n}天</span>`}`;}
   const vtxt=c.delta>0?`<em class="sch-var bad">晚${c.delta}天</em>`:c.delta<0?`<em class="sch-var ok">提前${-c.delta}天</em>`:c.delta===0?'<em class="sch-var">按预计</em>':'';
   const baseLine=!fv&&c.bs&&c.be?`<span class="sch-base" style="left:${diff(from,parse(c.bs))*dw}px;width:${(diff(parse(c.bs),parse(c.be))+1)*dw}px" title="预计 ${E(c.bs)} → ${E(c.be)}"></span>`:'';
   const actEnd=c.all&&c.ae?c.ae:(c.as?iso(t):null),actLine=c.as&&actEnd&&actEnd>=c.as?`<span class="sch-act${c.all?' done':''}" style="left:${diff(from,parse(c.as))*dw}px;width:${(diff(parse(c.as),parse(actEnd))+1)*dw}px" title="实际 ${E(c.as)} → ${c.all?E(c.ae):'进行中'}"></span>`:'';
   const m=matsBy.get(tk.key),mk=m&&m.orderBy&&!['ordered','arrived'].includes(m.status)?`<span class="sch-mat ${m.status==='late'?'bad':m.status==='soon'?'soon':''}" style="left:${diff(from,parse(m.orderBy))*dw}px" title="材料：${E(m.label)} 最晚 ${E(m.orderBy)} 下单（到货约 ${m.lead} 天）"></span>`:'';
   // 定做的工序（定制柜、台面门窗、浴室柜等）：横条前面画一段「工厂定做」，从下单到到货，后面才是现场安装
   let prod='';if(m&&pl&&m.lead){const ps=add(parse(pl.start),-m.lead),pw=m.lead*dw,arr=m.status==='arrived';
    const ptxt=arr?'已到货':m.status==='ordered'?`已下单 · 生产中`:`工厂定做 ${m.lead}天`;
    prod=`<span class="sch-prod${arr?' done':m.status==='late'?' bad':''}" style="left:${diff(from,ps)*dw}px;width:${pw}px" title="${E(m.label)}：${arr?'已到货':m.status==='ordered'?'已下单，工厂生产中':`最晚 ${E(iso(ps))} 下单`}，工厂定做 / 到货约 ${m.lead} 天，到货后现场安装">${pw>=86?`<em>${E(ptxt)}</em>`:''}</span>`;}
   // 展开：这道工序涉及的每张子单——履约进度、执行人、子单日期、固定总天数（设计 + 定做 + 安装）
   const open=state.open.has(tk.key),subs=open?`<div class="sch-items"><b>${E(tk.name)} · ${E(tk.trade)}一次进场 · 涉及 ${tk.workOrders.length} 张子单</b>${tk.workOrders.map(id=>{const w=work.find(x=>x.id===id);if(!w)return '';
     const ls=tk.lines.filter(l=>l.work_order_id===id),dn=ls.filter(l=>l.stage==='done').length,cnt={};ls.forEach(l=>cnt[l.stage]=(cnt[l.stage]||0)+1);
     const fx=+w.fixed_days||0,fs=fx&&pl?iso(add(parse(pl.end),-(fx-1))):null,started=ls.some(l=>['ordered','arrived','scheduled','working','done'].includes(l.stage));
     const fxTxt=fx&&!(m&&m.lead)?`定 ${fx} 天施工`:fx?(pl?`定 ${fx} 天：最晚 <b class="${!started&&fs<iso(t)?'bad':''}">${E(md(fs))}</b> 开始设计 / 下单 → ${E(md(pl.end))} 装好${!started&&fs<iso(t)?'（已过）':''}`:`定 ${fx} 天`):(m&&m.lead?`按常规：工厂定做约 ${m.lead} 天 + 安装 ${tk.days} 天`:`按工程量：约 ${tk.days} 天`);
     return `<div class="sch-wo"><div class="sch-wo-head"><b>${E(short(w.group_name))}</b><span>执行人 ${E(w.assignee||'未指定')}</span><span class="${dn===ls.length&&ls.length?'ok':''}">履约 ${dn}/${ls.length} 完成${Object.entries(cnt).filter(([k])=>k!=='done').map(([k,n])=>` · ${E(STAGE[k]||k)} ${n}`).join('')}</span>${w.planned_start?`<span>子单 ${E(md(String(w.planned_start).slice(0,10)))}–${E(md(String(w.planned_end).slice(0,10)))}</span>`:''}<button type="button" class="secondary sch-go" data-sch-gowo="${E(id)}">打开子单 ›</button></div>
      <div class="sch-wo-days"><span>${fxTxt}</span>${ctx.locked?'':`<label>${m&&m.lead?'总天数（设计 + 定做 + 安装）':'施工天数'}<input type="number" min="1" max="365" inputmode="numeric" data-sch-days="${E(id)}" value="${fx||''}" placeholder="不固定"> 天</label><button type="button" class="secondary" data-sch-dsave="${E(id)}">保存天数</button>`}</div>
      <ul>${ls.map(l=>`<li><span>${E(l.name)}${l.spec?` <small>${E(l.spec)}</small>`:''}</span><small>${E(l.qty??'')} ${E(l.unit)}</small><em class="st-${l.stage}">${E(STAGE[l.stage]||l.stage)}</em></li>`).join('')}</ul></div>`;}).join('')}</div>`:'';
   return `<div class="sch-row sch-phase-row"><button type="button" class="sch-label" data-sch-phase="${tk.key}" aria-expanded="${open}"><span>${k+1}. ${E(tk.name)}${bad?'<i class="sch-dot"></i>':''}</span><small>${m&&m.lead?`工厂定做 ${m.lead}天 → `:''}${E(tk.trade)}${m&&m.lead?'安装':''} · ${relText(tk)} ${open?'▾':'▸'}</small></button><div class="sch-lane"><div class="sch-sun">${sundays.join('')}</div>${baseLine}${prod}${barHtml}${actLine}${mk}${vtxt&&pl?`<span class="sch-vpos" style="left:${(diff(from,parse(pl.end))+1)*dw+46}px">${vtxt}</span>`:''}</div></div>${subs}${editor(tk)}`;
  };
  const editor=tk=>fv?(state.editingPhase===tk.key&&ctx.manager&&!ctx.locked?`<div class="sch-edit sch-phase-edit sch-fc-edit"><b>改「${E(tk.name)}」的预计计划（业主看到的日期）</b><div class="sch-edit-row" data-sch-pe="${tk.key}"><label>开始<input type="date" data-sch-es value="${E(state.baseline[tk.key]?.start||'')}"></label><label>完成<input type="date" data-sch-ee value="${E(state.baseline[tk.key]?.end||'')}"></label><label class="sch-reason">原因（必填）<input data-sch-reason maxlength="300" placeholder="如：业主加项 / 业主要求延期"></label><button type="button" data-sch-bok="${tk.key}">保存预计计划</button><button type="button" class="secondary" data-sch-cancel>取消</button></div><span class="muted">保存后业主链接马上更新，并记入调整记录（谁、为什么、从几号到几号）</span></div>`:''):state.editingPhase===tk.key&&!ctx.locked?`<div class="sch-edit sch-phase-edit"><b>调整「${E(tk.name)}」的日期（${E(tk.trade)}一次进场）</b><div class="sch-edit-row" data-sch-pe="${tk.key}"><label>开始<input type="date" data-sch-es value="${E(state.plans[tk.key]?.start||'')}"></label><label>完成<input type="date" data-sch-ee value="${E(state.plans[tk.key]?.end||'')}"></label><button type="button" data-sch-pok="${tk.key}">确定</button><button type="button" class="secondary" data-sch-cancel>取消</button></div><span class="muted">改好后点上面的「保存计划」才会保存，并记入调整记录</span></div>`:'';
  const msRow=ms.length?`<div class="sch-row sch-ms"><div class="sch-label"><span>验收节点</span><small>$ = 可收款</small></div><div class="sch-lane"><div class="sch-sun">${sundays.join('')}</div>${ms.map((m,k)=>`<span class="sch-dia${m.pay?' pay':''}${k%2?' low':''}" style="left:${diff(from,parse(m.on))*dw+dw/2}px" title="${E(m.on+' '+m.name+(m.pay?`；收款：${m.pay.name} ${money(m.pay.amount)}`:''))}">◆<em>${E(m.short||'')}${m.pay?' $':''}</em></span>`).join('')}</div></div>`:'';
  const hx=state.handover?`<div class="sch-hand${Math.abs(diff(from,parse(state.handover))-diff(from,t))*dw<44?' flip':''}" style="left:calc(var(--label) + ${diff(from,parse(state.handover))*dw+dw/2}px)" title="交房日 ${E(state.handover)}"><span>交房</span></div>`:'';
  html+=`<div class="sch-views" role="group" aria-label="看板范围"><button type="button" data-sch-zoom="fit" aria-pressed="${view==='all'}">全周期</button><button type="button" data-sch-zoom="out" aria-label="缩小" ${view==='all'?'disabled':''}>－</button><button type="button" data-sch-zoom="in" aria-label="放大">＋</button><span class="muted">${E(iso(from).replace(/-/g,'/'))} – ${E(iso(to).replace(/-/g,'/'))} · 共 ${days} 天 · 点月份看那个月；鼠标在日期那一行滚轮缩放（图上按住 Ctrl / ⌘ 滚轮也可以）</span></div><div class="sch-scroll${view==='all'?' sch-fit':''}"><div class="sch-grid${compact?' sch-compact':''}${dw<6?' sch-tiny':''}" style="--w:${days*dw}px"><div class="sch-row sch-axis"><div class="sch-label"></div><div class="sch-lane">${ticks}</div></div>
   ${phases.map(row).join('')}${msRow}
   <div class="sch-today" style="left:calc(var(--label) + ${diff(from,t)*dw+dw/2}px)" title="今天"><span>今天</span></div>${hx}</div></div>
   <p class="muted sch-hint">${ctx.locked?'':'按「工序 → 工种 → 流程」排：一行一道工序，合同里同一工序的项目（不管在哪张子单）一个工种一次进场做完。点工序名看要做的项目；点横条调整日期；拖动横条整道工序挪。◆ = 材料最晚下单日。'}${[...new Set(planned.map(tk=>tk.trade))].map(x=>`<span class="sch-key tr-${TRADE[x]||'other'}"></span>${E(x)}`).join(' ')}<br><span class="sch-key base"></span>预计 <span class="sch-key prod"></span>斜纹 = 工厂定做（下单到到货） <span class="sch-key act"></span>实际 <span class="sch-key late"></span>红框 = 超期 <span class="sch-key active"></span>深色 = 已做的部分 · 变淡打 ✓ = 已完成 <span class="sch-key crit"></span>卡完工的工序（它晚一天，交房就晚一天）</p>${extras(P)}<details class="sch-box" id="sch-log"><summary>调整记录</summary><div data-sch-log>${logHtml()}</div></details></div>`;
  const keep=el.querySelector('.sch-scroll')?.scrollLeft;
  el.innerHTML=html;el.dataset.dw=dw;
  const sc=el.querySelector('.sch-scroll');if(sc){const lab=el.querySelector('.sch-label')?.offsetWidth||150;
   if(state.anchor){sc.scrollLeft=Math.max(0,lab+state.anchor.day*dw-state.anchor.px);state.anchor=null;}
   else if(state.monthAt!=null){sc.scrollLeft=Math.max(0,state.monthAt*dw);state.monthAt=null;}
   else sc.scrollLeft=keep!=null&&state.scrolled?keep:Math.max(0,diff(from,t)*dw-lab-3*dw);state.scrolled=true;}
  el.dataset.fit=fit;el.dataset.days=days;
  state.P=P;state._rerender=()=>render(el,ctx);
  afterRender(el,ctx);
 }
// 调整记录：谁、什么时候、把什么从几号改到几号（从项目操作记录里读）
 function logHtml(){
  if(!state?.log)return '<p class="muted">正在读取…</p>';
  if(!state.log.length)return '<p class="muted">还没有调整过。</p>';
  const f=d=>d?md(String(d).slice(0,10)):'未排';
  return `<ul class="sch-list">${state.log.map(a=>{const at=new Date(a.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Kuala_Lumpur',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}),pl=a.payload||{};
   if(a.action==='handover_date_saved')return `<li><b>${E(at)}</b>${pl.by?' · '+E(pl.by):''} · 交房日 ${E(f(pl.before))} → <b>${E(f(pl.on))}</b></li>`;
   if(a.action==='work_order_days_saved')return `<li><b>${E(at)}</b>${pl.by?' · '+E(pl.by):''} · 子单「${E(String(pl.name||'').replace(/^增项-[0-9a-f-]{36} · ?/i,'增项 · '))}」总天数 ${pl.before?E(pl.before)+' 天':'不固定'} → <b>${pl.days?E(pl.days)+' 天':'不固定'}</b></li>`;
   if(a.action==='phase_baseline_confirmed')return `<li><b>${E(at)}</b>${pl.by?' · '+E(pl.by):''} · <b>确认预计计划</b>（锁定，业主链接显示）</li>`;
   if(a.action==='phase_baseline_changed'){const nm=k=>(window.RenoPlan?.PHASES||[]).find(p=>p.key===k)?.name||k;const items=(pl.changes||[]).map(x=>`${E(nm(x.phase))}：${x.before_start?`${E(f(x.before_start))}–${E(f(x.before_end))} → `:''}<b>${x.start?`${E(f(x.start))}–${E(f(x.end))}`:'取消'}</b>`);
    return `<li><b>${E(at)}</b>${pl.by?' · '+E(pl.by):''} · <b>改预计计划</b>，原因：${E(pl.reason||'')}<br><small>${items.join('；')}</small></li>`;}
   if(a.action==='phase_plan_saved'){const nm=k=>(window.RenoPlan?.PHASES||[]).find(p=>p.key===k)?.name||k;const items=(pl.changes||[]).map(x=>`${E(nm(x.phase))}：${x.before_start?`${E(f(x.before_start))}–${E(f(x.before_end))} → `:''}<b>${x.start?`${E(f(x.start))}–${E(f(x.end))}`:'取消排期'}</b>`);
    return `<li><b>${E(at)}</b>${pl.by?' · '+E(pl.by):''} · ${pl.auto_delay?'监理报延误，自动顺延':'实时计划'}调整 ${items.length} 道工序<br><small>${items.join('；')}</small></li>`;}
   const items=(pl.plans||[]).map(x=>`${E(x.name||'子单')}：${x.before_start!==undefined?`${E(f(x.before_start))}–${E(f(x.before_end))} → `:''}<b>${E(f(x.start))}–${E(f(x.end))}</b>`);
   const by=(pl.plans||[]).find(x=>x.by)?.by;
   return `<li><b>${E(at)}</b>${by?' · '+E(by):''} · 调整 ${items.length} 张子单<br><small>${items.join('；')}</small></li>`;}).join('')}</ul>`;
 }
 async function loadLog(ctx){
  if(!state||state.log||state.logLoading||!ctx.sb||!ctx.project?.id)return;state.logLoading=true;
  try{const {data}=await ctx.sb.from('renovation_audit').select('action,created_at,payload').eq('project_id',ctx.project.id).in('action',['work_order_days_saved','phase_plan_saved','phase_baseline_confirmed','phase_baseline_changed','schedule_saved','handover_date_saved']).order('created_at',{ascending:false}).limit(300);
   const all=(data||[]).slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));state.log=all.slice(0,30);
  }
  catch(e){state.log=[];}
  // 实际开工 / 完工：监理的「开工」「完工」记录
  try{const {data,error}=await ctx.sb.from('renovation_site_entries').select('work_order_id,kind,on_date').eq('project_id',ctx.project.id).in('kind',['start','finish']).order('on_date',{ascending:true}).limit(500);
   const act={};if(!error)for(const e of data||[]){if(!e.work_order_id)continue;const a=act[e.work_order_id]||(act[e.work_order_id]={});const d=String(e.on_date).slice(0,10);if(e.kind==='start'&&(!a.start||d<a.start))a.start=d;if(e.kind==='finish'&&(!a.end||d>a.end))a.end=d;}
   state.siteActual=act;}catch(e){state.siteActual={};}
  try{const {data,error}=await ctx.sb.from('renovation_site_entries').select('id,work_order_id,on_date,data,status').eq('project_id',ctx.project.id).eq('kind','delay').order('created_at',{ascending:true}).limit(200);state.delays=error?[]:data||[];}catch(e){state.delays=[];}
  finally{state.logLoading=false;}
  const rr=state._rerender;state._rerender=null;rr?.();
  const box=document.querySelector('#schedule [data-sch-log]');if(box)box.innerHTML=logHtml();
 }
 // 材料下单 / 验收节点 / 漏项检查 / 师傅名单
 function extras(P){
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
  loadLog(ctx);
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
  // 缩放：以某个位置（鼠标，或者画面中间）为中心，放大后这个日期还在原来的位置
  const zoomAt=(factor,clientX)=>{const sc=el.querySelector('.sch-scroll');if(!sc)return;const lab=el.querySelector('.sch-label')?.offsetWidth||150,dw=+el.dataset.dw||1,r=sc.getBoundingClientRect();
   const px=clientX==null?lab+(sc.clientWidth-lab)/2:Math.max(lab,clientX-r.left);state.anchor={day:(sc.scrollLeft+px-lab)/dw,px};state.z=Math.max(1,(state.z||1)*factor);};
  const openMonth=mt=>{const sc=el.querySelector('.sch-scroll'),lab=el.querySelector('.sch-label')?.offsetWidth||150,fit=+el.dataset.fit||1;
   state.z=Math.max(1,(sc.clientWidth-lab-12)/((+mt.dataset.schMdays||30)*fit));state.monthAt=+mt.dataset.schMonth;rerender();};
  el.addEventListener('click',e=>{const mt=e.target.closest('[data-sch-month]');if(mt&&el.contains(mt)){e.stopPropagation();openMonth(mt);}},true);
  el.addEventListener('keydown',e=>{const mt=e.target.closest?.('[data-sch-month]');if(mt&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openMonth(mt);}});
  // 滚轮：鼠标在日期那一行上直接缩放；在图上按住 Ctrl / ⌘（或触控板双指捏合）缩放；其他时候照常上下翻页
  let wheelAcc=0,wheelX=0,wheelRaf=0;
  el.addEventListener('wheel',e=>{if(!e.target.closest('.sch-scroll'))return;if(!e.target.closest('.sch-axis')&&!e.ctrlKey&&!e.metaKey)return;
   e.preventDefault();wheelAcc+=e.deltaY;wheelX=e.clientX;if(wheelRaf)return;
   wheelRaf=requestAnimationFrame(()=>{wheelRaf=0;const f=Math.exp(-wheelAcc*0.003);wheelAcc=0;if(Math.abs(f-1)<0.01)return;zoomAt(f,wheelX);rerender();});},{passive:false});
  // 手机转横屏 / 窗口变大变小：「全局」按新宽度重画，从开工到完工始终一屏放下
  let rz=null,lastW=innerWidth;addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(()=>{if(innerWidth===lastW)return;lastW=innerWidth;if((state?.z||1)<=1.001&&el.querySelector('.sch-grid')&&ctx.data().project)rerender();},150);});
  const setPlan=(id,start,end)=>{state.plans[id]={start,end};state.dirty.add(id);};
  el.addEventListener('click',async e=>{
   const b=e.target.closest('button');if(!b||!el.contains(b))return;const d=b.dataset;
   try{
    if('schZoom' in d){if(d.schZoom==='fit'){state.z=1;state.scrolled=false;}else zoomAt(d.schZoom==='in'?1.6:1/1.6,null);rerender();return;}
    if('schAuto' in d){
     const data=ctx.data(),P=RenoPlan.build({...planInput(data),fixed:Object.fromEntries(Object.entries(state.plans).filter(([,v])=>v))});
     const todo=P.tasks.filter(x=>!x.done);
     if(!todo.length){ctx.message('没有可以排期的工序（都已完成或只有赠品）。',true);return;}
     todo.forEach(x=>setPlan(x.key,x.start,x.end));rerender();
     ctx.message(`已按工序先后和合计工程量排好（同一工种一次进场，能同期的同时开工）：计划 ${P.finish} 完工${P.handover?(P.handover.late?`，比交房日晚 ${-P.handover.slack} 天`:`，比交房日早 ${P.handover.slack} 天`):''}。看一下再点「保存计划」。`,!!P.handover?.late);
    }else if('schSave' in d){
     b.disabled=true;const data=ctx.data();
     if(state.dirty.size){
      const plan=Object.fromEntries([...state.dirty].map(k=>[k,state.plans[k]||null]));
      const ww=workWindows(state.P||RenoPlan.build(planInput(data)));const pWork=(data.work||[]).filter(w=>!w.cancelled_at&&ww[w.id]).map(w=>({work_order_id:w.id,start:ww[w.id].start,end:ww[w.id].end}));
      const {error}=await saveLive(ctx.sb,{p_id:data.project.id,p_plan:plan,p_work:pWork,p_lines:phaseLines(state.P||RenoPlan.build(planInput(data)))});
      if(error)throw new Error(/function|schema cache/i.test(error.message)?'按工序保存要先在 Supabase 运行 renovation_phase_plan_migration.sql':error.message);state.dirty.clear();state.autoNote='';}
     if(state.handoverDirty){const {error}=await ctx.sb.rpc('renovation_handover_date_save',{p_id:data.project.id,p_on:state.handover||null});if(error)throw new Error(/function|schema cache/i.test(error.message)?'交房日要先在 Supabase 运行 renovation_planning_migration.sql 才能保存；进度已保存。':error.message);state.handoverDirty=false;}
     state.log=null;await ctx.onChange();ctx.message(data.project.phase_baseline_locked_at?'实时计划已保存，已记入调整记录；各子单日期已按工序更新。业主看到的预计计划不变。':'施工计划已保存，已记入调整记录；各子单日期已按工序更新。店长点「确认预计计划」后，业主链接才显示进度计划。');
    }else if(d.schPhase){const n=d.schPhase;state.open.has(n)?state.open.delete(n):state.open.add(n);rerender();}
    else if(d.schPok){const row=b.closest('[data-sch-pe]'),s=row.querySelector('[data-sch-es]').value,en=row.querySelector('[data-sch-ee]').value;
     if(!s||!en)throw new Error('请把开始和完成日期都填上');if(en<s)throw new Error('完成日期不能早于开始日期');const o=state.plans[d.schPok];if(!o||o.start!==s||o.end!==en)setPlan(d.schPok,s,en);state.editingPhase=null;rerender();}
    else if(d.schDsave){const inp=el.querySelector(`[data-sch-days="${d.schDsave}"]`),v=inp.value.trim(),n=v?Math.round(+v):null;
     if(v&&!(n>=1&&n<=365))throw new Error('天数要在 1 到 365 之间，不固定就留空');
     b.disabled=true;const {error}=await ctx.sb.rpc('renovation_work_order_days_save',{p_work_order:d.schDsave,p_days:n});if(error){b.disabled=false;throw new Error(/function|schema cache/i.test(error.message)?'要先在 Supabase 运行 renovation_work_order_days_migration.sql':error.message);}
     state.log=null;await ctx.onChange();ctx.message(n?`已定 ${n} 天（设计 + 定做 + 安装）。工厂定做那段和「最晚开始设计下单」已按 ${n} 天重新算；要整体重排请点「按工序重新排」。`:'已改回不固定天数。');}
    else if(d.schGowo){const id=d.schGowo;document.querySelector('.steps a[href="#work-orders"]')?.click();setTimeout(()=>{const c=document.querySelector(`#work-orders details.work[data-wid="${CSS.escape(id)}"]`);if(c){c.open=true;c.scrollIntoView({behavior:'smooth',block:'start'});}},80);}
    else if(d.schView){state.view=d.schView;state.editingPhase=null;rerender();}
    else if('schConfirm' in d){b.disabled=true;const {error}=await ctx.sb.rpc('renovation_phase_baseline_confirm',{p_id:ctx.data().project.id});if(error)throw new Error(/function|schema cache/i.test(error.message)?'要先在 Supabase 运行 renovation_phase_forecast_migration.sql':error.message);state.log=null;await ctx.onChange();ctx.message('预计计划已确认锁定：业主链接显示这份计划。之后现场调整只改实时计划。');}
    else if(d.schBok){const row=b.closest('[data-sch-pe]'),s=row.querySelector('[data-sch-es]').value,en=row.querySelector('[data-sch-ee]').value,why=row.querySelector('[data-sch-reason]').value.trim();
     if(!s||!en)throw new Error('请把开始和完成日期都填上');if(en<s)throw new Error('完成日期不能早于开始日期');if(why.length<2)throw new Error('请写改预计计划的原因');
     b.disabled=true;const {error}=await ctx.sb.rpc('renovation_phase_baseline_change',{p_id:ctx.data().project.id,p_plan:{[d.schBok]:{start:s,end:en}},p_reason:why});if(error){b.disabled=false;throw error;}
     state.editingPhase=null;state.log=null;await ctx.onChange();ctx.message('预计计划已改，业主链接已更新，已记入调整记录。');}
    else if('schCancel' in d){state.editingPhase=null;rerender();}
   }catch(err){ctx.message(err.message||String(err),true);if(d.schSave!==undefined)b.disabled=false;}
  });
  el.addEventListener('change',e=>{
   if(e.target.matches('[data-sch-start]'))state.startOn=e.target.value;
   if(e.target.matches('[data-sch-handover]')){state.handover=e.target.value;state.handoverDirty=true;rerender();}
  });
  let drag=null;
  el.addEventListener('pointerdown',e=>{
   const bar=e.target.closest('[data-sch-bar]');if(!bar||ctx.data().locked||e.button!==0)return;
   const id=bar.dataset.schBar;if(state.view==='forecast'){if(ctx.data().manager){state.editingPhase=state.editingPhase===id?null:id;rerender();}else ctx.message('预计计划只有店长能改。',true);return;}
   const p=state.plans[id];if(!p)return;
   drag={id,bar,x:e.clientX,mode:e.target.closest('[data-sch-end]')?'end':'move',s:parse(p.start),e:parse(p.end),dw:+el.dataset.dw||20,moved:0,left:parseFloat(bar.style.left),width:parseFloat(bar.style.width)};
   bar.setPointerCapture(e.pointerId);e.preventDefault();
  });
  el.addEventListener('pointermove',e=>{
   if(!drag)return;const n=Math.round((e.clientX-drag.x)/drag.dw);if(n===drag.moved)return;drag.moved=n;
   if(drag.mode==='move')drag.bar.style.left=(drag.left+n*drag.dw)+'px';
   else drag.bar.style.width=Math.max(drag.dw,drag.width+n*drag.dw)+'px';
  });
  const end=()=>{
   if(!drag)return;const g=drag;drag=null;
   // 没拖动 = 点了一下：打开调整日期的框
   if(!g.moved){state.editingPhase=state.editingPhase===g.id?null:g.id;rerender();return;}
   if(g.mode==='move')setPlan(g.id,iso(add(g.s,g.moved)),iso(add(g.e,g.moved)));
   else{const ne=add(g.e,g.moved);setPlan(g.id,iso(g.s),iso(ne<g.s?g.s:ne));}
   rerender();
  };
  el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
 }
 // 整装首页：师傅名单（公司共用）。员工能看；店长及以上能新增、停用 / 恢复
 async function crewAdmin(el,ctx){
  if(!el)return;
  const TRADES=['水管工','电工','水电工','泥水工','瓷砖工','木工','油漆工','柜体安装队','厂家安装','杂工','清洁','其他'];
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
