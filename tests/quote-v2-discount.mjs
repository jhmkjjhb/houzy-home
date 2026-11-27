// 报价优惠：硬装 / 材料 / 软装分开打折、单项优惠价。
// 为什么要测：优惠只能减「优惠」这一行，不能改明细单价；同一项不能被整组优惠和打折重复减；只改当前方案。
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const Q = require('../portal/quote-v2-rules.js');
const room = { ...Q.newRoom('kitchen', 1, 1), id: 'k1', L: 12, W: 10, H: 9, packs: ['floor', 'cabinets'], vals: {}, measured: true };
const P = { houseType: 'terrace', info: {}, rooms: [room], house: {}, extras: [], plans: [{ id: 'A', name: '方案 A', specs: {}, roomSpecs: {} }, { id: 'B', name: '方案 B', specs: {}, roomSpecs: {}, roomState: { k1: { packs: ['floor', 'cabinets'], vals: {} } } }], planId: 'A', prices: {} };
const run = () => { const L = Q.buildLines(P, 'A'); return { L, T: Q.totals(P, L, 'A') }; };

const base = run();
assert.equal(base.T.discount, 0);
const by = k => base.L.flatMap(Q.lineParts).filter(p => p.cls === k).reduce((t, p) => t + p.total, 0);
const hard = by('hard'), mat = by('mat');
assert.ok(hard > 0 && mat > 0, '样例要同时有硬装和材料');

// 材料打 9 折、硬装打 95 折：优惠 = 各类金额 × 比例，明细单价不变
P.plans[0].clsOff = { mat: 10, hard: 5 };
const a = run();
assert.equal(a.T.clsOff, Math.round(mat * 0.10) + Math.round(hard * 0.05));
assert.equal(a.T.discount, a.T.clsOff);
assert.deepEqual(a.L.map(l => l.unit), base.L.map(l => l.unit), '打折不改明细单价');
assert.ok(a.T.total < base.T.total);

// 单项优惠价：这一项不再参加分类打折（不重复减）
const part = a.L.flatMap(Q.lineParts).find(p => p.cls === 'mat' && p.total > 1000);
P.plans[0].lineFix = { [part.key]: part.total - 500 };
const b = run();
assert.equal(b.T.itemOff, 500);
assert.equal(b.T.clsOff, Math.round((mat - part.total) * 0.10) + Math.round(hard * 0.05), '单项优惠的那项不再打 9 折');
// 优惠价不能高于原价
P.plans[0].lineFix = { [part.key]: part.total + 100 };
assert.equal(run().T.itemOff, 0);
delete P.plans[0].lineFix;

// 整组填了优惠价：组里的项目不再分类打折
const st = a.L[0].stage, orig = a.L.filter(l => l.stage === st).reduce((t, l) => t + l.total, 0);
P.plans[0].groupFix = { ['stage:' + st]: orig - 300 };
const c = run();
const stageParts = c.L.filter(l => l.stage === st).flatMap(Q.lineParts);
const expect = ['hard', 'mat'].reduce((t, k) => t + Math.round((by(k) - stageParts.filter(p => p.cls === k).reduce((s, p) => s + p.total, 0)) * (k === 'mat' ? 0.10 : 0.05)), 0);
assert.equal(c.T.clsOff, expect);
assert.equal(c.T.discount, 300 + expect);
delete P.plans[0].groupFix;

// 只改当前方案：B 不受影响
const LB = Q.buildLines(P, 'B');
assert.equal(Q.totals(P, LB, 'B').discount, 0, '方案 B 没设打折');

// 打折超过 100% 当 100%，总优惠不超过应收
P.plans[0].clsOff = { hard: 500, mat: 100, soft: 100 };
const d = run();
assert.ok(d.T.total >= 0 && d.T.discount <= d.T.direct + d.T.design + d.T.mgmt + d.T.cont);
console.log('quote discounts: category % off, single-item price, no double discount with group price, per-plan only passed');
