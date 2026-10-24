'use strict';
window.RenoOrderList=(()=>{
 let projects=[],error='';
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={draft:'合同草稿',confirmed:'合同已确认',executing:'履约中',accepted:'已竣工验收'};
 async function load(client){
  try{const r=await client.from('renovation_projects').select('id,contract_no,customer_name,address,state,store_id,snapshot,additions_total,current_total,created_at').order('created_at',{ascending:false}).limit(200);if(r.error)throw r.error;projects=r.data||[];error='';}
  catch(e){error='整装订单暂时无法读取，请刷新重试。';}
 }
 function filtered(filters){return projects.filter(p=>{
  const date=filters.dateOf(p.created_at).slice(0,10);
  return (!filters.query||(p.contract_no+' '+p.customer_name+' '+p.address).toLowerCase().includes(filters.query))&&(!filters.store||filters.store===p.store_id)&&(!filters.date||filters.date===date)&&(!filters.month||filters.month===date.slice(0,7))&&(!filters.status||filters.status==='reno:'+p.state);
 }).map(p=>({...p,__renovation:true,status:'reno:'+p.state}));}
 function href(p){return 'renovation.html#'+encodeURIComponent(p.id);}
 function content(p,mobile,formatMoney,formatDate,stores){
  const link=href(p),store=stores.find(s=>s.id===p.store_id)?.name||'—';
  const title=`<a href="${link}" style="color:#633899;font-weight:700">${escape(p.contract_no)}</a><div style="color:#633899;font-size:12px;margin-top:4px">🏠 整装订单</div>`;
  const status=`<span style="background:#f2ebfa;color:#633899;padding:3px 8px;border-radius:5px">${escape(labels[p.state]||p.state)}</span>`;
  if(mobile)return `<a href="${link}" class="block p-4" style="border-left:4px solid #633899;background:#fcfaff"><div class="flex justify-between gap-2"><div><b style="color:#633899">${escape(p.contract_no)}</b><div class="text-xs" style="color:#633899">🏠 整装订单</div></div>${status}</div><div class="flex justify-between mt-2"><div>${escape(p.customer_name)}<div class="text-xs text-gray-500">${escape(store)}</div></div><div class="text-right">${formatMoney(p.current_total??p.snapshot?.net??0)}<div class="text-xs text-gray-400">${formatDate(p.created_at)}</div></div></div></a>`;
  return `<tr style="background:#fcfaff;border-left:4px solid #633899" class="border-t border-gray-100"><td class="px-4 py-3">${title}</td><td class="px-4 py-3">${escape(p.customer_name)}</td><td class="px-4 py-3 text-xs">${escape(store)}</td><td class="px-4 py-3 font-semibold">${formatMoney(p.current_total??p.snapshot?.net??0)}</td><td class="px-4 py-3">${status}</td><td class="px-4 py-3 text-xs text-gray-400">${formatDate(p.created_at)}</td></tr>`;
 }
 return {load,filtered,content,get error(){return error;}};
})();
