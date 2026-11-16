// 价目表上传：为什么重要——老板填的价格必须真的进到报价里，填错的行不能悄悄吞掉。
import assert from 'node:assert/strict';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const B = require('../portal/quote-v2-pricebook.js');
const src = require('../portal/quote-v2-price.js');
const PRICE = JSON.parse(JSON.stringify(src.PRICE)), OPT = {};
let n = 0; const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } n++; };

const csv = B.template(PRICE, globalThis.QV2_SPEC_CATS || require('../portal/quote-v2-rules.js').SPEC_CATS, OPT);
const rows = B.parseCsv(csv);
ok(rows[0][1] === '编号', '模板有表头');
ok(rows.some(r => r[1] === 'three_phase' && r[4] === ''), '待核定项目单价留空');
ok(rows.some(r => r[1] === 'floor_tile' && r[4] !== ''), '已有单价的项目带出现价');
ok(rows.some(r => r[1] === 'cabinet.door.烤漆@wardrobe'), '选材价差按项目分行');
ok(!rows.some(r => r[1].startsWith('tile.finish.')), '不影响价格的选项不出行');
ok(!rows.some(r => r[1] === 'tile.supply.客户自备砖@floor_tile'), '已知算法的选项（自备砖）不出行');

// 模拟老板在 Excel 填好：三相电 RM2,500 人工；烤漆门板衣柜每平方尺 +15；Blum 填 0
const filled = rows.map(r => {
  r = [...r];
  if (r[1] === 'three_phase') r[6] = 'RM 2,500';
  if (r[1] === 'cabinet.door.烤漆@wardrobe') r[4] = '15';
  if (r[1] === 'cabinet.hardware.Blum@wardrobe') r[6] = '0';
  if (r[1] === 'lighting.grade.防眩筒灯+射灯@light') r[4] = '-5';
  return r.map(x => /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x).join(',');
}).join('\n');
const res = B.read(filled, PRICE);
ok(res.errors.length === 0, '正常的表没有错误 ' + res.errors.join(';'));
ok(res.items.three_phase.lab === 2500, '带 RM 和千分位的数字能读');
ok(res.options['cabinet.door.烤漆'].wardrobe.mat === 15, '价差读进来');
ok(res.options['cabinet.hardware.Blum'].wardrobe.lab === 0, '填 0 = 不加价，也算已定');
ok(res.options['lighting.grade.防眩筒灯+射灯'].light.mat === -5, '价差可以是负数');
ok(!res.options['cabinet.door.PET'], '空白的价差不算已定');

B.apply(res, PRICE, OPT);
ok(!PRICE.three_phase.unpriced && PRICE.three_phase.lab === 2500, '填了单价后不再是待核定');
ok(OPT['cabinet.door.烤漆'].wardrobe.mat === 15, '价差合并进选材价');

const bad = B.read('类型,编号,名称,单位,材料,辅料,人工,损耗%,说明\n项目单价,no_such,,,1,,,,\n项目单价,setout,,,abc,,,,\n项目单价,protect,,,-1,,,,', PRICE);
ok(bad.errors.length === 3, '编号不存在、非数字、负单价都要报错 ' + bad.errors.join(';'));
ok(B.read('a,b\n1,2', PRICE).errors.length === 1, '表头不对要报错');

{
  // 旧价目表里「成品保护」是按「项」填的总价；改成按平方尺后不能再套用，否则 2,000 平方尺 × 250 = 50 万
  const price = { protect: { unit: '平方尺', mat: 0, aux: 0, lab: 0, unpriced: true }, setout: { unit: '项', mat: 0, aux: 0, lab: 150 } };
  B.apply({ items: { protect: { mat: 250, aux: 50, lab: 200, waste: 0 }, setout: { mat: 0, aux: 0, lab: 500, waste: 0 } } }, price, {});
  assert.equal(price.protect.mat, 0); assert.ok(price.protect.unpriced, '旧单位的价不套用');
  assert.equal(price.setout.lab, 500, '单位没变的照常套用');
  B.apply({ items: { protect: { mat: 0, aux: 0, lab: 0.3, waste: 0, unit: '平方尺' } } }, price, {});
  assert.equal(price.protect.lab, 0.3, '按新单位填的价可以用');
}
console.log(`PASS: ${n} pricebook checks`);
