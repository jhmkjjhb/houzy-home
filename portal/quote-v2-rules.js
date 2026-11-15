// 新版报价器的计算规则（不含界面）。
// 两层：
//   第一层「范围」：做哪些空间、哪些项目、尺寸/数量多少（ROOMS / PACKS / HOUSE_ITEMS）。
//   第二层「做法与选材」：用什么材料、工艺、配件（SPEC_CATS），按类别全屋统一，可逐间单独改。
// 选材没定的按「标准档」估价并标记暂定；正式报价要求全部定好。
// 同样的输入永远得到同样的清单和金额。单价只来自价目表（quote-v2-price.js），这里不写价格。
(function (root) {
  const src = typeof require !== 'undefined' && !root.QV2_PRICE ? require('./quote-v2-price.js') : null;
  const P = root.QV2_PRICE || src.PRICE;
  const STAGES = root.QV2_STAGES || src.STAGES;
  const OPTION_PRICES = root.QV2_OPTION_PRICES || (src && src.OPTION_PRICES) || {};
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const r2 = n => Math.round(n * 100) / 100;
  const ceil = Math.ceil;

  // ---------- 房屋类型与预设房间 ----------
  const HOUSES = {
    condo:     { label: '共管公寓', en: 'Condominium', landed: false, levels: 1 },
    apartment: { label: '普通公寓', en: 'Apartment / Flat', landed: false, levels: 1 },
    terrace:   { label: '排屋', en: 'Terrace / Link', landed: true, levels: 2 },
    semi:      { label: '半独立式', en: 'Semi-D', landed: true, levels: 2 },
    bungalow:  { label: '独立式', en: 'Bungalow', landed: true, levels: 2 },
    townhouse: { label: '联排分层', en: 'Townhouse', landed: false, levels: 1 }
  };

  // ---------- 户型模板：选户型 → 自动排房间，卧室/卫生间/楼层数可加减 ----------
  // 默认尺寸（尺）按新山常见户型估，都高于 UBBL 第 42 条最低要求（第一间房 ≥ 11㎡≈118 平方尺，第二间 ≥ 9.3㎡≈100，其余 ≥ 6.5㎡≈70，厨房 ≥ 4.5㎡且宽 ≥ 1.5 米）。
  // 双层排屋常见 20–22 × 70 尺、4 房 3 卫。都是估算，现场要复尺。
  const SIZES = {
    apt:      { living: [16, 12], dining: [10, 10], kitchen: [10, 7], master: [13, 11], beds: [[11, 10], [10, 9], [10, 9], [10, 9]], mbath: [8, 5], bath: [7, 5], laundry: [7, 5], balcony: [10, 4], family: [12, 10], stairs: [10, 4] },
    terrace:  { porch: [20, 18], living: [18, 14], dining: [14, 12], kitchen: [12, 10], wet: [12, 8], master: [16, 13], beds: [[12, 11], [11, 10], [11, 10], [10, 10]], mbath: [8, 6], bath: [7, 5], yard: [20, 8], family: [14, 12], stairs: [12, 4] },
    semi:     { porch: [24, 20], living: [22, 16], dining: [16, 12], kitchen: [14, 10], wet: [12, 10], master: [18, 15], beds: [[14, 12], [13, 11], [12, 11], [12, 11]], mbath: [9, 6], bath: [8, 5], yard: [30, 10], family: [16, 14], stairs: [13, 4] },
    bungalow: { porch: [30, 20], living: [26, 18], dining: [18, 14], kitchen: [16, 12], wet: [14, 10], master: [20, 16], beds: [[15, 13], [14, 12], [14, 12], [13, 12]], mbath: [10, 7], bath: [8, 6], yard: [40, 15], family: [18, 16], stairs: [14, 5] }
  };
  const sizeClass = h => ({ terrace: 'terrace', semi: 'semi', bungalow: 'bungalow' }[h] || 'apt');
  const LAYOUTS = {
    strata: [
      { id: 'studio', label: 'Studio 开放式', beds: 0, baths: 1, levels: 1 },
      { id: '1b1b', label: '1 房 1 卫', beds: 1, baths: 1, levels: 1 },
      { id: '2b2b', label: '2 房 2 卫', beds: 2, baths: 2, levels: 1 },
      { id: '3b2b', label: '3 房 2 卫', beds: 3, baths: 2, levels: 1 },
      { id: '4b3b', label: '4 房 3 卫', beds: 4, baths: 3, levels: 1 },
      { id: 'duplex', label: '复式 Duplex 3 房 3 卫', beds: 3, baths: 3, levels: 2 }
    ],
    landed: [
      { id: 'single', label: '单层 3 房 2 卫', beds: 3, baths: 2, levels: 1 },
      { id: 'double', label: '双层 4 房 3 卫', beds: 4, baths: 3, levels: 2 },
      { id: 'double5', label: '双层 5 房 4 卫', beds: 5, baths: 4, levels: 2 },
      { id: 'triple', label: '三层 5 房 4 卫', beds: 5, baths: 4, levels: 3 }
    ]
  };
  const layoutsFor = h => (HOUSES[h] && HOUSES[h].landed ? LAYOUTS.landed : LAYOUTS.strata);
  const DEFAULT_LAYOUT = { condo: '3b2b', apartment: '3b2b', townhouse: '3b2b', terrace: 'double', semi: 'double5', bungalow: 'double5' };
  // 按户型生成房间：公共区在底层；多层时主人房和大部分卧室在楼上，楼下留 1 间客房 + 1 间卫生间
  function layoutRooms(h, spec) {
    const S = SIZES[sizeClass(h)], landed = !!(HOUSES[h] && HOUSES[h].landed);
    const beds = Math.max(0, Math.round(num(spec.beds))), baths = Math.max(0, Math.round(num(spec.baths))), levels = Math.min(4, Math.max(1, Math.round(num(spec.levels) || 1)));
    const out = [], count = {};
    const add = (type, lv, name, size) => { count[type] = (count[type] || 0) + 1; const r = newRoom(type, lv, 1); r.name = name; if (size) { r.L = size[0]; r.W = size[1]; } out.push(r); return r; };
    if (landed && h !== 'townhouse') add('porch', 1, '车廊', S.porch);
    add('living', 1, beds === 0 ? '开放起居/睡眠区' : '客厅', S.living);
    if (beds > 0) add('dining', 1, '餐厅', S.dining);
    if (landed) { add('kitchen', 1, '干厨房', S.kitchen); add('kitchen', 1, '湿厨房', S.wet); }
    else add('kitchen', 1, beds === 0 ? '开放式厨房' : '厨房', S.kitchen);
    if (landed) add('yard', 1, '后院', S.yard); else add('laundry', 1, '洗衣区', S.laundry);
    if (!landed && beds > 0) add('balcony', 1, '阳台', S.balcony);
    // 卧室：多层时楼下 1 间客房（3 房以上），其余从 2 楼往上排，每层最多 3 间
    const bedLv = [];
    for (let i = 0; i < beds; i++) bedLv.push(levels === 1 ? 1 : (i === beds - 1 && beds >= 3 ? 1 : Math.min(levels, 2 + Math.floor(i / 3))));
    for (let i = 0; i < beds; i++) {
      if (i === 0) add('master', bedLv[0], '主人房', S.master);
      else add('bedroom', bedLv[i], bedLv[i] === 1 && levels > 1 ? '客房' : `卧室 ${i + 1}`, S.beds[Math.min(i - 1, S.beds.length - 1)]);
    }
    // 卫生间：第 1 间是主卧卫生间，放在主人房那层；其余的楼下 1 间、其他放楼上
    for (let i = 0; i < baths; i++) {
      if (i === 0 && beds > 0 && baths > 1) add('bath', bedLv[0], '主卧卫生间', S.mbath);
      else { const lv = levels === 1 ? 1 : (out.some(r => r.type === 'bath' && (r.level || 1) === 1) ? Math.min(levels, 2) : 1); add('bath', lv, `卫生间 ${(count.bath || 0) + 1 - (beds > 0 && baths > 1 ? 1 : 0)}`, S.bath); }
    }
    for (let lv = 2; lv <= levels; lv++) add('family', lv, levels > 2 ? `${lv}楼家庭厅` : '家庭厅', S.family);
    if (levels > 1) add('stairs', 1, '楼梯', S.stairs);
    const one = out.filter(r => r.type === 'bath' && /卫生间 \d/.test(r.name));
    if (one.length === 1) one[0].name = '公共卫生间';
    return out.map((r, i) => [r, i]).sort((a, b) => (a[0].level || 1) - (b[0].level || 1) || a[1] - b[1]).map(x => x[0]);
  }

  // ---------- 空间类型：默认尺寸、门数、可选项目 ----------
  const DRY = ['demo_floor', 'demo_skin', 'demo_ceiling', 'floor', 'wall_finish', 'ceiling', 'ceil_paint', 'cornice', 'electric', 'aircon', 'fan', 'curtain', 'sill', 'fly_screen', 'door', 'window_new'];
  const ROOMS = {
    living:  { label: '客厅', icon: '🛋️', L: 20, W: 14, doors: 0, packs: [...DRY, 'tv_cab', 'shoe_cab'] },
    dining:  { label: '餐厅', icon: '🍽️', L: 12, W: 10, doors: 0, packs: [...DRY, 'sideboard'] },
    master:  { label: '主人房', icon: '🛏️', L: 14, W: 12, doors: 1, packs: [...DRY, 'wardrobe', 'headboard'] },
    bedroom: { label: '卧室', icon: '🛏️', L: 11, W: 10, doors: 1, packs: [...DRY, 'wardrobe', 'desk'] },
    study:   { label: '书房', icon: '📚', L: 10, W: 9, doors: 1, packs: [...DRY, 'bookcase', 'desk'] },
    kitchen: { label: '厨房', icon: '🍳', L: 10, W: 8, doors: 0, wet: true, packs: ['demo_floor', 'demo_wall_tile', 'demo_ceiling', 'kitchen_tile', 'cabinets', 'cab_basket', 'kitchen_water', 'pipe_box', 'electric', 'wall_finish', 'ceiling', 'ceil_paint', 'aircon', 'sill', 'fly_screen', 'door', 'window_new'] },
    bath:    { label: '卫生间', icon: '🚿', L: 8, W: 5, doors: 1, wet: true, packs: ['bath_demo', 'demo_ceiling', 'bath_tile', 'sanitary', 'vanity', 'heater', 'bath_water', 'bath_move', 'bath_ceil', 'electric', 'door', 'window_new'] },
    laundry: { label: '洗衣区', icon: '🧺', L: 8, W: 5, doors: 0, wet: true, packs: ['demo_floor', 'wet_tile', 'laundry_water', 'pipe_box', 'laundry_cab', 'rack', 'electric', 'wall_finish', 'window_new'] },
    balcony: { label: '阳台', icon: '🌿', L: 10, W: 4, doors: 0, wet: true, packs: ['demo_floor', 'wet_tile', 'rack', 'electric', 'balc_seal'] },
    family:  { label: '家庭厅', icon: '🛋️', L: 14, W: 12, doors: 0, packs: [...DRY] },
    store:   { label: '储物间', icon: '📦', L: 6, W: 5, doors: 1, packs: ['demo_floor', 'floor', 'wall_finish', 'ceil_paint', 'electric', 'bookcase', 'door'] },
    corridor:{ label: '走廊/玄关', icon: '🚶', L: 12, W: 4, doors: 0, packs: ['demo_floor', 'floor', 'wall_finish', 'ceiling', 'ceil_paint', 'cornice', 'electric', 'shoe_cab'] },
    stairs:  { label: '楼梯', icon: '🪜', L: 12, W: 4, doors: 0, packs: ['stair_tile', 'stair_rail', 'stair_light', 'wall_finish', 'scaffold'] },
    yard:    { label: '后院/花园', icon: '🌳', L: 20, W: 8, doors: 0, outdoor: true, packs: ['porch_tile', 'drain_ch', 'awning', 'garden_light'] },
    porch:   { label: '车廊/前院', icon: '🚗', L: 20, W: 18, doors: 0, outdoor: true, packs: ['porch_tile', 'drain_ch', 'awning', 'garden_light'] }
  };
  Object.values(ROOMS).forEach(t => { if (!t.outdoor) t.packs.push('custom_item'); });

  // ---------- 第二层：做法与选材 ----------
  // std = 标准档（未选时按它估价）；codes = 影响哪些项目；packs = 只对哪些范围项目生效；
  // noPrice = 只影响做法说明或项目组成，不另外加价；mod = 已知的计价变化（如客户自备砖不收主材）。
  // 其他非标准选项的价差在 quote-v2-price.js 的 OPTION_PRICES 里登记，没登记的显示「价差待定」。
  const TILE_CODES = ['floor_tile', 'wall_tile', 'porch_tile'];
  const CAB_CODES = ['wardrobe', 'tv_cab', 'shoe_cab', 'sideboard', 'bookcase', 'laundry_cab', 'headboard', 'cab_low', 'cab_up'];
  const SPEC_CATS = {
    tile: { label: '地面与瓷砖', icon: '🟫', keys: {
      material:  { label: '干区地面材料', opts: ['瓷砖', 'SPC 石塑地板', '强化复合木地板'], std: '瓷砖', codes: ['floor_tile', 'laminate'], packs: ['floor'], noPrice: true },
      floorSize: { label: '地砖尺寸', opts: ['600×600 mm', '300×600 mm', '600×1200 mm', '800×800 mm', '750×1500 mm', '900×1800 mm', '1200×1200 mm'], std: '600×600 mm', codes: ['floor_tile', 'porch_tile'] },
      wallSize:  { label: '墙砖尺寸', opts: ['300×600 mm', '600×600 mm', '600×1200 mm', '750×1500 mm'], std: '300×600 mm', codes: ['wall_tile'] },
      finish:    { label: '地砖表面', opts: ['哑光', '柔光', '亮光', '防滑'], std: room => (room && (ROOMS[room.type].wet || ROOMS[room.type].outdoor) ? '防滑' : '哑光'), codes: ['floor_tile', 'porch_tile'], noPrice: true },
      wallFinish:{ label: '墙砖表面', opts: ['哑光', '柔光', '亮光'], std: '亮光', codes: ['wall_tile'], noPrice: true },
      supply:    { label: '瓷砖供应', opts: ['包工包料', '客户自备砖'], std: '包工包料', codes: TILE_CODES, mod: { '客户自备砖': { matZero: true } } },
      woodGrade: { label: '地板档次', opts: ['标准 5 mm', '加厚 8 mm', '多层实木复合'], std: '标准 5 mm', codes: ['laminate'] }
    } },
    wall: { label: '墙面', icon: '🖌️', keys: {
      method: { label: '墙面做法', opts: ['乳胶漆', '墙纸', '艺术漆'], std: '乳胶漆', codes: ['paint_wall', 'wallpaper', 'art_paint'], packs: ['wall_finish'], noPrice: true },
      brand:  { label: '油漆品牌', opts: ['Nippon Paint', 'Dulux', 'Jotun'], std: 'Nippon Paint', codes: ['paint_wall'] },
      base:   { label: '基层处理', opts: ['旧墙局部修补', '新墙满批', '铲除旧漆重做'], std: '旧墙局部修补', codes: ['skim'] }
    } },
    ceiling: { label: '天花', icon: '⬜', keys: {
      style: { label: '吊顶造型', opts: ['平顶', '叠级+灯槽'], std: '平顶', codes: ['plaster_ceiling'], packs: ['ceiling'], noPrice: true },
      board: { label: '天花板材', opts: ['普通石膏板', '防潮石膏板', '硅酸钙板'], std: room => (room && ROOMS[room.type].wet ? '防潮石膏板' : '普通石膏板'), codes: ['plaster_ceiling'] }
    } },
    cabinet: { label: '定制柜', icon: '🗄️', keys: {
      body:     { label: '柜体板材', opts: ['多层实木板', '防潮颗粒板', '铝合金'], std: '多层实木板', codes: CAB_CODES },
      door:     { label: '门板饰面', opts: ['双饰面', 'PET', '烤漆', '木皮'], std: '双饰面', codes: CAB_CODES },
      hardware: { label: '五金', opts: ['阻尼铰链+缓冲滑轨', 'Blum', 'Hettich'], std: '阻尼铰链+缓冲滑轨', codes: CAB_CODES },
      light:    { label: '柜内灯', opts: ['不做', '感应灯带'], std: '不做', codes: CAB_CODES },
      counter:  { label: '厨房台面', opts: ['石英石', '岩板', '花岗岩'], std: '石英石', codes: ['counter'] }
    } },
    lighting: { label: '灯具', icon: '💡', keys: {
      grade: { label: '灯具档次', opts: ['标准 LED 筒灯/吸顶灯', '防眩筒灯+射灯'], std: '标准 LED 筒灯/吸顶灯', codes: ['light'] },
      temp:  { label: '色温', opts: ['3000K 暖光', '4000K 自然光', '6000K 白光'], std: '4000K 自然光', codes: ['light', 'led_strip'], noPrice: true }
    } }
  };
  const stdOf = (key, room) => (typeof key.std === 'function' ? key.std(room) : key.std);

  // ---------- 第一层：范围项目（一个卡片 = 一组一定一起做的项目） ----------
  // area：按面积算的项目，默认 = 房间面积，可改成实际施工面积；inputs：其他要确认的数字，都有默认值。
  // lines(room, geo, values, picked, sp)：sp(类别, 选项) 取当前选材，用于「材料不同、项目也不同」的情况。
  const GROUPS = [['demo', '拆旧'], ['floor', '地面'], ['wall', '墙面'], ['ceil', '天花'], ['mep', '水电'], ['wet', '防水与瓷砖'], ['fix', '洁具设备'], ['cab', '定制柜'], ['open', '门窗窗帘'], ['out', '户外']];
  const BIG_TILE = ['750×1500 mm', '900×1800 mm', '1200×1200 mm'];
  const cabSqft = (label, icon, code, w, h) => ({ g: 'cab', label, icon,
    inputs: [{ k: 'w', label: '宽', unit: '尺', def: w }, { k: 'h', label: '高', unit: '尺', def: h }],
    lines: (r, g, v, picked, sp) => [[code, r2(v.w * v.h), `宽 ${v.w} × 高 ${v.h}`], ...(sp('cabinet', 'light') === '感应灯带' ? [['led_strip', v.w, '柜内灯带 = 柜宽']] : [])] });
  const tileExtra = (sp, area) => (BIG_TILE.includes(sp('tile', 'floorSize')) ? [['big_tile_extra', area, '大板砖铺贴加价']] : []);
  const PACKS = {
    demo_floor:     { g: 'demo', area: ['floor'], label: '拆旧地砖', icon: '⛏️', lines: (r, g) => [['demo_floor', g.floor, '拆除面积']] },
    demo_skin:      { g: 'demo', area: ['wall'], label: '铲旧墙皮', icon: '🧽', lines: (r, g) => [['demo_skin', g.wall, '墙面面积']] },
    demo_wall_tile: { g: 'demo', area: ['wall'], label: '拆旧墙砖', icon: '⛏️', lines: (r, g) => [['demo_wall_tile', g.wall, '墙砖面积']] },
    demo_ceiling:   { g: 'demo', area: ['floor'], label: '拆旧天花', icon: '⛏️', lines: (r, g) => [['demo_ceiling', g.floor, '旧天花面积']] },
    bath_demo:      { g: 'demo', area: ['floor', 'wall'], label: '拆旧（地砖+墙砖+洁具）', icon: '⛏️', lines: (r, g) => [['demo_floor', g.floor, '地面'], ['demo_wall_tile', g.wall, '墙面'], ['demo_piece', 3, '旧马桶/面盆/花洒']] },

    floor:          { g: 'floor', area: ['floor'], label: '地面翻新', icon: '🟫', hint: '材料在「④ 选材」定',
                      lines: (r, g, v, picked, sp) => sp('tile', 'material') === '瓷砖'
                        ? [['screed', g.floor, '地面找平'], ['floor_tile', g.floor, '地面'], ['grout', g.floor, '= 地砖面积'], ['skirting', g.skirt, '周长 − 门宽'], ...tileExtra(sp, g.floor)]
                        : [['laminate', g.floor, '地面'], ['skirting', g.skirt, '周长 − 门宽']] },
    wall_finish:    { g: 'wall', area: ['wall'], label: '墙面翻新', icon: '🖌️', hint: '做法在「④ 选材」定',
                      lines: (r, g, v, picked, sp) => {
                        // 厨房贴了操作区墙砖的部分不再批灰刷漆
                        const tiled = picked.kitchen_tile ? r2(packValues(r, 'kitchen_tile', g).back * 2.5) : 0, a = r2(Math.max(0, g.wall - tiled)), f = tiled ? `墙面 − 操作区墙砖 ${tiled}` : '墙面';
                        return [['skim', a, f], [{ '乳胶漆': 'paint_wall', '墙纸': 'wallpaper', '艺术漆': 'art_paint' }[sp('wall', 'method')], a, f]];
                      } },
    ceiling:        { g: 'ceil', area: ['floor'], label: '天花吊顶', icon: '⬜', hint: '造型在「④ 选材」定',
                      lines: (r, g, v, picked, sp) => [['plaster_ceiling', g.floor, '= 吊顶面积'], ['paint_ceiling', g.floor, '= 吊顶面积'], ...(sp('ceiling', 'style') === '叠级+灯槽' ? [['ceiling_step', g.perim, '= 周长'], ['led_strip', g.perim, '= 周长']] : [])] },
    ceil_paint:     { g: 'ceil', area: ['floor'], label: '天花重刷（不吊顶）', icon: '🖌️', lines: (r, g) => [['paint_ceiling', g.floor, '天花面积']] },
    cornice:        { g: 'ceil', label: '石膏线', icon: '〰️', lines: (r, g) => [['cornice', g.perim, '= 周长']] },
    bath_ceil:      { g: 'ceil', area: ['floor'], label: '防潮天花', icon: '⬜', lines: (r, g) => [['plaster_ceiling', g.floor, '= 地面面积'], ['paint_ceiling', g.floor, '= 地面面积']] },

    electric:       { g: 'mep', label: '插座开关+灯位', icon: '💡',
                      inputs: [{ k: 'pts', label: '插座/开关', unit: '个', def: (r, g) => ceil(g.floor / 30) + 2 }, { k: 'lights', label: '灯位', unit: '个', def: (r, g) => ceil(g.floor / 50) + 1 }],
                      lines: (r, g, v) => [['wire', v.pts, '插座/开关点位'], ['panel', v.pts, '= 点位数'], ['light', v.lights, '灯位']] },
    aircon:         { g: 'mep', label: '空调预埋', icon: '❄️', inputs: [{ k: 'n', label: '空调', unit: '台', def: () => 1 }],
                      lines: (r, g, v) => [['aircon_pipe', v.n, '空调台数'], ['circuit', v.n, '每台一条专用回路']] },
    fan:            { g: 'mep', label: '吊扇', icon: '🌀', inputs: [{ k: 'n', label: '吊扇', unit: '台', def: () => 1 }], lines: (r, g, v) => [['fan_point', v.n, '吊扇台数'], ['ceiling_fan', v.n, '吊扇台数']] },
    kitchen_water:  { g: 'mep', label: '水路改造', icon: '🚰', inputs: [{ k: 'n', label: '水点位', unit: '个', def: () => 2 }], lines: (r, g, v) => [['water_pt', v.n, '水点位']] },
    bath_water:     { g: 'mep', label: '水路改造', icon: '🚰', inputs: [{ k: 'n', label: '水点位', unit: '个', def: () => 5 }], lines: (r, g, v) => [['water_pt', v.n, '水点位'], ['pipe_box', 1, '下水立管包封']] },
    laundry_water:  { g: 'mep', label: '洗衣机水位', icon: '🚰', inputs: [{ k: 'n', label: '水点位', unit: '个', def: () => 2 }], lines: (r, g, v) => [['water_pt', v.n, '水点位']] },
    pipe_box:       { g: 'mep', label: '下水管包封', icon: '🧱', inputs: [{ k: 'n', label: '立管', unit: '处', def: () => 1 }], lines: (r, g, v) => [['pipe_box', v.n, '立管处数']] },
    heater:         { g: 'fix', label: '热水器', icon: '♨️', lines: () => [['heater', 1, '每个卫生间 1 台'], ['circuit', 1, '热水器专用回路']] },

    kitchen_tile:   { g: 'wet', area: ['floor'], label: '地砖+操作区墙砖+防水', icon: '🧱', inputs: [{ k: 'back', label: '操作区墙砖长度', unit: '尺', def: (r, g) => r2(g.L + g.W - 3) }],
                      lines: (r, g, v, picked, sp) => [['wp', g.floor, '厨房地面'], ['flood_test', 1, '做防水就要闭水'], ['screed', g.floor, '地面找平'], ['floor_tile', g.floor, '地面'], ['wall_tile', r2(v.back * 2.5), `操作区 ${v.back}×2.5 尺高`], ['grout', r2(g.floor + v.back * 2.5), '地砖+墙砖'], ['drain', 1, '厨房地漏'], ...tileExtra(sp, g.floor)] },
    bath_tile:      { g: 'wet', area: ['floor', 'wall'], label: '防水+地砖+满墙砖', icon: '🧱',
                      lines: (r, g, v, picked, sp) => [['wp', r2(g.floor + g.perim + 36), '地面 + 周长×上翻1尺 + 淋浴区墙 6×6'], ['flood_test', 1, '做防水就要闭水'], ['slope', g.floor, '往地漏找坡'], ['floor_tile', g.floor, '地面'], ['wall_tile', g.wall, '满墙'], ['grout', r2(g.floor + g.wall), '地砖+墙砖'], ['drain', 2, '淋浴区 + 干区'], ['threshold', g.doors, '每个门口一条挡水'], ...tileExtra(sp, g.floor)] },
    wet_tile:       { g: 'wet', area: ['floor'], label: '防水+地砖', icon: '🧱',
                      lines: (r, g, v, picked, sp) => [['wp', g.floor, '地面'], ['flood_test', 1, '做防水就要闭水'], ['slope', g.floor, '往地漏找坡'], ['floor_tile', g.floor, '地面'], ['grout', g.floor, '= 地砖面积'], ['drain', 1, '地漏'], ...tileExtra(sp, g.floor)] },
    bath_move:      { g: 'wet', area: ['floor'], label: '改马桶/排水位置', icon: '↔️', lines: (r, g) => [['bath_drop', g.floor, '改位置要降板+二次排水']] },

    sanitary:       { g: 'fix', label: '洁具（马桶+花洒+淋浴隔断）', icon: '🚽', lines: () => [['toilet', 1, ''], ['shower', 1, ''], ['screen', 1, ''], ['exhaust', 1, '卫生间必配'], ['bath_acc', 1, '毛巾架/纸巾架/挂钩']] },
    vanity:         { g: 'fix', label: '浴室柜+镜子', icon: '🪞', lines: () => [['vanity', 1, ''], ['mirror', 1, '']] },
    rack:           { g: 'fix', label: '晾衣架', icon: '👕', lines: () => [['rack', 1, '']] },

    cabinets:       { g: 'cab', label: '橱柜（地柜+吊柜+台面）', icon: '🗄️',
                      inputs: [{ k: 'low', label: '地柜长度', unit: '尺', def: (r, g) => r2(g.L + g.W - 3) }, { k: 'up', label: '吊柜长度', unit: '尺', def: (r, g) => r2(g.L) }],
                      lines: (r, g, v, picked, sp) => [['cab_low', v.low, '地柜长度'], ['counter', v.low, '= 地柜长度'], ['cab_up', v.up, '吊柜长度'], ['sink', 1, '厨房必配'], ['hood', 1, '烟机灶具安装'], ...(sp('cabinet', 'light') === '感应灯带' ? [['led_strip', v.up, '吊柜底灯带 = 吊柜长度']] : [])] },
    cab_basket:     { g: 'cab', label: '橱柜拉篮', icon: '🧺', inputs: [{ k: 'n', label: '拉篮', unit: '套', def: () => 2 }], lines: (r, g, v) => [['cab_basket', v.n, '拉篮套数']] },
    wardrobe:       cabSqft('衣柜', '🚪', 'wardrobe', (r, g) => r2(Math.min(g.L, g.W) - 2), () => 8),
    tv_cab:         cabSqft('电视柜/背景墙', '📺', 'tv_cab', () => 8, () => 3),
    shoe_cab:       cabSqft('鞋柜', '👟', 'shoe_cab', () => 4, () => 4),
    sideboard:      cabSqft('餐边柜', '🍶', 'sideboard', () => 6, () => 3),
    headboard:      cabSqft('床头背景', '🖼️', 'headboard', () => 8, () => 4),
    bookcase:       cabSqft('书柜/储物柜', '📚', 'bookcase', () => 6, () => 7),
    laundry_cab:    cabSqft('洗衣柜', '🗄️', 'laundry_cab', () => 4, () => 3),
    desk:           { g: 'cab', label: '书桌', icon: '🖥️', inputs: [{ k: 'n', label: '数量', unit: '项', def: () => 1 }], lines: (r, g, v) => [['desk', v.n, '按项']] },
    custom_item:    { g: 'cab', label: '其他定制小件（按项）', icon: '🪑', items: true, lines: r => (r.items || []).map(it => ['custom_item', num(it.qty), '按项', it]) },

    door:           { g: 'open', label: '换门', icon: '🚪', needDoors: true, lines: (r, g) => [['door', g.doors, '= 房间门数'], ['demo_piece', g.doors, '拆旧门 = 门数']] },
    window_new:     { g: 'open', label: '换窗', icon: '🪟', needWindows: true, lines: (r, g) => [['window_new', g.winA, '各樘窗 宽×高 合计'], ['demo_piece', g.wins.length, '拆旧窗 = 窗数']] },
    curtain:        { g: 'open', label: '窗帘', icon: '🎐', needWindows: true, lines: (r, g, v, picked) => [['curtain', g.winW, '各樘窗宽合计'], ...(picked.ceiling ? [['curtain_box', g.winW, '有吊顶 → 窗帘盒 = 窗宽']] : [])] },
    fly_screen:     { g: 'open', label: '纱窗', icon: '🦟', needWindows: true, lines: (r, g) => [['fly_screen', g.winA, '各樘窗 宽×高 合计']] },
    sill:           { g: 'open', label: '窗台石', icon: '▭', needWindows: true, lines: (r, g) => [['window_sill', g.winW, '各樘窗宽合计']] },
    balc_seal:      { g: 'open', label: '封阳台', icon: '🪟', lines: (r, g) => [['balc_seal', g.L, '= 阳台长度']] },

    stair_tile:     { g: 'floor', label: '楼梯踏步砖', icon: '🪜', inputs: [{ k: 'n', label: '踏步', unit: '级', def: () => 18 }], lines: (r, g, v) => [['stair_tread', v.n, '踏步级数']] },
    stair_rail:     { g: 'open', label: '楼梯扶手/栏杆', icon: '🪜', inputs: [{ k: 'len', label: '扶手长度', unit: '尺', def: (r, g) => r2(g.L + 3) }], lines: (r, g, v) => [['stair_rail', v.len, '扶手长度']] },
    stair_light:    { g: 'mep', label: '楼梯灯（上下双控）', icon: '💡', inputs: [{ k: 'n', label: '灯', unit: '套', def: () => 2 }], lines: (r, g, v) => [['stair_light', v.n, '套数']] },
    scaffold:       { g: 'demo', label: '挑空/高处脚手架', icon: '🏗️', inputs: [{ k: 'n', label: '处数', unit: '处', def: () => 1 }], lines: (r, g, v) => [['scaffold', v.n, '处数']] },
    porch_tile:     { g: 'out', area: ['floor'], label: '防滑地砖', icon: '🟫', lines: (r, g, v, picked, sp) => [['screed', g.floor, '地面找平'], ['porch_tile', g.floor, '地面'], ...tileExtra(sp, g.floor)] },
    drain_ch:       { g: 'out', label: '排水沟', icon: '〰️', inputs: [{ k: 'len', label: '排水沟长度', unit: '尺', def: (r, g) => g.W }], lines: (r, g, v) => [['drain_ch', v.len, '排水沟长度']] },
    awning:         { g: 'out', label: '雨棚', icon: '⛱️', inputs: [{ k: 'area', label: '雨棚面积', unit: '平方尺', def: (r, g) => g.floor }], lines: (r, g, v) => [['awning', v.area, '雨棚面积']] },
    garden_light:   { g: 'out', label: '户外灯', icon: '💡', inputs: [{ k: 'n', label: '灯位', unit: '个', def: () => 2 }], lines: (r, g, v) => [['garden_light', v.n, '灯位']] }
  };

  // ---------- 全屋项目：不属于某个房间 ----------
  // grp 决定分组显示；landed = 只在有地房屋显示（公寓不显示，已选的仍然显示）
  const HOUSE_GROUPS = [['struct', '结构与申请'], ['mep', '水电'], ['secure', '门窗与安防'], ['out', '外部、屋顶与加建']];
  const HOUSE_ITEMS = [
    { k: 'wall_demo', grp: 'struct', label: '拆墙/开门洞', icon: '🔨', inputs: [{ k: 'area', label: '拆墙面积', unit: '平方尺', def: () => 40 }], lines: v => [['demo_wall', v.area, '拆墙面积']] },
    { k: 'load_wall', grp: 'struct', label: '动承重墙', icon: '🏗️', why: '必须结构工程师签字', inputs: [{ k: 'n', label: '处数', unit: '处', def: () => 1 }], lines: v => [['struct', v.n, '处数'], ['engineer', 1, '动承重墙必须有']] },
    { k: 'reno_permit', grp: 'struct', label: '改建申请（市政局准证）', icon: '📄', lines: () => [['reno_permit', 1, '']] },
    { k: 'db_box', grp: 'mep', label: '换配电箱', icon: '🔌', lines: () => [['db_box', 1, '']] },
    { k: 'three_phase', grp: 'mep', label: '单相改三相电', icon: '⚡', lines: () => [['three_phase', 1, '']] },
    { k: 'net', grp: 'mep', label: '网络/电视线', icon: '📶', inputs: [{ k: 'n', label: '点位', unit: '个', def: () => 4 }], lines: v => [['net', v.n, '点位']] },
    { k: 'gas', grp: 'mep', label: '燃气管道', icon: '🔥', lines: () => [['gas', 1, '']] },
    { k: 'main_pipe', landed: true, grp: 'mep', label: '换进户主水管', icon: '🚰', inputs: [{ k: 'len', label: '长度', unit: '尺', def: () => 30 }], lines: v => [['main_pipe', v.len, '主水管长度']] },
    { k: 'water_filter', grp: 'mep', label: '全屋净水器', icon: '💧', lines: () => [['water_filter', 1, '']] },
    { k: 'sewer', landed: true, grp: 'mep', label: '排污管/化粪池接驳', icon: '🕳️', lines: () => [['sewer', 1, '']] },
    { k: 'pump', landed: true, grp: 'mep', label: '水泵/水箱', icon: '🛢️', lines: () => [['water_pump', 1, '']] },
    { k: 'cctv', grp: 'secure', label: '监控 CCTV', icon: '📹', inputs: [{ k: 'n', label: '摄像头', unit: '个', def: () => 4 }], lines: v => [['cctv', v.n, '摄像头数量']] },
    { k: 'doorbell', grp: 'secure', label: '可视门铃', icon: '🔔', lines: () => [['doorbell', 1, '']] },
    { k: 'main_door', grp: 'secure', label: '换大门', icon: '🚪', lines: () => [['main_door', 1, '']] },
    { k: 'grille', grp: 'secure', label: '防盗铁花', icon: '🔒', inputs: [{ k: 'area', label: '面积', unit: '平方尺', def: () => 40 }], lines: v => [['grille', v.area, '铁花面积']] },
    { k: 'autogate', landed: true, grp: 'secure', label: '自动大门', icon: '🚧', lines: () => [['autogate', 1, '']] },
    { k: 'extension', landed: true, grp: 'out', label: '加建/扩建（地基+砌墙+屋顶）', icon: '🏗️', why: '会自动加上扩建图纸及市政局申请', inputs: [{ k: 'area', label: '加建面积', unit: '平方尺', def: () => 100 }], lines: v => [['extension', v.area, '加建面积'], ['ext_permit', 1, '加建必须先申请批准']] },
    { k: 'awning', landed: true, grp: 'out', label: '雨棚', icon: '⛱️', inputs: [{ k: 'area', label: '雨棚面积', unit: '平方尺', def: () => 200 }], lines: v => [['awning', v.area, '雨棚面积']] },
    { k: 'roof_fix', landed: true, grp: 'out', label: '屋顶补漏', icon: '🏠', inputs: [{ k: 'n', label: '漏点', unit: '处', def: () => 1 }], lines: v => [['roof_fix', v.n, '漏点处数']] },
    { k: 'ext_paint', landed: true, grp: 'out', label: '外墙油漆', icon: '🎨', inputs: [{ k: 'area', label: '外墙面积', unit: '平方尺', def: () => 1500 }], lines: v => [['ext_paint', v.area, '外墙面积']] },
    { k: 'downpipe', landed: true, grp: 'out', label: '换雨水管', icon: '🌧️', inputs: [{ k: 'len', label: '长度', unit: '尺', def: () => 40 }], lines: v => [['downpipe', v.len, '雨水管长度']] },
    { k: 'fence', landed: true, grp: 'out', label: '围墙/栏杆', icon: '🧱', inputs: [{ k: 'len', label: '长度', unit: '尺', def: () => 40 }], lines: v => [['fence', v.len, '围墙长度']] },
    { k: 'drain_ch', landed: true, grp: 'out', label: '户外排水沟', icon: '〰️', inputs: [{ k: 'len', label: '长度', unit: '尺', def: () => 40 }], lines: v => [['drain_ch', v.len, '排水沟长度']] }
  ];
  // 手动增项：价目表没有的项目，员工自己填名称、单位、数量、单价和归属阶段
  const EXTRA_UNITS = ['项', '平方尺', '延尺', '个', '套', '樘', '处'];

  const SETTINGS = { designRate: 8, mgmtRate: 6, sst: 0, pay: [['签约定金', 30], ['水电隐蔽验收通过', 30], ['泥水瓷砖验收通过', 30], ['竣工验收交付', 10]] };

  // ---------- 方案（同一范围，多套选材） ----------
  function plans(project) {
    if (!Array.isArray(project.plans) || !project.plans.length) project.plans = [{ id: 'A', name: '方案 A', specs: {}, roomSpecs: {} }];
    return project.plans;
  }
  function activePlan(project, planId) {
    const ps = plans(project), id = planId || project.planId;
    return ps.find(p => p.id === id) || ps[0];
  }
  // 取某个房间某个位置的选材：位置（例如客厅·地面）> 房间 > 全屋 > 标准档；decided = 是否已明确选定
  function specOf(project, room, cat, k, planId, pack) {
    const pl = activePlan(project, planId), key = SPEC_CATS[cat].keys[k];
    const place = room && pack && pl.roomSpecs?.[room.id]?.['@' + pack]?.[cat]?.[k];
    const own = room && pl.roomSpecs?.[room.id]?.[cat]?.[k];
    const all = pl.specs?.[cat]?.[k];
    if (place !== undefined) return { v: place, decided: true, own: true };
    if (own !== undefined) return { v: own, decided: true, own: true };
    if (all !== undefined) return { v: all, decided: true, own: false };
    return { v: stdOf(key, room), decided: false, own: false };
  }

  // ---------- 计算 ----------
  function geo(room, house) {
    const L = num(room.L), W = num(room.W), H = num(room.H) || num(house && house.H) || 9, doors = Math.max(0, Math.round(num(room.doors)));
    const wins = (room.windows || []).map(x => ({ w: num(x.w), h: num(x.h) }));
    const winW = r2(wins.reduce((t, x) => t + x.w, 0)), winA = r2(wins.reduce((t, x) => t + x.w * x.h, 0));
    const floor = r2(L * W), perim = r2(2 * (L + W));
    const wall = r2(Math.max(0, perim * H - doors * 21 - winA));
    const skirt = r2(Math.max(0, perim - doors * 3));
    return { L, W, H, doors, floor, perim, wall, skirt, winW, winA, wins };
  }
  const AREA_INPUT = {
    floor: { k: 'floor', unit: '平方尺', def: (r, g) => g.floor },
    wall: { k: 'wall', label: '墙面面积', unit: '平方尺', def: (r, g) => g.wall }
  };
  function inputsOf(code) {
    const pk = PACKS[code], a = pk.area || [];
    return [...a.map(k => ({ ...AREA_INPUT[k], label: k === 'floor' ? (a.length > 1 ? '地面面积' : '施工面积') : AREA_INPUT[k].label, area: true })), ...(pk.inputs || [])];
  }
  function packValues(room, code, g) {
    const saved = (room.vals && room.vals[code]) || {}, v = {};
    inputsOf(code).forEach(i => { v[i.k] = saved[i.k] !== undefined && saved[i.k] !== '' ? num(saved[i.k]) : i.def(room, g); });
    return v;
  }
  function houseValues(q, item) {
    const v = {};
    (item.inputs || []).forEach(i => { v[i.k] = q[i.k] !== undefined && q[i.k] !== '' ? num(q[i.k]) : i.def(); });
    return v;
  }
  function unitPrice(code, prices) {
    const p = { ...P[code], ...((prices && prices[code]) || {}) };
    return r2(num(p.mat) * (1 + num(p.waste) / 100) + num(p.aux) + num(p.lab));
  }
  // 某个项目受哪些选材影响
  function specKeysFor(code, pack) {
    const out = [];
    Object.entries(SPEC_CATS).forEach(([cat, c]) => Object.entries(c.keys).forEach(([k, key]) => {
      if (key.codes.includes(code) && (!key.packs || key.packs.includes(pack))) out.push([cat, k, key]);
    }));
    return out;
  }
  // 单价 = 价目表标准价 + 选材价差；已知的变化直接算，未登记价差的标记 priceTbd
  function pricedLine(project, room, code, pack, planId) {
    const p = { ...P[code], ...((project.prices && project.prices[code]) || {}) };
    let mat = num(p.mat) * (1 + num(p.waste) / 100), aux = num(p.aux), lab = num(p.lab);
    const spec = [], tbdKeys = [], priceTbd = [];
    specKeysFor(code, pack).forEach(([cat, k, key]) => {
      const s = specOf(project, room, cat, k, planId, pack);
      spec.push(s.v);
      if (!s.decided) tbdKeys.push(cat);
      if (key.noPrice || s.v === stdOf(key, room)) return;
      const mod = key.mod && key.mod[s.v];
      if (mod && mod.matZero) { mat = 0; return; }
      const add = OPTION_PRICES[`${cat}.${k}.${s.v}`]?.[code];
      if (add) { mat += num(add.mat); aux += num(add.aux); lab += num(add.lab); }
      else priceTbd.push(`${key.label}：${s.v}`);
    });
    return { unit: r2(mat + aux + lab), spec: spec.join(' · '), tbd: [...new Set(tbdKeys)], priceTbd };
  }
  const roomLabel = (room, project) => (levelsOf(project) > 1 ? `${room.level || 1}楼 · ` : '') + room.name;
  const levelsOf = project => Math.max(1, ...project.rooms.map(r => r.level || 1));

  function buildLines(project, planId) {
    const lines = [];
    const push = (room, code, qty, formula, from, pack, item) => {
      qty = r2(num(qty));
      if (!(qty > 0) || !P[code]) return;
      let unit, spec = '', tbd = [], priceTbd = [];
      if (item) unit = r2(num(item.price));
      else ({ unit, spec, tbd, priceTbd } = pricedLine(project, room, code, pack, planId));
      lines.push({ roomId: room ? room.id : null, room: room ? roomLabel(room, project) : '全屋', code, pack, name: item ? (String(item.name || '').trim() || P[code].name) : P[code].name, unitName: (item && item.unit) || P[code].unit, stage: (item && item.stage) || P[code].stage, qty, formula, from, unit, total: Math.round(qty * unit), spec, tbd, priceTbd, custom: !!item, unpriced: item ? !(unit > 0) : !!P[code].unpriced && !(unit > 0) });
    };
    const anyWork = project.rooms.some(r => (r.packs || []).length) || Object.keys(project.house || {}).some(k => project.house[k] && project.house[k].on) || (project.extras || []).length > 0;
    if (anyWork) { push(null, 'setout', 1, '每单必做', '全屋'); push(null, 'protect', 1, '每单必做', '全屋'); }
    if (anyWork && HOUSES[project.houseType] && !HOUSES[project.houseType].landed) push(null, 'permit', 1, '公寓有管理处，装修要先申请', '全屋');
    project.rooms.forEach(room => {
      const g = geo(room, project), picked = {};
      (room.packs || []).forEach(c => { picked[c] = true; });
      (room.packs || []).forEach(code => {
        const pk = PACKS[code]; if (!pk) return;
        const sp = (cat, k) => specOf(project, room, cat, k, planId, code).v;
        const v = packValues(room, code, g), g2 = { ...g };
        (pk.area || []).forEach(k => { g2[k] = v[k]; });
        pk.lines(room, g2, v, picked, sp).forEach(([c, q, f, it]) => push(room, c, q, f, pk.label, code, it));
      });
    });
    const hs = project.house || {};
    HOUSE_ITEMS.forEach(item => { const q = hs[item.k]; if (q && q.on) item.lines(houseValues(q, item)).forEach(([c, qty, f]) => push(null, c, qty, f, item.label)); });
    // 人工增加项：挂在某个房间（roomId）或全屋
    (project.extras || []).forEach(x => push(project.rooms.find(r => r.id === x.roomId) || null, 'custom_item', x.qty, '人工增加', '人工增加项', 'extra', x));
    const indoor = project.rooms.filter(r => !ROOMS[r.type].outdoor);
    const worked = indoor.filter(r => (r.packs || []).length);
    const waterPts = lines.filter(l => l.code === 'water_pt').reduce((t, l) => t + l.qty, 0);
    if (waterPts > 0) push(null, 'pipe_test', 1, `全屋 ${waterPts} 个水点位，封槽前必须打压`, '自动');
    const upQty = worked.filter(r => (r.level || 1) > 1).reduce((t, r) => t + geo(r, project).floor * ((r.level || 1) - 1), 0);
    if (upQty > 0) push(null, 'carry_up', upQty, '楼上施工房间面积 × 楼层', '自动');
    if (anyWork) {
      const sum = cs => lines.filter(l => cs.includes(l.code)).reduce((t, l) => t + l.qty, 0);
      const demoArea = sum(['demo_floor', 'demo_skin', 'demo_wall_tile', 'demo_ceiling']), wallArea = sum(['demo_wall']), pieces = sum(['demo_piece']);
      // 砸墙渣土最重：每 100 平方尺 1 车（同旧版）
      push(null, 'waste_out', 1 + ceil(demoArea / 400) + ceil(wallArea / 100) + ceil(pieces / 10), `基础 1 车 + 铲除面积 ${r2(demoArea)}÷400 + 砸墙 ${r2(wallArea)}÷100 + 旧件 ${pieces}÷10（进位）`, '自动');
      push(null, 'clean', worked.reduce((t, r) => t + geo(r, project).floor, 0), '施工房间地面面积合计', '自动');
    }
    return lines;
  }

  function totals(project, lines) {
    const direct = lines.reduce((t, l) => t + l.total, 0);
    const s = { ...SETTINGS, ...(project.settings || {}) };
    // 设计费只按「有施工的室内房间」面积算：只做客厅就不收全屋设计费
    const floorSum = project.rooms.filter(r => !ROOMS[r.type].outdoor && (r.packs || []).length).reduce((t, r) => t + geo(r, project).floor, 0);
    const design = project.design === false ? 0 : Math.round(floorSum * num(s.designRate));
    const mgmt = Math.round(direct * num(s.mgmtRate) / 100);
    const before = direct + design + mgmt;
    const discount = Math.min(Math.round(num(project.discount)), before);
    const sst = Math.round((before - discount) * num(s.sst) / 100);
    const total = before - discount + sst;
    const byStage = STAGES.map(st => ({ ...st, total: lines.filter(l => l.stage === st.id).reduce((t, l) => t + l.total, 0) })).filter(x => x.total > 0);
    let paid = 0;
    const pay = s.pay.map(([name, pct], i, a) => { const amt = i === a.length - 1 ? total - paid : Math.round(total * pct / 100); paid += amt; return { name, pct, amt }; });
    return { direct, design, mgmt, discount, sst, total, floorSum: r2(floorSum), byStage, pay, settings: s };
  }

  // 一个房间里要定选材的「位置」：每个选了的范围项目是一个位置，只列出当前真正用到的选项
  const PLACE_LABEL = { floor: '地面', wall_finish: '墙面', ceiling: '天花', bath_ceil: '天花', kitchen_tile: '地砖与墙砖', bath_tile: '地砖与墙砖', wet_tile: '地砖', porch_tile: '地砖', electric: '灯具', cabinets: '橱柜与台面' };
  function placesOf(project, room, lines) {
    const order = [];
    Object.entries(SPEC_CATS).forEach(([cat, c]) => Object.keys(c.keys).forEach(k => order.push(cat + '.' + k)));
    return (room.packs || []).map(pack => {
      const ls = lines.filter(l => l.roomId === room.id && l.pack === pack);
      const set = new Set();
      ls.forEach(l => specKeysFor(l.code, l.pack).forEach(([cat, k]) => set.add(cat + '.' + k)));
      const keys = order.filter(x => set.has(x)).map(x => x.split('.'));
      // 材料决定其他选项：地面先选材料，墙面先选做法，天花先选造型
      if (pack === 'floor' && !keys.some(([c, k]) => c === 'tile' && k === 'material')) keys.unshift(['tile', 'material']);
      return { pack, label: PLACE_LABEL[pack] || PACKS[pack].label, keys, open: ls.some(l => l.tbd.length) };
    }).filter(x => x.keys.length);
  }

  // 选材的完成情况：哪些房间用到这一类、还有几处没定
  function specStatus(project, lines, cat) {
    const rooms = [...new Set(lines.filter(l => l.roomId && specKeysFor(l.code, l.pack).some(([c]) => c === cat)).map(l => l.roomId))];
    const open = [...new Set(lines.filter(l => l.tbd.includes(cat)).map(l => l.roomId))];
    return { rooms, open };
  }

  // 检查：red = 不处理不能出报价单；yellow = 提醒确认。mode: 'estimate' 预估 / 'formal' 正式
  function checks(project, lines, mode) {
    const red = [], yellow = [];
    if (!project.houseType) red.push({ m: '还没选房屋类型', go: 'house' });
    if (!project.rooms.length) red.push({ m: '还没有房间', go: 'house' });
    project.rooms.forEach(room => {
      const g = geo(room, project), label = roomLabel(room, project), packs = room.packs || [];
      if (!(g.L > 0 && g.W > 0)) red.push({ m: `「${label}」请填写长和宽`, go: room.id });
      else if (!room.measured && packs.length) (mode === 'formal' ? red : yellow).push({ m: `「${label}」尺寸还是默认值，${mode === 'formal' ? '请现场量好后点「尺寸已确认」' : '预估先按默认尺寸算'}`, go: room.id });
      (room.windows || []).forEach((x, i) => { if (!(num(x.w) > 0 && num(x.h) > 0)) red.push({ m: `「${label}」第 ${i + 1} 樘窗请填写宽和高`, go: room.id }); });
      packs.forEach(c => {
        const pk = PACKS[c]; if (!pk) return;
        (pk.area || []).forEach(k => { const v = packValues(room, c, g)[k]; if (v > g[k] + 0.01) yellow.push({ m: `「${label}」${pk.label}面积 ${r2(v)} 大于房间${k === 'wall' ? '墙面' : '地面'} ${g[k]}，请确认`, go: room.id }); });
        if (pk.needWindows && !(g.wins.length)) red.push({ m: `「${label}」选了${pk.label}，请先加窗户尺寸`, go: room.id });
        if (pk.items) {
          const items = room.items || [];
          if (!items.length) red.push({ m: `「${label}」选了定制小件，请至少加一项`, go: room.id });
          items.forEach((it, i) => {
            const nm = String(it.name || '').trim() || `第 ${i + 1} 项`;
            if (!String(it.name || '').trim()) red.push({ m: `「${label}」定制小件第 ${i + 1} 项请填写名称`, go: room.id });
            if (!(num(it.qty) > 0)) red.push({ m: `「${label}」定制小件「${nm}」数量要大于 0`, go: room.id });
            if (!(num(it.price) > 0)) red.push({ m: `「${label}」定制小件「${nm}」请填写单价`, go: room.id });
          });
        }
        if (pk.needDoors && !(g.doors > 0)) red.push({ m: `「${label}」选了换门，但门数是 0`, go: room.id });
        const v = packValues(room, c, g);
        inputsOf(c).forEach(i => { if (!(v[i.k] > 0)) red.push({ m: `「${label}」${pk.label}：${i.label}要大于 0`, go: room.id }); });
      });
      if (packs.includes('ceiling') && packs.includes('ceil_paint')) red.push({ m: `「${label}」同时选了「天花吊顶」和「天花重刷」，吊顶已含天花油漆，请去掉一个`, go: room.id });
      if (room.type === 'bath' && packs.includes('sanitary') && !packs.includes('bath_tile')) yellow.push({ m: `「${label}」换洁具但不做防水瓷砖，确认原防水没问题`, go: room.id });
    });
    ['awning', 'drain_ch'].forEach(k => { if (project.house?.[k]?.on && project.rooms.some(r => (r.packs || []).includes(k))) red.push({ m: `「${PACKS[k].label}」在车廊/前院和全屋项目都选了，会重复收费，请去掉一个`, go: 'all' }); });
    (project.extras || []).forEach((x, i) => {
      const nm = String(x.name || '').trim() || `第 ${i + 1} 项`;
      if (!String(x.name || '').trim()) red.push({ m: `人工增加项第 ${i + 1} 项请填写名称`, go: x.roomId || 'all' });
      if (!(num(x.qty) > 0)) red.push({ m: `人工增加项「${nm}」数量要大于 0`, go: x.roomId || 'all' });
      if (!(num(x.price) > 0)) red.push({ m: `人工增加项「${nm}」请填写单价`, go: x.roomId || 'all' });
    });
    const seen = {};
    lines.filter(l => l.unpriced && !l.custom).forEach(l => { if (!seen[l.code]) { seen[l.code] = 1; (mode === 'formal' ? red : yellow).push({ m: `「${l.name}」单价待公司核定，${mode === 'formal' ? '请填写价格' : '暂未计入总价'}`, go: 'price' }); } });
    // 选材：预估时提醒，正式报价时必须定好
    project.rooms.forEach(room => {
      const open = placesOf(project, room, lines).filter(x => x.open).map(x => x.label);
      if (open.length) (mode === 'formal' ? red : yellow).push({ m: `「${roomLabel(room, project)}」${open.join('、')}还没定选材，${mode === 'formal' ? '正式报价前要定好' : '暂按标准档估价'}`, go: 'spec:' + room.id });
    });
    const tbdPrice = {};
    lines.forEach(l => l.priceTbd.forEach(x => { tbdPrice[x] = 1; }));
    Object.keys(tbdPrice).forEach(x => (mode === 'formal' ? red : yellow).push({ m: `选了「${x}」，价差待公司核定${mode === 'formal' ? '' : '（暂按标准价算）'}`, go: 'price' }));
    return { red, yellow };
  }

  // ---------- 沿用到其他空间：复制，不是联动；复制后每间仍可单独改 ----------
  // 哪些房间也能做这个工项（同类房间排前面）
  // 同类空间：卧室类（主人房/卧室/书房）、客餐厅、湿区（洗衣区/阳台）
  const KIN = { master: 'bed', bedroom: 'bed', study: 'bed', living: 'hall', dining: 'hall', laundry: 'wetx', balcony: 'wetx' };
  const KIN_LABEL = { bed: '卧室', hall: '客餐厅', wetx: '洗衣区/阳台' };
  const kinOf = type => KIN[type] || type;
  const kinLabel = type => KIN_LABEL[kinOf(type)] || ROOMS[type].label;
  function roomsFor(project, fromId, code) {
    const from = project.rooms.find(r => r.id === fromId), k = kinOf(from.type);
    return project.rooms.filter(r => r.id !== fromId && ROOMS[r.type].packs.includes(code))
      .sort((a, b) => (kinOf(b.type) === k) - (kinOf(a.type) === k));
  }
  // 把一个工项的开/关、非面积类的数字（点位数、台数…）、这个位置的选材，从一间复制到另一间。
  // 面积类数字不复制：每间按自己的尺寸算。
  function copyPack(project, fromId, toId, code, on) {
    const from = project.rooms.find(r => r.id === fromId), to = project.rooms.find(r => r.id === toId), pk = PACKS[code];
    if (!from || !to || !pk || !ROOMS[to.type].packs.includes(code)) return false;
    to.packs = to.packs || [];
    if (!on) { to.packs = to.packs.filter(x => x !== code); return true; }
    if (pk.pick) to.packs = to.packs.filter(x => PACKS[x].pick !== pk.pick);
    if (!to.packs.includes(code)) to.packs.push(code);
    const sv = from.vals && from.vals[code];
    if (sv) {
      const keep = {}; (pk.inputs || []).forEach(i => { if (sv[i.k] !== undefined && sv[i.k] !== '') keep[i.k] = sv[i.k]; });
      if (Object.keys(keep).length) { to.vals = to.vals || {}; to.vals[code] = { ...(to.vals[code] || {}), ...keep }; }
    }
    if (pk.items) to.items = JSON.parse(JSON.stringify(from.items || []));
    plans(project).forEach(pl => {
      const src = pl.roomSpecs && pl.roomSpecs[fromId] && pl.roomSpecs[fromId]['@' + code];
      if (src) ((pl.roomSpecs[toId] = pl.roomSpecs[toId] || {}))['@' + code] = JSON.parse(JSON.stringify(src));
    });
    return true;
  }
  // 整间复制：目标房间的工项换成来源房间的（目标房间做不了的跳过），返回跳过的工项
  function copyRoom(project, fromId, toIds) {
    const from = project.rooms.find(r => r.id === fromId), skipped = {};
    toIds.forEach(id => {
      const to = project.rooms.find(r => r.id === id); if (!to || id === fromId) return;
      to.packs = [];
      (from.packs || []).forEach(c => { if (!copyPack(project, fromId, id, c, true)) (skipped[id] = skipped[id] || []).push(c); });
    });
    return skipped;
  }

  function newRoom(type, level, n) {
    const t = ROOMS[type];
    return { id: 'r' + Math.random().toString(36).slice(2, 9), type, level: level || 1, name: t.label + (n > 1 ? ' ' + n : ''), L: t.L, W: t.W, doors: t.doors, windows: [], packs: [], vals: {}, measured: false };
  }
  function presetRooms(houseType) {
    const l = layoutsFor(houseType).find(x => x.id === DEFAULT_LAYOUT[houseType]) || layoutsFor(houseType)[0];
    return layoutRooms(houseType, l);
  }
  // 旧草稿迁移：原来「地砖/木地板」「平顶/造型吊顶」「刷漆」是范围卡片，现在材料移到选材
  function migrate(project) {
    const pl = plans(project)[0];
    project.rooms.forEach(r => {
      const set = (cat, k, v) => { ((pl.roomSpecs[r.id] = pl.roomSpecs[r.id] || {})[cat] = pl.roomSpecs[r.id][cat] || {})[k] = v; };
      const has = c => (r.packs || []).includes(c), swap = (from, to) => { r.packs = r.packs.filter(x => x !== from); if (!r.packs.includes(to)) r.packs.push(to); if (r.vals?.[from]) { r.vals[to] = r.vals[from]; delete r.vals[from]; } };
      if (has('laminate')) { swap('laminate', 'floor'); set('tile', 'material', 'SPC 石塑地板'); }
      if (has('floor_tile')) { swap('floor_tile', 'floor'); set('tile', 'material', '瓷砖'); }
      if (has('ceil_feature')) { swap('ceil_feature', 'ceiling'); set('ceiling', 'style', '叠级+灯槽'); }
      if (has('ceil_flat')) { swap('ceil_flat', 'ceiling'); set('ceiling', 'style', '平顶'); }
      if (has('paint')) swap('paint', 'wall_finish');
    });
    return project;
  }

  const api = { HOUSES, ROOMS, PACKS, GROUPS, HOUSE_ITEMS, HOUSE_GROUPS, EXTRA_UNITS, SPEC_CATS, SETTINGS, PRICE: P, STAGES, OPTION_PRICES, geo, inputsOf, packValues, houseValues, unitPrice, buildLines, totals, checks, specOf, stdOf, specKeysFor, specStatus, placesOf, plans, activePlan, LAYOUTS, layoutsFor, layoutRooms, DEFAULT_LAYOUT, roomsFor, kinOf, kinLabel, copyPack, copyRoom, newRoom, presetRooms, migrate, roomLabel, num, r2 };
  root.QV2 = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
