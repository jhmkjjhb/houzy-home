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
assert.deepEqual(target.plans[1].prices, {}, '导入的方案和 A 用同一份价目表，不带来源报价的旧单价');
Q.switchPlan(target, 'A');
assert.deepEqual(target.rooms[0], originalA, '切回 A 后房间工程保持原样');
Q.switchPlan(target, 'B');
assert.deepEqual(target.rooms[0].packs, ['cabinets'], '再次打开 B 仍是导入的工程');

// 房间不同也能导入：对不上的房间加进来，只在新方案里有工程；原方案金额不变
Q.switchPlan(target, 'A');
const totalA = () => Q.totals(target, Q.buildLines(target, 'A'), 'A').total;
const beforeA = totalA();
const other = make('other-room', ['cabinets']);
other.rooms[0].W = 12;
other.house = { roro: { on: true } };
assert.equal(Q.importPlan(target, other), 'C');
assert.equal(target.rooms.length, 2, '尺寸不同的房间作为新房间加入');
assert.ok(target.rooms[1].name.includes('方案 C'), '同名房间加上方案名区分');
assert.deepEqual(target.rooms[1].packs, ['cabinets']);
assert.deepEqual(target.rooms[0].packs, [], '原房间在 C 里是空的');
assert.deepEqual(target.house, { roro: { on: true } }, 'C 用自己的全屋工程');
assert.equal(totalA(), beforeA, '导入 C 不改变 A 的金额');
Q.switchPlan(target, 'A');
assert.deepEqual(target.house, {}, '切回 A 全屋工程还原');
assert.deepEqual(target.rooms[1].packs, [], '新房间在 A 里是空的');
const unchanged = copy(target);
assert.throws(() => Q.importPlan(target, make('other-room', ['cabinets'], '0199999999')), /客户电话不同/);
assert.deepEqual(target, unchanged, '客户不符不能改动现有报价');

console.log('quote-v2 import plan: 通过');
