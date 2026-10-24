'use strict';
window.RenoFinance=(()=>{
 let version=0;
 async function load({sb,project,actor,onChange,canSave}){
  const current=++version,el=document.getElementById('actual-payments');
  if(!project||project.state==='draft'){el.innerHTML='<p>确认合同后可登记实际收款，付款计划不会自动算作已收款。</p>';return;}
  el.innerHTML='<p>正在读取收款记录…</p>';
  const {data,error}=await sb.rpc('renovation_payment_view',{p_id:project.id});
  if(current!==version)return;
  if(error||!data){el.textContent='收款记录暂时无法读取，请刷新或联系管理员。';return;}
  const V=RenoFinanceView,E=V.esc,manager=['store_manager','regional_manager','general_manager','admin','superadmin'].includes(actor.role);
  el.innerHTML=V.summary(data.summary)+`<div class="actions"><button type="button" data-refresh class="secondary">刷新收款记录</button></div><div class="grid"><label>登记类别<select data-field="kind"><option value="receipt">实际收款</option>${manager?'<option value="refund">实际退款</option>':''}</select></label><label>金额 RM<input data-field="amount" type="number" min="0.01" step="0.01"></label><label>到账／退款日期<input data-field="paid_on" type="date" value="${new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'})}"></label><label>收付款方式<select data-field="method">${Object.entries(V.methods).map(([v,n])=>`<option value="${v}">${n}</option>`).join('')}</select></label><label class="wide">银行参考号／收据编号<input data-field="reference" maxlength="200"></label><label class="wide">内部备注（不向客户显示）<input data-field="note" maxlength="1000"></label></div><p class="muted">请核实真实到账后登记。电子方式计入已付款；员工登记现金须店长核对。退款及作废须店长或上级操作。</p><button type="button" data-add>登记实际收退款</button><p data-feedback role="status" aria-live="polite"></p><details style="margin-top:20px"><summary>收退款记录（${data.entries.length}笔）</summary>${data.entries.map(e=>`<article class="customer-line"><b>${e.kind==='refund'?'退款':'收款'} ${V.money(e.amount)}</b><p>${E(e.paid_on)} · ${E(V.methods[e.method])} · ${e.voided_at?'已作废':e.verified_at?'已确认':'现金待核对'}</p><p>参考号／收据：${E(e.reference)}</p>${e.note?`<p>内部备注：${E(e.note)}</p>`:''}${e.voided_at?`<p>作废原因：${E(e.void_reason)}</p>`:manager?`<div class="actions">${!e.verified_at?`<button type="button" data-verify="${E(e.id)}">核对现金到账</button>`:''}<button type="button" class="secondary" data-void="${E(e.id)}">作废错误记录</button></div>`:''}</article>`).join('')||'<p>暂无实际收款记录。</p>'}</details>`;
  let busy=false,entryId=crypto.randomUUID();const feedback=el.querySelector('[data-feedback]');
  const field=name=>el.querySelector(`[data-field="${name}"]`).value;
  el.querySelector('[data-refresh]').onclick=async()=>{if(busy)return;await onChange();};
  async function send(action,id,payload){
   if(busy)return;
   if(!canSave()){feedback.textContent='请先保存合同核对内容，再登记收退款。';return;}
   busy=true;el.querySelectorAll('button').forEach(b=>b.disabled=true);feedback.textContent='正在保存…';
   try{
    const {error}=await sb.rpc('renovation_payment_command',{p_id:project.id,p_revision:project.revision,p_action:action,p_entry:id,p_data:payload});
    if(error)throw error;
    await onChange();
   }catch(e){feedback.textContent=e.message||'保存失败，请先刷新核对记录，避免重复登记。';}
   finally{busy=false;el.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  el.querySelector('[data-add]').onclick=()=>{
   const amount=Number(field('amount')),reference=field('reference').trim();
   if(!Number.isFinite(amount)||amount<=0||Math.abs(Math.round(amount*100)-amount*100)>0.00001||!field('paid_on')||!reference){feedback.textContent='请填写两位小数金额、日期及银行参考号／收据编号。';return;}
   if(!confirm(`确认已实际${field('kind')==='refund'?'退款':'收款'} ${V.money(amount)}，且参考号无误？`))return;
   send('add',entryId,{kind:field('kind'),amount,method:field('method'),paid_on:field('paid_on'),reference,note:field('note')});
  };
  el.querySelectorAll('[data-verify]').forEach(b=>b.onclick=()=>{if(confirm('确认此笔现金已实际到账？'))send('verify',b.dataset.verify,{});});
  el.querySelectorAll('[data-void]').forEach(b=>b.onclick=()=>{const reason=prompt('请填写作废原因。作废只纠正记录，不代表已向客户退款。');if(reason?.trim())send('void',b.dataset.void,{reason:reason.trim()});});
 }
 return {load};
})();
