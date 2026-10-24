'use strict';
const renovationLookupEsc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function lookupRenovationOrders(phone,code){
 const summary=await sb.rpc('renovation_customer_orders',{p_phone:phone});
 if(summary.error||!Array.isArray(summary.data))throw new Error('Unable to check renovation orders');
 const orders=summary.data.map(p=>({id:p.id,contract_no:p.contract_no,state:p.state,created_at:p.created_at}));
 if(!code)return {orders};
 try{
  const {data,error}=await sb.rpc('renovation_customer_lookup',{p_phone:phone,p_code:code});
  if(error||!Array.isArray(data))throw new Error('Unable to verify contract');
  const valid=data.filter(p=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(p.view_token));
  if(valid.length!==data.length)throw new Error('Invalid renovation response');
  const unlocked=new Map(valid.map(p=>[p.id,p]));
  return {orders:orders.map(p=>unlocked.has(p.id)?{...p,...unlocked.get(p.id)}:p),notice:valid.length?'':'查阅码不匹配，或合同尚未确认；订单列表仍可查看。 / No matching confirmed contract for this access code.'};
 }catch(e){return {orders,notice:'合同验证暂时失败，订单列表仍可查看，请重试。 / Contract verification unavailable. Please retry.'};}
}
function renderRenovationOrders(result){
 const el=document.getElementById('renovation-results');
 if(result.error){el.textContent=result.error;return;}
 const notice=result.notice?`<p class="text-sm mb-3" role="status" style="color:#633899">${renovationLookupEsc(result.notice)}</p>`:'';
 const states={draft:'待门店确认 / Awaiting confirmation',confirmed:'合同已确认 / Confirmed',executing:'工程进行中 / In progress',accepted:'已竣工验收 / Accepted'};
 el.innerHTML=notice+(result.orders||[]).map(p=>`<article class="rounded-xl p-5 mb-3 shadow-sm" style="background:#f2ebfa;border-left:4px solid #633899"><span class="text-xs font-semibold" style="color:#633899">🏠 整装订单 / Renovation</span><h3 class="font-semibold mt-1">${renovationLookupEsc(p.contract_no)}</h3><p class="text-sm mt-2" style="color:#633899">${renovationLookupEsc(states[p.state]||'待核对 / Pending review')}</p>${p.view_token?`<p class="text-sm text-gray-600 mt-2">${renovationLookupEsc(p.address)}</p><p class="font-semibold text-sm mt-2">RM ${Number(p.net||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}</p><a href="renovation-customer.html#${p.view_token}" class="inline-block mt-3 px-4 py-2 rounded-lg text-sm font-semibold" style="background:#633899;color:white">查看合同、清单及质保 / View my contract →</a>`:p.state==='draft'?'<p class="text-xs text-gray-600 mt-3">门店确认合同后可查阅清单及质保。 / Contract details available after confirmation.</p>':'<button type="button" onclick="editRenovationCode()" class="mt-3 px-4 py-2 rounded-lg text-sm font-semibold" style="background:#633899;color:white">查看合同、清单及质保 / View my contract →</button>'}</article>`).join('');
}
function editRenovationCode(){
 show('s-orders');
 const input=document.getElementById('renovation-code');
 document.getElementById('renovation-access').hidden=false;
 input.focus();
}
