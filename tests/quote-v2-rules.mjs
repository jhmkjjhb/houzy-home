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
    pk.lines(r, g, Q.packValues(r, code, g), { ceiling: true }, (c2, k2) => Q.stdOf(Q.SPEC_CATS[c2].keys[k2], r)).forEach(([c]) => assert.ok(Q.PRICE[c], `${code} → ${c} 不在价目表`));
  }
  for (const [cat, c] of Object.entries(Q.SPEC_CATS)) for (const [k, key] of Object.entries(c.keys)) for (const val of key.opts) {
    for (const code of ['floor', 'wall_finish', 'ceiling', 'wardrobe', 'cabinets', 'bath_tile']) {
      const r = { ...Q.newRoom('living', 1, 1) }, g = Q.geo(r, {});
      Q.PACKS[code].lines(r, g, Q.packValues(r, code, g), {}, (c2, k2) => (c2 === cat && k2 === k ? val : Q.stdOf(Q.SPEC_CATS[c2].keys[k2], r))).forEach(([c3]) => assert.ok(Q.PRICE[c3], `${cat}.${k}=${val} → ${c3} 不在价目表`));
    }
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
  r.packs.push('ceiling');
  assert.equal(qty(Q.buildLines(project([r])), 'curtain_box', r.id), 7, '有吊顶 → 窗帘盒 = 窗宽');
});

ok('窗户面积从墙面扣除（刷漆不算窗）', () => {
  const a = { ...Q.newRoom('bedroom', 1, 1), L: 10, W: 10, H: 9, doors: 1, measured: true, packs: ['wall_finish'] };
  const b = { ...a, id: 'b', windows: [{ w: 4, h: 5 }] };
  assert.equal(qty(Q.buildLines(project([a])), 'paint_wall') - qty(Q.buildLines(project([b])), 'paint_wall'), 20);
});

ok('范围只选「地面翻新」；材料在选材层定：瓷砖和地板只会出现一种', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['floor'] };
  const p = project([r]);
  let L = Q.buildLines(p);
  assert.equal(qty(L, 'floor_tile'), 110, '没定材料先按标准档（瓷砖）估价');
  assert.deepEqual(find(L, 'floor_tile')[0].tbd, ['tile'], '标记为暂定');
  p.plans = [{ id: 'A', name: '方案 A', specs: { tile: { material: 'SPC 石塑地板' } }, roomSpecs: {} }];
  L = Q.buildLines(p);
  assert.equal(qty(L, 'floor_tile'), 0);
  assert.equal(qty(L, 'laminate'), 110);
});

ok('有工程才加开工放线/成品保护/清运/开荒；空报价是 0', () => {
  assert.equal(Q.buildLines(project([Q.newRoom('living', 1, 1)])).length, 0);
  const L = Q.buildLines(project([{ ...Q.newRoom('living', 1, 1), measured: true, packs: ['wall_finish'] }]));
  ['setout', 'protect', 'waste_out', 'clean'].forEach(c => assert.equal(find(L, c).length, 1, c));
});

ok('楼上房间要加搬运费 = 面积 × (楼层 − 1)；楼下不加', () => {
  const up = { ...Q.newRoom('bedroom', 2, 1), L: 10, W: 10, measured: true, packs: ['wall_finish'] };
  const down = { ...Q.newRoom('bedroom', 1, 2), L: 10, W: 10, measured: true, packs: ['wall_finish'] };
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

ok('没确认尺寸：正式报价拦住，预估只提醒；窗户没填完、选了窗帘却没窗 → 都不能出报价单', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), packs: ['curtain'] };
  let K = Q.checks(project([r]), Q.buildLines(project([r])), 'formal');
  assert.ok(K.red.some(x => x.m.includes('尺寸还是默认值')));
  K = Q.checks(project([r]), Q.buildLines(project([r])), 'estimate');
  assert.ok(!K.red.some(x => x.m.includes('尺寸还是默认值')) && K.yellow.some(x => x.m.includes('尺寸还是默认值')), '预估不该被默认尺寸拦住');
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
  assert.ok(Q.checks(p, Q.buildLines(p), 'formal').red.some(x => x.m.includes('单价待公司核定')));
  assert.ok(Q.checks(p, Q.buildLines(p), 'estimate').yellow.some(x => x.m.includes('暂未计入总价')), '预估时提醒但不拦');
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
  const p = project([{ ...Q.newRoom('living', 1, 1), measured: true, packs: ['wall_finish', 'floor', 'electric'] }]);
  const L = Q.buildLines(p), T = Q.totals(p, L);
  assert.equal(T.pay.reduce((t, x) => t + x.amt, 0), T.total);
  assert.equal(T.mgmt, Math.round(T.direct * 0.06));
  assert.equal(T.design, Math.round(280 * 8));
});

ok('可改实际施工面积：旧地砖只铺一半就只拆一半；地砖改面积，找平和美缝跟着改，踢脚线仍按周长', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['demo_floor', 'floor'] }; // 11×10 = 110
  let L = Q.buildLines(project([r]));
  assert.equal(qty(L, 'demo_floor'), 110);
  r.vals = { demo_floor: { floor: 60 }, floor: { floor: 80 } };
  L = Q.buildLines(project([r]));
  assert.equal(qty(L, 'demo_floor'), 60);
  assert.equal(qty(L, 'floor_tile'), 80);
  assert.equal(qty(L, 'screed'), 80);
  assert.equal(qty(L, 'grout'), 80);
  assert.equal(qty(L, 'skirting'), 42 - 3, '踢脚线按周长减门宽，不跟面积走');
  r.vals.floor.floor = 200;
  assert.ok(Q.checks(project([r]), Q.buildLines(project([r]))).yellow.some(x => x.m.includes('大于房间地面')));
});

ok('定制柜按正面面积 = 宽 × 高；单价未定前拦住出单', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['wardrobe'], vals: { wardrobe: { w: 9, h: 8 } } };
  const p = project([r]); const L = Q.buildLines(p);
  assert.equal(Q.PRICE.wardrobe.unit, '平方尺');
  assert.equal(qty(L, 'wardrobe'), 72);
  assert.ok(Q.checks(p, L, 'formal').red.some(x => x.m.includes('衣柜定制')));
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

