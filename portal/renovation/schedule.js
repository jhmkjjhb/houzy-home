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
  let html=`<div class="sch"><div class="sch-head"><div class="sch-sum"><b>施工计划</b>${lastEnd?`<span>计划完工 <b>${E(md(lastEnd))}</b></span>`:''}${hand}<span>已完成 ${doneCount}/${rows.length} 张</span>${late.length?`<span class="fx-chip bad">⚠ ${late.length} 张超过计划完成日</span>`:''}${clashes?`<span class="fx-chip bad">⚠ ${clashes} 张师傅撞期</span>`:''}${state.dirty.size||state.handoverDirty?`<span class="fx-chip now">有改动还没保存</span>`:''}</div>`;
  if(!ctx.locked)html+=`<div class="sch-tools"><label>开工日<input type="date" data-sch-start value="${E(state.startOn)}"></label><label>交房日<input type="date" data-sch-handover value="${E(state.handover)}"></label><button type="button" class="secondary" data-sch-auto>${planned.length?'按工程量重新排':'按工程量自动排期'}</button><button type="button" data-sch-save ${state.dirty.size||state.handoverDirty?'':'disabled'}>保存计划</button></div>`;
  html+='</div>';
  if(!planned.length){html+=`<p class="muted sch-empty">还没有排期。填开工日（和交房日），点「按工程量自动排期」：系统按合同工程量算每道工序要几天，按 拆除 → 水电 → 泥水 → 天花木作 → 油漆 → 定制柜 → 台面门窗玻璃 → 洁具灯具 → 清洁 排好；定制和门窗会等生产 / 复尺。排好后可以拖动调整。</p>${extras(P,ctx,rows)}</div>`;el.innerHTML=html;afterRender(el,ctx);return;}
  const ms=(P?.milestones||[]).filter(m=>m.on);
  const from=add([...planned.map(r=>parse(r.plan.start)),t,...ms.map(m=>parse(m.on))].reduce((a,b)=>a<b?a:b),-2);
  const to=add([...planned.map(r=>parse(r.plan.end)),t,...(state.handover?[parse(state.handover)]:[]),...ms.map(m=>parse(m.on))].reduce((a,b)=>a>b?a:b),5);
  const days=diff(from,to)+1,dw=Math.max(14,Math.min(30,Math.floor(760/days)));
  const monthAt=new Set();for(let i=0;i<days;i++){const d=add(from,i);if(d.getUTCDate()===1||i===0)monthAt.add(i);}
  const nearMonth=i=>[...monthAt].some(m=>m!==i&&Math.abs(m-i)*dw<34);
  let ticks='';for(let i=0;i<days;i++){const d=add(from,i);const first=monthAt.has(i);if((d.getUTCDay()===1&&!nearMonth(i))||first)ticks+=`<span class="sch-tick${first?' m':''}" style="left:${i*dw}px">${first?`${d.getUTCMonth()+1}月`:''}${d.getUTCDate()}</span>`;}
  const sundays=[];for(let i=0;i<days;i++)if(add(from,i).getUTCDay()===0)sundays.push(`<i style="left:${i*dw}px;width:${dw}px"></i>`);
  const bar=r=>{
   if(!r.plan)return '<span class="sch-none">未排期</span>';
   const s=parse(r.plan.start),e=parse(r.plan.end),left=diff(from,s)*dw,width=(diff(s,e)+1)*dw;
   const cls=r.p.finished?'done':(e<t?'late':r.p.started?'active':'wait');
   const pct=r.p.total?Math.round(100*r.p.done/r.p.total):0;
   const tip=`${short(r.w.group_name)}：${r.plan.start} → ${r.plan.end}`+(r.info?`（${r.info.days} 个工作日，${r.info.trade}${r.info.why?`；${r.info.why}`:''}）`:'');
   return `<div class="sch-bar ${cls}${state.dirty.has(r.w.id)?' dirty':''}${r.info?.critical&&!r.p.finished?' crit':''}" data-sch-bar="${r.w.id}" style="left:${left}px;width:${width}px" title="${E(tip)}"><i style="width:${pct}%"></i><span>${E(md(r.plan.start))}–${E(md(r.plan.end))}</span>${ctx.locked?'':'<b data-sch-end aria-hidden="true"></b>'}</div>`;
  };
  const sub=r=>{const c=clash(r);const who=String(r.w.assignee||'').trim();
   return r.p.finished?'<small class="ok">✓ 已完成</small>':`<small>${r.info?E(r.info.trade)+' · ':''}${who?E(who)+' · ':''}${r.p.done}/${r.p.total} 项${r.plan&&parse(r.plan.end)<t?' · <span class="bad">超期</span>':''}${c.length?` · <span class="bad" title="${E(c.map(b=>`${b.contract_no} ${b.group_name} ${b.start}~${b.end}`).join('；'))}">撞期 ${E(c[0].contract_no)}</span>`:''}</small>`;};
  const editor=r=>state.editing===r.w.id&&!ctx.locked?`<div class="sch-edit"><label>开始<input type="date" data-sch-es value="${E(r.plan?.start||'')}"></label><label>完成<input type="date" data-sch-ee value="${E(r.plan?.end||'')}"></label><button type="button" data-sch-ok="${r.w.id}">确定</button><button type="button" class="secondary" data-sch-cancel>取消</button></div>`:'';
  const msRow=ms.length?`<div class="sch-row sch-ms"><div class="sch-label"><span>验收节点</span><small>◆ 对应收款</small></div><div class="sch-lane"><div class="sch-sun">${sundays.join('')}</div>${ms.map(m=>`<span class="sch-dia${m.pay?' pay':''}" style="left:${diff(from,parse(m.on))*dw+dw/2}px" title="${E(m.on+' '+m.name+(m.pay?`；收款：${m.pay.name} ${money(m.pay.amount)}`:''))}">◆</span>`).join('')}</div></div>`:'';
  const hx=state.handover?`<div class="sch-hand" style="left:calc(var(--label) + ${diff(from,parse(state.handover))*dw+dw/2}px)" title="交房日 ${E(state.handover)}"><span>交房</span></div>`:'';
  html+=`<div class="sch-scroll"><div class="sch-grid" style="--w:${days*dw}px"><div class="sch-row sch-axis"><div class="sch-label"></div><div class="sch-lane">${ticks}</div></div>
   ${rows.map(r=>`<div class="sch-row"><button type="button" class="sch-label" data-sch-name="${r.w.id}" ${ctx.locked?'disabled':''}><span>${E(short(r.w.group_name))}</span>${sub(r)}</button><div class="sch-lane"><div class="sch-sun">${sundays.join('')}</div>${bar(r)}</div></div>${editor(r)}`).join('')}${msRow}
   <div class="sch-today" style="left:calc(var(--label) + ${diff(from,t)*dw+dw/2}px)" title="今天"></div>${hx}</div></div>
   <p class="muted sch-hint">${ctx.locked?'':'拖动横条整体改日期，拖右端改完成日；手机上点子单名称改日期。'}<span class="sch-key wait"></span>未开始 <span class="sch-key active"></span>进行中 <span class="sch-key done"></span>已完成 <span class="sch-key late"></span>超期 <span class="sch-key crit"></span>关键工序（它晚一天，完工就晚一天） ◆ 验收节点</p>${extras(P,ctx,rows)}</div>`;
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
  const crews=state.crews.length?`<ul class="sch-list">${state.crews.map(c=>`<li><b>${E(c.name)}</b> · ${E(c.trade)} · ${c.headcount} 人${c.phone?` · ${E(c.phone)}`:''}${c.active?'':' · 已停用'}</li>`).join('')}</ul>`:'<p class="muted">还没有师傅名单。</p>';
  const crewForm=ctx.manager&&!ctx.locked?`<div class="work-controls sch-crew-form"><label>名称<input data-crew-f="name" maxlength="60" placeholder="例：阿强泥水队"></label><label>工种<select data-crew-f="trade">${['水电工','泥水工','木工','油漆工','柜体安装队','厂家安装','杂工','清洁','其他'].map(x=>`<option>${x}</option>`).join('')}</select></label><label>人数<input data-crew-f="headcount" type="number" min="1" max="50" value="2"></label><label>电话<input data-crew-f="phone" maxlength="40"></label><button type="button" data-crew-add>加入名单</button></div>`:'';
  return `<div class="sch-extras">
   <details class="sch-box" ${soon?'open':''}><summary>材料下单${soon?` <span class="fx-chip bad">${soon} 项要注意</span>`:''}</summary>${mats}</details>
   <details class="sch-box"><summary>验收节点 · ${P.milestones.length} 个</summary>${msl}</details>
   <details class="sch-box" ${P.checks.some(c=>c.level==='必查')?'open':''}><summary>漏项检查${P.checks.length?` <span class="fx-chip ${P.checks.some(c=>c.level==='必查')?'bad':'now'}">${P.checks.length} 条</span>`:' ✓'}</summary>${ck}</details>
   <details class="sch-box" ${state.crewOpen?'open':''} data-crew-box><summary>师傅名单 · ${state.crews.length}</summary>${crews}${crewForm}<p class="muted sch-note">子单的「执行人」填名单里的名字，系统才能查出跨工地撞期。</p></details></div>`;
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
   const [c,b]=await Promise.all([ctx.sb.from('renovation_crews').select('*').order('name'),
    ctx.sb.rpc('renovation_crew_busy',{p_names:[...new Set((ctx.work||[]).map(w=>String(w.assignee||'').trim()).filter(Boolean))],p_exclude:ctx.project.id})]);
   if(!c.error)state.crews=c.data||[];if(!b.error)state.busy=b.data||[];
  }catch(e){}finally{loading=false;}
  render(el,ctx);
 }
 function bind(el,ctx){
  const rerender=()=>render(el,{...ctx.data(),sb:ctx.sb});
  const setPlan=(id,start,end)=>{state.plans[id]={start,end};state.dirty.add(id);};
  el.addEventListener('click',async e=>{
   const b=e.target.closest('button');if(!b||!el.contains(b))return;const d=b.dataset;
   try{
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
    else if('crewAdd' in d){const f=k=>el.querySelector(`[data-crew-f="${k}"]`)?.value||'';
     if(!f('name').trim())throw new Error('请填写师傅 / 队伍名称');
     const {error}=await ctx.sb.rpc('renovation_crew_save',{p_id:null,p_data:{name:f('name'),trade:f('trade'),headcount:Number(f('headcount'))||1,phone:f('phone')}});if(error)throw error;
     state.loadedFor=null;state.crewOpen=true;ctx.message(`已把「${f('name').trim()}」加入师傅名单。`);rerender();}
   }catch(err){ctx.message(err.message||String(err),true);if(d.schSave!==undefined)b.disabled=false;}
  });
  el.addEventListener('toggle',e=>{if(e.target.matches?.('[data-crew-box]'))state.crewOpen=e.target.open;},true);
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
 return {render,bind};
})();
