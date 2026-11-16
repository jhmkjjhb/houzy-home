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
assert.ok(storage.get('houzy-quote-v2-pricebook-before-market-20261116'), '迁移旧价前应备份');
assert.equal(context.QV2_PRICE.demo_floor.lab, 2.21, '首次启用时调查建议价优先于旧浏览器价');
assert.equal(context.QV2_TILE_PIECE_PRICES['tile.size.600×1200 mm.亮光'], 112, '瓷砖系统片价保持独立');
console.log('PASS: market workbook overlay and migration');