ok('预估报价：没定的选材只提醒；正式报价：必须全部定好', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['floor'] };
  const p = project([r]);
  const L = Q.buildLines(p);
  assert.ok(Q.checks(p, L, 'estimate').yellow.some(x => x.m.includes('地面还没定选材')));
  assert.ok(!Q.checks(p, L, 'estimate').red.some(x => x.m.includes('地面还没定选材')));
  assert.ok(Q.checks(p, L, 'formal').red.some(x => x.m.includes('地面还没定选材')));
  p.plans = [{ id: 'A', specs: { tile: { material: '瓷砖', floorSize: '600×600 mm', finish: '哑光', supply: '包工包料' } }, roomSpecs: {} }];
  assert.ok(!Q.checks(p, Q.buildLines(p), 'formal').red.length);
});

ok('客户自备砖：地砖只收辅材+人工，不收主材', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['floor'] };
  const p = project([r], { plans: [{ id: 'A', specs: { tile: { supply: '客户自备砖' } }, roomSpecs: {} }] });
  const t = Q.PRICE.floor_tile;
  assert.equal(find(Q.buildLines(p), 'floor_tile')[0].unit, Math.round((t.aux + t.lab) * 100) / 100);
});

ok('换了非标准选项但公司还没登记价差：标记价差待定，正式报价拦住；登记后按价差加价', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['floor'] };
  const p = project([r], { plans: [{ id: 'A', specs: { tile: { material: '瓷砖', floorSize: '600×1200 mm', finish: '哑光', supply: '包工包料' } }, roomSpecs: {} }] });
  let line = find(Q.buildLines(p), 'floor_tile')[0];
  assert.deepEqual(line.priceTbd, ['地砖尺寸：600×1200 mm']);
  assert.equal(line.unit, Q.unitPrice('floor_tile'), '价差未定时暂按标准价');
  assert.ok(Q.checks(p, Q.buildLines(p), 'formal').red.some(x => x.m.includes('价差待公司核定')));
  Q.OPTION_PRICES['tile.floorSize.600×1200 mm'] = { floor_tile: { mat: 2, lab: 1 } };
  line = find(Q.buildLines(p), 'floor_tile')[0];
  assert.equal(line.priceTbd.length, 0);
  assert.equal(line.unit, Math.round((Q.unitPrice('floor_tile') + 3) * 100) / 100);
  delete Q.OPTION_PRICES['tile.floorSize.600×1200 mm'];
});

ok('大板砖（750×1500 以上）自动加大板铺贴加价', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['floor'] };
  const p = project([r], { plans: [{ id: 'A', specs: { tile: { floorSize: '900×1800 mm' } }, roomSpecs: {} }] });
  assert.equal(qty(Q.buildLines(p), 'big_tile_extra'), 110);
});

ok('逐间设置优先于全屋统一：客厅瓷砖、卧室木地板', () => {
  const a = { ...Q.newRoom('living', 1, 1), measured: true, packs: ['floor'] }, b = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['floor'] };
  const p = project([a, b], { plans: [{ id: 'A', specs: { tile: { material: '瓷砖' } }, roomSpecs: { [b.id]: { tile: { material: '强化复合木地板' } } } }] });
  const L = Q.buildLines(p);
  assert.equal(qty(L, 'floor_tile', a.id), 280);
  assert.equal(qty(L, 'laminate', b.id), 110);
  assert.equal(qty(L, 'floor_tile', b.id), 0);
});

ok('卫生间、厨房天花默认防潮石膏板，其他房间普通石膏板；叠级吊顶自动带灯槽灯带', () => {
  const b = bath({ packs: ['bath_ceil'] }), l = { ...Q.newRoom('living', 1, 1), measured: true, packs: ['ceiling'] };
  const p = project([b, l]);
  assert.equal(Q.specOf(p, b, 'ceiling', 'board').v, '防潮石膏板');
  assert.equal(Q.specOf(p, l, 'ceiling', 'board').v, '普通石膏板');
  p.plans = [{ id: 'A', specs: { ceiling: { style: '叠级+灯槽' } }, roomSpecs: {} }];
  const L = Q.buildLines(p);
  assert.equal(qty(L, 'ceiling_step', l.id), 68);
  assert.equal(qty(L, 'led_strip', l.id), 68);
});

ok('同一范围两套方案：方案之间只差选材，范围和数量相同', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['floor', 'wall_finish'] };
  const p = project([r], { plans: [{ id: 'A', specs: { tile: { supply: '包工包料' } }, roomSpecs: {} }, { id: 'B', specs: { tile: { supply: '客户自备砖' } }, roomSpecs: {} }] });
  const A = Q.buildLines(p, 'A'), B = Q.buildLines(p, 'B');
  assert.deepEqual(A.map(l => [l.code, l.qty]), B.map(l => [l.code, l.qty]));
  assert.ok(Q.totals(p, A).total > Q.totals(p, B).total);
});

ok('旧草稿迁移：地砖/木地板/吊顶/刷漆卡片转成新的范围卡片和选材', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['laminate', 'ceil_feature', 'paint'], vals: { laminate: { floor: 90 } } };
  const p = Q.migrate(project([r]));
  assert.deepEqual([...r.packs].sort(), ['ceiling', 'floor', 'wall_finish']);
  const L = Q.buildLines(p);
  assert.equal(qty(L, 'laminate'), 90);
  assert.equal(qty(L, 'ceiling_step'), 42);
});

ok('加建一定带扩建图纸及市政局申请', () => {
  const p = project([], { house: { extension: { on: true, area: 150 } } });
  const L = Q.buildLines(p);
  assert.equal(qty(L, 'extension'), 150);
  assert.equal(qty(L, 'ext_permit'), 1);
});

