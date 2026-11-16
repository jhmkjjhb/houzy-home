// 新版报价器「公司价目表」：下载模板 → 填价格 → 上传。
// 模板两类行：「项目单价」= 价目表里每个项目的售价；「选材价差」= 选了非标准选项后，每单位加/减多少（可填负数）。
// 空白 = 还没定（项目显示「单价待核定」，选材显示「价差待定」）；填 0 = 不加价。
// 上传的价格存在本机浏览器，并在加载计算规则之前合并进 QV2_PRICE / QV2_OPTION_PRICES。
(function (root) {
  const KEY = 'houzy-quote-v2-pricebook';
  const HEAD = ['类型', '编号', '名称', '单位', '材料', '辅料', '人工', '损耗%', '说明'];
  const ITEM = '项目单价', OPT = '选材价差';
  const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const blank = v => v === '' || v == null;

  // specCats 来自 QV2.SPEC_CATS；只为会影响价格的选项出行
  function template(price, specCats, optPrices) {
    const rows = [HEAD];
    Object.entries(price).forEach(([code, p]) => {
      const un = p.unpriced;
      rows.push([ITEM, code, p.name, p.unit, un ? '' : p.mat, un ? '' : p.aux, un ? '' : p.lab, un ? '' : p.waste, un ? '单价待公司核定' : '']);
    });
    Object.entries(specCats).forEach(([cat, c]) => Object.entries(c.keys).forEach(([k, key]) => {
      if (key.noPrice) return;
      const std = typeof key.std === 'function' ? null : key.std;
      key.opts.forEach(v => {
        if (v === std || (key.mod && key.mod[v])) return;
        key.codes.forEach(code => {
          if (!price[code]) return;
          const o = (optPrices[`${cat}.${k}.${v}`] || {})[code];
          rows.push([OPT, `${cat}.${k}.${v}@${code}`, `${c.label}·${key.label}：${v} → ${price[code].name}`, price[code].unit,
            o ? o.mat : '', o ? o.aux : '', o ? o.lab : '', '',
            std ? `比标准「${std}」每${price[code].unit}多/少多少` : '标准档按房间不同（干区/湿区），填比普通做法多/少多少']);
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

  // 读上传的表 → { items: {code:{mat,aux,lab,waste}}, options: {'cat.key.value': {code:{mat,aux,lab}}}, errors: [] }
  function read(text, price) {
    const rows = parseCsv(text), out = { items: {}, options: {}, errors: [] };
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
      if (type === OPT) {
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
  function apply(book, price, optPrices) {
    if (!book) return;
    Object.entries(book.items || {}).forEach(([code, v]) => {
      if (!price[code]) return;
      // 计价单位改过的项目（如成品保护 项 → 平方尺），旧价目表里按旧单位填的价不能套用，否则会按平方尺乘出天价
      if (v.unit ? v.unit !== price[code].unit : UNIT_CHANGED[code]) return;
      Object.assign(price[code], { mat: v.mat, aux: v.aux, lab: v.lab, waste: v.waste });
      if (v.mat + v.aux + v.lab > 0) delete price[code].unpriced;
    });
    Object.entries(book.options || {}).forEach(([k, byCode]) => { optPrices[k] = { ...(optPrices[k] || {}), ...byCode }; });
  }

  function load() { try { return JSON.parse(root.localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function save(book) { try { root.localStorage.setItem(KEY, JSON.stringify(book)); return true; } catch (e) { return false; } }
  function clear() { try { root.localStorage.removeItem(KEY); } catch (e) {} }

  const api = { template, parseCsv, read, apply, load, save, clear, KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QV2_BOOK = api;
  // 浏览器里：在计算规则加载之前把已上传的价目表合并进去
  if (root.QV2_PRICE && root.localStorage) {
    root.QV2_OPTION_PRICES = root.QV2_OPTION_PRICES || {};
    const b = load(); if (b) { apply(b, root.QV2_PRICE, root.QV2_OPTION_PRICES); root.QV2_BOOK_INFO = b.info || null; }
  }
})(typeof window !== 'undefined' ? window : globalThis);
