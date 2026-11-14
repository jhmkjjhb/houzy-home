// 新版报价器规则测试：只测「为什么这样算」的业务规则，界面另测。
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const Q = require('../portal/quote-v2-rules.js');
let n = 0; const ok = (name, fn) => { fn(); n++; };
const find = (lines, code, roomId) => lines.filter(l => l.code === code && (roomId === undefined || l.roomId === roomId));
const qty = (lines, code, roomId) => find(lines, code, roomId).reduce((t, l) => t + l.qty, 0);

function project(rooms, extra = {}) { return { houseType: 'terrace', rooms, house: {}, prices: {}, info: {}, discount: 0, design: true, ...extra }; }
function bath(over = {}) { return { ...Q.newRoom('bath', 1, 1), L: 8, W: 5, H: 9, doors: 1, measured: true, ...over }; }

ok('数据完整：每个工程包用到的项目都在价目表里', () => {
  for (const [code, pk] of Object.entries(Q.PACKS)) {
    const r = { ...Q.newRoom('living', 1, 1), windows: [{ w: 4, h: 5 }], doors: 1 };
    const g = Q.geo(r, {});
    pk.lines(r, g, Q.packValues(r, code, g), { ceil_flat: true }).forEach(([c]) => assert.ok(Q.PRICE[c], `${code} → ${c} 不在价目表`));
  }
  for (const [t, d] of Object.entries(Q.ROOMS)) d.packs.forEach(c => assert.ok(Q.PACKS[c], `${t} 缺工程包 ${c}`));
});

ok('卫生间防水 = 地面 + 周长×上翻 1 尺 + 淋浴区 36，并且一定带闭水试验', () => {
  const r = bath({ packs: ['bath_tile'] });
  const L = Q.buildLines(project([r]));
  assert.equal(qty(L, 'wp', r.id), 40 + 26 + 36);
  assert.equal(qty(L, 'flood_test', r.id), 1);
  // 墙砖 = 周长×层高 − 门洞 21（没有窗）
  assert.equal(qty(L, 'wall_tile', r.id), 26 * 9 - 21);
  assert.equal(qty(L, 'grout', r.id), 40 + 26 * 9 - 21);
});

ok('窗帘、窗台石按每樘窗宽合计；换窗按每樘 宽×高 合计', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, windows: [{ w: 4, h: 5 }, { w: 3, h: 4 }], packs: ['curtain', 'sill', 'window_new'] };
  const L = Q.buildLines(project([r]));
  assert.equal(qty(L, 'curtain', r.id), 7);
  assert.equal(qty(L, 'window_sill', r.id), 7);
  assert.equal(qty(L, 'window_new', r.id), 32);
  assert.equal(qty(L, 'curtain_box', r.id), 0, '没做吊顶就没有窗帘盒');
  r.packs.push('ceil_flat');
  assert.equal(qty(Q.buildLines(project([r])), 'curtain_box', r.id), 7, '有吊顶 → 窗帘盒 = 窗宽');
});

ok('窗户面积从墙面扣除（刷漆不算窗）', () => {
  const a = { ...Q.newRoom('bedroom', 1, 1), L: 10, W: 10, H: 9, doors: 1, measured: true, packs: ['paint'] };
  const b = { ...a, id: 'b', windows: [{ w: 4, h: 5 }] };
  assert.equal(qty(Q.buildLines(project([a])), 'paint_wall') - qty(Q.buildLines(project([b])), 'paint_wall'), 20);
});

ok('地面只能二选一：选木地板就不会再有地砖', () => {
  // 互斥由界面保证；规则层保证两个包各自独立、不会互相带出
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['laminate'] };
  const L = Q.buildLines(project([r]));
  assert.equal(qty(L, 'floor_tile'), 0);
  assert.equal(qty(L, 'laminate'), 110);
  assert.equal(Q.PACKS.laminate.pick, Q.PACKS.floor_tile.pick);
});

ok('有工程才加开工放线/成品保护/清运/开荒；空报价是 0', () => {
  assert.equal(Q.buildLines(project([Q.newRoom('living', 1, 1)])).length, 0);
  const L = Q.buildLines(project([{ ...Q.newRoom('living', 1, 1), measured: true, packs: ['paint'] }]));
  ['setout', 'protect', 'waste_out', 'clean'].forEach(c => assert.equal(find(L, c).length, 1, c));
});

ok('楼上房间要加搬运费 = 面积 × (楼层 − 1)；楼下不加', () => {
  const up = { ...Q.newRoom('bedroom', 2, 1), L: 10, W: 10, measured: true, packs: ['paint'] };
  const down = { ...Q.newRoom('bedroom', 1, 2), L: 10, W: 10, measured: true, packs: ['paint'] };
  assert.equal(qty(Q.buildLines(project([up, down])), 'carry_up'), 100);
  assert.equal(qty(Q.buildLines(project([down])), 'carry_up'), 0);
});

ok('有水点位才加水管打压', () => {
  const r = bath({ packs: ['bath_water'] });
  assert.equal(qty(Q.buildLines(project([r])), 'pipe_test'), 1);
  assert.equal(qty(Q.buildLines(project([bath({ packs: ['sanitary'] })])), 'pipe_test'), 0);
});

ok('员工改过的数字优先，没改用默认值（不会出现空格）', () => {
  const r = { ...Q.newRoom('living', 1, 1), measured: true, packs: ['aircon'] };
  assert.equal(qty(Q.buildLines(project([r])), 'aircon_pipe'), 1);
  r.vals = { aircon: { n: 3 } };
  const L = Q.buildLines(project([r]));
  assert.equal(qty(L, 'aircon_pipe'), 3);
  assert.equal(qty(L, 'circuit'), 3, '每台空调一条专用回路');
});

