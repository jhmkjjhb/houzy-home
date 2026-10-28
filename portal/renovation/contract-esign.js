'use strict';
// Staff side of contract e-signature: request a signing link for the saved unsigned PDF,
// follow the owner's status, and countersign while confirming the contract.
window.RenoContractEsign=(()=>{
 const E=s=>RenoFinanceView.esc(s);
 const time=t=>new Date(t).toLocaleString('zh-CN');
 let record=null,strokes=[],canvas=null,ctx=null,loadId=0;
 function paint(){if(!canvas)return;const w=canvas.clientWidth||600,h=180,dpr=Math.min(devicePixelRatio||1,3);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.lineWidth=2.2;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#22362e';for(const s of strokes){if(s.length<2)continue;ctx.beginPath();ctx.moveTo(s[0][0]*w,s[0][1]*h);for(const p of s.slice(1))ctx.lineTo(p[0]*w,p[1]*h);ctx.stroke();}}
 function pad(){
  let pointer=null;const point=e=>{const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
  canvas.onpointerdown=e=>{if(pointer!==null||e.button!==0)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);pointer=e.pointerId;strokes.push([point(e)]);};
  canvas.onpointermove=e=>{if(e.pointerId!==pointer)return;e.preventDefault();const p=point(e),s=strokes.at(-1),last=s.at(-1);if(Math.abs(p[0]-last[0])+Math.abs(p[1]-last[1])<0.001)return;if(strokes.reduce((n,v)=>n+v.length,0)>=2048)return;s.push(p);paint();};
  canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=e=>{if(e.pointerId!==pointer)return;pointer=null;if(strokes.at(-1)?.length<2)strokes.pop();paint();};
 }
 async function render({project,sb,isDirty,onChange}){
  const el=document.getElementById('contract-esign');if(!el)return;
  const id=++loadId;record=null;strokes=[];canvas=null;
  if(!project){el.innerHTML='';return;}
  const {data,error}=await sb.rpc('renovation_contract_esign_view',{p_id:project.id});
  if(id!==loadId)return;
  if(error){el.innerHTML='<p class="warning">电子签署状态暂时无法读取，请刷新重试。</p>';return;}
  record=data;
  if(project.state!=='draft'){el.innerHTML=record?.status==='countersigned'?`<p style="color:#15803d">电子签署合同 · 业主 ${E(record.signer_name)} ${E(time(record.signed_at))} · 会签 ${E(record.company_signer_name)} ${E(time(record.company_signed_at))}。「查看归档合同」打开的是已签版本。</p>`:'';return;}
  const s=record?.status;
  el.innerHTML=`<h3>业主电子签署</h3>${!s||s==='voided'?`<p>合同PDF是未签名的电子版时，可请业主在线阅读并手写签名，签名页附在原PDF末尾归档。纸质已签合同不需要此步骤。</p>${s==='voided'?`<p class="muted">上次签署已作废：${E(record.void_reason)}</p>`:''}<button type="button" data-request>发起业主电子签署</button>`
   :s==='pending'?`<p><b>待业主签署</b> · 发起于 ${E(time(record.created_at))}。只有业主本人可签：打开链接须输入登记手机号后四位。修改合同金额、付款计划或PDF后，此链接自动作废。</p><div class="actions"><button type="button" data-copy>复制签署链接</button><button type="button" data-void class="secondary">作废签署链接</button></div>`
   :s==='signed'?`<p style="color:#15803d"><b>业主已签署</b> · ${E(record.signer_name)} · ${E(time(record.signed_at))}。签约日期已按签署日自动填写。</p><p>店长会签：请在下方手写签名，再勾选核对项并点击「确认合同并锁定版本」。系统会把双方签名页附在原PDF末尾，归档为已签合同。</p><label>会签人姓名<input data-cs-name maxlength="100" autocomplete="name"></label><canvas data-cs-pad aria-label="店长会签手写签名" style="width:100%;height:180px;display:block;border:1px solid #b2bcb6;border-radius:8px;background:white;touch-action:none"></canvas><div class="actions"><button type="button" data-clear class="secondary">清除重签</button><button type="button" data-void class="secondary">作废业主签署</button></div>`
   :`<p style="color:#15803d"><b>双方已签署</b>，已签合同已归档。请勾选核对项并点击「确认合同并锁定版本」。</p>`}<p data-esign-feedback role="status" aria-live="polite"></p>`;
  const feedback=el.querySelector('[data-esign-feedback]');
  const send=async(action,payload)=>{const {error:e}=await sb.rpc('renovation_contract_esign_command',{p_id:project.id,p_revision:project.revision,p_action:action,p_data:payload});if(e)throw e;await onChange();};
  const guard=fn=>async()=>{el.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){feedback.textContent=e.message||'操作失败，请刷新后重试。';}finally{el.querySelectorAll('button').forEach(b=>b.disabled=false);}};
  el.querySelector('[data-request]')?.addEventListener('click',guard(async()=>{
   if(isDirty())throw new Error('请先点击「保存核对版本」，再发起签署。');
   if(!project.snapshot?.contract_path)throw new Error('请先上传未签名合同PDF并保存核对版本。');
   feedback.textContent='正在读取归档合同…';
   const {data:blob,error:e}=await sb.storage.from('renovation-contracts').download(project.snapshot.contract_path);if(e)throw e;
   await send('request',{contract_sha256:await RenoContractPdf.sha256(await blob.arrayBuffer())});
  }));
  el.querySelector('[data-copy]')?.addEventListener('click',async()=>{const url=new URL('renovation-contract-sign.html',location.href);url.searchParams.set('contract',record.id);url.searchParams.set('sign',record.signing_token);
   try{await navigator.clipboard.writeText(url.href);feedback.textContent='已复制合同签署链接，请发给业主本人；业主须输入登记手机号后四位才能查看和签署。';}catch{feedback.replaceChildren();const t=document.createElement('textarea');t.readOnly=true;t.value=url.href;feedback.append(t);t.focus();t.select();}});
  el.querySelector('[data-void]')?.addEventListener('click',guard(async()=>{const reason=prompt('请填写作废原因（作废后需重新发起签署）。');if(reason?.trim())await send('void',{reason:reason.trim()});}));
  canvas=el.querySelector('[data-cs-pad]');
  if(canvas){paint();pad();el.querySelector('[data-clear]').onclick=()=>{strokes=[];paint();};}
 }
 // Called by「确认合同并锁定版本」. Returns false for a paper contract (no e-sign), true once
 // the signed PDF is archived and countersigned; throws when the owner has not signed yet.
 async function beforeConfirm({project,sb}){
  const s=record?.status;
  if(!s||s==='voided')return false;
  if(s==='pending')throw new Error('业主尚未完成电子签署，请等业主签署后再确认合同。');
  if(s==='countersigned')return true;
  const name=document.querySelector('[data-cs-name]')?.value.trim();
  if(!name||strokes.reduce((n,v)=>n+v.length,0)<8)throw new Error('请填写会签人姓名并在会签框内完整手写签名。');
  const {data:blob,error:e}=await sb.storage.from('renovation-contracts').download(record.contract_path);if(e)throw e;
  const original=await blob.arrayBuffer();
  if(await RenoContractPdf.sha256(original)!==record.contract_sha256)throw new Error('归档合同PDF与业主签署时不一致，请作废后重新发起签署。');
  const signed=await RenoContractPdf.build({pdf:original,terms:record.terms,
   owner:{name:record.signer_name,strokes:record.signature_strokes,signed_at:record.signed_at,hash:record.signature_hash},
   company:{name,strokes,signed_at:new Date().toISOString()}});
  const path=`${project.id}/signed-contract-${crypto.randomUUID()}.pdf`;
  const up=await sb.storage.from('renovation-contracts').upload(path,new Blob([signed.bytes],{type:'application/pdf'}),{contentType:'application/pdf',upsert:false});if(up.error)throw up.error;
  const {error:failure}=await sb.rpc('renovation_contract_esign_command',{p_id:project.id,p_revision:project.revision,p_action:'countersign',p_data:{signer_name:name,strokes,signed_pdf_path:path,signed_pdf_sha256:signed.sha256}});
  if(failure)throw failure;
  record={...record,status:'countersigned'};return true;
 }
 // Owner signature stamps the signed date on the server, so the client-side date check is skipped.
 const active=()=>!!record&&record.status!=='voided';
 return {render,beforeConfirm,active};
})();
