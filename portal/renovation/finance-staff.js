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
  const stages=(data.installments||[]).filter(p=>!p.pending_signature);
  const allocatableStages=stages.filter(p=>!p.cancelled);
  const stageOptions=(selected)=>'<option value="">未指定期数</option>'+stages.filter(p=>!p.cancelled).map(p=>`<option value="${p.number}" ${Number(selected)===p.number?'selected':''}>第${p.number}期 · ${p.is_addition?'增项应收':V.percent(p.amount,data.summary.original_total||data.summary.total)} · ${E(p.name)}</option>`).join('');
  el.innerHTML=V.summary(data.summary)+V.plan(data,true)+`<div class="actions"><button type="button" data-refresh class="secondary">刷新收款记录</button></div><div class="grid"><label>登记类别<select data-field="kind"><option value="receipt">实际收款</option>${manager?'<option value="refund">实际退款</option>':''}</select></label><label class="wide">对应付款节点<select data-field="installment">${stageOptions()}</select></label><label class="wide"><input type="checkbox" data-split> 一笔转账同时支付多个期数／增项</label><div class="wide" data-allocation-panel hidden><p class="muted">一条真实进款，只填一次银行参考号；下面分别填写本次归到各节点的金额。</p>${allocatableStages.map(p=>`<label>第${E(p.number)}期 · ${p.is_addition?'增项':'原合同'} · ${E(p.name)}（还差 ${V.money(p.balance)}）<input type="number" min="0" step="0.01" value="0" data-allocation-stage="${p.number}"></label>`).join('')}<p data-allocation-balance role="status"></p></div><p class="wide muted" data-stage-help>每次实际转账单独登记，可在同一期内分多次收款。</p><label>本次实际收退款金额 RM<input data-field="amount" type="number" min="0.01" step="0.01"></label><label>到账／退款日期<input data-field="paid_on" type="date" value="${new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'})}"></label><label>收付款方式<select data-field="method">${Object.entries(V.methods).map(([v,n])=>`<option value="${v}">${n}</option>`).join('')}</select></label><label class="wide">银行参考号／收据编号<input data-field="reference" maxlength="200"></label><label class="wide">内部备注（不向客户显示）<input data-field="note" maxlength="1000"></label></div><p class="muted">请核实真实到账后登记。电子方式计入已付款；员工登记现金须店长核对。退款及作废须店长或上级操作。日期不得早于签约日前180天；补登上月或更早的款项须店长登记，并在内部备注写明原因。</p><button type="button" data-add>登记实际收退款</button><p data-feedback role="status" aria-live="polite"></p><details style="margin-top:20px"><summary>收退款记录（${data.entries.length}笔）</summary>${data.entries.map(e=>`<article class="customer-line"><b>${e.kind==='refund'?'退款':'收款'} ${V.money(e.amount)}</b><p>${e.allocations?.length?'分配到 '+e.allocations.length+' 个付款节点':e.installment?'第'+E(e.installment)+'期':'未指定期数'} · ${E(e.paid_on)} · ${E(V.methods[e.method])} · ${e.voided_at?'已作废':e.verified_at?'已确认':'现金待核对'}</p><p>参考号／收据：${E(e.reference)}</p>${e.allocations?.length?`<p>归款：${e.allocations.map(a=>`第${E(a.installment)}期 ${V.money(a.amount)}`).join('；')}</p>`:''}${!e.allocations?.length&&!e.voided_at&&(manager||e.created_by===actor.id)?`<label>按进款单调整所属期数<select data-assign-stage="${E(e.id)}">${stageOptions(e.installment)}</select></label><button type="button" class="secondary" data-assign="${E(e.id)}">保存期数调整</button>`:''}${e.note?`<p>内部备注：${E(e.note)}</p>`:''}${e.voided_at?`<p>作废原因：${E(e.void_reason)}</p>`:manager?`<div class="actions">${!e.verified_at?`<button type="button" data-verify="${E(e.id)}">核对现金到账</button>`:''}<button type="button" class="secondary" data-void="${E(e.id)}">作废错误记录</button></div>`:''}</article>`).join('')||'<p>暂无实际收款记录。</p>'}</details>`;
  let statementBusy=false;
  el.onclick=async event=>{
   const button=event.target.closest('[data-stage-statement]');if(!button||statementBusy)return;
   const installment=Number(button.dataset.stageStatement),stage=stages.find(p=>Number(p.number)===installment);
   if(!stage||stage.cancelled)return;
   statementBusy=true;button.disabled=true;const oldText=button.textContent;button.textContent='Preparing latest PDF / 正在生成最新付款单…';
   try{
    if(!window.RenoInstallmentStatement||!window.HOUZY_PDF_COMPANY)throw new Error('PDF组件未加载，请刷新页面重试。');
    const history=(data.entries||[]).filter(e=>!e.voided_at).flatMap(e=>{
     const allocated=e.allocations?.length?e.allocations.filter(a=>Number(a.installment)===installment):Number(e.installment)===installment?[{amount:e.amount}]:[];
     return allocated.map(a=>({kind:e.kind,amount:Number(a.amount),method:e.method,paid_on:e.paid_on,verified:Boolean(e.verified_at)}));
    });
    const unassignedPaid=(data.entries||[]).filter(e=>!e.voided_at&&!e.allocations?.length&&!e.installment&&e.verified_at).reduce((sum,e)=>sum+(e.kind==='refund'?-Number(e.amount):Number(e.amount)),0);
    const paid=Number(stage.paid||0),pending=Number(stage.pending||0),amount=Number(stage.amount||0);
    const statement={reference:`${project.contract_no}-P${String(installment).padStart(2,'0')}`,contract_no:project.contract_no,customer_name:project.customer_name,address:project.address,installment,stage_name:stage.name,amount,received:Number(stage.received||0),refunded:Number(stage.refunded||0),paid,pending,balance:Number(stage.balance??Math.max(0,amount-paid)),project_total:Number(data.summary.total),original_total:Number(data.summary.original_total??data.summary.total),additions_total:Number(data.summary.additions_total||0),deductions_total:Number(data.summary.deductions_total||0),unassigned_paid:Math.max(0,unassignedPaid),status:paid>=amount&&amount>0?'paid':pending>0||unassignedPaid>0?'review':paid>0?'partial':'unpaid',entries:history,generated_at:new Date().toISOString()};
    await RenoInstallmentStatement.download(statement,window.HOUZY_PDF_COMPANY);
    el.querySelector('[data-feedback]').textContent=`第 ${installment} 期付款单已按最新收款记录生成。`;
   }catch(error){el.querySelector('[data-feedback]').textContent=error.message||'付款单PDF生成失败，请刷新后重试。';}
   finally{statementBusy=false;button.disabled=false;button.textContent=oldText;}
  };
  let busy=false,entryId=crypto.randomUUID();const feedback=el.querySelector('[data-feedback]');
  const field=name=>el.querySelector(`[data-field="${name}"]`).value;
  const splitToggle=el.querySelector('[data-split]'),allocationPanel=el.querySelector('[data-allocation-panel]');
  function splitAmounts(){return [...el.querySelectorAll('[data-allocation-stage]')].map(input=>({installment:Number(input.dataset.allocationStage),amount:Number(input.value)})).filter(a=>a.amount>0);}
  function updateSplit(){
   const split=splitToggle.checked;
   allocationPanel.hidden=!split;el.querySelector('[data-field="installment"]').disabled=split;
   const allocated=splitAmounts().reduce((sum,a)=>sum+Math.round(a.amount*100),0);
   const difference=Math.round(Number(field('amount')||0)*100)-allocated;
   allocationPanel.querySelector('[data-allocation-balance]').textContent=split?`已分配 ${V.money(allocated/100)}；尚待分配 ${V.money(difference/100)}`:'';
  }
  splitToggle.onchange=updateSplit;
  el.querySelector('[data-field="amount"]').oninput=updateSplit;
  el.querySelectorAll('[data-allocation-stage]').forEach(input=>input.oninput=updateSplit);
  el.querySelector('[data-field="installment"]').onchange=()=>{const p=stages.find(p=>p.number===Number(field('installment')));el.querySelector('[data-stage-help]').textContent=p?`第${p.number}期：${p.is_addition?'增项应付':'合同应付'} ${V.money(p.amount)}，本期已付 ${V.money(p.paid)}，本期还差 ${V.money(p.balance)}。请只填写本次进款单的实际金额。`:'每次实际转账单独登记；未指定期数的记录会提示稍后归期。';};
  el.querySelector('[data-refresh]').onclick=async()=>{if(busy)return;await onChange();};
  async function send(action,id,payload){
   if(busy)return;
   if(!canSave()){feedback.textContent='请先保存当前编辑内容，再登记收退款。';return;}
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
   const split=splitToggle.checked,allocations=split?splitAmounts():null;
   if(stages.length&&!split&&!field('installment')){feedback.textContent='请选择本次进款单对应的付款节点。';return;}
   if(!Number.isFinite(amount)||amount<=0||Math.abs(Math.round(amount*100)-amount*100)>0.00001||!field('paid_on')||!reference){feedback.textContent='请填写两位小数金额、日期及银行参考号／收据编号。';return;}
   if(split&&(allocations.length<2||allocations.some(a=>!Number.isFinite(a.amount)||Math.abs(Math.round(a.amount*100)-a.amount*100)>0.00001)||allocations.reduce((sum,a)=>sum+Math.round(a.amount*100),0)!==Math.round(amount*100))){feedback.textContent='请至少分配到两个节点，且归款合计须等于这笔实际收退款。';return;}
   if(!confirm(`确认已实际${field('kind')==='refund'?'退款':'收款'} ${V.money(amount)}，${split?'并按所填节点拆分归款，':''}且参考号无误？`))return;
   send('add',entryId,{kind:field('kind'),amount,method:field('method'),paid_on:field('paid_on'),reference,note:field('note'),...(split?{allocations}:{installment:field('installment')?Number(field('installment')):null})});
  };
  el.querySelectorAll('[data-assign]').forEach(b=>b.onclick=()=>{const select=el.querySelector(`[data-assign-stage="${b.dataset.assign}"]`);const reason=prompt('请填写调整所属期数的原因。金额与原始进款记录不变。');if(reason?.trim())send('assign',b.dataset.assign,{installment:select.value?Number(select.value):null,reason:reason.trim()});});
  el.querySelectorAll('[data-verify]').forEach(b=>b.onclick=()=>{if(confirm('确认此笔现金已实际到账？'))send('verify',b.dataset.verify,{});});
  el.querySelectorAll('[data-void]').forEach(b=>b.onclick=()=>{const reason=prompt('请填写作废原因。作废只纠正记录，不代表已向客户退款。');if(reason?.trim())send('void',b.dataset.void,{reason:reason.trim()});});
 }
 return {load};
})();
