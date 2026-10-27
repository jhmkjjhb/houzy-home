/* Customer-facing statements. Company banking details must be verified before release. */
(function (root) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cents = value => {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error('金额无效 / Invalid amount');
    return Math.round(n * 100);
  };
  function snapshot(order, payments) {
    const total = cents(order.amount);
    if (total < 0 || !Array.isArray(payments)) throw new Error('收款资料无效 / Invalid payment data');
    let paid = 0, pending = 0;
    const records = payments.map(p => {
      if (p.amount == null) throw new Error('收款金额缺失 / Missing payment amount');
      const amount = cents(p.amount);
      if (amount < 0) throw new Error('收款金额无效 / Invalid payment amount');
      const confirmed = p.method !== 'cash' || Boolean(p.verified_at);
      if (confirmed) paid += amount; else pending += amount;
      return {...p, amountCents: amount, confirmed};
    });
    const gatewayPaid = Boolean(order.hitpay_paid_at) || ['completed','paid','succeeded','success'].includes(String(order.hitpay_status || '').toLowerCase());
    // Gateway and installment records may describe the same receipt: never add them together.
    const gatewayAmountVerified = gatewayPaid && order.hitpay_amount != null && cents(order.hitpay_amount) === total;
    if (!records.length && gatewayAmountVerified) {
      paid = total;
      records.push({method:'hitpay', paid_at:order.hitpay_paid_at, amountCents:paid, confirmed:true});
    }
    const legacy = !records.length && order.payment_status !== 'unpaid' && Boolean(order.payment_status);
    const disputed = (!legacy && (order.payment_status === 'paid' || gatewayPaid) && paid < total) || (gatewayPaid && !gatewayAmountVerified && !records.length);
    const cancelled = ['cancelled','canceled','void','refunded'].includes(String(order.status).toLowerCase());
    const stage = cancelled ? 'cancelled' : legacy || disputed ? 'verify' : paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    const paidAt = records.filter(p => p.confirmed && p.paid_at).map(p => p.paid_at).sort().at(-1) || null;
    return {total, paid, pending, balance:Math.max(0,total-paid), credit:Math.max(0,paid-total), records, legacy, disputed, cancelled, stage, paidAt};
  }
  function render(order, items, payments, company, now = new Date()) {
    const s = snapshot(order, payments);
    const itemsTotal = items.reduce((sum, item) => sum + cents(item.total_price ?? Number(item.quantity) * Number(item.unit_price)), 0);
    const adjustment = s.total - itemsTotal;
    const money = n => `${escape(order.currency || 'MYR')} ${(n / 100).toFixed(2)}`;
    const date = value => value && !Number.isNaN(new Date(value).getTime()) ? escape(new Date(value).toLocaleString('en-GB', {timeZone:'Asia/Kuala_Lumpur'})) + ' MYT' : '—';
    const pair = (zh,en) => `${zh}<small>${en}</small>`;
    const methods = {cash:'现金 / Cash',transfer:'银行转账 / Bank transfer',ewallet:'电子钱包 / E-wallet',card:'银行卡 / Card',hitpay:'HitPay'};
    const row = (label, value) => `<div class="kv"><span>${label}</span><strong>${value}</strong></div>`;
    const missing = '待公司确认 / Pending company confirmation';
    const configured = Boolean(company.taxStatus && company.bankName && company.accountName && company.accountNumber);
    const foreignCurrency = String(order.currency || 'MYR').toUpperCase() !== String(company.accountCurrency || 'MYR').toUpperCase();
    const stages = {unpaid:['待付款','Awaiting Payment','付款通知','Payment Notice'],partial:['部分付款','Partially Paid','付款进度通知','Payment Progress Notice'],paid:['已付款 · 已结清','Paid in Full','付款确认','Payment Confirmation'],verify:['付款资料待核实','Payment Records Under Review','对账通知','Reconciliation Notice'],cancelled:['订单已作废','Cancelled Order','作废订单','Cancelled Order']};
    const stage = stages[s.stage];
    const paymentState = `${stage[0]} / ${stage[1]}`;
    const progressLabels = {pending_payment:'待付款 / Awaiting payment',paid:'已付款 / Payment received',assigned:'已派单 / Assigned',accepted:'工厂接单 / Accepted',in_production:'生产中 / In production',production_complete:'生产完成 / Production complete',shipped:'已发货 / Shipped',in_transit:'运输中 / In transit',arrived:'已到货 / Arrived',installing:'安装中 / Installing',completed:'已完成 / Completed',after_sales:'质保服务 / Warranty service',closed:'已关闭 / Closed',cancelled:'已作废 / Cancelled'};
    const orderProgress = s.stage === 'paid' && order.status === 'pending_payment'
      ? '已付款，进度待同步 / Paid; workflow update pending'
      : progressLabels[order.status] || escape(order.status || '—');
    return `<article class="order-statement${items.length <= 4 ? ' compact' : ''}" lang="zh-CN"><style>
.order-statement{font:12px/1.6 'Noto Sans SC','PingFang SC','Microsoft YaHei',Arial,sans-serif;color:#233c30;background:white;padding:30px;box-sizing:border-box;width:750px}.order-statement *{box-sizing:border-box}.order-statement small{display:block;font-size:9px;color:#647169;font-weight:400}.order-statement header{display:flex;justify-content:space-between;border-bottom:3px solid #214737;padding-bottom:16px;margin-bottom:18px}.order-statement h1{font-size:22px;margin:0;letter-spacing:1px}.order-statement h2{font-size:15px;margin:0 0 8px}.order-statement .cols{display:flex;gap:18px;margin:16px 0}.order-statement .panel{flex:1;background:#f7f6f1;padding:14px;border-radius:8px}.order-statement .kv{display:flex;justify-content:space-between;gap:14px;margin:5px 0}.order-statement table{width:100%;border-collapse:collapse;margin:18px 0;font-size:11px}.order-statement th{background:#214737;color:white;text-align:left;padding:8px}.order-statement th small{color:#e0ddcd}.order-statement td{padding:8px;border-bottom:1px solid #e5e7e1;overflow-wrap:anywhere}.order-statement .num{text-align:right;white-space:nowrap}.order-statement tr,.order-statement .keep{break-inside:avoid;page-break-inside:avoid}.order-statement .balance{background:#214737;color:white;border-radius:8px;padding:15px}.order-statement .balance small{color:#d3bc8a}.order-statement .notice{border-left:3px solid #c3a367;background:#faf7ed;padding:12px;margin:14px 0}.order-statement footer{border-top:1px solid #ddd;padding-top:10px;font-size:9px;color:#69776e;margin-top:20px}.order-statement .stage{border-left:4px solid #c3a367;background:#faf7ed;padding:10px 14px;margin:12px 0}.order-statement .stage.paid{border-color:#214737;background:#edf5ee}.order-statement .stage.verify,.order-statement .stage.cancelled{border-color:#a6402b;background:#fdf0ec}.order-statement .stage strong{font-size:15px}.order-statement .draft{color:#a6402b;font-weight:bold}.order-statement thead{display:table-header-group}.order-statement .signatures{display:flex;gap:24px;margin-top:18px}.order-statement .signature{flex:1;border-top:1px solid #a5afa8;padding-top:6px;margin-top:38px}.order-statement.compact{padding:20px 28px;font-size:11.5px;line-height:1.45}.order-statement.compact small{line-height:1.35}.order-statement.compact header{margin-bottom:12px;padding-bottom:10px}.order-statement.compact .cols{margin:10px 0}.order-statement.compact .panel{padding:8px 10px}.order-statement.compact .panel .kv{margin:2px 0}.order-statement.compact .panel h2{margin-bottom:4px}.order-statement.compact table{margin:12px 0}.order-statement.compact td{padding:5px}.order-statement.compact .balance{padding:10px}.order-statement.compact .stage{margin:8px 0;padding:8px 10px}.order-statement.compact .notice{padding:8px;margin:10px 0}.order-statement.compact .signatures{margin-top:10px}.order-statement.compact .signature{margin-top:10px}.order-statement.compact .signatures-panel p{margin:4px 0}.order-statement.compact footer{margin-top:10px}</style>
${!configured ? '<p class="draft">内部预览 · 公司收款资料待核实 / INTERNAL DRAFT · PAYMENT DETAILS NOT VERIFIED</p>' : ''}
<header><div><h1>HOUZY HOME</h1><strong>${escape(company.legalName)}</strong><small>公司注册号 / Registration No.: ${escape(company.registrationNumber)}</small><small>税号（TIN）/ Tax ID: ${escape(company.taxStatus || missing)}</small><small>${escape(company.businessAddress || '')}</small><small>${escape(company.contactPhone || '')}</small><small>${escape(order.stores?.name || '')}</small></div><div style="text-align:right"><h2>${pair('订单及付款状态确认书','Order & Payment Statement')}</h2><strong>${escape(order.order_no)}</strong><small>订单日期 / Order date: ${date(order.created_at)}</small></div></header>
<div class="stage ${escape(s.stage)} keep"><strong>${escape(paymentState)}</strong><small>${escape(stage[2])} / ${escape(stage[3])} · 截至 / As of: ${date(now)}</small>${s.stage === 'paid' && s.paidAt ? `<small>最近确认收款 / Last Confirmed Payment: ${date(s.paidAt)}</small>` : ''}</div>
<div class="cols"><section class="panel"><h2>${pair('客户信息','Customer Details')}</h2><strong>${escape(order.customers?.name || '—')}</strong><div>${escape(order.customers?.phone)}</div><div>${escape(order.customers?.address)}</div></section><section class="panel"><h2>${pair('订单信息','Order Details')}</h2><div>订单进度 / Order Progress: ${orderProgress}</div>${row('付款方式 / Payment method', escape(methods[order.payment_method || s.records.at(-1)?.method] || order.payment_method || s.records.at(-1)?.method || '—'))}${order.deadline_at ? row('预计安装日期 / Estimated installation',date(order.deadline_at)) : ''}</section></div>
${order.description ? `<p>${escape(order.description)}</p>` : ''}
<table><thead><tr><th>${pair('货品名称 / 规格','Product / Specification')}</th><th>${pair('数量','Quantity')}</th><th class="num">${pair('单价','Unit Price')}</th><th class="num">${pair('小计','Amount')}</th></tr></thead><tbody>${items.map(i => `<tr><td><strong>${escape(i.product_name)}</strong><small>${escape(i.model_spec)}</small>${i.group_name ? `<small>${escape(i.group_name)}</small>`:''}</td><td>${escape(i.quantity)} ${escape(i.uom || i.unit || '')}</td><td class="num">${money(cents(i.unit_price))}</td><td class="num">${money(cents(i.total_price ?? Number(i.quantity)*Number(i.unit_price)))}</td></tr>`).join('')}</tbody></table>
<section class="keep panel">${items.length ? row('商品小计 / Items Subtotal',money(itemsTotal)) : ''}${items.length && adjustment ? row('订单调整 / Order Adjustment',money(adjustment)) : ''}${row('订单总金额 / Order Total',money(s.total))}${row('已确认收款 / Confirmed Payments',money(s.paid))}${s.pending ? row('现金待核对 / Cash Pending Verification',money(s.pending)) : ''}${s.credit ? row('超付金额 / Overpayment',money(s.credit)):''}</section>
<div class="balance keep">${row(pair(s.cancelled || s.legacy || s.disputed ? '账面差额（需核实）':'未收余额',s.cancelled || s.legacy || s.disputed ? 'Recorded Difference (Verify)':'Outstanding Balance'),money(s.balance))}</div>
${s.legacy ? '<p class="notice">本订单仅有历史付款状态，未取得对应收款明细，请先与公司核实，勿据此重复付款。<br>Only a legacy payment status is available. Please verify with the company before making any further payment.</p>':''}
${s.disputed ? '<p class="notice">系统付款状态与收款明细不一致，请先与公司核实，勿据此重复付款。<br>The payment status and records differ. Please verify with the company before making any further payment.</p>':''}
${s.cancelled ? '<p class="notice">本订单已作废，本单不作催款通知。<br>This order is cancelled. This statement is not a payment demand.</p>':''}
<section><h2 style="margin-top:20px">${pair('付款记录','Payment History')}</h2>${s.records.length ? `<table><thead><tr><th>${pair('付款日期','Payment Date')}</th><th>${pair('付款方式','Method')}</th><th>${pair('核对状态','Verification')}</th><th class="num">${pair('金额','Amount')}</th></tr></thead><tbody>${s.records.map(p=>`<tr><td>${date(p.paid_at)}</td><td>${escape(methods[p.method] || p.method || '—')}</td><td>${p.confirmed ? '已计入 / Counted':'待核对 / Pending'}</td><td class="num">${money(p.amountCents)}</td></tr>`).join('')}</tbody></table>`:'<p>暂无收款明细 / No payment records available.</p>'}</section>
<section class="panel keep"><h2>${pair('公司收款账户','Company Payment Account')}</h2>${row('银行 / Bank',escape(company.bankName || missing))}${row('账户名称 / Account Name',escape(company.accountName || missing))}${row('银行账号 / Account Number',escape(company.accountNumber || missing))}${row('账户币种 / Account Currency',escape(company.accountCurrency || 'MYR'))}${row('转账备注 / Transfer Reference',escape(order.order_no))}</section>
${foreignCurrency ? '<p class="notice">订单与收款账户币种不同，转账前请向公司确认金额及汇率。<br>The order and bank account use different currencies. Confirm the amount and exchange rate with the company before transferring.</p>' : ''}
${!foreignCurrency && (s.stage === 'unpaid' || s.stage === 'partial') ? '<p class="notice">请按约定付款，转账备注订单号并提交凭证。若已付款或现金待核对，请先联系公司，避免重复付款。<br>Pay as agreed; quote the order number and send proof. If already paid or cash is pending, contact us before paying again.</p>':''}
<section class="keep signatures-panel"><h2>${pair('订单确认签字','Order Confirmation Signatures')}</h2><p>签署后确认订单内容 / The parties confirm this order upon signing.</p><div class="signatures"><div class="signature">客户签名及日期 / Customer Signature & Date</div><div class="signature">公司代表签名及日期 / Company Representative & Date</div></div></section>
<footer>付款状态以本单生成时已记录并确认的收款为准。付款后请重新下载查看最新状态。本单并非税务发票或电子发票。<br>Payment status reflects confirmed records at the time generated. Download again after payment to view the latest status. This document is not a tax invoice or e-Invoice.<br>生成时间 / Generated: ${date(now)} · houzyhome.com</footer></article>`;
  }
  root.HouzyOrderPDF = Object.freeze({snapshot,render});
  if (typeof module !== 'undefined') module.exports = root.HouzyOrderPDF;
})(typeof window !== 'undefined' ? window : globalThis);
