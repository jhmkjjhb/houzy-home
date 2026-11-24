'use strict';
// 监理现场页的「施工计划」：按工序看日期和进度。内部监理可以按住 ≡ 上下拖动改先后（拖到谁下面就等谁做完，后面的工序自动重排）、
// 把项目换到别的工序、加 / 删现场多出来的工序。外部监理只看。页面上没有金额。
window.RenoSitePlan=(()=>{
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const md=d=>d?String(d).slice(5).replace('-','/'):'';
 const TR=['杂工','水管工','电工','泥水工','瓷砖工','木工','油漆工','柜体安装队','厂家安装','清洁','其他'];
 const open=new Set();let addOpen=false;
 // 现场页的数据 → 排期程序的输入
 function input(site,setup){
  const P=site.project,plan=P.phase_plan||{},work=site.work_orders.map(w=>({id:w.id,group_name:w.group_name,line_ids:w.items.map(i=>i.line_id)}));
  const lines=[],seen=new Set();for(const w of site.work_orders)for(const i of w.items)if(!seen.has(i.line_id)){seen.add(i.line_id);lines.push({id:i.line_id,name:i.name,spec:i.spec||'',qty:i.qty,unit:i.unit||'',kind:i.kind});}
  const items=site.work_orders.flatMap(w=>w.items.map(i=>({work_order_id:w.id,line_id:i.line_id,kind:i.kind,stage:i.stage})));
  const start=Object.values(plan).map(x=>x?.start).filter(Boolean).sort()[0]||site.today;
  return {work,lines,tracking:{items,batches:[]},payments:[],start,today:site.today,fixed:plan,mepCombined:['mep','fixture'].some(k=>k in plan),setup:setup||P.phase_setup||{}};
 }
 const build=(site,setup)=>window.RenoPlan?RenoPlan.build(input(site,setup)):null;
 function section(site,editable){
  const P=build(site);if(!P||!P.tasks.length)return '';
  const plan=site.project.phase_plan||{},order=P.phases.map(p=>p.key),tasks=P.tasks.slice().sort((a,b)=>order.indexOf(a.key)-order.indexOf(b.key));
  const row=(tk,i)=>{const pl=plan[tk.key],done=tk.lines.filter(l=>l.stage==='done').length,all=tk.lines.length,fin=all>0&&done===all,late=pl&&!fin&&pl.end<site.today;
   const body=open.has(tk.key)?`<div class="sp-body"><ul>${tk.lines.map(l=>`<li><span>${E(l.name)}${l.manual?' <i class="sp-manual">手动</i>':''}</span>${editable?`<select data-sp-move="${E(l.work_order_id+':'+l.id)}" data-sp-name="${E(l.name)}" aria-label="把「${E(l.name)}」换到别的工序">${P.phases.map(p=>`<option value="${E(p.key)}"${p.key===tk.key?' selected':''}>${p.key===tk.key?'换工序：':''}${E(p.name)}</option>`).join('')}${l.manual?'<option value="__auto">↺ 恢复自动归类</option>':''}</select>`:''}</li>`).join('')||'<li class="sp-none">还没有清单项</li>'}</ul>
    ${tk.custom&&editable?`<button type="button" class="ghost" data-sp-del="${E(tk.key)}" ${all?'disabled':''}>${all?'先把项目换走才能删除':'删除这道工序'}</button>`:''}</div>`:'';
   return `<li class="sp-row${fin?' done':''}${late?' late':''}" data-sp-key="${E(tk.key)}">${editable?'<span class="sp-grip" data-sp-grip aria-label="按住上下拖动改顺序" role="button" tabindex="0">≡</span>':''}<button type="button" class="sp-main" data-sp-open="${E(tk.key)}" aria-expanded="${open.has(tk.key)}"><b>${i+1}. ${E(tk.name)}</b><span>${E(tk.trade)} · ${pl?`${E(md(pl.start))}–${E(md(pl.end))}`:'未排期'} · ${fin?'✓ 已完成':`${done}/${all}`}${late?' · 超期':''}</span></button>${body}</li>`;};
  const add=editable?`<details class="sp-add"${addOpen?' open':''}><summary>＋ 加工序（现场多出来的活）</summary><label>名称<input data-sp-cname maxlength="30" placeholder="例：防白蚁"></label><label>工种<select data-sp-ctrade>${TR.map(x=>`<option>${x}</option>`).join('')}</select></label><label>天数<input data-sp-cdays type="number" min="1" max="365" inputmode="numeric" value="1"></label><label>接在哪道后面开工<select data-sp-cafter>${tasks.filter(t=>t.key!=='clean').map(t=>`<option value="${E(t.key)}">${E(t.name)}</option>`).join('')}</select></label><button type="button" class="site-primary" data-sp-cadd>加上并排日期</button></details>`:'';
  return `<section class="site-card"><h2>施工计划（按工序）</h2><p class="sp-hint">${editable?'按住左边 ≡ 上下拖动改先后：拖到谁下面就等谁做完，后面的工序自动重排。点工序看项目，可以「换工序」。':'工序先后和日期由门店和内部监理调整。'}${site.project.phase_locked?' 业主看的预计计划不变。':''}</p><ol class="sp-list" data-sp-list>${tasks.map(row).join('')}</ol>${add}</section>`;
 }
 // 保存：现场调整（顺序 / 换工序 / 加工序），需要时把受影响工序的日期按新设置重排后一起保存
 async function save(ctx,setup,keys,msg){
  const site=ctx.site(),{sb}=ctx;
  for(const x of ['assign','after'])if(setup[x]&&!Object.keys(setup[x]).length)delete setup[x];
  const r=await sb.rpc('renovation_phase_setup_save',{p_id:site.project.id,p_setup:setup});if(r.error)throw new Error(/function|schema cache/i.test(r.error.message)?'门店还没开通这个功能（要先运行 renovation_phase_site_migration.sql）':r.error.message);
  if(keys?.length){const P=build(site,setup),plan={},ww={};
   for(const t of P.tasks)if(keys.includes(t.key)&&!t.done)plan[t.key]={start:t.start,end:t.end};
   const all={...(site.project.phase_plan||{}),...plan};
   for(const t of P.tasks){const pl=all[t.key];if(!pl)continue;for(const id of t.workOrders){const w=ww[id]||(ww[id]={start:pl.start,end:pl.end});if(pl.start<w.start)w.start=pl.start;if(pl.end>w.end)w.end=pl.end;}}
   if(Object.keys(plan).length){const q=await sb.rpc('renovation_phase_plan_save',{p_id:site.project.id,p_plan:plan,p_work:Object.entries(ww).map(([id,v])=>({work_order_id:id,...v})),p_lines:Object.fromEntries(P.tasks.map(t=>[t.key,t.lines.map(l=>[l.work_order_id,String(l.id)])]))});if(q.error)throw new Error(q.error.message);}}
  await ctx.reload();ctx.say(msg);
 }
 const setupOf=ctx=>JSON.parse(JSON.stringify(ctx.site().project.phase_setup||{}));
 // 拖完：新顺序；被拖的工序等它上面那道做完；它和后面的工序重排日期
 async function dropped(ctx,keys,moved){
  const s=setupOf(ctx),i=keys.indexOf(moved),above=keys[i-1];s.order=keys;s.after={...(s.after||{})};
  if(above)s.after[moved]=[above];else delete s.after[moved];
  const P=build(ctx.site()),name=k=>P.tasks.find(t=>t.key===k)?.name||k;
  await save(ctx,s,keys.slice(i),above?`「${name(moved)}」改成等「${name(above)}」做完，后面的工序已按新顺序重排。`:`「${name(moved)}」挪到最前面，后面的工序已重排。`);
 }
 function bind(el,ctx){
  el.addEventListener('click',async e=>{
   const b=e.target.closest('button');if(!b||!el.contains(b)||!ctx.site())return;const d=b.dataset;
   try{
    if(d.spOpen){open.has(d.spOpen)?open.delete(d.spOpen):open.add(d.spOpen);ctx.render();return;}
    if('spCadd' in d){const box=b.closest('.sp-add'),name=box.querySelector('[data-sp-cname]').value.trim(),days=Math.round(+box.querySelector('[data-sp-cdays]').value),trade=box.querySelector('[data-sp-ctrade]').value,after=box.querySelector('[data-sp-cafter]').value;
     if(!name)throw new Error('请填工序名称');if(!(days>=1&&days<=365))throw new Error('天数要在 1 到 365 之间');
     const s=setupOf(ctx),key='c_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);s.custom=[...(s.custom||[]),{key,name,trade,days,after}];b.disabled=true;addOpen=false;
     await save(ctx,s,[key],`已加工序「${name}」并排好日期。`);return;}
    if(d.spDel){const s=setupOf(ctx),c=(s.custom||[]).find(x=>x.key===d.spDel);if(!c||!confirm(`删除工序「${c.name}」？`))return;b.disabled=true;
     if(ctx.site().project.phase_plan?.[d.spDel]){const q=await ctx.sb.rpc('renovation_phase_plan_save',{p_id:ctx.site().project.id,p_plan:{[d.spDel]:null},p_work:[]});if(q.error)throw new Error(q.error.message);}
     s.custom=s.custom.filter(x=>x.key!==d.spDel);s.assign=Object.fromEntries(Object.entries(s.assign||{}).filter(([,v])=>v!==d.spDel));if(s.order)s.order=s.order.filter(k=>k!==d.spDel);
     if(s.after){delete s.after[d.spDel];for(const k of Object.keys(s.after))s.after[k]=s.after[k].filter(x=>x!==d.spDel);}
     await save(ctx,s,null,`已删除工序「${c.name}」。`);return;}
   }catch(err){b.disabled=false;ctx.say(err.message||String(err),true);}
  });
  el.addEventListener('toggle',e=>{if(e.target.matches?.('.sp-add'))addOpen=e.target.open;},true);
  el.addEventListener('change',async e=>{
   const sel=e.target.closest('[data-sp-move]');if(!sel)return;const s=setupOf(ctx);s.assign={...(s.assign||{})};
   if(sel.value==='__auto')delete s.assign[sel.dataset.spMove];else s.assign[sel.dataset.spMove]=sel.value;sel.disabled=true;
   // 换进来的工序还没排日期，就顺便给它排上（现场页没有「重排」按钮）
   const P0=build(ctx.site(),s),to=sel.value==='__auto'?P0.tasks.find(t=>t.lines.some(l=>`${l.work_order_id}:${l.id}`===sel.dataset.spMove))?.key:sel.value,need=to&&!ctx.site().project.phase_plan?.[to]?[to]:null;
   try{await save(ctx,s,need,sel.value==='__auto'?`「${sel.dataset.spName}」已恢复自动归类。`:`已把「${sel.dataset.spName}」换到「${sel.selectedOptions[0].textContent.replace(/^换工序：/,'')}」。`);}catch(err){sel.disabled=false;ctx.say(err.message||String(err),true);}
  });
  // 按住 ≡ 上下拖（手机手指 / 电脑鼠标都行）
  let drag=null;
  el.addEventListener('pointerdown',e=>{const g=e.target.closest('[data-sp-grip]');if(!g)return;const li=g.closest('.sp-row');
   drag={li,list:li.parentElement,key:li.dataset.spKey,start:[...li.parentElement.children].map(x=>x.dataset.spKey).join()};li.classList.add('dragging');g.setPointerCapture(e.pointerId);e.preventDefault();});
  el.addEventListener('pointermove',e=>{if(!drag)return;e.preventDefault();
   const rows=[...drag.list.children].filter(x=>x!==drag.li),y=e.clientY;let before=null;
   for(const r of rows){const b=r.getBoundingClientRect();if(y<b.top+b.height/2){before=r;break;}}
   if(before!==drag.li.nextSibling)drag.list.insertBefore(drag.li,before);});
  const end=async()=>{if(!drag)return;const g=drag;drag=null;g.li.classList.remove('dragging');
   const keys=[...g.list.children].map(x=>x.dataset.spKey);if(keys.join()===g.start)return;
   try{await dropped(ctx,keys,g.key);}catch(err){ctx.say(err.message||String(err),true);await ctx.reload().catch(()=>{});}};
  el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
  // 键盘：≡ 上按 ↑ ↓ 挪一格
  el.addEventListener('keydown',async e=>{const g=e.target.closest?.('[data-sp-grip]');if(!g||!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();
   const li=g.closest('.sp-row'),keys=[...li.parentElement.children].map(x=>x.dataset.spKey),i=keys.indexOf(li.dataset.spKey),j=i+(e.key==='ArrowUp'?-1:1);if(j<0||j>=keys.length)return;
   keys.splice(i,1);keys.splice(j,0,li.dataset.spKey);try{await dropped(ctx,keys,li.dataset.spKey);}catch(err){ctx.say(err.message||String(err),true);}});
 }
 return {section,bind,build};
})();
