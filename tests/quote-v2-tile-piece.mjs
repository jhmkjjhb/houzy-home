import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const Q = require('../portal/quote-v2-rules.js');
const B = require('../portal/quote-v2-pricebook.js');
const Products = require('../portal/quote-v2-tile-products.js');

const room = (type, packs, L = 10.7639, W = 10) => ({ ...Q.newRoom(type, 1, 1), L, W, measured: true, packs });
const project = (rooms, specs = {}) => ({ houseType: 'terrace', rooms, house: {}, prices: {}, info: {}, discount: 0, design: true,
  planId: 'A', plans: [{ id: 'A', name: 'A', specs, roomSpecs: {} }] });
const line = (p, code) => Q.buildLines(p).find(l => l.code === code);
const floorId = 'tile.floorSize.600×600 mm@floor_tile';
const largeId = 'tile.floorSize.600×1200 mm@floor_tile';

const legacy = line(project([room('bedroom', ['floor'])]), 'floor_tile');
assert.equal(legacy.tile, null, '无片价时不套旧面积砖材价');
assert.ok(legacy.priceTbd.some(x => x.includes('砖材片价')));
Q.TILE_PIECE_PRICES['tile.size.600×600 mm.哑光'] = 20;
const standard = line(project([room('bedroom', ['floor'])], { tile: { material: '瓷砖', floorSize: '600×600 mm' } }), 'floor_tile');
assert.equal(standard.tile.areaM2, 10);
assert.equal(standard.tile.pieces, 30, '10m²、600×600、损耗8% = 30片');
assert.equal(standard.tile.materialTotal, 600, 'RM20/片 = RM600砖材');
assert.equal(standard.tile.areaTotal, Math.round(standard.qty * (Q.PRICE.floor_tile.aux + Q.PRICE.floor_tile.lab) * 100) / 100, '砖材旧面积价不重复计入');
assert.equal(standard.total, Math.round(standard.tile.materialTotal + standard.tile.areaTotal));

Q.TILE_PIECE_PRICES['tile.size.600×1200 mm.哑光'] = 40;
const large = line(project([room('bedroom', ['floor'])], { tile: { material: '瓷砖', floorSize: '600×1200 mm' } }), 'floor_tile');
assert.equal(large.tile.pieces, 15, '规格变大，片数自动减少');
assert.equal(large.tile.materialTotal, 600, '规格使用独立每片价格');
assert.deepEqual(large.priceTbd, [], '已有片价无需旧规格价差');

const wallId = 'tile.wallSize.300×600 mm@wall_tile';
Q.TILE_PIECE_PRICES['tile.size.300×600 mm.亮光'] = 12;
const wall = line(project([room('bath', ['bath_tile'], 8, 5)]), 'wall_tile');
assert.equal(wall.tile.size, '300×600 mm');
assert.equal(wall.tile.materialTotal, wall.tile.pieces * 12);
assert.ok(wall.tile.areaM2 > 0);

