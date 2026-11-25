'use strict';
// 施工师傅 / 厂家看图页：链接 + 门店单独给的 4 位验证码，显示这个项目所有图纸的最新版。不显示价格和业主电话。
(()=>{
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const params=new URLSearchParams(location.search),id=params.get('share'),token=params.get('t');
 const uuid=s=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s||'');
 const KIND={render:'效果图',drawing:'施工图'},KEY='houzy-design-code-'+id;
 let sb,el;
 function gate(note=''){
  el.innerHTML=`<h2>输入验证码</h2><p>请输入门店另外发给你的 <b>4 位验证码</b>。</p><label>验证码<input data-code inputmode="numeric" maxlength="4" autocomplete="one-time-code" pattern="[0-9]{4}"></label><button type="button" data-verify>验证并看图</button><p data-feedback role="status">${E(note)}</p>`;
  const input=el.querySelector('[data-code]'),go=()=>{const v=input.value.trim();if(!/^\d{4}$/.test(v)){el.querySelector('[data-feedback]').textContent='请输入4位数字。';return;}open(v).catch(e=>gate(e.message));};
  el.querySelector('[data-verify]').onclick=go;input.onkeydown=e=>{if(e.key==='Enter')go();};input.focus();
 }
 const stop=t=>{try{sessionStorage.removeItem(KEY);}catch(e){}el.innerHTML=`<h2>施工图纸</h2><p>${E(t)}</p>`;};
 async function open(code){
  el.querySelector('[data-verify]')?.setAttribute('disabled','');
  const {data,error}=await sb.rpc('renovation_design_share_open',{p_id:id,p_token:token,p_code:code});
  if(error||!data)throw new Error('看图链接无效，请联系门店重新发送。');
  if(data.status==='revoked')return stop('这个看图链接已停用，请联系门店。');
  if(data.status==='locked')return stop('验证码错误次数过多，链接已锁定。请联系门店重新发送。');
  if(data.status==='wrong_code'){try{sessionStorage.removeItem(KEY);}catch(e){}return gate(`验证码不正确，还可尝试 ${data.remaining} 次。`);}
  try{sessionStorage.setItem(KEY,code);}catch(e){}
  const files=data.files||[],urls={};
  if(files.length){try{const r=await sb.storage.from('renovation-fulfillment').createSignedUrls(files.map(f=>f.path),3600);for(const x of r.data||[])if(x.signedUrl)urls[x.path]=x.signedUrl;}catch(e){}}
  const group=k=>{const list=files.filter(f=>f.kind===k);if(!list.length)return '';
   return `<h3>${KIND[k]}（${list.length}）</h3>${list.map(f=>{const u=urls[f.path],img=/^image\//.test(f.mime||'');
    return `<a class="dv-item" ${u?`href="${E(u)}" target="_blank" rel="noopener"`:''}>${img&&u?`<img src="${E(u)}" alt="${E(f.title)}" loading="lazy">`:`<span class="dv-ico">${img?'🖼':'PDF'}</span>`}<span><b>${E(f.title)}</b><small>第 ${E(f.version)} 版 · ${E(String(f.created_at||'').slice(0,10))} 更新${u?' · 点开看大图':''}</small></span></a>`;}).join('')}`;};
  el.innerHTML=`<h2>${E(data.contract_no||'施工图纸')}</h2><p>${E(data.address||'')}</p><p>查看人：<b>${E(data.label)}</b></p>
   ${files.length?group('drawing')+group('render'):'<p>门店还没上传图纸。</p>'}
   <p class="muted">图纸以门店最新上传为准；看到有疑问请先问门店再动工。12 小时后需要重新输入验证码。</p>
   <button type="button" class="secondary" data-refresh>刷新图纸</button>`;
  el.querySelector('[data-refresh]').onclick=()=>open(code).catch(e=>gate(e.message));
 }
 addEventListener('DOMContentLoaded',()=>{
  const msg=document.getElementById('message');
  try{
   if(!window.supabase)throw new Error('网络组件未加载，请刷新重试。');
   if(!uuid(id)||!uuid(token))throw new Error('请使用门店发送的完整看图链接。');
   sb=supabase.createClient('https://csabbxiijzghooppayae.supabase.co','sb_publishable__9KY2RRSxb1excfVxBTH_Q_5HtFWxmH',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
   el=document.getElementById('design-view');el.hidden=false;msg.textContent='';msg.hidden=true;
   let saved='';try{saved=sessionStorage.getItem(KEY)||'';}catch(e){}
   if(/^\d{4}$/.test(saved)){el.innerHTML='<p>正在读取图纸…</p>';open(saved).catch(e=>gate(e.message));}else gate();
  }catch(e){msg.textContent=e.message;msg.classList.add('error');}
 });
})();