ok('手动增项：自己填的名称、单位、阶段、单价进报价单；没填完拦住', () => {
  const p = project([], { extras: [{ name: '屋顶瓦片翻新', unit: '平方尺', stage: 'outdoor', qty: 800, price: 12 }] });
  const L = Q.buildLines(p), x = L.find(l => l.name === '屋顶瓦片翻新');
  assert.equal(x.total, 9600);
  assert.equal(x.unitName, '平方尺');
  assert.equal(x.stage, 'outdoor');
  assert.equal(find(L, 'setout').length, 1, '只有手动增项也算开工');
  p.extras.push({ name: '', unit: '项', stage: 'outdoor', qty: 1, price: 0 });
  const red = Q.checks(p, Q.buildLines(p)).red.map(r => r.m);
  assert.ok(red.some(m => m.includes('第 2 项请填写名称')));
  assert.ok(red.some(m => m.includes('请填写单价')));
});

ok('选材按「房间·位置」定：同一房间两个柜子可以用不同门板', () => {
  const r = { ...Q.newRoom('living', 1, 1), measured: true, packs: ['tv_cab', 'shoe_cab'] };
  const p = project([r], { plans: [{ id: 'A', specs: {}, roomSpecs: { [r.id]: { '@tv_cab': { cabinet: { door: '烤漆' } }, '@shoe_cab': { cabinet: { door: 'PET' } } } } }] });
  const L = Q.buildLines(p);
  assert.ok(find(L, 'tv_cab')[0].spec.includes('烤漆'));
  assert.ok(find(L, 'shoe_cab')[0].spec.includes('PET'));
});

ok('位置清单只列真正用到的选项：地面选木地板就不再问地砖尺寸；卫生间墙砖和地砖表面分开', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['floor'] };
  const p = project([r]);
  let pl = Q.placesOf(p, r, Q.buildLines(p))[0];
  assert.equal(pl.label, '地面');
  assert.deepEqual(pl.keys[0], ['tile', 'material'], '先选材料');
  assert.ok(pl.keys.some(([, k]) => k === 'floorSize'));
  p.plans = [{ id: 'A', specs: {}, roomSpecs: { [r.id]: { '@floor': { tile: { material: 'SPC 石塑地板' } } } } }];
  pl = Q.placesOf(p, r, Q.buildLines(p))[0];
  assert.ok(!pl.keys.some(([, k]) => k === 'floorSize'));
  assert.ok(pl.keys.some(([, k]) => k === 'woodGrade'));
  const b = bath({ packs: ['bath_tile'] }), pb = project([b]);
  const keys = Q.placesOf(pb, b, Q.buildLines(pb))[0].keys.map(([, k]) => k);
  assert.ok(keys.includes('finish') && keys.includes('wallFinish'));
  assert.equal(Q.specOf(pb, b, 'tile', 'finish', null, 'bath_tile').v, '防滑', '卫生间地砖默认防滑');
});

ok('设计费只算有施工的室内房间：没动的卧室不收设计费', () => {
  const live = { ...Q.newRoom('living', 1, 1), measured: true, packs: ['wall_finish'] };
  const idle = Q.newRoom('bedroom', 1, 1);
  const p = project([live, idle]);
  assert.equal(Q.totals(p, Q.buildLines(p)).design, 280 * 8);
});

ok('同样的输入永远算出同样的结果', () => {
  const p = project(Q.presetRooms('semi').map(r => ({ ...r, measured: true, packs: Q.ROOMS[r.type].packs.slice(0, 4) })));
  assert.deepEqual(Q.buildLines(p), Q.buildLines(JSON.parse(JSON.stringify(p))));
});


ok('厨房贴了操作区墙砖，那部分墙不再批灰刷漆（不重复收费）', () => {
  const r = { ...Q.newRoom('kitchen', 1, 1), measured: true, packs: ['wall_finish'] };
  const plain = qty(Q.buildLines(project([r])), 'paint_wall');
  r.packs = ['wall_finish', 'kitchen_tile']; r.vals = { kitchen_tile: { back: 10 } };
  const L = Q.buildLines(project([r]));
  assert.equal(qty(L, 'wall_tile'), 25);
  assert.equal(plain - qty(L, 'paint_wall'), 25);
  assert.equal(plain - qty(L, 'skim'), 25);
});

ok('拆旧墙砖按「铲除旧墙砖」收，不再按铲墙皮的价', () => {
  const r = { ...Q.newRoom('bath', 1, 1), measured: true, packs: ['bath_demo'] };
  const L = Q.buildLines(project([r]));
  assert.ok(qty(L, 'demo_wall_tile') > 0 && qty(L, 'demo_skin') === 0);
});

ok('砸墙渣土每 100 平方尺 1 车', () => {
  const p = project([{ ...Q.newRoom('living', 1, 1), measured: true, packs: ['electric'] }], { house: { wall_demo: { on: true, area: 250 } } });
  assert.equal(qty(Q.buildLines(p), 'waste_out'), 1 + 3);
});

ok('公寓自动加物业装修申请，有地房屋不加', () => {
  const rooms = [{ ...Q.newRoom('living', 1, 1), packs: ['electric'] }];
  assert.equal(qty(Q.buildLines(project(rooms, { houseType: 'condo' })), 'permit'), 1);
  assert.equal(qty(Q.buildLines(project(rooms, { houseType: 'terrace' })), 'permit'), 0);
});

ok('补上的漏项：吊扇含安装、换门换窗带拆旧、只刷天花、纱窗', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, doors: 1, windows: [{ w: 4, h: 5 }], packs: ['fan', 'door', 'window_new', 'ceil_paint', 'fly_screen'] };
  const L = Q.buildLines(project([r]));
  assert.equal(qty(L, 'ceiling_fan'), 1);
  assert.equal(qty(L, 'demo_piece'), 2, '1 扇旧门 + 1 樘旧窗');
  assert.equal(qty(L, 'paint_ceiling'), 110);
  assert.equal(qty(L, 'fly_screen'), 20);
});

ok('吊顶和只刷天花同时选 → 拦住（吊顶已含天花油漆）', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['ceiling', 'ceil_paint'] };
  assert.ok(Q.checks(project([r]), Q.buildLines(project([r]))).red.some(x => x.m.includes('天花重刷')));
});

ok('雨棚在车廊和全屋都选 → 重复收费，拦住', () => {
  const r = { ...Q.newRoom('porch', 1, 1), measured: true, packs: ['awning'] };
  const p = project([r], { house: { awning: { on: true } } });
  assert.ok(Q.checks(p, Q.buildLines(p)).red.some(x => x.m.includes('重复收费')));
});

