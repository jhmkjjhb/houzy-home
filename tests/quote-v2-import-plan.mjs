import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const Q = require('../portal/quote-v2-rules.js');
const copy = value => JSON.parse(JSON.stringify(value));
const make = (roomId, packs, phone = '0123456789') => {
  const room = { ...Q.newRoom('kitchen', 1, 1), id: roomId, L: 10, W: 8, H: 9, packs, vals: {}, measured: true };
  return { houseType: 'terrace', info: { phone }, rooms: [room], house: {}, extras: [], plans: [{ id: 'A', name: '方案 A', specs: {}, roomSpecs: {} }], planId: 'A', prices: {} };
};

const target = make('target-room', ['floor']);
const source = make('source-room', ['cabinets']);
source.plans[0].roomSpecs['source-room'] = { cabinet: { body: '铝合金' } };
source.plans[0].prices = { cabinet_base: { mat: 100, lab: 50 } };
const originalA = copy(target.rooms[0]);
assert.equal(Q.importPlan(target, source), 'B');
assert.equal(target.planId, 'B');
assert.deepEqual(target.rooms[0].packs, ['cabinets']);
assert.equal(target.plans[1].roomSpecs['target-room'].cabinet.body, '铝合金');
assert.deepEqual(target.plans[1].prices.cabinet_base, { mat: 100, lab: 50 });
Q.switchPlan(target, 'A');
assert.deepEqual(target.rooms[0], originalA, '切回 A 后房间工程保持原样');
Q.switchPlan(target, 'B');
assert.deepEqual(target.rooms[0].packs, ['cabinets'], '再次打开 B 仍是导入的工程');

const unchanged = copy(target);
const wrongLayout = make('other-room', ['cabinets']);
wrongLayout.rooms[0].W = 12;
assert.throws(() => Q.importPlan(target, wrongLayout), /房间名称、尺寸或门窗布局不同/);
assert.deepEqual(target, unchanged, '校验失败不能改动现有报价');
assert.throws(() => Q.importPlan(target, make('other-room', ['cabinets'], '0199999999')), /客户电话不同/);
assert.deepEqual(target, unchanged, '客户不符不能改动现有报价');

console.log('quote-v2 import plan: 通过');
