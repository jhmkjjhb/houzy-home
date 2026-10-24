'use strict';
(async()=>{
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
try{
 const token=location.hash.slice(1);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token))throw new Error('请使用HOUZY发送的完整项目链接');
 if(!window.supabase)throw new Error('网络组件未加载，请刷新重试');
 const sb=supabase.createClient('https://csabbxiijzghooppayae.supabase.co','sb_publishable__9KY2RRSxb1excfVxBTH_Q_5HtFWxmH',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {data:p,error}=await sb.rpc('renovation_customer_view',{p_token:token});if(error)throw new Error('暂时无法读取项目，请联系HOUZY核对链接');if(!p)throw new Error('项目尚未确认或链接已失效，请联系HOUZY');
 $('project').innerHTML=`<article class="project"><span class="type renovation">整装项目</span><h2>${esc(p.contract_no)}</h2><p>${esc(p.address)}</p><b>合同金额 RM ${Number(p.net).toLocaleString('en-MY',{minimumFractionDigits:2})}</b><p>${p.accepted_on?'竣工验收日期：'+esc(p.accepted_on):'尚未确认竣工验收；以下为合同约定质保，尚未起算。'}</p></article>`;
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'});
 $('lines').innerHTML='<h2>我的工程与产品清单</h2>'+p.lines.map(l=>`<article class="customer-line"><h3>${esc(l.id)} · ${esc(l.name)} ${l.gift?'<span class="type renovation">赠送</span>':''}</h3><p>${esc(l.spec||'')} · ${esc(l.qty)} ${esc(l.unit)}</p>${(l.warranties||[]).map(w=>{
  const end=RenoCore.expires(p.accepted_on,w.years);
  return `<div class="term"><b>${esc(w.component)}</b><span>${w.years?esc(w.years)+'年':'期限待确认'} · ${!w.years?'联系HOUZY补充凭证':!p.accepted_on?'竣工验收后起算':`${end<today?'已届满':'质保期内'}，到期日 ${esc(end)}`}</span></div><div class="muted">依据：${esc(w.source)}</div>`;
 }).join('')||'<p>此项质保范围待确认，请联系HOUZY。</p>'}</article>`).join('');
 $('lines').hidden=false;$('message').textContent='请按具体产品及部件查看质保范围。';
}catch(e){$('message').textContent=e.message;$('message').classList.add('error');}
})();