ok('公寓不显示有地房屋的外部项目', () => {
  ['sewer', 'autogate', 'roof_fix', 'fence'].forEach(k => assert.ok(Q.HOUSE_ITEMS.find(i => i.k === k).landed, k));
  ['db_box', 'cctv', 'wall_demo'].forEach(k => assert.ok(!Q.HOUSE_ITEMS.find(i => i.k === k).landed, k));
});
ok('人工增加项挂在房间：算进这间小计；不挂房间就算全屋', () => {
  const r = { ...Q.newRoom('living', 1, 1), measured: true, packs: [] };
  const p = project([r], { extras: [{ roomId: r.id, name: '墙面裂缝修补', unit: '项', stage: 'custom', qty: 2, price: 300 }, { name: '屋顶检查', unit: '项', stage: 'outdoor', qty: 1, price: 500 }] });
  const L = Q.buildLines(p).filter(l => l.code === 'custom_item');
  assert.equal(L.find(l => l.name === '墙面裂缝修补').roomId, r.id);
  assert.equal(L.find(l => l.name === '墙面裂缝修补').total, 600);
  assert.equal(L.find(l => l.name === '屋顶检查').roomId, null);
  const bad = project([r], { extras: [{ roomId: r.id, name: '', qty: 1, price: 0 }] });
  assert.ok(Q.checks(bad, Q.buildLines(bad)).red.some(x => x.go === r.id && x.m.includes('人工增加项')), '没填完要提醒，并能点回这个房间');
});

ok('卫生间 1 选了防水地砖，一键沿用到卫生间 2：数量按各自尺寸算，选材跟着带过去，之后可单独改', () => {
  const b1 = { ...Q.newRoom('bath', 1, 1), L: 8, W: 5, measured: true, packs: ['bath_tile', 'bath_water'], vals: { bath_water: { n: 6 }, bath_tile: { floor: 30 } } };
  const b2 = { ...Q.newRoom('bath', 1, 2), L: 7, W: 5, measured: true, packs: [] };
  const lv = { ...Q.newRoom('living', 1, 1), packs: [] };
  const p = project([b1, b2, lv]);
  p.plans = [{ id: 'A', name: '方案 A', specs: {}, roomSpecs: { [b1.id]: { '@bath_tile': { tile: { floorSize: '300×600 mm' } } } } }]; p.planId = 'A';
  // 避免漏项：全屋其他房间都列出，但一般不做这项的（客厅做卫生间防水）排在最后，页面标「一般不做」
  assert.deepEqual(Q.roomsFor(p, b1.id, 'bath_tile').map(r => r.id), [b2.id, lv.id], '同类卫生间在前，客厅也列出但排最后');
  Q.copyPack(p, b1.id, b2.id, 'bath_tile', true); Q.copyPack(p, b1.id, b2.id, 'bath_water', true);
  const L = Q.buildLines(p);
  assert.equal(L.find(l => l.roomId === b2.id && l.code === 'floor_tile').qty, 35, '面积按卫生间 2 自己的 7×5，不复制卫生间 1 手改的 30');
  assert.equal(L.find(l => l.roomId === b2.id && l.code === 'water_pt').qty, 6, '点位数这类数字跟着复制');
  assert.equal(Q.specOf(p, b2, 'tile', 'floorSize', null, 'bath_tile').v, '300×600 mm', '选材跟着复制');
  Q.activePlan(p).roomSpecs[b2.id]['@bath_tile'].tile.floorSize = '600×600 mm';
  assert.equal(Q.specOf(p, b1, 'tile', 'floorSize', null, 'bath_tile').v, '300×600 mm', '改卫生间 2 不影响卫生间 1（是复制不是联动）');
  Q.copyPack(p, b1.id, b2.id, 'bath_water', false);
  assert.ok(!b2.packs.includes('bath_water'), '取消也能一起取消');
});

ok('整间复制：同类房间整套照搬，不同类房间只搬做得了的', () => {
  const m = { ...Q.newRoom('master', 1, 1), measured: true, packs: ['floor', 'wall_finish', 'ceiling', 'wardrobe'] };
  const b = { ...Q.newRoom('bedroom', 1, 1), packs: ['fan'] };
  const k = { ...Q.newRoom('kitchen', 1, 1), packs: [] };
  const p = project([m, b, k]);
  const skipped = Q.copyRoom(p, m.id, [b.id, k.id]);
  assert.deepEqual(b.packs.sort(), ['ceiling', 'floor', 'wall_finish', 'wardrobe'], '目标原来的工项被换掉');
  assert.deepEqual(k.packs.sort(), ['ceiling', 'wall_finish']);
  assert.deepEqual(skipped[k.id].sort(), ['floor', 'wardrobe'], '厨房做不了的要告诉员工');
});

ok('主人房、卧室、书房算同类；客厅和餐厅算同类，沿用时排在前面', () => {
  const p = project(Q.presetRooms('semi'));
  const m = p.rooms.find(r => r.type === 'master'), lv = p.rooms.find(r => r.type === 'living');
  const t = Q.roomsFor(p, m.id, 'wardrobe').map(r => r.type);
  assert.equal(t[0], 'bedroom', '衣柜沿用先列卧室');
  assert.equal(t.length, p.rooms.length - 1, '全屋其他房间都列出，不漏');
  assert.equal(Q.roomsFor(p, lv.id, 'wall_finish')[0].type, 'dining', '客厅刷墙先问餐厅');
  assert.equal(Q.kinLabel('master'), '卧室');
});

