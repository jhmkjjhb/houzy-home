'use strict';
// 进度表（甘特图）：每张子单一条横条。系统按常规施工顺序自动排一版，员工拖动横条改日期
// （拖中间 = 整条挪动，拖右端 = 改完成日；手机上点名称改日期），保存后业主链接里也能看到简版。
window.RenoSchedule=(()=>{
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const DAY=86400000;
 const parse=s=>s?new Date(String(s).slice(0,10)+'T00:00:00Z'):null;
 const iso=d=>d.toISOString().slice(0,10);
 const add=(d,n)=>new Date(d.getTime()+n*DAY);
 const diff=(a,b)=>Math.round((b-a)/DAY);
 const today=()=>parse(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'}));
 // 马来西亚工地一般周日休息：工期按「工作日」算，跳过周日
 const skipSunday=d=>{let x=d;while(x.getUTCDay()===0)x=add(x,1);return x;};
 const endAfter=(start,days)=>{let x=skipSunday(start),left=days-1;while(left>0){x=add(x,1);if(x.getUTCDay()!==0)left--;}return x;};
 const short=n=>String(n||'').replace(/^增项-[0-9a-f-]{36} · ?/i,'增项 · ');
 // 常规顺序：阶段一个接一个；同一阶段的子单同时做。天数是工作日，排出来后可以再拖改。
 const PHASES=[
  ['拆除',/拆除|拆旧|清运|敲/,3],
  ['水电',/水电|电线|电路|水管|管道|空调|冷气/,7],
  ['泥水',/泥水|泥瓦|瓷砖|铺砖|防水|砌|批荡|地砖|墙砖|找平/,12],
  ['木作天花',/木作|天花|石膏|吊顶|隔墙|木工/,8],
  ['油漆',/油漆|涂料|乳胶|漆/,6],
  ['定制安装',/定制|柜|台面|门|窗/,4],
  ['设备灯具',/卫浴|洁具|灯|开关|插座|五金|电器|窗帘|智能|锁|雨棚|车棚|安装/,3],
  ['清洁',/清洁|保洁|开荒/,2]
 ];
 const CUSTOM_LEAD=25; // 定制：业主签名后工厂生产约 25 天，安装不早于开工日 + 25 天
 function itemsOf(w,tracking){return (tracking?.items||[]).filter(i=>i.work_order_id===w.id&&i.stage!=='cancelled');}
 function phaseOf(w,items){
  // 先看子单名称（「卫浴洁具」里有「浴室柜」，按项目名会被误当成定制柜）；名称看不出来再看里面的项目
  const byName=PHASES.findIndex(p=>p[1].test(short(w.group_name)));if(byName>=0)return byName;
  const byItems=PHASES.findIndex(p=>p[1].test(items.map(i=>i.name).join(' ')));if(byItems>=0)return byItems;
  if(items.length&&items.every(i=>i.kind==='gift'))return -1;
  if(items.some(i=>i.kind==='custom'))return 5;
  if(items.some(i=>i.kind==='stock'))return 6;
  return 3;
 }
 function progress(w,tracking){
  const items=itemsOf(w,tracking),done=items.filter(i=>i.stage==='done').length;
  const started=items.some(i=>['ordered','arrived','scheduled','working','done'].includes(i.stage));
  return {items,total:items.length,done,started,finished:items.length>0&&done===items.length};
 }
 // 自动排：已全部完成的子单不动；赠品不排；返回 {work_order_id:{start,end}}
 function auto(work,tracking,startOn){
  const start=skipSunday(parse(startOn)||today()),plans={};
  const rows=work.filter(w=>!w.cancelled_at).map(w=>({w,p:progress(w,tracking)})).filter(r=>!r.p.finished).map(r=>({...r,phase:phaseOf(r.w,r.p.items)})).filter(r=>r.phase>=0);
  let cursor=start;
  for(let k=0;k<PHASES.length;k++){
   const inPhase=rows.filter(r=>r.phase===k);if(!inPhase.length)continue;
   let phaseEnd=cursor;
   for(const r of inPhase){
    let s=cursor;
    if(r.p.items.some(i=>i.kind==='custom')){const ready=skipSunday(add(start,CUSTOM_LEAD));if(ready>s)s=ready;}
    const e=endAfter(s,PHASES[k][2]);plans[r.w.id]={start:iso(s),end:iso(e)};if(e>phaseEnd)phaseEnd=e;
   }
   cursor=skipSunday(add(phaseEnd,1));
  }
  return plans;
 }
 let state=null; // {plans:{id:{start,end}}, dirty:Set, editing:id|null, startOn}
 function render(el,ctx){
  const work=(ctx.work||[]).filter(w=>!w.cancelled_at);
  if(!work.length){el.innerHTML='';return;}
  if(!('planned_start' in work[0])){el.innerHTML=ctx.locked?'':'<div class="sch"><p class="muted">进度表需要先在 Supabase 运行 renovation_schedule_migration.sql。</p></div>';return;}
  if(!state||state.project!==ctx.project.id){state={project:ctx.project.id,plans:{},dirty:new Set(),editing:null,startOn:''};}
  for(const w of work)if(!state.dirty.has(w.id))state.plans[w.id]=w.planned_start?{start:String(w.planned_start).slice(0,10),end:String(w.planned_end).slice(0,10)}:null;
  const t=today(),rows=work.map(w=>({w,p:progress(w,ctx.tracking),plan:state.plans[w.id]}));
  rows.sort((a,b)=>(a.plan?.start||'9999').localeCompare(b.plan?.start||'9999')||short(a.w.group_name).localeCompare(short(b.w.group_name),'zh'));
  const planned=rows.filter(r=>r.plan);
  const lastEnd=planned.reduce((m,r)=>!m||r.plan.end>m?r.plan.end:m,'');
  const doneCount=rows.filter(r=>r.p.finished).length;
  const late=rows.filter(r=>r.plan&&!r.p.finished&&parse(r.plan.end)<t);
  const firstStart=planned.reduce((m,r)=>!m||r.plan.start<m?r.plan.start:m,'');
  if(!state.startOn)state.startOn=firstStart||iso(t);
  let html=`<div class="sch"><div class="sch-head"><div class="sch-sum"><b>进度表</b>${lastEnd?`<span>计划完工 <b>${E(lastEnd.slice(5).replace('-','/'))}</b></span>`:''}<span>已完成 ${doneCount}/${rows.length} 张</span>${late.length?`<span class="fx-chip bad">⚠ ${late.length} 张超过计划完成日</span>`:''}${state.dirty.size?`<span class="fx-chip now">有 ${state.dirty.size} 张改了还没保存</span>`:''}</div>`;
  if(!ctx.locked)html+=`<div class="sch-tools"><label>开工日<input type="date" data-sch-start value="${E(state.startOn)}"></label><button type="button" class="secondary" data-sch-auto>${planned.length?'按常规顺序重新排':'按常规顺序自动排期'}</button><button type="button" data-sch-save ${state.dirty.size?'':'disabled'}>保存进度表</button></div>`;
  html+='</div>';
  if(!planned.length){html+=`<p class="muted sch-empty">还没有排期。选好开工日，点「按常规顺序自动排期」，系统会按 拆除 → 水电 → 泥水 → 木作天花 → 油漆 → 定制安装 → 设备灯具 → 清洁 排出一版，之后可以拖动调整。</p></div>`;el.innerHTML=html;return;}
  const from=add([...planned.map(r=>parse(r.plan.start)),t].reduce((a,b)=>a<b?a:b),-2);
  const to=add([...planned.map(r=>parse(r.plan.end)),t].reduce((a,b)=>a>b?a:b),5);
  const days=diff(from,to)+1,dw=Math.max(14,Math.min(30,Math.floor(760/days)));
  // 刻度：每周一一个日期、每月 1 号写月份；离月份刻度太近的周刻度省掉，免得字叠在一起
  const monthAt=new Set();for(let i=0;i<days;i++){const d=add(from,i);if(d.getUTCDate()===1||i===0)monthAt.add(i);}
  const nearMonth=i=>[...monthAt].some(m=>m!==i&&Math.abs(m-i)*dw<34);
  let ticks='';for(let i=0;i<days;i++){const d=add(from,i);const first=monthAt.has(i);if((d.getUTCDay()===1&&!nearMonth(i))||first)ticks+=`<span class="sch-tick${first?' m':''}" style="left:${i*dw}px">${first?`${d.getUTCMonth()+1}月`:''}${d.getUTCDate()}</span>`;}
  const sundays=[];for(let i=0;i<days;i++)if(add(from,i).getUTCDay()===0)sundays.push(`<i style="left:${i*dw}px;width:${dw}px"></i>`);
  const bar=r=>{
   if(!r.plan)return '<span class="sch-none">未排期</span>';
   const s=parse(r.plan.start),e=parse(r.plan.end),left=diff(from,s)*dw,width=(diff(s,e)+1)*dw;
   const cls=r.p.finished?'done':(e<t?'late':r.p.started?'active':'wait');
   const pct=r.p.total?Math.round(100*r.p.done/r.p.total):0;
   return `<div class="sch-bar ${cls}${state.dirty.has(r.w.id)?' dirty':''}" data-sch-bar="${r.w.id}" style="left:${left}px;width:${width}px" title="${E(short(r.w.group_name))}：${E(r.plan.start)} → ${E(r.plan.end)}"><i style="width:${pct}%"></i><span>${E(r.plan.start.slice(5).replace('-','/'))}–${E(r.plan.end.slice(5).replace('-','/'))}</span>${ctx.locked?'':'<b data-sch-end aria-hidden="true"></b>'}</div>`;
  };
  const status=r=>r.p.finished?'<small class="ok">✓ 已完成</small>':`<small>${r.p.done}/${r.p.total} 项完成${r.plan&&!r.p.finished&&parse(r.plan.end)<t?' · <span class="bad">超期</span>':''}</small>`;
  const editor=r=>state.editing===r.w.id&&!ctx.locked?`<div class="sch-edit"><label>开始<input type="date" data-sch-es value="${E(r.plan?.start||'')}"></label><label>完成<input type="date" data-sch-ee value="${E(r.plan?.end||'')}"></label><button type="button" data-sch-ok="${r.w.id}">确定</button><button type="button" class="secondary" data-sch-cancel>取消</button></div>`:'';
  html+=`<div class="sch-scroll"><div class="sch-grid" style="--w:${days*dw}px"><div class="sch-row sch-axis"><div class="sch-label"></div><div class="sch-lane">${ticks}</div></div>
   ${rows.map(r=>`<div class="sch-row"><button type="button" class="sch-label" data-sch-name="${r.w.id}" ${ctx.locked?'disabled':''}><span>${E(short(r.w.group_name))}</span>${status(r)}</button><div class="sch-lane"><div class="sch-sun">${sundays.join('')}</div>${bar(r)}</div></div>${editor(r)}`).join('')}
   <div class="sch-today" style="left:calc(var(--label) + ${diff(from,t)*dw+dw/2}px)" title="今天"></div></div></div>
   <p class="muted sch-hint">${ctx.locked?'':'拖动横条整体改日期，拖右端改完成日；手机上点子单名称改日期。'}灰底是周日。颜色：<span class="sch-key wait"></span>未开始 <span class="sch-key active"></span>进行中 <span class="sch-key done"></span>已完成 <span class="sch-key late"></span>超过计划完成日</p></div>`;
  el.innerHTML=html;el.dataset.dw=dw;
 }
 function bind(el,ctx){
  const rerender=()=>render(el,ctx.data());
  const setPlan=(id,start,end)=>{state.plans[id]={start,end};state.dirty.add(id);};
  el.addEventListener('click',async e=>{
   const b=e.target.closest('button');if(!b||!el.contains(b))return;const d=b.dataset;
   try{
    if('schAuto' in d){
     const data=ctx.data(),plans=auto(data.work,data.tracking,state.startOn);
     if(!Object.keys(plans).length){ctx.message('没有可以排期的子单（都已完成或只有赠品）。',true);return;}
     for(const [id,p] of Object.entries(plans))setPlan(id,p.start,p.end);rerender();ctx.message('已按常规顺序排好，看一下再点「保存进度表」。');
    }else if('schSave' in d){
     const plans=[...state.dirty].map(id=>({work_order_id:id,start:state.plans[id]?.start||null,end:state.plans[id]?.end||null}));
     b.disabled=true;const {error}=await ctx.sb.rpc('renovation_schedule_save',{p_id:ctx.data().project.id,p_plans:plans});if(error)throw error;
     state.dirty.clear();await ctx.onChange();ctx.message('进度表已保存，业主链接里也会显示。');
    }else if(d.schName){state.editing=state.editing===d.schName?null:d.schName;rerender();}
    else if(d.schOk){const box=b.closest('.sch-edit'),s=box.querySelector('[data-sch-es]').value,en=box.querySelector('[data-sch-ee]').value;
     if(!s||!en)throw new Error('请填开始和完成日期');if(en<s)throw new Error('完成日期不能早于开始日期');setPlan(d.schOk,s,en);state.editing=null;rerender();}
    else if('schCancel' in d){state.editing=null;rerender();}
   }catch(err){ctx.message(err.message||String(err),true);if(b.dataset.schSave!==undefined)b.disabled=false;}
  });
  el.addEventListener('change',e=>{if(e.target.matches('[data-sch-start]'))state.startOn=e.target.value;});
  // 拖动：中间 = 整体挪动，右端 = 改完成日。按天对齐。
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
 return {render,bind,auto,phaseOf,PHASES};
})();
