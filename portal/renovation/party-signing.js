'use strict';
// 工厂 / 负责人签字页：链接 + 门店单独给的 4 位验证码，逐项核对，手写签字。不显示价格和业主电话。
(()=>{
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const params=new URLSearchParams(location.search),id=params.get('signoff'),token=params.get('sign');
 const uuid=s=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s||'');
 const PDFJS='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.min.mjs';
 const TITLE={order:'工厂确认下单内容',arrival:'到货验收',install:'安装完工确认',issue:'问题处理确认'};
 const CONSENT={
  order:'我已逐项核对上方清单和附件，确认名称、规格、颜色、尺寸和数量无误，按此生产 / 备货。',
  arrival:'我已逐项清点上方货品，数量和外观与清单一致；如有缺件、破损，已在备注写明。',
  install:'上方各项已按图纸安装完成；如有遗留问题，已在备注写明。',
  issue:'上方问题已按说明处理完成；如仍有遗留，已在备注写明。'
 };
 const NOTE_HINT={order:'备注（选填，如需改动请写明）',arrival:'备注（如有缺件、破损请写明）',install:'备注（如有遗留问题请写明）',issue:'备注（处理结果或遗留问题）'};
 let sb,el,code='',view,strokes=[],canvas,ctx,busy=false,dirty=false;
 async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
 function paint(){if(!canvas)return;const w=canvas.clientWidth||600,h=180,dpr=Math.min(devicePixelRatio||1,3);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.lineWidth=2.2;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#22362e';for(const s of strokes){if(s.length<2)continue;ctx.beginPath();ctx.moveTo(s[0][0]*w,s[0][1]*h);for(const p of s.slice(1))ctx.lineTo(p[0]*w,p[1]*h);ctx.stroke();}}
 function gate(note=''){
  el.innerHTML=`<h2>输入验证码</h2><p>请输入门店另外发给你的 <b>4 位验证码</b>。</p><label>验证码<input data-code inputmode="numeric" maxlength="4" autocomplete="one-time-code" pattern="[0-9]{4}"></label><button type="button" data-verify>验证并查看</button><p data-feedback role="status">${E(note)}</p>`;
  const input=el.querySelector('[data-code]'),go=()=>{const v=input.value.trim();if(!/^\d{4}$/.test(v)){el.querySelector('[data-feedback]').textContent='请输入4位数字。';return;}code=v;openIt().catch(e=>gate(e.message));};
  el.querySelector('[data-verify]').onclick=go;input.onkeydown=e=>{if(e.key==='Enter')go();};input.focus();
 }
 function done(text){el.innerHTML=`<h2>核对签字</h2><p>${text}</p>`;}
 async function openIt(){
  el.querySelector('[data-verify]')?.setAttribute('disabled','');
  const {data,error}=await sb.rpc('renovation_signoff_open',{p_id:id,p_token:token,p_code:code});
  if(error||!data)throw new Error('签字链接无效或已撤销，请联系门店重新发送。');
  if(data.status==='voided')return done('此链接已撤销，请联系门店重新发送。');
  if(data.status==='locked')return done('验证码错误次数过多，链接已锁定。请联系门店重新发送。');
  if(data.status==='wrong_code')return gate(`验证码不正确，还可尝试 ${data.remaining} 次。`);
  if(data.status!=='pending')return done(`<span style="color:#15803d">已于 ${E(new Date(data.signed_at).toLocaleString('zh-CN'))} 由 ${E(data.signer_company)} ${E(data.signer_name)} 签字确认。</span>`);
  view=data;const t=data.terms;
  const shortGroup=(name,items)=>{const m=/^增项-[0-9a-f-]{36} · ?(.*)$/i.exec(String(name||''));if(!m)return name;const n=(items||[]).filter(Boolean);return n.length?`增项：${n.slice(0,2).join('、')}${n.length>2?` 等${n.length}项`:''}${m[1]?`（${m[1]}）`:''}`:`增项${m[1]?' · '+m[1]:''}`;};
  el.innerHTML=`<h2>${E(TITLE[t.purpose]||'核对签字')}</h2><p>${E(shortGroup(t.group_name,t.lines.map(l=>l.name)))} · ${E(t.contract_no)} · ${E(t.address)}</p><p>签字方：<b>${E(t.party)}</b></p>${t.note?`<p class="warning"><b>门店说明：</b>${E(t.note)}</p>`:''}
   <h3>核对清单（${t.lines.length}项）</h3>${t.lines.map((l,n)=>`<p><b>${n+1}. ${E(l.name)}</b><br>${E(l.spec||'规格见附件')} · ${E(l.qty??'')} ${E(l.unit)}${l.issue?`<br><span class="warning">问题：${E(l.issue)}</span>`:''}</p>`).join('')}
   ${data.document_path?'<h3>附件</h3><div data-pages>正在读取文件…</div>':''}<section data-sign hidden></section>`;
  if(data.document_path)await pages();else sign();
 }
 async function pages(){
  const box=el.querySelector('[data-pages]');
  const {data:blob,error}=await sb.storage.from('renovation-fulfillment').download(view.document_path);
  if(error||!blob){box.textContent='附件加载失败，请刷新页面重新验证。';return;}
  const bytes=await blob.arrayBuffer();
  if(await sha256(bytes)!==view.terms.document_sha256){box.textContent='附件校验失败，不能签字。请联系门店。';return;}
  if(!/\.pdf$/i.test(view.document_path)){const img=document.createElement('img');img.src=URL.createObjectURL(blob);img.alt='附件';img.style.cssText='width:100%;display:block;border:1px solid #dce2df';box.replaceChildren(img);sign();return;}
  const pdfjs=await import(PDFJS);pdfjs.GlobalWorkerOptions.workerSrc=PDFJS.replace('pdf.min.mjs','pdf.worker.min.mjs');
  const doc=await pdfjs.getDocument({data:bytes,isEvalSupported:false}).promise;box.replaceChildren();
  for(let n=1;n<=doc.numPages;n++){
   const page=await doc.getPage(n),base=page.getViewport({scale:1}),width=Math.min(box.clientWidth||360,900),dpr=Math.min(devicePixelRatio||1,2);
   const vp=page.getViewport({scale:width/base.width*dpr}),c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;
   c.style.cssText='width:100%;display:block;margin:0 0 12px;border:1px solid #dce2df;background:white';c.setAttribute('aria-label',`附件第 ${n} 页`);
   box.append(c);await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
  }
  sign();
 }
 function sign(){
  const t=view.terms,box=el.querySelector('[data-sign]');box.hidden=false;
  box.innerHTML=`<h3>签字确认</h3><label>签字人姓名<input data-name maxlength="100" autocomplete="name"></label><label>所属工厂 / 单位<input data-company maxlength="120" value="${E(t.party)}"></label><label>${E(NOTE_HINT[t.purpose]||'备注（选填）')}<textarea data-note maxlength="1000" rows="3" style="width:100%"></textarea></label><p>请在下方手写签名：</p><canvas data-signature aria-label="手写签名" style="width:100%;height:180px;display:block;border:1px solid #b2bcb6;border-radius:8px;background:white;touch-action:none"></canvas><div class="actions"><button type="button" data-clear class="secondary">清除重签</button></div><label class="check"><input type="checkbox" data-consent>${E(CONSENT[t.purpose]||'我已核对上方全部内容。')}</label><button type="button" data-submit>确认并签字</button><p data-feedback role="status" aria-live="polite"></p>`;
  canvas=box.querySelector('[data-signature]');ctx=canvas.getContext('2d');strokes=[];paint();
  const feedback=box.querySelector('[data-feedback]');let pointer=null;
  const point=e=>{const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
  canvas.onpointerdown=e=>{if(busy||pointer!==null||e.button!==0)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);pointer=e.pointerId;strokes.push([point(e)]);dirty=true;};
  canvas.onpointermove=e=>{if(e.pointerId!==pointer||busy)return;e.preventDefault();const p=point(e),s=strokes.at(-1),last=s.at(-1);if(Math.abs(p[0]-last[0])+Math.abs(p[1]-last[1])<0.001)return;if(strokes.reduce((n,v)=>n+v.length,0)>=2048)return;s.push(p);paint();};
  canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=e=>{if(e.pointerId!==pointer)return;pointer=null;if(strokes.at(-1)?.length<2)strokes.pop();paint();};
  box.querySelector('[data-clear]').onclick=()=>{if(busy||pointer!==null)return;strokes=[];dirty=true;paint();feedback.textContent='请重新手写签名。';};
  box.querySelector('[data-submit]').onclick=async()=>{
   if(busy||pointer!==null)return;const name=box.querySelector('[data-name]').value.trim(),company=box.querySelector('[data-company]').value.trim();
   if(!name||!company||!box.querySelector('[data-consent]').checked||strokes.reduce((n,v)=>n+v.length,0)<8){feedback.textContent='请填写姓名、工厂 / 单位，完整手写签名，并勾选确认。';return;}
   busy=true;box.querySelectorAll('button,input,select,textarea').forEach(x=>x.disabled=true);feedback.textContent='正在提交，请稍候…';
   try{const {data,error}=await sb.rpc('renovation_signoff_sign',{p_id:id,p_token:token,p_code:code,p_terms_hash:view.terms_hash,p_name:name,p_company:company,p_note:box.querySelector('[data-note]').value.trim(),p_strokes:strokes,p_accept:true});
    if(error||!data?.ok)throw new Error(error?.message||'签字暂未成功，请重试。');
    dirty=false;done('<span style="color:#15803d">签字成功，谢谢！</span>门店已收到记录。');}
   catch(e){feedback.textContent=e.message;}finally{busy=false;box.querySelectorAll('button,input,select,textarea').forEach(x=>x.disabled=false);}
  };
 }
 addEventListener('DOMContentLoaded',()=>{
  const msg=document.getElementById('message');
  try{
   if(!window.supabase)throw new Error('网络组件未加载，请刷新重试。');
   if(!uuid(id)||!uuid(token))throw new Error('请使用门店发送的完整签字链接。');
   sb=supabase.createClient('https://csabbxiijzghooppayae.supabase.co','sb_publishable__9KY2RRSxb1excfVxBTH_Q_5HtFWxmH',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
   el=document.getElementById('party-signing');el.hidden=false;gate();msg.textContent='';msg.hidden=true;
   addEventListener('resize',paint);addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  }catch(e){msg.textContent=e.message;msg.classList.add('error');}
 });
})();