ok('户型模板：卧室/卫生间/楼层数照选的生成；默认尺寸不低于 UBBL 第 42 条最低面积', () => {
  for (const h of Object.keys(Q.HOUSES)) for (const l of Q.layoutsFor(h)) for (const d of [0, 1]) {
    const spec = { ...l, beds: l.beds + d, baths: l.baths + d };
    const rs = Q.layoutRooms(h, spec), beds = rs.filter(r => ['master', 'bedroom'].includes(r.type));
    assert.equal(beds.length, spec.beds, h + l.id + ' 卧室数');
    assert.equal(rs.filter(r => r.type === 'bath').length, spec.baths, h + l.id + ' 卫生间数');
    assert.equal(Math.max(...rs.map(r => r.level || 1)), spec.levels, h + l.id + ' 楼层数');
    const area = r => r.L * r.W;
    const others = beds.filter(r => r.type === 'bedroom').sort((a, b) => area(b) - area(a));
    if (beds.length) assert.ok(area(beds.find(r => r.type === 'master')) >= 118, h + ' 主人房 ≥ 11㎡');
    if (others[0]) assert.ok(area(others[0]) >= 100, h + ' 第二间房 ≥ 9.3㎡');
    others.forEach(r => assert.ok(area(r) >= 70, h + ' 其他卧室 ≥ 6.5㎡'));
    rs.filter(r => r.type === 'kitchen').forEach(r => assert.ok(area(r) >= 48 && Math.min(r.L, r.W) >= 4.9, h + ' 厨房 ≥ 4.5㎡、宽 ≥ 1.5 米'));
    if (spec.levels > 1) assert.ok(rs.some(r => r.type === 'stairs'), '多层要有楼梯');
  }
});

ok('楼梯：踏步、扶手、楼梯灯都能报', () => {
  const r = { ...Q.newRoom('stairs', 1, 1), measured: true, packs: ['stair_tile', 'stair_rail', 'stair_light'] };
  const L = Q.buildLines(project([r]));
  assert.equal(qty(L, 'stair_tread'), 18); assert.equal(qty(L, 'stair_rail'), 15); assert.equal(qty(L, 'stair_light'), 2);
});

ok('客厅可以选神龛：按正面宽×高的平方尺计，单价待公司核定（不乱填价）', () => {
  assert.ok(Q.ROOMS.living.packs.includes('altar'), '客厅有神龛选项');
  const lv = { ...Q.newRoom('living', 1, 1), measured: true, packs: ['altar'], vals: { altar: { w: 4, h: 7 } } };
  const l = Q.buildLines(project([lv])).find(x => x.code === 'altar_cab');
  assert.ok(l && l.qty === 28, '4 × 7 = 28 平方尺');
});

ok('门和窗一样逐樘记录：换门按樘数计，墙面扣掉每樘门的实际面积；旧数据只有门数时自动变成默认 3×7 尺的门', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), L: 10, W: 10, H: 9, measured: true, doorList: [{ at: '房门', w: 3, h: 7 }, { at: '阳台门', w: 6, h: 7 }], packs: ['door'] };
  const g = Q.geo(r, {});
  assert.equal(g.doors, 2);
  assert.equal(g.wall, 40 * 9 - 21 - 42, '墙面 = 周长×层高 − 两樘门面积');
  assert.equal(Q.buildLines(project([r])).find(l => l.code === 'door').qty, 2, '换门 2 樘');
  const old = Q.migrate(project([{ ...Q.newRoom('bedroom', 1, 1), doors: 2, doorList: undefined }]));
  assert.equal(old.rooms[0].doorList.length, 2, '旧数据门数 2 → 两樘默认门');
});

ok('橱柜功能五金：每种按数量计，0 就不出现在报价单；旧报价里的「拉篮 3 套」照样算碗碟拉篮', () => {
  const k = { ...Q.newRoom('kitchen', 1, 1), measured: true, packs: ['cab_basket'], vals: { cab_basket: { n: 3, corner: 1, rice: 0 } } };
  const L = Q.buildLines(project([k]));
  assert.equal(L.find(l => l.code === 'cab_basket').qty, 3, '旧数据的拉篮数量保留');
  assert.equal(L.find(l => l.code === 'hw_corner').qty, 1);
  assert.ok(!L.some(l => l.code === 'hw_rice'), '填 0 的不出现');
  assert.ok(!L.some(l => l.code === 'hw_spice'), '新增的五金默认 0，不会悄悄加进原来的报价');
});

ok('送产品不送人工：赠送的项目材料免收、人工安装照收，报价单写明送了多少；衣柜可以加功能配件', () => {
  Q.PRICE.hw_rice = { ...Q.PRICE.hw_rice, mat: 150, aux: 10, lab: 40, waste: 0 }; delete Q.PRICE.hw_rice.unpriced;
  const k = { ...Q.newRoom('kitchen', 1, 1), measured: true, packs: ['cab_basket'], vals: { cab_basket: { n: 1, rice: 1 } }, gift: { hw_rice: true } };
  const L = Q.buildLines(project([k])), rice = L.find(l => l.code === 'hw_rice');
  // 送产品不送人工：米箱材料 150 + 辅料 10 免收，人工安装 40 照收
  assert.ok(rice.gift && rice.total === 40 && rice.giftValue === 160, '米箱赠送：产品 160 免收，人工 40 照收 ' + JSON.stringify(rice));
  assert.equal(Q.totals(project([k]), L).gift, 160);
  const m = { ...Q.newRoom('master', 1, 1), measured: true, packs: ['wardrobe'], vals: { wardrobe: { w: 8, h: 8, pants: 2, mirror: 1 } } };
  const W = Q.buildLines(project([m]));
  assert.equal(W.find(l => l.code === 'whw_pants').qty, 2); assert.equal(W.find(l => l.code === 'whw_mirror').qty, 1);
  assert.ok(!W.some(l => l.code === 'whw_safe'), '没填的配件不出现');
  Object.assign(Q.PRICE.hw_rice, { mat: 0, aux: 0, lab: 0, unpriced: true });
});

ok('功能五金只选需要的几种：其他填 0 不算错，不挡住「这间完成」', () => {
  const k = { ...Q.newRoom('kitchen', 1, 1), measured: true, packs: ['cab_basket'], vals: { cab_basket: { n: 2 } } };
  const K = Q.checks(project([k]), Q.buildLines(project([k])), 'estimate');
  assert.ok(!K.red.some(x => /功能五金/.test(x.m)), K.red.map(x => x.m).join('；'));
});