ok('没确认尺寸、窗户没填完、选了窗帘却没窗 → 都不能出报价单', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), packs: ['curtain'] };
  let K = Q.checks(project([r]), Q.buildLines(project([r])));
  assert.ok(K.red.some(x => x.m.includes('尺寸还是默认值')));
  assert.ok(K.red.some(x => x.m.includes('请先加窗户尺寸')));
  r.measured = true; r.windows = [{ w: 4, h: '' }];
  K = Q.checks(project([r]), Q.buildLines(project([r])));
  assert.ok(K.red.some(x => x.m.includes('第 1 樘窗请填写宽和高')));
  r.windows = [{ w: 4, h: 5 }];
  K = Q.checks(project([r]), Q.buildLines(project([r])));
  assert.equal(K.red.length, 0);
});

ok('价格待核定的项目：没填价格就拦住，本单填了就放行', () => {
  const p = project([], { house: { three_phase: { on: true } } });
  assert.ok(Q.checks(p, Q.buildLines(p)).red.some(x => x.m.includes('单价待公司核定')));
  p.prices = { three_phase: { lab: 2500 } };
  const L = Q.buildLines(p);
  assert.equal(find(L, 'three_phase')[0].total, 2500);
  assert.ok(!Q.checks(p, L).red.some(x => x.m.includes('单价待公司核定')));
});

ok('单价 = 主材×(1+损耗) + 辅材 + 人工，与旧版报价器一致', () => {
  const p = Q.PRICE.floor_tile;
  assert.equal(Q.unitPrice('floor_tile'), Math.round((p.mat * (1 + p.waste / 100) + p.aux + p.lab) * 100) / 100);
});

ok('付款节点加起来刚好等于总价；管理费 6%', () => {
  const p = project([{ ...Q.newRoom('living', 1, 1), measured: true, packs: ['paint', 'floor_tile', 'electric'] }]);
  const L = Q.buildLines(p), T = Q.totals(p, L);
  assert.equal(T.pay.reduce((t, x) => t + x.amt, 0), T.total);
  assert.equal(T.mgmt, Math.round(T.direct * 0.06));
  assert.equal(T.design, Math.round(280 * 8));
});

ok('可改实际施工面积：旧地砖只铺一半就只拆一半；地砖改面积，找平和美缝跟着改，踢脚线仍按周长', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['demo_floor', 'floor_tile'] }; // 11×10 = 110
  let L = Q.buildLines(project([r]));
  assert.equal(qty(L, 'demo_floor'), 110);
  r.vals = { demo_floor: { floor: 60 }, floor_tile: { floor: 80 } };
  L = Q.buildLines(project([r]));
  assert.equal(qty(L, 'demo_floor'), 60);
  assert.equal(qty(L, 'floor_tile'), 80);
  assert.equal(qty(L, 'screed'), 80);
  assert.equal(qty(L, 'grout'), 80);
  assert.equal(qty(L, 'skirting'), 42 - 3, '踢脚线按周长减门宽，不跟面积走');
  r.vals.floor_tile.floor = 200;
  assert.ok(Q.checks(project([r]), Q.buildLines(project([r]))).yellow.some(x => x.m.includes('大于房间地面')));
});

ok('定制柜按正面面积 = 宽 × 高；单价未定前拦住出单', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['wardrobe'], vals: { wardrobe: { w: 9, h: 8 } } };
  const p = project([r]); const L = Q.buildLines(p);
  assert.equal(Q.PRICE.wardrobe.unit, '平方尺');
  assert.equal(qty(L, 'wardrobe'), 72);
  assert.ok(Q.checks(p, L).red.some(x => x.m.includes('衣柜定制')));
  p.prices = { wardrobe: { lab: 60 } };
  assert.equal(find(Q.buildLines(p), 'wardrobe')[0].total, 72 * 60);
});

ok('小件定制按项：名称和单价逐项填，没填就拦住', () => {
  const r = { ...Q.newRoom('living', 1, 1), measured: true, packs: ['custom_item'], items: [{ name: '换鞋凳', qty: 2, price: 350 }, { name: '', qty: 1, price: 0 }] };
  const p = project([r]); const L = Q.buildLines(p);
  const bench = L.find(l => l.name === '换鞋凳');
  assert.equal(bench.total, 700);
  const red = Q.checks(p, L).red.map(x => x.m);
  assert.ok(red.some(m => m.includes('第 2 项请填写名称')));
  assert.ok(red.some(m => m.includes('请填写单价')));
  assert.ok(!red.some(m => m.includes('单价待公司核定')), '小件不走公司价目表');
  r.items = [];
  assert.ok(Q.checks(p, Q.buildLines(p)).red.some(x => x.m.includes('请至少加一项')));
});

ok('设计费只算有施工的室内房间：没动的卧室不收设计费', () => {
  const live = { ...Q.newRoom('living', 1, 1), measured: true, packs: ['paint'] };
  const idle = Q.newRoom('bedroom', 1, 1);
  const p = project([live, idle]);
  assert.equal(Q.totals(p, Q.buildLines(p)).design, 280 * 8);
});

ok('同样的输入永远算出同样的结果', () => {
  const p = project(Q.presetRooms('semi').map(r => ({ ...r, measured: true, packs: Q.ROOMS[r.type].packs.slice(0, 4) })));
  assert.deepEqual(Q.buildLines(p), Q.buildLines(JSON.parse(JSON.stringify(p))));
});

console.log(`PASS: ${n} quote-v2 rule checks`);
