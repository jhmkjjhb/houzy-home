// 新版报价器「公司价目表」：下载模板 → 填价格 → 上传。
// 模板三类行：「项目单价」= 施工/旧面积单价；「选材价差」= 非标准选项的旧面积价差；「瓷砖片价」= 砖材 RM/片。
// 空白 = 还没定（项目显示「单价待核定」，选材显示「价差待定」）；填 0 = 不加价。
// 上传的价格存在本机浏览器，并在加载计算规则之前合并进 QV2_PRICE / QV2_OPTION_PRICES。
(function (root) {
  const KEY = 'houzy-quote-v2-pricebook';
  const HEAD = ['类型', '编号', '名称', '单位', '材料', '辅料', '人工', '损耗%', '说明'];
  const ITEM = '项目单价', OPT = '选材价差', TILE = '瓷砖片价';
  const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const blank = v => v === '' || v == null;

  // specCats 来自 QV2.SPEC_CATS；只为会影响价格的选项出行
  function template(price, specCats, optPrices, tilePrices = {}) {
    const rows = [HEAD];
    Object.entries(price).forEach(([code, p]) => {
      const un = p.unpriced;
      const tileLay = ['floor_tile', 'wall_tile', 'porch_tile'].includes(code);
      rows.push([ITEM, code, p.name, p.unit, un || tileLay ? '' : p.mat, un ? '' : p.aux, un ? '' : p.lab, un ? '' : p.waste, un ? '单价待公司核定' : tileLay ? '本行只填铺贴辅料及人工；砖材统一规格片价另填' : '']);
    });
    const sizes = [...new Set([...specCats.tile.keys.floorSize.opts, ...specCats.tile.keys.wallSize.opts])];
    const finishes = [...new Set([...specCats.tile.keys.finish.opts, ...specCats.tile.keys.wallFinish.opts])];
    sizes.forEach(size => finishes.forEach(finish => {
      const id = `tile.size.${size}.${finish}`, value = tilePrices[id];
      rows.push([TILE, id, `${size}·${finish}（地／墙／门廊通用）`, '片', value === undefined ? '' : value, '', '', '', '同规格表面只填一次 RM/片；铺贴另按面积计费']);
    }));
    Object.entries(specCats).forEach(([cat, c]) => Object.entries(c.keys).forEach(([k, key]) => {
      if (key.noPrice) return;
      const std = typeof key.std === 'function' ? null : key.std;
      key.opts.forEach(v => {
        if (v === std || (key.mod && key.mod[v])) return;
        key.codes.forEach(code => {
          if (!price[code]) return;
          const o = (optPrices[`${cat}.${k}.${v}`] || {})[code];
          // 旧面积价差要能在再次保存时保留；新规格只显示独立的 RM/片输入。
          rows.push([OPT, `${cat}.${k}.${v}@${code}`, `${c.label}·${key.label}：${v} → ${price[code].name}`, price[code].unit,
            o ? o.mat : '', o ? o.aux : '', o ? o.lab : '', '',
            cat === 'tile' && (k === 'floorSize' || k === 'wallSize') ? '只填铺贴辅料/人工比标准尺寸多多少；砖材按片价，材料栏不用' : std ? `比标准「${std}」每${price[code].unit}多/少多少` : '标准档按房间不同（干区/湿区），填比普通做法多/少多少']);
        });
      });
    }));
    return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
  }

  function parseCsv(text) {
    const rows = []; let row = [], f = '', q = false;
    text = String(text).replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim() !== ''));
  }

  // 读上传的表 → { items, options, tiles: {'tile.floorSize.600×600 mm@floor_tile': 片价}, errors }
  function read(text, price) {
    const rows = parseCsv(text), out = { items: {}, options: {}, tiles: {}, errors: [] };
    const h = (rows[0] || []).map(s => String(s).trim());
    const col = n => h.indexOf(n);
    if (col('编号') < 0 || col('材料') < 0) { out.errors.push('表头不对，请用「下载价格模板」下载的表来填'); return out; }
    rows.slice(1).forEach((r, i) => {
      const get = n => String(r[col(n)] ?? '').trim();
      const type = get('类型'), id = get('编号'), line = i + 2;
      const vals = {}; let bad = false, any = false;
      ['材料', '辅料', '人工', '损耗%'].forEach(n => {
        const s = get(n).replace(/^RM\s*/i, '').replace(/,/g, '');
        if (blank(s)) return;
        const v = Number(s);
        if (!Number.isFinite(v)) { out.errors.push(`第 ${line} 行「${n}」不是数字：${s}`); bad = true; return; }
        vals[n] = v; any = true;
      });
      if (bad || !any) return;
      if (type === TILE) {
        const shared = /^tile\.size\.(\d+)×(\d+) mm\.([^@]+)$/.test(id);
        const m = id.match(/^tile\.(floorSize|wallSize)\.(\d+)×(\d+) mm(?:\.([^@]+))?@(floor_tile|wall_tile|porch_tile)$/);
        if (!shared && (!m || !price[m[5]] || (m[1] === 'wallSize' ? m[5] !== 'wall_tile' : m[5] === 'wall_tile'))) { out.errors.push(`第 ${line} 行瓷砖编号看不懂：${id}`); return; }
        if (!Object.hasOwn(vals, '材料') || vals['材料'] < 0 || Object.hasOwn(vals, '辅料') || Object.hasOwn(vals, '人工')) { out.errors.push(`第 ${line} 行瓷砖片价只填非负的「材料」`); return; }
        out.tiles[id] = vals['材料'];
      } else if (type === OPT) {
        const m = id.match(/^(.+)@(.+)$/);
        if (!m || !price[m[2]]) { out.errors.push(`第 ${line} 行编号看不懂：${id}`); return; }
        (out.options[m[1]] = out.options[m[1]] || {})[m[2]] = { mat: vals['材料'] || 0, aux: vals['辅料'] || 0, lab: vals['人工'] || 0 };
      } else {
        if (!price[id]) { out.errors.push(`第 ${line} 行没有这个项目编号：${id}`); return; }
        if ((vals['材料'] || 0) < 0 || (vals['辅料'] || 0) < 0 || (vals['人工'] || 0) < 0) { out.errors.push(`第 ${line} 行项目单价不能是负数`); return; }
        out.items[id] = { mat: vals['材料'] || 0, aux: vals['辅料'] || 0, lab: vals['人工'] || 0, waste: vals['损耗%'] || 0, unit: price[id].unit };
      }
    });
    return out;
  }

  // 把价目表合并进价格对象（原地修改，计算规则持有同一个对象）
  const UNIT_CHANGED = { protect: true };
  const SPLIT_FROM = { wood_floor: 'laminate' };
  function apply(book, price, optPrices, tilePrices = {}) {
    if (!book) return;
    Object.entries(book.items || {}).forEach(([code, v]) => {
      if (!price[code]) return;
      // 计价单位改过的项目（如成品保护 项 → 平方尺），旧价目表里按旧单位填的价不能套用，否则会按平方尺乘出天价
      if (v.unit ? v.unit !== price[code].unit : UNIT_CHANGED[code]) return;
      Object.assign(price[code], { mat: v.mat, aux: v.aux, lab: v.lab, waste: v.waste });
      price[code].companyPrice = true;
      delete price[code].ref; // 公司填过价就不再是参考价
      if (v.mat + v.aux + v.lab > 0) delete price[code].unpriced;
    });
    // 后来拆出来的项目：旧价目表里还没有它时，先沿用原来共用的那个价
    Object.entries(SPLIT_FROM).forEach(([code, from]) => {
      const v = (book.items || {})[from];
      if (price[code] && v && !(book.items || {})[code] && v.unit === price[code].unit) Object.assign(price[code], { mat: v.mat, aux: v.aux, lab: v.lab, waste: v.waste });
    });
    Object.entries(book.options || {}).forEach(([k, byCode]) => {
      // 旧的「地板档次」价差登记在 laminate 上，现在归强化复合木地板
      if (/^tile\.woodGrade\./.test(k) && byCode.laminate && !byCode.wood_floor) byCode = { ...byCode, wood_floor: byCode.laminate };
      optPrices[k] = { ...(optPrices[k] || {}), ...byCode };
    });
    Object.assign(tilePrices, book.tiles || {});
  }

  function load() { try { return JSON.parse(root.localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function save(book) { try { root.localStorage.setItem(KEY, JSON.stringify(book)); return true; } catch (e) { return false; } }
  function clear() { try { root.localStorage.removeItem(KEY); } catch (e) {} }

  const api = { template, parseCsv, read, apply, load, save, clear, KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QV2_BOOK = api;
  // 浏览器里：在计算规则加载之前把已上传的价目表合并进去
  if (root.QV2_PRICE && root.localStorage) {
    root.QV2_OPTION_PRICES = root.QV2_OPTION_PRICES || {};
    root.QV2_TILE_PIECE_PRICES = root.QV2_TILE_PIECE_PRICES || {};
    // 市场调查建议价只是参考价（已在 quote-v2-market 里铺好）；公司已保存过的价格照常覆盖它，不会被建议价替换（老板 11-16 决定）
    const b = load();
    if (b) { apply(b, root.QV2_PRICE, root.QV2_OPTION_PRICES, root.QV2_TILE_PIECE_PRICES); root.QV2_BOOK_INFO = b.info || null; }
  }
})(typeof window !== 'undefined' ? window : globalThis);
