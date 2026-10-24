'use strict';
const renovationLookupEsc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function lookupRenovationOrders(phone,code){
 if(!code)return {orders:[]};
 const {data,error}=await sb.rpc('renovation_customer_lookup',{p_phone:phone,p_code:code});
 if(error)throw new Error('Unable to check renovation orders');
 if(!Array.isArray(data))throw new Error('Invalid renovation response');
 const orders=data.filter(p=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(p.view_token));
 if(orders.length!==data.length)throw new Error('Invalid renovation response');
 return {orders};
}
function renderRenovationOrders(result,hasCode){
 const el=document.getElementById('renovation-results');
 if(result.error){el.textContent=result.error;return;}
 if(!hasCode){
  el.innerHTML='<div class="rounded-xl p-4 border" style="background:#f8f4fc;border-color:#e5d9f1"><b class="text-sm" style="color:#633899">🏠 整装订单 / Renovation</b><p class="text-sm text-gray-600 mt-2">如有整装合同，请填写门店提供的合同查阅码，即可在这里查看。 / To include renovation contracts, enter your private access code.</p><button type="button" onclick="editRenovationCode()" class="mt-3 text-sm font-semibold underline" style="color:#633899">填写查阅码 / Enter access code →</button></div>';
  return;
 }
 if(!result.orders.length){el.innerHTML='<p class="rounded-lg p-4 text-sm" style="background:#f8f4fc;color:#633899">未找到匹配的已确认整装合同，请核对手机号及查阅码，或联系门店。 / No matching confirmed renovation contract.</p>';return;}
 el.innerHTML=result.orders.map(p=>`<article class="rounded-xl p-5 mb-3 shadow-sm" style="background:#f2ebfa;border-left:4px solid #633899"><span class="text-xs font-semibold" style="color:#633899">🏠 整装订单 / Renovation</span><h3 class="font-semibold mt-1">${renovationLookupEsc(p.contract_no)}</h3><p class="text-sm text-gray-600 mt-1">${renovationLookupEsc(p.address)}</p><p class="font-semibold text-sm mt-2">RM ${Number(p.net||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}</p><a href="renovation-customer.html#${p.view_token}" class="inline-block mt-3 px-4 py-2 rounded-lg text-sm font-semibold" style="background:#633899;color:white">查看合同、清单及质保 / View my contract →</a></article>`).join('');
}
function editRenovationCode(){
 show('s-orders');
 const input=document.getElementById('renovation-code');
 document.getElementById('renovation-access').hidden=false;
 input.focus();
}
