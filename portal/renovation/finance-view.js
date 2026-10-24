'use strict';
window.RenoFinanceView=(()=>{
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'RM '+Number(n||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
 const methods={bank_transfer:'银行转账',ewallet:'电子钱包',card:'刷卡',cash:'现金'};
 const statuses={no_records:'尚未登记实际收款',pending:'现金待核对',unpaid:'待付款',partial:'部分付款',paid:'已付清'};
 function summary(s){return `<div class="grid"><div>合同总额<br><b>${money(s.total)}</b></div><div>已确认净付款<br><b>${money(s.paid)}</b></div><div>尚未付清<br><b>${money(s.balance)}</b></div><div>付款状态<br><b>${esc(statuses[s.status]||'待核对')}</b></div></div>${Number(s.refunded)>0?`<p>累计已收 ${money(s.received)} · 已退款 ${money(s.refunded)}</p>`:''}${Number(s.pending)>0?`<p>现金待店长核对：${money(s.pending)}，尚未计入已付款。</p>`:''}${s.status==='no_records'?'<p>系统尚无实际收款记录。历史已付款请门店核对后补登，合同分期计划不会自动算作已付款。</p>':''}<p class="muted">以门店实际确认的收退款记录为准</p>`;}
 function customer(data){return summary(data.summary)+`<p>项目状态：${esc({confirmed:'合同已确认',executing:'工程进行中',accepted:'已竣工验收'}[data.state]||'待核对')}</p><details><summary>收退款明细（${data.entries.length}笔）</summary>${data.entries.map(e=>`<div class="customer-line"><b>${e.kind==='refund'?'退款':'收款'} ${money(e.amount)}</b><p>${esc(e.paid_on)} · ${esc(methods[e.method]||e.method)} · ${e.verified?'已确认':'待店长核对'}</p></div>`).join('')||'<p>暂无已登记收退款。</p>'}</details><details style="margin-top:14px"><summary>合同付款计划（约定金额）</summary><p class="muted">以下为合同约定，不代表已付款。</p>${(data.plan||[]).map(p=>`<div class="term"><span>${esc(p.name)}</span><b>${money(p.amount)}</b></div>`).join('')}</details>`;}
 return {esc,money,methods,summary,customer};
})();
