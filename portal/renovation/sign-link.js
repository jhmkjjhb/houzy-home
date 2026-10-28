'use strict';
(async()=>{
 const msg=document.getElementById('message');
 try{
  if(!window.supabase)throw new Error('网络组件未加载，请刷新重试。');
  const sb=supabase.createClient('https://csabbxiijzghooppayae.supabase.co','sb_publishable__9KY2RRSxb1excfVxBTH_Q_5HtFWxmH',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  await RenoAdditionSigning.mountLink(sb);
  msg.textContent='';msg.hidden=true;
 }catch(e){msg.textContent=e.message;msg.classList.add('error');}
})();
