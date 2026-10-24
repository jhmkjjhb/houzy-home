'use strict';
let renovationLookupVersion=0,renovationLookupBusy=false;
const renovationLookupEsc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for(const id of ['phone-in','country-code','renovation-code'])document.getElementById(id)?.addEventListener('input',()=>{renovationLookupVersion++;document.getElementById('renovation-results').replaceChildren();});
async function searchRenovationByPhone(){
 if(renovationLookupBusy)return;
 const results=document.getElementById('renovation-results'),btn=document.getElementById('renovation-search');
 const phone=RenoCore.normalizePhone(document.getElementById('phone-in').value,document.getElementById('country-code').value);
 const code=document.getElementById('renovation-code').value.normalize('NFKC').replace(/[\s-]/g,'').toLowerCase();
 results.replaceChildren();
 if(!phone){results.textContent='请检查登记手机号及国家区号 / Check phone and country code.';return;}
 if(!/^[a-f0-9]{20}$/.test(code)){results.textContent='请填写HOUZY提供的完整合同查阅码；如未收到，请联系门店。 / Enter your private contract access code.';return;}
 const version=++renovationLookupVersion;renovationLookupBusy=true;btn.disabled=true;btn.textContent='正在核对 / Checking…';
 try{
  const {data,error}=await sb.rpc('renovation_customer_lookup',{p_phone:phone,p_code:code});
  if(version!==renovationLookupVersion)return;
  if(error)throw new Error('暂时无法查询，请稍后重试或联系HOUZY。 / Unable to check now.');
  if(!Array.isArray(data)||!data.length){results.textContent='登记手机号或查阅码不匹配，或合同尚未确认。 / No matching confirmed contract.';return;}
  const valid=data.filter(p=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(p.view_token));
  if(!valid.length)throw new Error('查询结果异常，请联系HOUZY。');
  results.innerHTML=valid.map(p=>`<article class="rounded-lg p-4 mb-3" style="background:#f2ebfa;border-left:4px solid #633899"><span class="text-xs font-semibold" style="color:#633899">🏠 整装主单 / Renovation</span><h3 class="font-semibold mt-1">${renovationLookupEsc(p.contract_no)}</h3><p class="text-sm text-gray-600 mt-1">${renovationLookupEsc(p.address)}</p><p class="font-semibold text-sm mt-2">RM ${Number(p.net||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}</p><a href="renovation-customer.html#${p.view_token}" class="inline-block mt-3 px-4 py-2 rounded-lg text-sm font-semibold" style="background:#633899;color:white">查看合同、清单及质保 / View my contract →</a></article>`).join('');
 }catch(e){if(version===renovationLookupVersion)results.textContent=e.message;}
 finally{renovationLookupBusy=false;btn.disabled=false;btn.textContent='查询我的整装合同 / Find my contract';}
}
