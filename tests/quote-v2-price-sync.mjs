import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const B = require('../portal/quote-v2-pricebook.js');
const Q = require('../portal/quote-v2-rules.js');

const room = { ...Q.newRoom('living', 1, 1), measured: true, packs: ['floor'] };
const project = { houseType: 'terrace', rooms: [room], house: {}, prices: { protect: { mat: 0, aux: 0, lab: 0.5, waste: 0 } }, info: {}, discount: 0, design: true };
const savedPrice = { mat: 0.2787, aux: 0, lab: 0.0929, waste: 0, unit: '平方尺' };
B.apply({ items: { protect: savedPrice }, options: {} }, Q.PRICE, Q.OPTION_PRICES);
assert.equal(Q.PRICE.protect.companyPrice, true);
let line = Q.buildLines(project).find(l => l.code === 'protect');
assert.equal(line.unit, 0.5, '旧的本单临时价会遮住公司价');

const html = readFileSync(new URL('../portal/quote-v2.html', import.meta.url), 'utf8');
const fn = html.match(/  function applyBookPricesToQuote\(codes, at\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(fn, '报价器必须在公司价更新时清理旧覆盖价');
let backedUp = 0, saved = 0;
const ctx = { P: project, backupNow: force => { assert.equal(force, true); backedUp++; }, save: () => saved++ };
vm.runInNewContext(`${fn}; this.applyBookPricesToQuote = applyBookPricesToQuote`, ctx);
const changed = ctx.applyBookPricesToQuote(['protect'], '2026-11-16 12:00:00');
assert.deepEqual(Array.from(changed), ['protect']);
assert.equal(backedUp, 1);
assert.equal(saved, 1);
assert.equal(project.pricebookAppliedAt, '2026-11-16 12:00:00');
assert.equal(project.prices.protect, undefined);

line = Q.buildLines(project).find(l => l.code === 'protect');
assert.equal(line.unit, 0.3716, '报价重新采用公司价并保留平方米换算精度');
assert.equal(Math.round(line.unit * 10.7639 * 100) / 100, 4, '前端可显示 RM 4/平方米');
assert.equal(line.total, Math.round(line.qty * line.unit));
console.log('PASS: quote-v2 company price sync checks');
