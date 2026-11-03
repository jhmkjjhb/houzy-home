'use strict';
// List-page panels: the to-do list (problems and deadlines only) and staff handover.
window.RenoFulfillmentHome=(()=>{
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={issue:'有问题待处理',overdue_arrival:'到货已逾期',paper_review:'纸质确认单待审核',awaiting_signature:'等待业主签名',need_signature:'待发起业主签名',to_order:'待下单',arriving_soon:'3天内到货'};
 const order=Object.keys(labels);
 const roles={staff:'店员',store_manager:'店长',regional_manager:'区域经理',general_manager:'总经理',admin:'管理员',superadmin:'管理员'};
 const todoLine=t=>`<li><b>${E(labels[t.type]||t.type)}</b> · ${E(t.group_name)} · ${t.count}项${t.due?` · ${E(t.due)}`:''}${t.note?` · ${E(t.note)}`:''}</li>`;
 function todosHtml(data){
  const items=[...data.items].sort((a,b)=>order.indexOf(a.type)-order.indexOf(b.type)),by=new Map();
  for(const t of items){if(!by.has(t.project_id))by.set(t.project_id,{no:t.contract_no,name:t.customer_name,rows:[]});by.get(t.project_id).rows.push(t);}
  const hand=data.handovers.map(h=>`<div class="warning" data-handover="${h.id}"><b>${E(h.from_name)} 把 ${h.checklist.length} 个项目交接给你</b>${h.note?`<p>交接说明：${E(h.note)}</p>`:''}${h.checklist.map(p=>`<p><b>${E(p.contract_no)}</b> · ${E(p.customer_name)} · ${E(p.customer_phone)}</p><ul>${p.todos.map(todoLine).join('')}</ul>`).join('')}<button type="button" data-accept="${h.id}">确认接手</button></div>`).join('');
  const projects=[...by].map(([id,p])=>`<div class="customer-line"><button type="button" class="secondary" data-open-project="${id}">${E(p.no)} · ${E(p.name)}</button><ul>${p.rows.map(todoLine).join('')}</ul></div>`).join('');
  return `${hand}${projects||(hand?'':'<p class="muted">暂无逾期或待处理事项。</p>')}`;
 }
 function handoverHtml(people,pending){
  const active=people.filter(p=>p.active),holders=people.filter(p=>p.projects.length);
  const opt=list=>list.map(p=>`<option value="${p.id}">${E(p.name||p.id)} · ${E(roles[p.role]||p.role)}${p.projects.length?` · ${p.projects.length}个项目`:''}</option>`).join('');
  const names=Object.fromEntries(people.map(p=>[p.id,p.name]));
  return `<details><summary>员工交接与离职（店长及以上）</summary>
  ${pending.map(h=>`<p>等待 ${E(names[h.to_user]||'接手人')} 确认：来自 ${E(names[h.from_user]||'')} 的 ${h.project_ids.length} 个项目 <button type="button" class="secondary" data-cancel="${h.id}">撤销</button></p>`).join('')}
  <div class="grid"><label>交出人<select data-from><option value="">请选择</option>${opt(holders)}</select></label><label>接手人<select data-to><option value="">请选择</option>${opt(active)}</select></label></div>
  <div data-projects></div><label>交接说明（给客户的口头承诺、注意事项）<input data-note maxlength="1000"></label>
  <div class="actions"><button type="button" data-create>发起交接（接手人确认后生效）</button></div>
  <details><summary>紧急离职：不等确认，立即转交并停用账号</summary><p class="muted">选择上方的交出人和接手人，并写明情况。交出人名下所有项目会立即转给接手人。业绩不变。</p><label>离职情况<input data-offboard-note maxlength="500"></label><div class="actions"><button type="button" class="secondary" data-offboard>立即转交并停用账号</button></div></details>
  <p data-handover-feedback role="status" aria-live="polite"></p></details>`;
 }
 async function load({sb,openProject,refresh}){
  const host=document.getElementById('list-workspace');if(!host)return;
  let section=document.getElementById('my-todos');
  if(!section){section=document.createElement('section');section.id='my-todos';section.className='panel';host.prepend(section);}
  const [todos,people,pending]=await Promise.all([sb.rpc('renovation_my_todos'),sb.rpc('renovation_handover_people'),sb.from('renovation_handovers').select('*').eq('status','pending')]);
  if(todos.error||people.error||pending.error){section.innerHTML='<div class="panel-heading"><h2>我的待办</h2></div><p class="warning">待办暂时无法读取，请刷新重试。</p>';return;}
  const list=people.data||[];
  section.innerHTML=`<div class="panel-heading"><h2>我的待办</h2><span>只显示逾期和卡点</span></div>${todosHtml(todos.data)}${list.length?handoverHtml(list,pending.data||[]):''}`;
  const q=s=>section.querySelector(s),feedback=t=>{const f=q('[data-handover-feedback]');if(f)f.textContent=t;};
  const drawProjects=()=>{const p=list.find(x=>x.id===q('[data-from]').value);q('[data-projects]').innerHTML=p?p.projects.map(x=>`<label class="check"><input type="checkbox" data-project="${x.id}" checked> ${E(x.contract_no)} · ${E(x.customer_name)}</label>`).join(''):'';};
  if(q('[data-from]'))q('[data-from]').onchange=drawProjects;
  section.onclick=async e=>{
   const t=e.target,cmd=async(action,id,data)=>{const {error}=await sb.rpc('renovation_handover_command',{p_action:action,p_handover:id,p_data:data});if(error)throw error;};
   try{
    if(t.dataset.openProject)return await openProject(t.dataset.openProject);
    if(t.dataset.accept){await cmd('accept',t.dataset.accept,{});return await refresh();}
    if(t.dataset.cancel){await cmd('cancel',t.dataset.cancel,{});return await refresh();}
    if(t.dataset.create!==undefined){const ids=[...section.querySelectorAll('[data-project]:checked')].map(x=>x.dataset.project);await cmd('create',null,{from_user:q('[data-from]').value||null,to_user:q('[data-to]').value||null,project_ids:ids,note:q('[data-note]').value});return await refresh();}
    if(t.dataset.offboard!==undefined){const from=q('[data-from]'),person=from.options[from.selectedIndex]?.text;if(!from.value)throw new Error('请选择交出人');if(!confirm(`确定立即转交 ${person} 名下所有项目并停用账号？`))return;const {error}=await sb.rpc('renovation_offboard_user',{p_user:from.value,p_to:q('[data-to]').value||null,p_note:q('[data-offboard-note]').value});if(error)throw error;return await refresh();}
   }catch(err){feedback(err.message||String(err));if(!q('[data-handover-feedback]'))alert(err.message||String(err));}
  };
 }
 return {load,todosHtml,handoverHtml};
})();
