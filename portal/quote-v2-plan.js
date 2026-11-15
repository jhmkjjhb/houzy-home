// 平面图识别：沿用旧版 scripts/quote-plan-server.py 的识别逻辑（按文字标签找房间，只读同一行明确写出的「长×宽+单位」）。
// 输入：OCR 出来的文字行 [{ page, text, x, y }]（x、y 为 0–1 的相对位置）；输出：候选房间，必须员工核对后才加入报价。
// 不识别墙线、比例尺、门窗；没读到的尺寸留空，用该类房间默认尺寸并标记待复尺。
(function (root) {
  // 旧版类型 → 新版房间类型（干/湿厨房都是厨房，玄关并入走廊）
  const LABELS = [
    ['kitchen', /dry\s*kitchen|干厨/i, '干厨房'], ['kitchen', /wet\s*kitchen|湿厨/i, '湿厨房'],
    ['porch', /car\s*porch|carport|车廊|车库/i], ['yard', /back\s*yard|rear\s*yard|后院/i, '后院'], ['yard', /side\s*yard|garden|侧院|花园/i, '花园'],
    ['master', /master(?:\s*(?:bed\s*room|bedroom|bed))?|主卧/i], ['family', /family\s*(?:hall|area|room)|家庭厅|起居厅/i],
    ['dining', /dining(?:\s*(?:room|area))?|餐厅/i], ['living', /living(?:\s*(?:room|area))?|客厅/i],
    ['bedroom', /bed\s*room\s*\d*|bedroom\s*\d*|卧室\s*\d*|客房/i],
    ['bath', /bath(?:room)?\s*\d*|toilet\s*\d*|w\.?c\.?|卫生间|浴室|主卫|公卫/i],
    ['kitchen', /kitchen|厨房/i], ['laundry', /laundry|utility|洗衣区|洗衣房/i],
    ['balcony', /balcony|阳台/i], ['study', /study(?:\s*room)?|书房/i], ['store', /stor(?:e|age)(?:\s*room)?|储物间|储藏室/i],
    ['corridor', /foyer|entrance\s*hall|玄关/i, '玄关'], ['stairs', /stair(?:case|s)?|楼梯/i], ['corridor', /corridor|passage|走廊|过道/i]
  ];
  const UNIT = { mm: 1 / 304.8, '毫米': 1 / 304.8, cm: 1 / 30.48, m: 1 / 0.3048, '米': 1 / 0.3048, ft: 1, feet: 1, '尺': 1, '英尺': 1 };
  const FLOORS = [[1, /^(?:ground|g)\s+(?:floor|flr\.?)\s*(?:plan)?$/i], [2, /^(?:first|1st)\s+(?:floor|flr\.?)\s*(?:plan)?$/i], [3, /^(?:second|2nd)\s+(?:floor|flr\.?)\s*(?:plan)?$/i], [4, /^(?:third|3rd)\s+(?:floor|flr\.?)\s*(?:plan)?$/i]];
  const bounded = re => new RegExp('(?<![A-Za-z])(?:' + re.source + ')(?![A-Za-z])', 'i');

  function dims(text) {
    // 英尺英寸写法：12'6" x 10'、12' x 14'（本地图纸常见）
    const fi = text.match(/(\d+)\s*['’′]\s*(?:(\d+(?:\.\d+)?)\s*(?:"|”|″|''))?\s*[x×X]\s*(\d+)\s*['’′]\s*(?:(\d+(?:\.\d+)?)\s*(?:"|”|″|''))?/);
    if (fi) return { L: Math.round((+fi[1] + (+fi[2] || 0) / 12) * 10) / 10, W: Math.round((+fi[3] + (+fi[4] || 0) / 12) * 10) / 10 };
    // 例：3600mm x 3000mm、12ft × 10ft、3.6 x 3.0 m（单位写在最后也算）。
    // 第一个单位被识别坏了（如 12ft 读成 12t）时，按第二个单位算
    const m = text.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m|ft|feet|尺|英尺|米|毫米|[a-z]{1,3})?\s*[x×X]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|ft|feet|尺|英尺|米|毫米)(?![A-Za-z])/i);
    if (!m) {
      // 本地图纸常只写毫米数字不写单位：3600 x 3000（两个数都 ≥ 1000 才当毫米）
      const n = text.match(/(?<![\d.])(\d{4,5})\s*[x×X]\s*(\d{4,5})(?![\d.])/);
      return n ? { L: Math.round(n[1] / 304.8 * 10) / 10, W: Math.round(n[2] / 304.8 * 10) / 10 } : null;
    }
    const u2 = m[4].toLowerCase();
    let u1 = (m[2] || m[4]).toLowerCase();
    if (!(u1 in UNIT)) u1 = u2;
    if (!(u2 in UNIT)) return null;
    return { L: Math.round(parseFloat(m[1]) * UNIT[u1] * 10) / 10, W: Math.round(parseFloat(m[3]) * UNIT[u2] * 10) / 10 };
  }

  function parse(lines) {
    const ignored = new Set(), rooms = [], used = new Set();
    [...new Set(lines.map(x => x.page))].forEach(page => {
      const text = lines.filter(x => x.page === page).map(x => x.text).join('\n');
      const isPlan = /\b(?:ground|first|second|third|\d+(?:st|nd|rd|th))\s+floor\s+plan\b|平面图/i.test(text);
      if (!isPlan && /\b(?:section|elevation)\b|剖面图|立面图/i.test(text)) ignored.add(page);
    });
    lines.forEach(line => {
      if (ignored.has(line.page)) return;
      let text = String(line.text || '').trim();
      if (!text || text.length > 100) return;
      const pageLines = lines.filter(x => x.page === line.page);
      // 房间编号常被识别成下一行单独的数字（例如 "Bath" 下面一个 "4"），就近拼回去
      let label = text;
      if (!/\d/.test(label)) {
        const near = pageLines.filter(x => x !== line && /^[1-9]$/.test(String(x.text).trim()))
          .map(x => ({ d: Math.abs((x.y || 0) - (line.y || 0)) + Math.abs((x.x || 0) - (line.x || 0)), dy: Math.abs((x.y || 0) - (line.y || 0)), dx: Math.abs((x.x || 0) - (line.x || 0)), t: String(x.text).trim() }))
          .filter(x => x.dy <= 0.06 && x.dx <= 0.16).sort((a, b) => a.d - b.d);
        if (near.length) label += ' ' + near[0].t;
      }
      const hit = LABELS.find(([, re]) => bounded(re).test(label));
      if (!hit) return;
      const [type, , fixed] = hit;
      const titles = [];
      pageLines.forEach(x => { const t = String(x.text).trim(); FLOORS.forEach(([v, re]) => { if (re.test(t)) titles.push([v, t]); }); if (t === '底层平面图' || t === '首层平面图') titles.push([1, t]); });
      const levels = [...new Set(titles.map(x => x[0]))];
      let d = dims(text);
      // 尺寸常写在房间名正下方（或正上方）的另一行：找最近的、本身不是房间名的尺寸行
      if (!d) {
        const cand = pageLines.filter(x => x !== line && dims(String(x.text)) && !LABELS.some(([, re]) => bounded(re).test(String(x.text))))
          .map(x => ({ x, dy: Math.abs((x.y || 0) - (line.y || 0)), dx: Math.abs((x.x || 0) - (line.x || 0)) }))
          .filter(c => c.dy <= 0.07 && c.dx <= 0.12).sort((a, b) => (a.dy + a.dx) - (b.dy + b.dx))[0];
        if (cand && !used.has(cand.x)) { used.add(cand.x); d = dims(String(cand.x.text)); text = text + ' / ' + String(cand.x.text).trim(); }
      }
      // 名称里去掉尺寸部分（尺寸已单独读出）
      if (d) label = label.replace(/\s*\d+(?:\.\d+)?\s*\S{0,6}\s*[x×X]\s*\d.*$/, '').trim() || label;
      let name = fixed && !/\d/.test(label) ? fixed : label;
      if (type === 'master' && !/bed/i.test(name) && !/主卧/.test(name)) name = 'Master Bedroom';
      if (type === 'bath' && /^bath$/i.test(name)) name = 'Bathroom（图纸未编号）';
      if (type === 'bedroom' && /^bedroom$/i.test(name)) name = 'Bedroom（图纸未编号）';
      rooms.push({ type, name, L: d ? d.L : null, W: d ? d.W : null, level: levels.length === 1 ? levels[0] : null, levelEvidence: [...new Set(titles.map(x => x[1]))].join(' / '), page: line.page, evidence: text });
    });
    // 同一页重复的未编号标签加序号，核对时才分得清
    const seen = {};
    rooms.forEach(r => { if (!r.name.includes('图纸未编号')) return; const k = r.page + r.type; seen[k] = (seen[k] || 0) + 1; r.name = r.name.replace('（图纸未编号）', `（图纸未编号·第 ${seen[k]} 个）`); });
    return { rooms, ignoredPages: [...ignored].sort(), warnings: [...[...ignored].sort().map(p => `第 ${p} 页是立面/剖面图，不生成房间。`), '只识别文字标签和旁边写出的「长×宽」（同一行或紧挨着的上下一行），不识别墙线、比例尺、门窗。'] };
  }

  const api = { parse, dims, LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QV2_PLAN = api;
})(typeof window !== 'undefined' ? window : globalThis);
