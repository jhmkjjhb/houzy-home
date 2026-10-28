'use strict';
// Owner signing page for the main contract: phone last-4 check, full PDF reading, hand-drawn signature.
window.RenoContractSigning=(()=>{
 const E=s=>RenoFinanceView.esc(s),M=n=>RenoFinanceView.money(n);
 const params=new URLSearchParams(location.search),id=params.get('contract'),token=params.get('sign');
 const uuid=s=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s||'');
 const PDFJS='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
 let sb,el,last4='',view,strokes=[],canvas,ctx,busy=false,dirty=false;
 async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
 function paint(){if(!canvas)return;const w=canvas.clientWidth||600,h=180,dpr=Math.min(devicePixelRatio||1,3);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.lineWidth=2.2;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#22362e';for(const s of strokes){if(s.length<2)continue;ctx.beginPath();ctx.moveTo(s[0][0]*w,s[0][1]*h);for(const p of s.slice(1))ctx.lineTo(p[0]*w,p[1]*h);ctx.stroke();}}
 function gate(note=''){
  el.innerHTML=`<h2>业主身份验证</h2><p>本合同只能由业主本人签署。请输入业主登记手机号的<b>后四位</b>，验证后显示合同全文。</p><label>手机号后四位<input data-last4 inputmode="numeric" maxlength="4" autocomplete="off" pattern="[0-9]{4}"></label><button type="button" data-verify>验证并查看合同</button><p data-feedback role="status" aria-live="polite">${E(note)}</p>`;
  const input=el.querySelector('[data-last4]'),go=()=>{const v=input.value.trim();if(!/^\d{4}$/.test(v)){el.querySelector('[data-feedback]').textContent='请输入4位数字。';return;}last4=v;open().catch(e=>gate(e.message));};
  el.querySelector('[data-verify]').onclick=go;input.onkeydown=e=>{if(e.key==='Enter')go();};input.focus();
 }
 function done(text){el.innerHTML=`<h2>合同签署</h2><p>${text}</p>`;}
 async function open(){
  el.querySelector('[data-verify]')?.setAttribute('disabled','');
  const {data,error}=await sb.rpc('renovation_contract_esign_open',{p_esign:id,p_sign_token:token,p_last4:last4});
  if(error||!data)throw new Error('签署链接无效或已撤销，请联系门店重新提供。');
  if(data.status==='voided')return done('此签署链接已作废，请联系门店重新发送。');
  if(data.status==='locked')return done('手机号验证错误次数过多，链接已锁定。请联系门店重新发送签署链接。');
  if(data.status==='wrong_phone')return gate(`手机号后四位不正确，还可尝试 ${data.remaining} 次。`);
  if(data.status!=='pending')return done(`<span style="color:#15803d">合同已于 ${E(new Date(data.signed_at).toLocaleString('zh-CN'))} 由 ${E(data.signer_name)} 签署。</span>门店会签后，已签合同PDF可在您的客户页面查看。`);
  view=data;const t=data.terms;
  el.innerHTML=`<h2>${E(t.contract_no)}</h2><p>${E(t.address)}</p><div class="grid"><div>业主<br><b>${E(t.customer_name)}</b></div><div>合同总价<br><b>${M(t.money.net)}</b></div></div><details><summary>付款计划（${t.money.payments.length}期）</summary>${t.money.payments.map((p,i)=>`<p>${i+1}. ${E(p.name)} · ${M(p.amount)}</p>`).join('')}</details><h3>合同全文</h3><p class="muted">请完整阅读以下合同各页，再在页面底部签名。</p><div data-pages>正在加载合同全文…</div><div data-sign hidden></div>`;
  await pages();
 }
 async function pages(){
  const box=el.querySelector('[data-pages]');
  const {data:blob,error}=await sb.storage.from('renovation-contracts').download(view.contract_path);
  if(error||!blob){box.textContent='合同文件加载失败，请刷新页面重新验证。';return;}
  const bytes=await blob.arrayBuffer();
  if(await sha256(bytes)!==view.terms.contract_sha256){box.textContent='合同文件校验失败，不能签署。请联系门店。';return;}
  const pdfjs=await import(PDFJS);pdfjs.GlobalWorkerOptions.workerSrc=PDFJS.replace('pdf.min.mjs','pdf.worker.min.mjs');
  const doc=await pdfjs.getDocument({data:bytes,isEvalSupported:false}).promise;box.replaceChildren();
  for(let n=1;n<=doc.numPages;n++){
   const page=await doc.getPage(n),base=page.getViewport({scale:1}),width=Math.min(box.clientWidth||360,900),dpr=Math.min(devicePixelRatio||1,2);
   const vp=page.getViewport({scale:width/base.width*dpr}),c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;
   c.style.cssText='width:100%;display:block;margin:0 0 12px;border:1px solid #dce2df;background:white';c.setAttribute('aria-label',`合同第 ${n} 页`);
   box.append(c);await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
  }
  sign(doc.numPages);
 }
 function sign(total){
  const box=el.querySelector('[data-sign]');box.hidden=false;const name=view.terms.customer_name;
  box.innerHTML=`<h3>业主签名</h3><p>签署人：<b>${E(name)}</b>（合同业主本人）</p><p>请在下方手写签名：</p><canvas data-signature aria-label="合同手写签名" style="width:100%;height:180px;display:block;border:1px solid #b2bcb6;border-radius:8px;background:white;touch-action:none"></canvas><div class="actions"><button type="button" data-clear class="secondary">清除重签</button></div><label class="check"><input type="checkbox" data-consent>我是合同业主 ${E(name)} 本人，已阅读上方合同全部 ${total} 页，同意合同全部条款，并以手写电子签名签署。</label><button type="button" data-submit>电子签名签署合同</button><p data-feedback role="status" aria-live="polite"></p>`;
  canvas=box.querySelector('[data-signature]');ctx=canvas.getContext('2d');strokes=[];paint();
  const feedback=box.querySelector('[data-feedback]');let pointer=null;
  const point=e=>{const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
  canvas.onpointerdown=e=>{if(busy||pointer!==null||e.button!==0)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);pointer=e.pointerId;strokes.push([point(e)]);dirty=true;};
  canvas.onpointermove=e=>{if(e.pointerId!==pointer||busy)return;e.preventDefault();const p=point(e),s=strokes.at(-1),last=s.at(-1);if(Math.abs(p[0]-last[0])+Math.abs(p[1]-last[1])<0.001)return;if(strokes.reduce((n,v)=>n+v.length,0)>=2048)return;s.push(p);paint();};
  canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=e=>{if(e.pointerId!==pointer)return;pointer=null;if(strokes.at(-1)?.length<2)strokes.pop();paint();};
  box.querySelector('[data-clear]').onclick=()=>{if(busy||pointer!==null)return;strokes=[];dirty=true;paint();feedback.textContent='请重新手写签名。';};
  box.querySelector('[data-submit]').onclick=async()=>{
   if(busy||pointer!==null)return;
   if(!box.querySelector('[data-consent]').checked||strokes.reduce((n,v)=>n+v.length,0)<8){feedback.textContent='请完整手写签名，并勾选确认。';return;}
   busy=true;box.querySelectorAll('button,input').forEach(x=>x.disabled=true);feedback.textContent='正在提交签署，请稍候…';
   try{const {data,error}=await sb.rpc('renovation_contract_esign_sign',{p_esign:id,p_sign_token:token,p_last4:last4,p_terms_hash:view.terms_hash,p_strokes:strokes,p_accept:true});
    if(error||!data?.ok)throw new Error(error?.message||'签署暂未成功，请重试。');
    dirty=false;done('<span style="color:#15803d">签署成功，谢谢！</span>门店店长会签后，已签合同PDF可在您的客户页面查看。');}
   catch(e){feedback.textContent=e.message;}finally{busy=false;box.querySelectorAll('button,input').forEach(x=>x.disabled=false);}
  };
 }
 async function mount(client){
  if(!uuid(id)||!uuid(token))throw new Error('请使用门店发送的完整合同签署链接。');
  sb=client;el=document.getElementById('contract-signing');el.hidden=false;gate();
  addEventListener('resize',paint);addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 }
 return {mount};
})();