ok('加建：标了加建的房间按地面面积加结构；整单只申请一次准证；全屋和房间都选了要提醒重复', () => {
  const k = { ...Q.newRoom('kitchen', 1, 1), L: 12, W: 10, ext: true, measured: true, packs: ['wet_tile'] };
  const e = { ...Q.newRoom('extension', 1, 1), measured: true };
  assert.ok(e.ext, '「加建空间」默认就是加建');
  const p = project([k, e]); const L = Q.buildLines(p);
  assert.equal(L.filter(l => l.code === 'extension' && l.roomId === k.id)[0].qty, 120);
  assert.equal(L.filter(l => l.code === 'extension' && l.roomId === e.id)[0].qty, 200);
  assert.equal(qty(L, 'ext_permit'), 1, '准证整单一次');
  p.house = { extension: { on: true, area: 100 } };
  assert.equal(qty(Q.buildLines(p), 'ext_permit'), 1, '全屋也选了加建，准证还是一次');
  assert.ok(Q.checks(p, Q.buildLines(p)).yellow.some(x => x.m.includes('加建')), '提醒确认面积没重复');
  const rs = Q.layoutRooms('terrace', { beds: 4, baths: 3, levels: 2, ext: true });
  assert.ok(rs.some(r => r.type === 'extension' && r.name === '后院加建' && r.ext), '户型可带后院加建');
  assert.ok(!Q.layoutRooms('condo', { beds: 3, baths: 2, levels: 1, ext: true }).some(r => r.ext), '公寓不能加建');
});

ok('空间分组：室内在前室外在后；洗衣房、楼梯单独一组；阳台算室外', () => {
  assert.equal(Q.kinOf('laundry'), 'laundry'); assert.equal(Q.kinOf('stairs'), 'stairs');
  assert.notEqual(Q.kinOf('laundry'), Q.kinOf('kitchen'), '洗衣房不跟厨房一组');
  assert.equal(Q.kinOf('balcony'), Q.kinOf('porch'), '阳台按室外做');
  assert.equal(Q.kinOf('extension'), 'ext', '加建空间单独一组，不混进客厅公共区');
  assert.ok(Q.SPACE_GROUPS.find(g => g.id === Q.kinOf('yard')).out);
  const typed = new Set(Q.SPACE_GROUPS.flatMap(g => g.types));
  Object.keys(Q.ROOMS).forEach(t => assert.ok(typed.has(t), t + ' 要归到某一组，不然按类型做时会漏'));
  const p = project(Q.presetRooms('semi')), order = Q.sortRooms(p.rooms).map(r => Q.SPACE_GROUPS.find(g => g.types.includes(r.type)).out ? 1 : 0);
  assert.deepEqual(order, [...order].sort(), '室外房间排在所有室内房间后面');
  const bed = p.rooms.find(r => r.type === 'bedroom'); bed.ext = true;
  assert.equal(Q.roomGroup(bed), 'ext', '标了加建的卧室归加建组（要一起算地基、墙、屋顶）');
  assert.equal(Q.roomGroup(p.rooms.find(r => r.type === 'master')), 'bed', '没标加建的还在卧室组');
});

ok('按类型一起选：只加到这类房间做得了的，数量各按自己尺寸算；再点一次全部取消', () => {
  const p = project(Q.presetRooms('semi'));
  const baths = p.rooms.filter(r => r.type === 'bath'); baths[0].L = 10; baths[0].W = 6;
  assert.ok(baths.length >= 2);
  assert.equal(Q.setPackFor(p, baths.map(r => r.id), 'bath_tile', true), baths.length);
  const L = Q.buildLines(p), q = r => L.filter(l => l.roomId === r.id && l.pack === 'bath_tile' && l.code === 'floor_tile').reduce((t, l) => t + l.qty, 0);
  assert.notEqual(q(baths[0]), q(baths[1]), '大卫生间地砖数量应比小的多，不能一刀切');
  const bed = p.rooms.find(r => r.type === 'bedroom');
  assert.equal(Q.setPackFor(p, [bed.id], 'bath_tile', true), 0, '卧室不会被加上卫生间瓷砖');
  Q.setPackFor(p, baths.map(r => r.id), 'bath_tile', false);
  assert.ok(baths.every(r => !r.packs.includes('bath_tile')));
});

ok('浴室柜：每间按自己的尺寸列出；整组可一起选定制和材质；定制按柜宽计价', () => {
  const p = project(Q.presetRooms('semi')), baths = p.rooms.filter(r => r.type === 'bath');
  Q.setPackFor(p, baths.map(r => r.id), 'vanity', true);
  baths[0].vals = { vanity: { w: 120, d: 50, h: 85 } };
  let L = Q.buildLines(p);
  const v0 = L.find(l => l.roomId === baths[0].id && l.code === 'vanity'), v1 = L.find(l => l.roomId === baths[1].id && l.code === 'vanity');
  assert.match(v0.formula, /宽 120 × 深 50 × 高 85 cm/, '报价单上写清这间浴室柜尺寸');
  assert.match(v1.formula, /宽 80 /, '另一间用自己的（默认）尺寸，不被第一间带走');
  const pl = Q.activePlan(p);
  baths.forEach(r => { ((pl.roomSpecs[r.id] = pl.roomSpecs[r.id] || {})['@vanity'] = { vanity: { kind: '定制浴室柜', body: '铝合金' } }); });
  L = Q.buildLines(p);
  const c0 = L.find(l => l.roomId === baths[0].id && l.code === 'vanity_custom');
  assert.ok(c0 && Math.abs(c0.qty - 120 / 30.48) < 0.01, '定制按柜宽（延尺）算');
  assert.ok(!L.some(l => l.code === 'vanity'), '选了定制就不再算成品柜');
  assert.ok(c0.spec.includes('铝合金'), '材质写进报价单');
  assert.ok(c0.unpriced, '定制浴室柜单价待公司核定，不能悄悄按 0 算');
});

