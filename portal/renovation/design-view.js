'use strict';
// 施工师傅 / 厂家看图页：打开链接就显示这个项目所有图纸的最新版（不用验证码；项目竣工验收或门店停用后失效）。不显示价格和业主电话。
(()=>{
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const params=new URLSearchParams(location.search),id=params.get('share'),token=params.get('t');
 const uuid=s=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s||'');
 const KIND={render:'效果图',drawing:'施工图'};
 let sb,el;
 const stop=t=>{el.innerHTML=`<h2>施工图纸</h2><p>${E(t)}</p>`;};
 async function open(){
  const {data,error}=await sb.rpc('renovation_design_share_open',{p_id:id,p_token:token});
  if(error||!data)return stop('看图链接无效，请联系门店重新发送。');
  if(data.status==='revoked')return stop('这个看图链接已停用，请联系门店。');
  if(data.status==='finished')return stop('这个项目已竣工验收，看图链接已关闭。如还需要图纸，请联系门店。');
  const files=data.files||[],urls={};
  if(files.length){try{const r=await sb.storage.from('renovation-fulfillment').createSignedUrls(files.map(f=>f.path),3600);for(const x of r.data||[])if(x.signedUrl)urls[x.path]=x.signedUrl;}catch(e){}}
  const group=k=>{const list=files.filter(f=>f.kind===k);if(!list.length)return '';
   return `<h3>${KIND[k]}（${list.length}）</h3>${list.map(f=>{const u=urls[f.path],img=/^image\//.test(f.mime||'');
    return `<a class="dv-item" ${u?`href="${E(u)}" target="_blank" rel="noopener"`:''}>${img&&u?`<img src="${E(u)}" alt="${E(f.title)}" loading="lazy">`:`<span class="dv-ico">${img?'🖼':'PDF'}</span>`}<span><b>${E(f.title)}</b><small>第 ${E(f.version)} 版 · ${E(String(f.created_at||'').slice(0,10))} 更新${u?' · 点开看大图':''}</small></span></a>`;}).join('')}`;};
  el.innerHTML=`<h2>${E(data.contract_no||'施工图纸')}</h2><p>${E(data.address||'')}</p><p>查看人：<b>${E(data.label)}</b></p>
   ${files.length?group('drawing')+group('render'):'<p>门店还没上传图纸。</p>'}
   <p class="muted">图纸以门店最新上传为准；看到有疑问请先问门店再动工。</p>
   <button type="button" class="secondary" data-refresh>刷新图纸</button>`;
  el.querySelector('[data-refresh]').onclick=()=>{el.innerHTML='<p>正在读取图纸…</p>';open().catch(e=>stop(e.message));};
 }
 addEventListener('DOMContentLoaded',()=>{
  const msg=document.getElementById('message');
  try{
   if(!window.supabase)throw new Error('网络组件未加载，请刷新重试。');
   if(!uuid(id)||!uuid(token))throw new Error('请使用门店发送的完整看图链接。');
   sb=supabase.createClient('https://csabbxiijzghooppayae.supabase.co','sb_publishable__9KY2RRSxb1excfVxBTH_Q_5HtFWxmH',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
   el=document.getElementById('design-view');el.hidden=false;msg.textContent='';msg.hidden=true;
   el.innerHTML='<p>正在读取图纸…</p>';open().catch(()=>stop('网络不稳定，请刷新页面重试。'));
  }catch(e){msg.textContent=e.message;msg.classList.add('error');}
 });
})();