const matteId = 'tile.floorSize.600×600 mm.质感哑面@floor_tile';
const glossyId = 'tile.floorSize.600×600 mm.普通亮面@floor_tile';
Q.TILE_PIECE_PRICES[matteId] = 20;
Q.TILE_PIECE_PRICES[glossyId] = 10;
const matte = line(project([room('bedroom', ['floor'])], { tile: { material: '瓷砖', floorSize: '600×600 mm', finish: '质感哑面' } }), 'floor_tile');
const glossy = line(project([room('bedroom', ['floor'])], { tile: { material: '瓷砖', floorSize: '600×600 mm', finish: '普通亮面' } }), 'floor_tile');
assert.equal(matte.tile.price, 20);
assert.equal(glossy.tile.price, 10);
assert.equal(matte.tile.pieces, 30);
assert.equal(matte.tile.materialTotal, 600);
assert.equal(glossy.tile.materialTotal, 300, '表面改变后自动取不同片价');
assert.equal(matte.tile.splitPricing, true);
const missingFinish = line(project([room('bedroom', ['floor'])], { tile: { material: '瓷砖', floorSize: '600×600 mm', finish: '质感亮面' } }), 'floor_tile');
assert.ok(missingFinish.priceTbd.some(x => x.includes('砖材片价')), '缺该表面价时不套其他价格');
const sharedId = 'tile.size.600×600 mm.质感哑面';
Q.TILE_PIECE_PRICES[sharedId] = 29;
const sharedFloor = line(project([room('bedroom', ['floor'])], { tile: { material: '瓷砖', floorSize: '600×600 mm', finish: '质感哑面' } }), 'floor_tile');
assert.equal(sharedFloor.tile.price, 29, '统一规格价优先于旧地面区域价');
const sharedWall = line(project([room('bath', ['bath_tile'], 8, 5)], { tile: { wallSize: '600×600 mm', wallFinish: '质感哑面' } }), 'wall_tile');
assert.equal(sharedWall.tile.price, 29, '墙面也读取同一规格片价');
assert.equal(B.parseCsv(B.template(Q.PRICE, Q.SPEC_CATS, Q.OPTION_PRICES, Q.TILE_PIECE_PRICES)).filter(r => r[1] === sharedId).length, 1, '每个规格表面在价目表只出现一次');
const templateRows = B.parseCsv(B.template(Q.PRICE, Q.SPEC_CATS, Q.OPTION_PRICES, Q.TILE_PIECE_PRICES));
assert.equal(templateRows.filter(r => r[0] === '瓷砖片价' && r[1].includes('@')).length, 0, '新模板不按地面墙面重复瓷砖价格');
assert.equal(templateRows.find(r => r[1] === 'floor_tile')[4], '', '铺贴行不再录入砖材面积价');
assert.equal(B.read(B.template(Q.PRICE, Q.SPEC_CATS, Q.OPTION_PRICES, { [sharedId]: 29 }), Q.PRICE).tiles[sharedId], 29, '统一规格价可导出再导入');
const grouped = Products.groups([
  { sku: 'A', name: '灰砖（哑光）', category: 'B01-瓷砖', unit: '片', specs: '600*1200*10MM', price: 108 },
  { sku: 'B', name: '白砖（哑光）', category: 'B01-瓷砖', unit: '片', specs: '600*1200*10MM', price: 112 }
]);
assert.deepEqual(grouped['tile.size.600×1200 mm.哑光'].map(x => x.price), [108, 112], '同规格不同 SKU 保留供选择，不自动猜一个价格');
const html = readFileSync(new URL('../portal/quote-v2.html', import.meta.url), 'utf8');
const fn = html.match(/  function quoteDisplayLines\(lines\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(fn, '报价单应分开列瓷砖材料与铺贴');
const ctx = { nf: x => String(x) };
vm.runInNewContext(`${fn}; this.quoteDisplayLines = quoteDisplayLines`, ctx);
const shown = ctx.quoteDisplayLines([matte]);
assert.equal(shown.length, 2);
assert.equal(shown[0].unitName, '片');
assert.equal(shown[1].unitName, '平方尺');
assert.equal(shown[0].total + shown[1].total, matte.total, '分行不重复计价');
const oldShown = ctx.quoteDisplayLines([legacy]);
assert.equal(oldShown.length, 2, '缺片价时仍在报价单分列砖材待定和铺贴');
assert.equal(oldShown[0].total + oldShown[1].total, legacy.total);
const pendingShown = ctx.quoteDisplayLines([missingFinish]);
assert.equal(pendingShown.length, 2);
assert.equal(pendingShown[0].tilePending, true, '缺片价时仍单列待定价砖材');

const csv = '类型,编号,名称,单位,材料,辅料,人工,损耗%,说明\n瓷砖片价,' + floorId + ',地砖,片,20,,,,\n瓷砖片价,' + wallId + ',墙砖,片,0,,,,';
const parsed = B.read(csv, Q.PRICE);
assert.deepEqual(parsed.errors, []);
assert.equal(parsed.tiles[floorId], 20);
assert.equal(parsed.tiles[wallId], 0, '0片价和空白不同');
const applied = {};
B.apply(parsed, structuredClone(Q.PRICE), {}, applied);
assert.equal(applied[floorId], 20, 'CSV 导入后能恢复片价');
assert.equal(applied[wallId], 0);
assert.ok(!Object.hasOwn(parsed.tiles, largeId), '空白片价仍是未定');
const variantCsv = '类型,编号,名称,单位,材料,辅料,人工,损耗%,说明\n瓷砖片价,' + matteId + ',哑面,片,20,,,,\n瓷砖片价,' + glossyId + ',亮面,片,10,,,,';
const variantParsed = B.read(variantCsv, Q.PRICE);
assert.equal(variantParsed.tiles[matteId], 20);
assert.equal(variantParsed.tiles[glossyId], 10);

const oldOption = { 'tile.floorSize.800×800 mm': { floor_tile: { mat: 2, aux: 0, lab: 0 } } };
const oldCsv = B.template(Q.PRICE, Q.SPEC_CATS, oldOption, {});
const oldParsed = B.read(oldCsv, Q.PRICE);
assert.equal(oldParsed.options['tile.floorSize.800×800 mm'].floor_tile.mat, 2, '旧面积规格价差在导出导入中保留');

const bad = B.read('类型,编号,名称,单位,材料,辅料,人工,损耗%,说明\n瓷砖片价,tile.floorSize.600×600 mm@floor_tile,,片,-1,,,,', Q.PRICE);
assert.equal(bad.errors.length, 1, '负数片价拒绝导入');

delete Q.TILE_PIECE_PRICES[floorId]; delete Q.TILE_PIECE_PRICES[largeId]; delete Q.TILE_PIECE_PRICES[wallId]; delete Q.TILE_PIECE_PRICES[matteId]; delete Q.TILE_PIECE_PRICES[glossyId];
console.log('PASS: tile piece pricing checks');
