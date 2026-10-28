'use strict';
window.RenoDeductions=(()=>{
 let changed=false;
 const E=s=>RenoFinanceView.esc(s),M=n=>RenoFinanceView.money(n);
 function render({data,project,sb,onChange,canSave}){
  const el=document.getElementById('project-deductions');if(!el)return;
  changed=false;
  if(!project||project.state==='draft'){el.innerHTML='<p>确认合同后，可为不再施工的原合同项目生成减项确认单。</p>';return;}
  if(!data){el.textContent='减项清单暂时无法读取，请刷新重试。';return;}
  const active=new Set(data.entries.filter(d=>d.status!=='voided').map(d=>d.line_id));
  const lines=(data.lines||[]).filter(l=>l.kind!=='gift'&&Number(l.qty)*Number(l.rate)>0&&!active.has(String(l.id)));
  const ratio=Number(data.original_net)/Number(data.original_gross);
  const locked=project.state==='accepted';
  el.innerHTML=`<div class="grid"><div>签约优惠比例<br><b>${E((100*(1-ratio)).toLocaleString('zh-CN',{maximumFractionDigits:4}))}%</b></div><div>已签减项合计<br><b>${M(data.deductions_total)}</b></div><div>当前应收总额<br><b>${M(data.current_total)}</b></div></div><p>从原合同清单选择不再施工的整项，按签约时整单折扣比例计算减款。客户手写签署后才从项目应收和未收的原合同付款节点扣除；原合同、签名及收款记录保留。</p>${locked?'':`<div class="grid"><label class="wide">原合同减项<select data-line><option value="">选择原合同项目</option>${lines.map(l=>`<option value="${E(l.id)}">#${E(l.id)} · ${E(l.name)} · ${M(Number(l.qty)*Number(l.rate))}</option>`).join('')}</select></label><label class="wide">减项原因<textarea data-reason maxlength="500" placeholder="例如：客户确认取消施工"></textarea></label></div><p data-preview>选择项目后显示折后减款。</p><button type="button" data-add>保存减项，等待客户签署</button>`}<p data-feedback role="status" aria-live="polite"></p><div>${data.entries.map(d=>`<article class="customer-line"><b>#${E(d.line_id)} · ${E(d.line_name)}</b><p>原清单 ${M(d.original_amount)} · 折后减少 ${M(d.discount_credit)}</p><p>原因：${E(d.reason)}</p><p>${d.status==='signed'?`<span style="color:#15803d">客户已签署 · ${E(d.signer_name)} · ${E(new Date(d.signed_at).toLocaleString('zh-CN'))}</span>`:d.status==='voided'?'已撤销 · '+E(d.void_reason):'待客户签署，尚未减少项目应收'}</p>${d.status!=='voided'?`<button type="button" class="secondary" data-copy="${E(d.id)}">${d.status==='signed'?'复制已签确认单链接':'复制客户签署链接'}</button>`:''}${d.status==='pending'?`<button type="button" class="secondary" data-void="${E(d.id)}">撤销待签减项</button>`:''}</article>`).join('')||'<p>暂无减项确认单。</p>'}</div>`;
  let busy=false,entryId=crypto.randomUUID();const feedback=el.querySelector('[data-feedback]');
  async function send(action,id,payload){
   if(busy)return;if(!canSave()){feedback.textContent='请先保存当前核对内容。';return;}
   busy=true;el.querySelectorAll('button').forEach(b=>b.disabled=true);feedback.textContent='正在保存减项…';
   try{const {error}=await sb.rpc('renovation_deduction_command',{p_id:project.id,p_revision:project.revision,p_action:action,p_entry:id,p_data:payload});if(error)throw error;changed=false;await onChange();}
   catch(e){feedback.textContent=e.message||'保存失败，请刷新核对。';}
   finally{busy=false;el.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  if(!locked){
   const select=el.querySelector('[data-line]'),reason=el.querySelector('[data-reason]');
   select.onchange=()=>{changed=true;const line=lines.find(l=>String(l.id)===select.value);el.querySelector('[data-preview]').textContent=line?`原价 ${M(Number(line.qty)*Number(line.rate))} × 折后比例 ${E((ratio*100).toFixed(4))}% ≈ 减少 ${M(Math.round(Number(line.qty)*Number(line.rate)*ratio*100)/100)}`:'选择项目后显示折后减款。';};
   reason.oninput=()=>changed=true;
   el.querySelector('[data-add]').onclick=()=>{const line=lines.find(l=>String(l.id)===select.value),why=reason.value.trim();if(!line||!why){feedback.textContent='请选择原合同项目并填写减项原因。';return;}const credit=Math.round(Number(line.qty)*Number(line.rate)*ratio*100)/100;if(!confirm(`确认登记「${line.name}」减项？签署后将减少 ${M(credit)}。`))return;send('add',entryId,{line_id:String(line.id),reason:why});};
  }
  el.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{const d=data.entries.find(x=>x.id===b.dataset.copy),url=new URL('renovation-deduction-sign.html',location.href);url.searchParams.set('deduction',d.id);url.searchParams.set('sign',d.signing_token);try{await navigator.clipboard.writeText(url.href);feedback.textContent='已复制这张减项确认单的专属链接，可发给业主或其授权的家人签署。';}catch{feedback.replaceChildren();const input=document.createElement('textarea');input.readOnly=true;input.value=url.href;feedback.append(input);input.focus();input.select();}});
  el.querySelectorAll('[data-void]').forEach(b=>b.onclick=()=>{const reason=prompt('请填写撤销待签减项的原因。');if(reason?.trim())send('void',b.dataset.void,{reason:reason.trim()});});
 }
 return {render,isDirty:()=>changed,clear:()=>{changed=false;}};
})();
