'use strict';
window.RenoDeductionSigning=(()=>{
 const E=s=>RenoFinanceView.esc(s),M=n=>RenoFinanceView.money(n);
 const params=new URLSearchParams(location.search),id=params.get('deduction'),token=params.get('sign');
 const uuid=s=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s||'');
 let sb,view,strokes=[],canvas,ctx,busy=false,dirty=false;
 const markup=t=>`<h3>#${E(t.line_id)} · ${E(t.line_name)}</h3><p>主合同：${E(t.contract_no)}</p>${t.partial?`<p><b>部分减项</b>：本项照常施工，仅减少未做部分。原项金额 ${M(t.line_amount)}。</p>`:''}<div class="grid"><div>${t.partial?'减少部分原清单价':'原清单金额'}<br><b>${M(t.original_amount)}</b></div><div>签约折后比例<br><b>${E((Number(t.discount_ratio)*100).toFixed(4))}%</b></div><div>本次减少应收<br><b>${M(t.discount_credit)}</b></div></div><p>减项原因：${E(t.reason)}</p><p class="muted">${E(t.note)}</p>`;
 function paint(){if(!ctx||!canvas)return;const w=canvas.clientWidth||600,h=180,dpr=Math.min(devicePixelRatio||1,3);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.lineWidth=2.2;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#22362e';for(const stroke of strokes){if(stroke.length<2)continue;ctx.beginPath();ctx.moveTo(stroke[0][0]*w,stroke[0][1]*h);for(const p of stroke.slice(1))ctx.lineTo(p[0]*w,p[1]*h);ctx.stroke();}}
 async function load(){
  const el=document.getElementById('deduction-signing');el.hidden=false;el.textContent='正在读取减项确认单…';
  const {data,error}=await sb.rpc('renovation_deduction_sign_view',{p_entry:id,p_sign_token:token});
  if(error||!data)throw new Error('签署链接无效或已撤销，请联系门店重新提供。');
  view=data;strokes=data.signature_strokes||[];dirty=false;
  el.innerHTML='<h2>原合同减项确认单</h2>'+markup(data.terms)+(data.status==='voided'?'<p>此减项确认单已撤销，不能签署。</p>':data.status==='signed'?`<p style="color:#15803d">已签署 · ${E(data.signer_name)} · ${E(new Date(data.signed_at).toLocaleString('zh-CN'))}</p><canvas data-signature style="width:100%;height:180px;display:block;border:1px solid #dce2df;border-radius:8px;background:white"></canvas><p class="muted" style="overflow-wrap:anywhere">签署凭据：${E(data.signature_hash)}</p><button type="button" data-print class="secondary">打印／保存已签确认单</button>`:`<label>签署姓名<input data-name maxlength="100" autocomplete="name" placeholder="填写您的姓名"></label><p>请在下方手写签名：</p><canvas data-signature aria-label="减项确认单手写签名" style="width:100%;height:180px;display:block;border:1px solid #b2bcb6;border-radius:8px;background:white;touch-action:none"></canvas><div class="actions"><button type="button" data-clear class="secondary">清除重签</button><button type="button" data-reload class="secondary">重新核对最新内容</button></div><label class="check"><input type="checkbox" data-consent>我已核对取消的原合同项目、原价、折扣比例、实际减款及原因，同意减项并以电子签名确认。</label><button type="button" data-submit>电子签名确认减项</button><p data-feedback role="status" aria-live="polite"></p>`);
  canvas=el.querySelector('[data-signature]');if(canvas){ctx=canvas.getContext('2d');paint();}
  if(data.status==='signed'){
   el.querySelector('[data-print]').onclick=()=>{const tab=window.open('about:blank','_blank');if(!tab)return;tab.opener=null;const image=canvas.toDataURL('image/png');tab.document.write(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>已签减项确认单</title><style>body{font:15px/1.7 sans-serif;max-width:850px;margin:35px auto;padding:20px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.muted{color:#647268}@media print{button{display:none}}</style><body><button onclick="window.print()">打印／保存PDF</button><h1>HOUZY HOME · 已签减项确认单</h1>${markup(data.terms)}<p>签署人：${E(data.signer_name)}<br>签署时间：${E(new Date(data.signed_at).toLocaleString('zh-CN'))}</p><img alt="客户手写签名" src="${image}" style="max-width:100%;border:1px solid #ddd"><p style="overflow-wrap:anywhere">签署凭据：${E(data.signature_hash)}</p></body></html>`);tab.document.close();};return;
  }
  if(data.status==='voided')return;
  const feedback=el.querySelector('[data-feedback]');let pointer=null;
  const point=e=>{const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
  canvas.onpointerdown=e=>{if(busy||pointer!==null||e.button!==0)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);pointer=e.pointerId;strokes.push([point(e)]);dirty=true;};
  canvas.onpointermove=e=>{if(e.pointerId!==pointer||busy)return;e.preventDefault();const p=point(e),s=strokes.at(-1),last=s.at(-1);if(Math.abs(p[0]-last[0])+Math.abs(p[1]-last[1])<0.001)return;if(strokes.reduce((n,v)=>n+v.length,0)>=2048)return;s.push(p);paint();};
  const end=e=>{if(e.pointerId!==pointer)return;pointer=null;if(strokes.at(-1)?.length<2)strokes.pop();paint();};canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=end;
  el.querySelector('[data-name]').oninput=()=>dirty=true;el.querySelector('[data-consent]').onchange=()=>dirty=true;
  el.querySelector('[data-clear]').onclick=()=>{if(busy||pointer!==null)return;strokes=[];dirty=true;paint();feedback.textContent='请重新手写签名。';};
  el.querySelector('[data-reload]').onclick=()=>{if(busy)return;if(!dirty||confirm('重新核对会清除尚未提交的签名，继续？'))load().catch(e=>el.textContent=e.message);};
  el.querySelector('[data-submit]').onclick=async()=>{if(busy||pointer!==null)return;const name=el.querySelector('[data-name]').value.trim();if(!name||!el.querySelector('[data-consent]').checked||strokes.reduce((n,v)=>n+v.length,0)<8){feedback.textContent='请填写姓名、完整手写签名，并勾选确认。';return;}busy=true;el.querySelectorAll('button,input').forEach(x=>x.disabled=true);feedback.textContent='正在提交签署，请稍候…';try{const {data:result,error:failure}=await sb.rpc('renovation_deduction_sign',{p_entry:id,p_sign_token:token,p_terms_hash:view.terms_hash,p_name:name,p_strokes:strokes,p_accept:true});if(failure||!result?.ok)throw new Error(failure?.message||'签署暂未成功，请重试。');dirty=false;location.reload();}catch(e){feedback.textContent=e.message;}finally{busy=false;el.querySelectorAll('button,input').forEach(x=>x.disabled=false);}};
 }
 async function mount(client){if(!uuid(id)||!uuid(token))throw new Error('请使用门店发送的完整减项签署链接。');sb=client;await load();addEventListener('resize',paint);addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});}
 return {mount};
})();
