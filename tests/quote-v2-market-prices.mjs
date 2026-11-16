import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = name => readFileSync(new URL(`../portal/${name}`, import.meta.url), 'utf8');
const storage = new Map();
const context = { localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) } };
vm.runInNewContext(src('quote-v2-price.js'), context);
const originalProtect = { ...context.QV2_PRICE.protect };
vm.runInNewContext(src('quote-v2-market-20261116.js'), context);
assert.equal(context.QV2_MARKET_INFO.items, 169);
assert.equal(context.QV2_MARKET_INFO.options, 215);
assert.equal(context.QV2_PRICE.protect.unit, '平方尺');
assert.equal(context.QV2_PRICE.protect.lab, originalProtect.lab, '旧“项”价格不可套到平方尺');
for (const [code, v] of Object.entries(context.QV2_MARKET_BOOK.items)) {
  assert.equal(context.QV2_PRICE[code].unit, v.unit, code);
  const total = v.mat * (1 + v.waste / 100) + v.aux + v.lab;
  assert.ok(Number.isFinite(total), code);
  assert.equal(context.QV2_PRICE[code].ref, true, '调查建议价须标为参考价');
}
storage.set('houzy-quote-v2-pricebook', JSON.stringify({ items: { demo_floor: { mat: 0, aux: 0, lab: 1, waste: 0, unit: '平方尺' } }, options: {}, tiles: { 'tile.size.600×1200 mm.亮光': 112 } }));
vm.runInNewContext(src('quote-v2-pricebook.js'), context);
// 老板 11-16 决定：已保存的公司价不能被市场估价替换，估价只填没定过的项目
assert.equal(context.QV2_PRICE.demo_floor.lab, 1, '公司已保存的价优先于市场估价');
assert.ok(!context.QV2_PRICE.demo_floor.ref, '公司价不标参考价');
assert.equal(context.QV2_PRICE.demo_wall.ref, true, '没定过的项目仍用市场估价并标参考价');
assert.equal(context.QV2_TILE_PIECE_PRICES['tile.size.600×1200 mm.亮光'], 112, '瓷砖系统片价保持独立');
console.log('PASS: market workbook overlay and migration');
