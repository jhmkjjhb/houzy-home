// 平面图识别：为什么重要——识别错了员工会照着报价；宁可留空让人核对，也不能乱猜。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const R = require('../portal/quote-v2-plan.js');
let n = 0; const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } n++; };
const L = (page, text, x = 0.5, y = 0.5) => ({ page, text, x, y });

const res = R.parse([
  L(1, 'GROUND FLOOR PLAN', 0.5, 0.95), L(1, 'LIVING', 0.3, 0.4), L(1, 'DRY KITCHEN', 0.6, 0.3), L(1, 'WET KITCHEN', 0.7, 0.3),
  L(1, 'Bath', 0.8, 0.5), L(1, '4', 0.82, 0.53), L(1, 'CAR PORCH 6000mm x 5400mm', 0.5, 0.1),
  L(2, 'FIRST FLOOR PLAN', 0.5, 0.95), L(2, 'MASTER BEDROOM 12ft x 14ft', 0.3, 0.4), L(2, 'BEDROOM 2', 0.6, 0.4), L(2, 'Bedroom', 0.7, 0.2), L(2, 'Bedroom', 0.2, 0.2),
  L(3, 'FRONT ELEVATION', 0.5, 0.9), L(3, 'BEDROOM 3', 0.5, 0.5)
]);
const by = name => res.rooms.find(r => r.name === name);
ok(by('干厨房') && by('干厨房').type === 'kitchen' && by('湿厨房'), '干湿厨房都识别成厨房，名字分开');
ok(by('Bath 4'), '下一行单独的数字拼回房间名');
const porch = res.rooms.find(r => r.type === 'porch');
ok(Math.abs(porch.L - 19.7) < 0.1 && Math.abs(porch.W - 17.7) < 0.1, '毫米换算成尺 ' + JSON.stringify(porch));
ok(res.rooms.find(r => r.type === 'master').L === 12, '主卧读到 12×14 尺');
ok(res.rooms.find(r => r.type === 'living').L === null, '没写尺寸的留空，不猜');
ok(res.rooms.find(r => r.type === 'master').level === 2 && res.rooms.find(r => r.type === 'living').level === 1, '按页标题判断楼层');
ok(res.rooms.filter(r => r.name.includes('图纸未编号·第')).length === 2, '重复的未编号卧室加序号');
ok(!res.rooms.some(r => r.page === 3) && res.ignoredPages.includes(3), '立面图那页不生成房间');
ok(R.dims('3.6 x 3.0 m').L === 11.8, '单位写在最后也能读');
ok(R.dims('Bedroom 3 x 4') === null, '没有单位不当尺寸');
ok(R.dims("MASTER 12'6\" x 10'").L === 12.5 && R.dims("12' x 14'").W === 14, '英尺英寸写法');
ok(R.dims('12t x 14ft').L === 12, '第一个单位识别坏了按第二个算');
ok(res.rooms.find(r => r.type === 'master').name === 'MASTER BEDROOM', '房间名不带尺寸 ' + res.rooms.find(r => r.type === 'master').name);
console.log(`PASS: ${n} plan recognition checks`);
