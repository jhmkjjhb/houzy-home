'use strict';
(async()=>{
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
try{
 const token=location.hash.slice(1);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token))throw new Error('请使用HOUZY发送的完整项目链接');
 if(!window.supabase)throw new Error('网络组件未加载，请刷新重试');
 const sb=supabase.createClient('https://csabbxiijzghooppayae.supabase.co','sb_publishable__9KY2RRSxb1excfVxBTH_Q_5HtFWxmH',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {data:p,error}=await sb.rpc('renovation_customer_view',{p_token:token});if(error)throw new Error('暂时无法读取项目，请联系HOUZY核对链接');if(!p)throw new Error('项目尚未确认或链接已失效，请联系HOUZY');
 $('project').innerHTML=`<article class="project"><span class="type renovation">整装项目</span><h2>${esc(p.contract_no)}</h2><p>${esc(p.address)}</p><b>${Number(p.additions_total)>0?'项目应收总额':'合同金额'} RM ${Number(p.net).toLocaleString('en-MY',{minimumFractionDigits:2})}</b>${Number(p.additions_total)>0?`<p>原合同 RM ${Number(p.original_net).toLocaleString('en-MY',{minimumFractionDigits:2})} ＋ 新增工项／材料 RM ${Number(p.additions_total).toLocaleString('en-MY',{minimumFractionDigits:2})}</p>`:''}<p>${p.accepted_on?'竣工验收日期：'+esc(p.accepted_on):'尚未确认竣工验收；以下为合同约定质保，尚未起算。'}</p></article>`;
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'});
 $('lines').innerHTML=`<details id="customer-checklist"><summary style="font-size:19px;font-weight:700">我的工程与产品清单 <span class="muted">（共${p.lines.length}项，点击展开／收起）</span></summary>`+p.lines.map(l=>`<article class="customer-line"><h3>${esc(l.id)} · ${esc(l.name)} ${l.gift?'<span class="type renovation">赠送</span>':''}</h3><p>${esc(l.spec||'')} · ${esc(l.qty)} ${esc(l.unit)}</p>${(l.warranties||[]).map(w=>{
  const end=RenoCore.expires(p.accepted_on,w.years);
  return `<div class="term"><b>${esc(w.component)}</b><span>${w.years?esc(w.years)+'年':'期限待确认'} · ${!w.years?'联系HOUZY补充凭证':!p.accepted_on?'竣工验收后起算':`${end<today?'已届满':'质保期内'}，到期日 ${esc(end)}`}</span></div><div class="muted">依据：${esc(w.source)}</div>`;
 }).join('')||'<p>此项质保范围待确认，请联系HOUZY。</p>'}</article>`).join('')+'</details>';
 const viewButton=$('view-signed-contract');viewButton.hidden=false;
 viewButton.onclick=async()=>{
  if(viewButton.disabled)return;viewButton.disabled=true;$('contract-message').textContent='正在准备临时合同链接…';
  try{
   const {data,error}=await sb.functions.invoke('renovation-contract',{body:{token}});
   if(error||!data?.url)throw new Error(data?.error||'暂时无法打开合同，请稍后重试或联系HOUZY。');
   const target=new URL(data.url);
   if(target.protocol!=='https:'||target.hostname!=='csabbxiijzghooppayae.supabase.co'||!target.pathname.startsWith('/storage/v1/object/sign/renovation-contracts/'))throw new Error('合同链接无效，请联系HOUZY。');
   // Same-tab navigation avoids popup blocking after an asynchronous request.
   $('contract-message').textContent='合同链接已准备，有效期2分钟。';location.assign(target.href);
  }catch(e){$('contract-message').textContent=e.message;}finally{viewButton.disabled=false;}
 };
 $('lines').hidden=false;$('message').textContent='请按具体产品及部件查看质保范围。';
 await RenoAdditionSigning.mount(sb,token);
 $('customer-finance-panel').hidden=false;
 let paymentBusy=false;
 async function refreshPayments(){
  if(paymentBusy)return;paymentBusy=true;$('refresh-payments').disabled=true;
  try{
   const {data,error}=await sb.rpc('renovation_customer_payment_view',{p_token:token});
   if(error||!data)throw new Error('付款记录暂时无法同步，请刷新重试或联系门店。');
   if((p.state&&data.state!==p.state)||Number(p.scope_revision||0)!==Number(data.scope_revision||0)){if(!RenoAdditionSigning.isDirty()){location.reload();return;}}
   await RenoAdditionSigning.refresh();
   const openSections=[...$('customer-payments').querySelectorAll('details')].map(e=>e.open);
   $('customer-payments').innerHTML=RenoFinanceView.customer(data);
   $('customer-payments').querySelectorAll('details').forEach((e,i)=>e.open=Boolean(openSections[i]));
   $('payment-sync').textContent='已与门店同步 · '+new Date().toLocaleTimeString('zh-CN')+' · 每30分钟自动更新';
  }catch(e){$('payment-sync').textContent=e.message;$('customer-payments').replaceChildren();}
  finally{paymentBusy=false;$('refresh-payments').disabled=false;}
 }
 $('refresh-payments').onclick=refreshPayments;
 await refreshPayments();
 const refreshTimer=setInterval(()=>{if(!document.hidden)refreshPayments();},30*60*1000);
 window.addEventListener('pagehide',()=>clearInterval(refreshTimer),{once:true});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshPayments();});

}catch(e){$('message').textContent=e.message;$('message').classList.add('error');}
})();