ok('淋浴区：每间尺寸和做法可不同；淋浴盘、L 型隔断、浴帘按选的做法出项目；旧报价迁移后隔断不丢', () => {
  const p = project(Q.presetRooms('semi')), baths = p.rooms.filter(r => r.type === 'bath');
  Q.setPackFor(p, baths.map(r => r.id), 'shower_area', true);
  baths[0].vals = { shower_area: { w: 120, d: 90, h: 200 } };
  const pl = Q.activePlan(p);
  (pl.roomSpecs[baths[0].id] = {})['@shower_area'] = { shower: { base: '成品淋浴盘', type: 'L 型' } };
  (pl.roomSpecs[baths[1].id] = {})['@shower_area'] = { shower: { type: '浴帘杆（不做玻璃）' } };
  const L = Q.buildLines(p), of = r => L.filter(l => l.roomId === r.id && l.pack === 'shower_area').map(l => l.code);
  assert.deepEqual(of(baths[0]), ['shower_tray', 'screen_l']);
  assert.match(L.find(l => l.code === 'screen_l').formula, /L 型，宽 120 × 深 90 × 高 200 cm/, '报价单写清这间隔断形式和尺寸');
  assert.deepEqual(of(baths[1]), ['curtain_rod'], '选浴帘就不算玻璃隔断');
  if (baths[2]) assert.deepEqual(of(baths[2]), ['screen'], '没改的按标准一字型');
  assert.ok(!L.some(l => l.pack === 'sanitary' && l.code === 'screen'), '隔断不再重复算在洁具里');
  const old = project([{ ...Q.newRoom('bath', 1, 1), packs: ['sanitary'] }]); delete old.mig;
  Q.migrate(old);
  assert.ok(old.rooms[0].packs.includes('shower_area'), '旧报价选了洁具的，迁移后补上淋浴区');
  old.rooms[0].packs = ['sanitary']; Q.migrate(old);
  assert.ok(!old.rooms[0].packs.includes('shower_area'), '只迁移一次，员工自己取消后不会又加回来');
});

ok('卫生间拆旧/防水/墙砖每间可不同：拆除范围、防水高度、墙砖高度改变数量；壁龛按个列出', () => {
  const p = project(Q.presetRooms('semi')), [a, b] = p.rooms.filter(r => r.type === 'bath');
  Q.setPackFor(p, [a.id, b.id], 'bath_demo', true); Q.setPackFor(p, [a.id, b.id], 'bath_tile', true);
  const pl = Q.activePlan(p);
  pl.roomSpecs[a.id] = { '@bath_demo': { demo: { scope: '只拆地砖（墙砖保留）' } }, '@bath_tile': { wet: { wpHeight: '全部墙面到顶', wallTile: '半墙 4 尺（上面刷漆）' } } };
  a.vals = { bath_tile: { niche: 2 } };
  const L = Q.buildLines(p), q = (r, code, pack) => L.filter(l => l.roomId === r.id && l.code === code && (!pack || l.pack === pack)).reduce((t, l) => t + l.qty, 0);
  const ga = Q.geo(a, p), gb = Q.geo(b, p);
  assert.equal(q(a, 'demo_wall_tile'), 0, '墙砖保留就不算拆墙砖'); assert.ok(q(b, 'demo_wall_tile') > 0, '另一间照常全拆');
  assert.equal(q(a, 'wp'), Q.r2(ga.floor + ga.wall), '全墙防水 = 地面 + 全部墙面');
  assert.equal(q(b, 'wp'), Q.r2(gb.floor + gb.perim + 36), '标准做法不变');
  assert.ok(Math.abs(q(a, 'wall_tile') - ga.wall * 4 / ga.H) < 0.02, '半墙只铺 4 尺');
  assert.ok(q(a, 'paint_wall', 'bath_tile') > 0, '半墙上面要刷漆，不能漏');
  assert.equal(q(a, 'niche'), 2); assert.equal(q(b, 'niche'), 0, '没填壁龛的不出这项');
});

ok('做法（scope）在房间里定，默认标准做法，不算「未定」；材料没选才算未定', () => {
  const p = project(Q.presetRooms('semi')), a = p.rooms.find(r => r.type === 'bath');
  Q.setPackFor(p, [a.id], 'shower_area', true);
  const L = Q.buildLines(p), sc = L.find(l => l.roomId === a.id && l.code === 'screen');
  assert.ok(sc.tbd.includes('shower'), '玻璃、五金颜色还没选，算未定');
  const pl = Q.activePlan(p); pl.roomSpecs[a.id] = { '@shower_area': { shower: { glass: '8 mm 钢化透明', frame: '不锈钢本色' } } };
  const sc2 = Q.buildLines(p).find(l => l.roomId === a.id && l.code === 'screen');
  assert.deepEqual(sc2.tbd, [], '材料选好了就算已定；隔断形式、淋浴区地面是做法，没点也按标准做法，不挡着');
  assert.ok(Object.values(Q.SPEC_CATS).every(c => Object.values(c.keys).every(k => !k.per)), '旧的 per 标记已全部换成 scope');
});

ok('楼梯：踏步做法、栏杆做法、踏步灯按选的出项目；没改的按瓷砖踏步 + 不锈钢立柱木扶手', () => {
  const r = { ...Q.newRoom('stairs', 1, 1), packs: ['stair_tile', 'stair_rail', 'stair_step_light'], vals: { stair_tile: { n: 16, w: 4, land: 20 }, stair_rail: { len: 15, top: 10 } } };
  const p = project([r]); let L = Q.buildLines(p);
  const codes = () => L.map(l => l.code);
  assert.ok(codes().includes('stair_tread') && codes().includes('floor_tile') && codes().includes('stair_steplight'));
  assert.equal(L.filter(l => l.code === 'stair_rail').reduce((t, l) => t + l.qty, 0), 25, '楼梯段 + 楼上护栏都算');
  Q.activePlan(p).roomSpecs[r.id] = { '@stair_tile': { stairs: { finish: '实木踏板' } }, '@stair_rail': { stairs: { rail: '钢化玻璃栏板 + 木扶手' } }, '@stair_step_light': { stairs: { stepLight: '踏步下 LED 灯带' } } };
  L = Q.buildLines(p);
  assert.ok(codes().includes('stair_wood') && codes().includes('stair_wood_land') && !codes().includes('stair_tread'), '实木踏板不再算瓷砖');
  assert.ok(codes().includes('rail_glass') && !codes().includes('stair_rail'));
  assert.equal(L.find(l => l.code === 'led_strip').qty, 64, '灯带 = 16 级 × 4 尺');
  assert.ok(L.find(l => l.code === 'stair_wood').unpriced, '实木踏板等公司定价，不按 0 算');
});

