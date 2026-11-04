const assert = require('node:assert/strict');
const {snapshot,render} = require('../portal/order-pdf.js');
const vm = require('node:vm');
const fs = require('node:fs');
const configWindow = {};
vm.runInNewContext(fs.readFileSync(require.resolve('../portal/order-pdf-company.js'),'utf8'), {window:configWindow});
assert.ok(configWindow.HOUZY_PDF_COMPANY.taxStatus);
assert.ok(configWindow.HOUZY_PDF_COMPANY.bankName);
assert.ok(configWindow.HOUZY_PDF_COMPANY.accountNumber);
const base = {amount:1000,currency:'MYR',payment_status:'unpaid',status:'pending_payment',order_no:'H-001',created_at:'2026-10-26T08:00:00Z',customers:{name:'王先生'}};
const company = {legalName:'HOUZY HOME SDN. BHD.',registrationNumber:'202601013740',taxStatus:'TEST-TIN',bankName:'TEST BANK',accountName:'TEST COMPANY',accountNumber:'TEST-123'};
let s = snapshot(base,[]);
assert.equal(s.balance,100000);
assert.equal(s.paid,0);
assert.equal(s.stage,'unpaid');
assert.match(render(base,[],[],company),/待付款 \/ Awaiting Payment/);
assert.match(render(base,[],[],company),/订单及付款状态确认书/);
assert.match(render(base,[],[],company),/Payment Notice/);
assert.match(render(base,[],[],company),/TEST-123/);
assert.match(render(base,[],[],configWindow.HOUZY_PDF_COMPANY),/Tax ID:/);
assert.match(render(base,[],[],configWindow.HOUZY_PDF_COMPANY),/United Overseas Bank/);
assert.match(render({...base,currency:'SGD'},[],[],configWindow.HOUZY_PDF_COMPANY),/exchange rate with the company/);
assert.match(render(base,[],[],company),/Order Confirmation Signatures/);
assert.doesNotMatch(render({...base,notes:'internal commission 20%'},[],[],company),/internal commission/);
assert.match(render(base,[],[],company),/MYR 1000\.00/);
assert.match(render(base,[],[],company),/请按约定付款/);
s = snapshot({...base,payment_status:'partial'},[
  {amount:300,method:'transfer',paid_at:'2026-10-25'},
  {amount:200,method:'cash',paid_at:'2026-10-26'},
]);
assert.equal(s.paid,30000);
assert.equal(s.pending,20000);
assert.equal(s.balance,70000);
assert.equal(s.legacy,false);
assert.equal(s.stage,'partial');
assert.match(render({...base,payment_status:'partial'},[],[{amount:300,method:'transfer'}],company),/部分付款 \/ Partially Paid/);
s = snapshot({...base,payment_status:'paid'},[]);
assert.equal(s.legacy,true);
assert.equal(s.stage,'verify');
assert.doesNotMatch(render({...base,payment_status:'paid'},[],[],company),/请按约定付款/);
s = snapshot({...base,payment_status:'paid'},[{amount:300,method:'transfer'}]);
assert.equal(s.disputed,true);
assert.doesNotMatch(render({...base,payment_status:'paid'},[],[{amount:300,method:'transfer'}],company),/请按约定付款/);
s = snapshot({...base,hitpay_status:'completed',hitpay_amount:1000},[]);
assert.equal(s.paid,100000);
assert.equal(s.balance,0);
assert.equal(s.stage,'paid');
const paidHtml=render({...base,payment_status:'paid'},[],[{amount:1000,method:'transfer',paid_at:'2026-10-26T09:00:00Z'}],company);
assert.match(paidHtml,/已付款 · 已结清/);
assert.match(paidHtml,/Paid in Full/);
assert.match(paidHtml,/MYR 0\.00/);
assert.doesNotMatch(paidHtml,/请按约定付款/);
assert.equal(snapshot({...base,hitpay_status:'completed',hitpay_amount:1000},[{amount:300,method:'transfer'}]).disputed,true);
assert.equal(snapshot({...base,hitpay_status:'completed',hitpay_amount:900},[]).stage,'verify');
assert.match(render({...base,status:'cancelled'},[],[],company),/This order is cancelled/);
assert.doesNotMatch(render({...base,status:'cancelled'},[],[],company),/请按约定付款/);
const hostile = render({...base,customers:{name:'<script>alert(1)</script>'}},[{product_name:'<img src=x onerror=alert(1)>',quantity:1,unit_price:1000}],[],company);
assert.doesNotMatch(hostile,/<script>|<img/);
assert.match(hostile,/&lt;script&gt;/);
console.log('order PDF financial, bilingual, reminder and escaping checks passed');

// Company billing: the company leads the PDF, the customer becomes the contact, and hostile text stays inert.
{
  const billed = {...base, customers:{name:'王先生',phone:'60167475446',address:'配送地址 A'}, order_billing:{company_name:'SpaceMade <b>Sdn Bhd</b>',registration_no:'202501014187 (1615601-X)',address:'28B Jalan Pendekar 17',phone:'016-7475446',tax_id:''}};
  const html = render(billed,[],[],company);
  assert.ok(html.includes('Bill To') && html.includes('SpaceMade &lt;b&gt;Sdn Bhd&lt;/b&gt;'));
  assert.ok(html.includes('202501014187 (1615601-X)') && html.includes('28B Jalan Pendekar 17') && html.includes('016-7475446'));
  assert.ok(html.includes('Contact') && html.includes('王先生') && html.includes('配送地址 A'));
  assert.ok(!html.includes('TIN: ') , 'an empty tax number prints nothing');
  assert.ok(render({...billed,order_billing:{...billed.order_billing,tax_id:'C123'}},[],[],company).includes('TIN: C123'));
  const individual = render({...base,order_billing:null},[],[],company);
  assert.ok(!individual.includes('Bill To') && individual.includes('Customer Details'), 'individual orders print as before');
  assert.equal(individual, render(base,[],[],company));
}
