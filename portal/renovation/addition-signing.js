'use strict';
window.RenoAdditionSigning=(()=>{
 let sb,token,dirty=false,busy=false,view=null,strokes=[],canvas,ctx,refreshing=false;
 const E=s=>RenoFinanceView.esc(s),M=n=>RenoFinanceView.money(n);
 const params=new URLSearchParams(location.search),addition=params.get('addition'),sign=params.get('sign');
 const uuid=s=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s||'');
 function terms(t){return `<h3>${t.category==='work'?'新增工项':'新增材料'} · ${E(t.name)}</h3><p>主合同：${E(t.contract_no)}<br>项目地址：${E(t.address)}</p><p>${E(t.spec)}</p><div class="grid"><div>数量<br><b>${E(t.qty)} ${E(t.unit)}</b></div><div>单价<br><b>${M(t.rate)}</b></div><div>本次新增金额<br><b>${M(t.amount)}</b></div><div>签署后项目应收总额<br><b>${M(t.after_sign_total)}</b></div></div><p>付款节点：${E(t.payment_node)}</p><p class="muted">${E(t.warranty_note)}</p>`;}
 function paint(){if(!ctx)return;const w=canvas.clientWidth||600,h=180,dpr=Math.min(window.devicePixelRatio||1,3);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.lineWidth=2.2;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#22362e';for(const stroke of strokes){if(stroke.length<2)continue;ctx.beginPath();ctx.moveTo(stroke[0][0]*w,stroke[0][1]*h);for(const p of stroke.slice(1))ctx.lineTo(p[0]*w,p[1]*h);ctx.stroke();}}
 async function refresh(){
  if(!sb||refreshing)return;refreshing=true;
  const el=document.getElementById('customer-additions-list');
  try{const {data,error}=await sb.rpc('renovation_customer_additions',{p_token:token});if(error||!Array.isArray(data))throw new Error('新增单暂时无法读取，请刷新重试。');
   el.innerHTML=data.map(a=>`<article class="customer-line"><b>${a.category==='work'?'工项':'材料'} · ${E(a.name)}</b><p>${E(a.qty)} ${E(a.unit)} × ${M(a.rate)} = ${M(a.amount)}</p><p>付款节点：${E(a.payment_node)}</p><p>${a.voided?'已撤销':a.signature_status==='signed'?`<span style="color:#15803d">已由客户电子签署 · ${E(a.signer_name)} · ${E(new Date(a.signed_at).toLocaleString('zh-CN'))}</span>`:'待客户电子签署，尚未计入项目应收。请打开门店提供的专属签署链接确认。'}</p></article>`).join('')||'<p>暂无新增工项或材料确认单。</p>';
  }catch(e){el.textContent=e.message;}finally{refreshing=false;}
 }
 async function loadSigning(){
  if(busy)return;
  if(!uuid(addition)||!uuid(sign))return;
  const el=document.getElementById('addition-signing');el.hidden=false;el.textContent='正在读取待签新增单…';
  try{const {data,error}=await sb.rpc('renovation_customer_addition_sign_view',{p_token:token,p_addition:addition,p_sign_token:sign});if(error||!data)throw new Error('签署链接无效或已撤销，请联系门店重新提供。');view=data;strokes=data.signature_strokes||[];dirty=false;
   el.innerHTML='<h2>新增项目确认单</h2>'+terms(data.terms)+(data.status==='voided'?'<p>此新增单已撤销，不能签署。</p>':data.status==='signed'?`<p style="color:#15803d">已签署 · ${E(data.signer_name)} · ${E(new Date(data.signed_at).toLocaleString('zh-CN'))}</p><canvas data-signature style="width:100%;height:180px;display:block;border:1px solid #dce2df;border-radius:8px;background:white"></canvas><p class="muted" style="overflow-wrap:anywhere">签署凭据：${E(data.signature_hash)}</p><button type="button" data-print class="secondary">打印／保存已签确认单</button>`:`<label>签署姓名<input data-name maxlength="100" autocomplete="name" placeholder="填写您的姓名"></label><p>请在下方手写签名：</p><canvas data-signature aria-label="新增单手写签名" style="width:100%;height:180px;display:block;border:1px solid #b2bcb6;border-radius:8px;background:white;touch-action:none"></canvas><div class="actions"><button type="button" data-clear class="secondary">清除重签</button><button type="button" data-reload class="secondary">重新核对最新内容</button></div><label class="check"><input type="checkbox" data-consent>我已核对以上工项／材料、数量、单价、金额及付款节点，同意此新增单并以电子签名确认。</label><button type="button" data-submit>电子签名确认新增单</button><p data-feedback role="status" aria-live="polite"></p>`);
   canvas=el.querySelector('[data-signature]');if(canvas){ctx=canvas.getContext('2d');paint();}
   if(data.status==='signed'){
    el.querySelector('[data-print]').onclick=()=>{const tab=window.open('about:blank','_blank');if(!tab)return;tab.opener=null;const image=canvas.toDataURL('image/png');tab.document.write(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>已签新增项目确认单</title><style>body{font:15px/1.7 sans-serif;max-width:850px;margin:35px auto;padding:20px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.muted{color:#647268}@media print{button{display:none}}</style><body><button onclick="window.print()">打印／保存PDF</button><h1>HOUZY HOME · 已签新增项目确认单</h1>${terms(data.terms)}<p>签署人：${E(data.signer_name)}<br>签署时间：${E(new Date(data.signed_at).toLocaleString('zh-CN'))}</p><img alt="客户手写签名" src="${image}" style="max-width:100%;border:1px solid #ddd"><p style="overflow-wrap:anywhere">签署凭据：${E(data.signature_hash)}</p></body></html>`);tab.document.close();};
    return;
   }
   if(data.status==='voided')return;
   const feedback=el.querySelector('[data-feedback]');let activePointer=null;
   const point=e=>{const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
   canvas.onpointerdown=e=>{if(busy||activePointer!==null||e.button!==0)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);activePointer=e.pointerId;strokes.push([point(e)]);dirty=true;};
   canvas.onpointermove=e=>{if(e.pointerId!==activePointer||busy)return;e.preventDefault();const p=point(e),s=strokes.at(-1),prev=s.at(-1);if(Math.abs(p[0]-prev[0])+Math.abs(p[1]-prev[1])<0.001)return;if(strokes.reduce((n,s)=>n+s.length,0)>=2048)return;s.push(p);paint();};
   const finishStroke=e=>{if(e.pointerId!==activePointer)return;activePointer=null;if(strokes.at(-1)?.length<2)strokes.pop();paint();};
   canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=finishStroke;
   el.querySelector('[data-name]').oninput=()=>dirty=true;el.querySelector('[data-consent]').onchange=()=>dirty=true;
   el.querySelector('[data-clear]').onclick=()=>{if(busy||activePointer!==null)return;strokes=[];dirty=true;paint();feedback.textContent='请重新手写签名。';};
   el.querySelector('[data-reload]').onclick=()=>{if(busy)return;if(!dirty||confirm('重新核对会清除尚未提交的签名，继续？'))loadSigning();};
   el.querySelector('[data-submit]').onclick=async()=>{
    if(busy||activePointer!==null)return;const name=el.querySelector('[data-name]').value.trim(),accepted=el.querySelector('[data-consent]').checked;
    if(!name||!accepted||strokes.reduce((n,s)=>n+s.length,0)<8){feedback.textContent='请填写姓名、完整手写签名，并勾选确认。';return;}
    busy=true;el.querySelectorAll('button,input').forEach(b=>b.disabled=true);feedback.textContent='正在提交签署，请稍候…';
    try{const {data,error}=await sb.rpc('renovation_customer_sign_addition',{p_token:token,p_addition:addition,p_sign_token:sign,p_terms_hash:view.terms_hash,p_name:name,p_strokes:strokes,p_accept:true});if(error||!data?.ok)throw new Error(error?.message||'签署暂未成功，请重试或联系门店。');dirty=false;location.reload();}
    catch(e){feedback.textContent=e.message;}finally{busy=false;el.querySelectorAll('button,input').forEach(b=>b.disabled=false);}
   };
  }catch(e){el.textContent=e.message;}
 }
 async function mount(client,projectToken){sb=client;token=projectToken;document.getElementById('customer-additions-panel').hidden=false;await refresh();await loadSigning();window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});window.addEventListener('resize',()=>{if(canvas&&ctx)paint();});window.addEventListener('reno:customer-step',()=>{if(canvas&&ctx&&canvas.clientWidth)paint();});}
 return {mount,refresh,refreshSigning:()=>!dirty&&!busy?loadSigning():Promise.resolve(),isDirty:()=>dirty,isBusy:()=>busy};
})();
