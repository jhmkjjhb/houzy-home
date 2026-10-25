'use strict';
window.RenoAdditions=(()=>{
 let changed=false;
 function render({data,project,actor,sb,onChange,canSave}){
  const el=document.getElementById('project-additions');changed=false;el.oninput=()=>changed=true;
  if(!project||project.state==='draft'){el.innerHTML='<p>草稿可在上方新增工项或材料，数量和单价变更后会自动重算总价；确认合同后在这里单独登记增项。</p>';return;}
  if(!data){el.textContent='增项清单暂时无法读取，请刷新重试。';return;}
  const V=RenoFinanceView,E=V.esc,manager=['store_manager','regional_manager','general_manager','admin','superadmin'].includes(actor.role),locked=project.state==='accepted';
  el.innerHTML=`<div class="grid"><div>原合同总额<br><b>${V.money(data.original_total)}</b></div><div>新增工项／材料合计<br><b>${V.money(data.additions_total)}</b></div><div>项目当前应收总额<br><b>${V.money(data.total)}</b></div></div><p>新增单需由客户在专属链接上电子签名。待签金额不计入项目总额，不生成执行单，也不能收款；签署后自动生效。原合同PDF及原付款节点保留。</p>${locked?'<p>项目已竣工验收，不能继续增加费用，请另建项目。</p>':`<div class="actions"><button type="button" data-new="work">＋ 新增工项</button><button type="button" data-new="material" class="secondary">＋ 新增材料</button></div><div class="grid"><label>增项类别<select data-field="category"><option value="work">新增工项</option><option value="material">新增材料</option></select></label><label>名称<input data-field="name" maxlength="200"></label><label class="wide">规格／施工范围<textarea data-field="spec" maxlength="2000"></textarea></label><label>数量<input data-field="qty" type="number" min="0.001" step="0.001" value="1"></label><label>单位<input data-field="unit" maxlength="50" value="项"></label><label>单价 RM<input data-field="rate" type="number" min="0.01" step="0.01"></label><label>本次新增金额<output data-preview>RM 0.00</output></label><label>执行分组<input data-field="group_name" maxlength="80" value="新增工项"></label><label>增项付款节点<input data-field="payment_node" maxlength="200" value="增项确认后"></label></div><p class="muted">新增项目的质保范围及期限待双方补充确认，不自动套用原合同其他部件质保。</p><button type="button" data-add>保存新增单，等待客户签署</button>`}<p data-feedback role="status" aria-live="polite"></p><div>${data.entries.map(a=>`<article class="customer-line"><b>${a.category==='work'?'工项':'材料'} · ${E(a.name)}${a.voided_at?' · 已撤销':a.signature_status==='signed'?' · 客户已签署':' · 待客户签署'}</b><p>${E(a.spec)} · ${E(a.qty)} ${E(a.unit)} × ${V.money(a.rate)} = <b>${V.money(a.amount)}</b></p><p>${a.signature_status==='signed'?'第'+E(a.installment)+'付款节点':'待签付款节点'}：${E(a.payment_node)}</p>${a.signature_status==='signed'?`<p style="color:#15803d">签署人：${E(a.signer_name)} · ${E(new Date(a.signed_at).toLocaleString('zh-CN'))}</p>`:'<p>此单未签署，金额尚未计入应收。</p>'}${!a.voided_at?`<button type="button" class="secondary" data-copy-sign="${E(a.id)}">${a.signature_status==='signed'?'复制已签确认单链接':'复制客户签署链接'}</button>`:''}${a.voided_at?`<p>作废原因：${E(a.void_reason)}</p>`:!locked&&(manager||(a.signature_status==='pending'&&a.created_by===actor.id))?`<button type="button" class="secondary" data-void="${E(a.id)}">作废错误增项</button>`:''}</article>`).join('')||'<p>暂无新增工项或材料。</p>'}</div>`;
  let busy=false,entryId=crypto.randomUUID();const feedback=el.querySelector('[data-feedback]');const field=k=>el.querySelector(`[data-field="${k}"]`);
  async function send(action,id,payload){
   if(busy)return;
   if(!canSave()){feedback.textContent='请先保存当前核对内容，待其他操作完成后再登记增项。';return;}
   busy=true;el.querySelectorAll('button').forEach(b=>b.disabled=true);feedback.textContent='正在保存增项…';
   try{const {error}=await sb.rpc('renovation_addition_command',{p_id:project.id,p_revision:project.revision,p_action:action,p_entry:id,p_data:payload});if(error)throw error;changed=false;await onChange();}
   catch(e){feedback.textContent=e.message||'保存失败，请刷新核对是否已登记，避免重复增加金额。';}
   finally{busy=false;el.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  if(!locked){
   const preview=()=>el.querySelector('[data-preview]').textContent=V.money(Number(field('qty').value)*Number(field('rate').value));
   field('qty').oninput=field('rate').oninput=preview;
   el.querySelectorAll('[data-new]').forEach(b=>b.onclick=()=>{field('category').value=b.dataset.new;field('group_name').value=b.dataset.new==='work'?'新增工项':'新增材料';field('name').focus();});
   el.querySelector('[data-add]').onclick=()=>{
    const payload=Object.fromEntries(['category','name','spec','unit','group_name','payment_node'].map(k=>[k,field(k).value.trim()]));payload.qty=Number(field('qty').value);payload.rate=Number(field('rate').value);
    if(!payload.name||!payload.unit||!payload.group_name||!payload.payment_node||!Number.isFinite(payload.qty)||!Number.isFinite(payload.rate)||payload.qty<=0||payload.rate<=0){feedback.textContent='请补齐名称、数量、单位、单价、执行分组及付款节点。';return;}
    if(!confirm(`确认登记${payload.category==='work'?'新增工项':'新增材料'}「${payload.name}」，增加 ${V.money(payload.qty*payload.rate)} ，等待客户电子签名后再计入项目应收？`))return;
    send('add',entryId,payload);
   };
  }
  el.querySelectorAll('[data-copy-sign]').forEach(b=>b.onclick=async()=>{
   const a=data.entries.find(a=>a.id===b.dataset.copySign),url=new URL('renovation-customer.html',location.href);url.searchParams.set('addition',a.id);url.searchParams.set('sign',a.signing_token);url.hash=project.customer_token;
   try{await navigator.clipboard.writeText(url.href);feedback.textContent='已复制专属签署链接，请发给业主或其授权签署人。';}
   catch(e){feedback.replaceChildren();const label=document.createElement('label');label.textContent='请手动复制以下专属签署链接：';const input=document.createElement('textarea');input.readOnly=true;input.value=url.href;label.append(input);feedback.append(label);input.focus();input.select();}
  });
  el.querySelectorAll('[data-void]').forEach(b=>b.onclick=()=>{const reason=prompt('请填写作废原因。已收款或已安排执行的增项需先核对，不能直接作废。');if(reason?.trim())send('void',b.dataset.void,{reason:reason.trim()});});
 }
 return {render,isDirty:()=>changed,clear:()=>{changed=false;}};
})();
