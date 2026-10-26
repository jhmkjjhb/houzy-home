const assert = require('node:assert/strict');
const {snapshot,render} = require('../portal/order-pdf.js');
const base = {amount:1000,currency:'MYR',payment_status:'unpaid',status:'pending_payment',order_no:'H-001',created_at:'2026-10-26T08:00:00Z',customers:{name:'王先生'}};
const company = {legalName:'HOUZY HOME SDN. BHD.',registrationNumber:'202601013740',taxStatus:'TEST-TIN',bankName:'TEST BANK',accountName:'TEST COMPANY',accountNumber:'TEST-123'};
let s = snapshot(base,[]);
assert.equal(s.balance,100000);
assert.equal(s.paid,0);
assert.match(render(base,[],[],company),/订单确认及付款通知/);
assert.match(render(base,[],[],company),/Payment Notice/);
assert.match(render(base,[],[],company),/TEST-123/);
assert.match(render(base,[],[],company),/Order Confirmation Signatures/);
assert.match(render(base,[],[],company),/MYR 1000\.00/);
assert.match(render(base,[],[],company),/请按约定付款安排支付未收余额/);
s = snapshot({...base,payment_status:'partial'},[
  {amount:300,method:'transfer',paid_at:'2026-10-25'},
  {amount:200,method:'cash',paid_at:'2026-10-26'},
]);
assert.equal(s.paid,30000);
assert.equal(s.pending,20000);
assert.equal(s.balance,70000);
assert.equal(s.legacy,false);
s = snapshot({...base,payment_status:'paid'},[]);
assert.equal(s.legacy,true);
assert.doesNotMatch(render({...base,payment_status:'paid'},[],[],company),/请按约定付款安排支付未收余额/);
s = snapshot({...base,payment_status:'paid'},[{amount:300,method:'transfer'}]);
assert.equal(s.disputed,true);
assert.doesNotMatch(render({...base,payment_status:'paid'},[],[{amount:300,method:'transfer'}],company),/请按约定付款安排支付未收余额/);
s = snapshot({...base,hitpay_status:'completed',hitpay_amount:1000},[]);
assert.equal(s.paid,100000);
assert.equal(s.balance,0);
assert.equal(snapshot({...base,hitpay_status:'completed',hitpay_amount:1000},[{amount:300,method:'transfer'}]).disputed,true);
assert.throws(()=>snapshot({...base,hitpay_status:'completed',hitpay_amount:900},[]),/线上付款金额需核对/);
assert.match(render({...base,status:'cancelled'},[],[],company),/This order is cancelled/);
assert.doesNotMatch(render({...base,status:'cancelled'},[],[],company),/请按约定付款安排支付未收余额/);
const hostile = render({...base,customers:{name:'<script>alert(1)</script>'}},[{product_name:'<img src=x onerror=alert(1)>',quantity:1,unit_price:1000}],[],company);
assert.doesNotMatch(hostile,/<script>|<img/);
assert.match(hostile,/&lt;script&gt;/);
console.log('order PDF financial, bilingual, reminder and escaping checks passed');
