// 报价方案转整装订单：转过去的合同清单必须能通过整装订单的核对规则（工程合计 − 优惠 = 合同价 = 报价合计，付款各期加起来 = 合同价）。
// 为什么要测：金额对不平，整装订单那边就保存不了；而且合同价必须跟客户看到的报价一样。
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const Q = require('../portal/quote-v2-rules.js'), C = require('../portal/renovation/core.js');
const room = { ...Q.newRoom('kitchen', 1, 1), id: 'k1', L: 12, W: 10, H: 9, packs: ['floor', 'cabinets'], vals: {}, measured: true };
const P = { houseType: 'terrace', info: {}, rooms: [room], house: {}, extras: [], plans: [{ id: 'A', name: '方案 A', specs: {}, roomSpecs: {} }], planId: 'A', prices: {} };
const check = label => {
  const L = Q.buildLines(P, 'A'), T = Q.totals(P, L, 'A'), s = Q.toReno(P, 'A');
  assert.deepEqual(C.validate(s).errors, [], label + '：整装订单核对通过');
  assert.equal(s.net, T.total, label + '：合同价 = 报价合计');
  assert.equal(s.payments.reduce((t, p) => t + p.amount, 0), T.total, label + '：付款各期合计 = 合同价');
  assert.ok(s.lines.every(l => l.qty > 0 && l.rate >= 0), label + '：每项数量、单价有效');
  return { s, T };
};
check('原价');
// 有优惠、设计费赠送时，优惠金额要把这些都算进去
P.plans[0].clsOff = { mat: 10, hard: 5 }; P.plans[0].discount = 300; P.plans[0].designGift = true;
const { s, T } = check('有优惠');
assert.ok(s.discount >= T.discount, '优惠至少包含报价上的优惠');
assert.ok(s.lines.some(l => l.name === '管理费'), '管理费单独一行');
console.log('quote → renovation order: lines/discount/payments reconcile with contract rules passed');