ok('阳台按墙面算的项目要现场确认墙面面积，填了才放行；其他房间不受影响', () => {
  const b = { ...Q.newRoom('balcony', 1, 1), L: 18, W: 10.5, measured: true, packs: ['wall_finish'] };
  const bed = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['wall_finish'] };
  const p = project([b, bed]);
  const red = () => Q.checks(p, Q.buildLines(p), 'estimate').red.map(x => x.m).filter(m => m.includes('墙面要现场确认'));
  assert.equal(red().length, 1, '阳台没确认墙面就挡着，卧室不用');
  b.vals = { wall_finish: { wall: 295 } };
  assert.equal(red().length, 0);
  assert.equal(Q.buildLines(p).find(l => l.roomId === b.id && l.code === 'paint_wall').qty, 295, '按员工填的实际面积算');
});

ok('阳台阳光棚只算顶；阳光房算顶 + 玻璃围合（长 × 高），顶面材料可选', () => {
  const b = { ...Q.newRoom('balcony', 1, 1), L: 18, W: 10.5, measured: true, packs: ['sun_canopy'] };
  const p = project([b]); let L = Q.buildLines(p);
  assert.equal(L.find(l => l.code === 'awning').qty, 189); assert.ok(!L.some(l => l.code === 'sunroom_wall'), '阳光棚四周不封');
  b.packs = ['sunroom']; b.vals = { sunroom: { area: 189, len: 39, h: 8 } };
  Q.activePlan(p).roomSpecs[b.id] = { '@sunroom': { canopy: { roof: '夹胶钢化玻璃' } } };
  L = Q.buildLines(p);
  assert.equal(L.find(l => l.code === 'sunroom_wall').qty, 312, '围合 39 尺 × 高 8 尺');
  const roof = L.find(l => l.code === 'awning');
  assert.ok(roof.spec.includes('夹胶钢化玻璃') && roof.priceTbd.length, '换玻璃顶要标价差待定，不能按阳光板价算');
});

ok('车廊上的棚叫车棚：旧报价的「雨棚」迁移成车棚，面积和价钱不变；和全屋雨棚同时选会提示重复', () => {
  const r = { ...Q.newRoom('porch', 1, 1), measured: true, packs: ['awning'], vals: { awning: { area: 300 } } };
  const p = project([r]); delete p.mig; const before = Q.totals(p, Q.buildLines(p)).total;
  Q.migrate(p);
  assert.deepEqual(r.packs, ['carport']); assert.equal(r.vals.carport.area, 300);
  assert.equal(Q.totals(p, Q.buildLines(p)).total, before, '只是改名，金额不变');
  p.house = { awning: { on: true } };
  assert.ok(Q.checks(p, Q.buildLines(p), 'estimate').red.some(x => x.m.includes('重复收费')));
});

ok('自动杂项可对某单免收；不可预见费按直接费百分比加进总价', () => {
  const r = { ...Q.newRoom('bedroom', 2, 1), measured: true, packs: ['wall_finish'] };
  const p = project([r]); p.houseType = 'condo';
  const has = c => Q.buildLines(p).some(l => l.code === c);
  ['setout', 'protect', 'permit', 'carry_up', 'waste_out', 'clean'].forEach(c => assert.ok(has(c), c + ' 自动加上'));
  p.waive = { protect: true }; assert.ok(!has('protect'), '免收后不再算'); assert.ok(has('setout'));
  const L = Q.buildLines(p), t0 = Q.totals(p, L);
  p.settings = { contRate: 5 }; const t1 = Q.totals(p, L);
  assert.equal(t1.cont, Math.round(t0.direct * 0.05)); assert.equal(t1.total - t0.total, t1.cont);
});

ok('天花做法：L-box 只做一圈、双层叠级两倍长度、格栅/铝扣板不用石膏板；旧的「叠级+灯槽」照旧', () => {
  const r = { ...Q.newRoom('living', 1, 1), L: 20, W: 15, H: 9, measured: true, packs: ['ceiling'] };
  const p = project([r]), set = st => { Q.activePlan(p).roomSpecs[r.id] = { '@ceiling': { ceiling: { style: st } } }; return Q.buildLines(p); };
  const q = (L, c) => L.filter(l => l.code === c).reduce((t, l) => t + l.qty, 0);
  let L = set('平顶'); assert.equal(q(L, 'plaster_ceiling'), 300); assert.equal(q(L, 'ceiling_step'), 0);
  L = set('四周 L-box 灯槽（中间不吊）'); assert.equal(q(L, 'plaster_ceiling'), 140, 'L-box 只做周长 70 × 2 尺宽'); assert.equal(q(L, 'paint_ceiling'), 300, '中间原天花也要刷漆');
  L = set('叠级+灯槽'); assert.equal(q(L, 'ceiling_step'), 70); assert.equal(q(L, 'led_strip'), 70);
  L = set('双层回字形叠级'); assert.equal(q(L, 'ceiling_step'), 140);
  L = set('木纹格栅'); assert.equal(q(L, 'ceil_slat'), 300); assert.equal(q(L, 'plaster_ceiling'), 0);
  r.vals = { ceiling: { pelmet: 12 } }; L = set('平顶'); assert.equal(q(L, 'pelmet'), 12, '窗帘盒按填的长度');
});

ok('收费里的自动杂项可以手动改数量和单价；清掉手动值就恢复自动算', () => {
  const r = { ...Q.newRoom('bedroom', 1, 1), measured: true, packs: ['wall_finish'] };
  const p = project([r]), w = () => Q.buildLines(p).find(l => l.code === 'waste_out');
  const autoQty = w().qty;
  p.feeQty = { waste_out: 4 }; p.prices = { waste_out: { mat: 0, aux: 0, waste: 0, lab: 300 } };
  assert.equal(w().qty, 4); assert.equal(w().total, 1200); assert.match(w().formula, /手动填写/);
  delete p.feeQty.waste_out; delete p.prices.waste_out;
  assert.equal(w().qty, autoQty); assert.equal(w().unit, 350);
});

console.log(`PASS: ${n} quote-v2 rule checks`);
