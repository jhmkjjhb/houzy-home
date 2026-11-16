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
  const OPTION_REF = root.QV2_OPTION_REF || (src && src.OPTION_REF) || {};
  const TILE_PIECE_PRICES = root.QV2_TILE_PIECE_PRICES || {};
  const TILE_PIECE_REF = root.QV2_TILE_PIECE_REF || (src && src.TILE_PIECE_REF) || {};
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const r2 = n => Math.round(n * 100) / 100;
  const r4 = n => Math.round(n * 10000) / 10000;
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
    if (landed && spec.ext) add('extension', 1, '后院加建', [S.yard[0], Math.max(8, S.yard[1])]);
    const one = out.filter(r => r.type === 'bath' && /卫生间 \d/.test(r.name));
    if (one.length === 1) one[0].name = '公共卫生间';
    return out.map((r, i) => [r, i]).sort((a, b) => (a[0].level || 1) - (b[0].level || 1) || a[1] - b[1]).map(x => x[0]);
  }

  // ---------- 空间类型：默认尺寸、门数、可选项目 ----------
  const DRY = ['demo_floor', 'demo_skin', 'demo_ceiling', 'floor', 'wall_finish', 'ceiling', 'ceil_paint', 'cornice', 'electric', 'aircon', 'fan', 'curtain', 'sill', 'fly_screen', 'door', 'window_new'];
  const ROOMS = {
    living:  { label: '客厅', icon: '🛋️', L: 20, W: 14, doors: 0, packs: [...DRY, 'tv_cab', 'shoe_cab', 'altar', 'soft_living'] },
    dining:  { label: '餐厅', icon: '🍽️', L: 12, W: 10, doors: 0, packs: [...DRY, 'sideboard', 'soft_dining'] },
    master:  { label: '主人房', icon: '🛏️', L: 14, W: 12, doors: 1, packs: [...DRY, 'wardrobe', 'headboard', 'soft_bed'] },
    bedroom: { label: '卧室', icon: '🛏️', L: 11, W: 10, doors: 1, packs: [...DRY, 'wardrobe', 'desk', 'soft_bed'] },
    study:   { label: '书房', icon: '📚', L: 10, W: 9, doors: 1, packs: [...DRY, 'bookcase', 'desk', 'soft_study'] },
    kitchen: { label: '厨房', icon: '🍳', L: 10, W: 8, doors: 0, wet: true, packs: ['demo_floor', 'demo_wall_tile', 'demo_ceiling', 'kitchen_tile', 'cabinets', 'cab_basket', 'kitchen_water', 'pipe_box', 'electric', 'wall_finish', 'ceiling', 'ceil_paint', 'aircon', 'sill', 'fly_screen', 'door', 'window_new'] },
    bath:    { label: '卫生间', icon: '🚿', L: 8, W: 5, doors: 1, wet: true, packs: ['bath_demo', 'demo_ceiling', 'bath_tile', 'sanitary', 'shower_area', 'vanity', 'heater', 'bath_water', 'bath_move', 'bath_ceil', 'electric', 'door', 'window_new'] },
    laundry: { label: '洗衣区', icon: '🧺', L: 8, W: 5, doors: 0, wet: true, packs: ['demo_floor', 'wet_tile', 'laundry_water', 'pipe_box', 'laundry_cab', 'rack', 'electric', 'wall_finish', 'window_new'] },
    balcony: { label: '阳台', icon: '🌿', L: 10, W: 4, doors: 0, wet: true, confirmWall: true, packs: ['demo_floor', 'wet_tile', 'rack', 'electric', 'balc_seal', 'sun_canopy', 'sunroom', 'soft_out'] },
    family:  { label: '家庭厅', icon: '🛋️', L: 14, W: 12, doors: 0, packs: [...DRY, 'soft_living'] },
    store:   { label: '储物间', icon: '📦', L: 6, W: 5, doors: 1, packs: ['demo_floor', 'floor', 'wall_finish', 'ceil_paint', 'electric', 'bookcase', 'door'] },
    corridor:{ label: '走廊/玄关', icon: '🚶', L: 12, W: 4, doors: 0, packs: ['demo_floor', 'floor', 'wall_finish', 'ceiling', 'ceil_paint', 'cornice', 'electric', 'shoe_cab'] },
    stairs:  { label: '楼梯', icon: '🪜', L: 12, W: 4, doors: 0, packs: ['stair_tile', 'stair_rail', 'stair_step_light', 'stair_light', 'wall_finish', 'scaffold'] },
    yard:    { label: '后院/花园', icon: '🌳', L: 20, W: 8, doors: 0, outdoor: true, packs: ['porch_tile', 'drain_ch', 'awning', 'sunroom', 'garden_light', 'soft_out'] },
    // 加建空间：新建的地基、墙、屋顶按地面面积自动算；里面的地砖、水电等照常选
    extension: { label: '加建空间', icon: '🏗️', L: 20, W: 10, doors: 1, ext: true, landed: true, packs: ['floor', 'wet_tile', 'wall_finish', 'ceiling', 'ceil_paint', 'electric', 'kitchen_water', 'aircon', 'fan', 'window_new', 'fly_screen', 'door', 'cabinets', 'sill'] },
    porch:   { label: '车廊/前院', icon: '🚗', L: 20, W: 18, doors: 0, outdoor: true, packs: ['porch_tile', 'drain_ch', 'carport', 'garden_light'] }
  };
  Object.values(ROOMS).forEach(t => { if (!t.outdoor) t.packs.push('custom_item'); });

  // ---------- 第二层：做法与选材 ----------
  // std = 标准档（未选时按它估价）；codes = 影响哪些项目；packs = 只对哪些范围项目生效；
  // noPrice = 只影响做法说明或项目组成，不另外加价；mod = 已知的计价变化（如客户自备砖不收主材）。
  // 其他非标准选项的价差在 quote-v2-price.js 的 OPTION_PRICES 里登记，没登记的显示「价差待定」。
  const TILE_CODES = ['floor_tile', 'wall_tile', 'porch_tile'];
  const CAB_CODES = ['wardrobe', 'tv_cab', 'shoe_cab', 'altar_cab', 'sideboard', 'bookcase', 'laundry_cab', 'headboard', 'cab_low', 'cab_up'];
  const SCREEN_CODES = ['screen', 'screen_l', 'screen_diamond', 'curtain_rod', 'shower_tray'];
  // scope: true = 做法（拆多少、防水多高、隔断形式、成品还是定制），在「② 房间」逐间定，默认标准做法，不算「未定」；
  // 其余是材料和选品，在「④ 选材」按空间类型统一选，某间可单独不同。
  const RAIL_CODES = { '不锈钢立柱 + 木扶手': 'stair_rail', '钢化玻璃栏板 + 木扶手': 'rail_glass', '铁艺栏杆': 'rail_iron', '实木栏杆': 'rail_wood', '黑色方管栏杆（现代简约）': 'rail_black', '铝合金栏杆': 'rail_alu' };
  const STAIR_CODES = ['stair_tread', 'stair_wood', 'stair_stone', 'stair_paint'];
  // 软装：按房间类型列常用家具/灯饰/配饰，每样填数量（0 = 不要）；档次和风格到「④ 选材」统一选。软装不收管理费。
  const SOFT = {
    living:  [['sofa', '沙发', '套', 'sf_sofa', 1], ['coffee', '茶几', '张', 'sf_coffee', 1], ['side', '边几', '张', 'sf_side', 0], ['rug', '地毯', '张', 'sf_rug', 1], ['pendant', '装饰吊灯', '盏', 'sf_pendant', 1], ['art', '挂画', '幅', 'sf_art', 0], ['fan', '吊扇（产品）', '台', 'sf_fan', 0], ['decor', '配饰包（靠垫/花艺/摆件）', '项', 'decor', 0]],
    dining:  [['table', '餐桌椅', '套', 'sf_dining', 1], ['pendant', '餐吊灯', '盏', 'sf_pendant', 1], ['fan', '吊扇（产品）', '台', 'sf_fan', 0], ['decor', '配饰包', '项', 'decor', 0]],
    bed:     [['bed', '床架 + 床垫', '套', 'sf_bed', 1], ['night', '床头柜', '个', 'sf_night', 2], ['dresser', '梳妆台', '张', 'sf_dresser', 0], ['bedding', '床品', '套', 'sf_bedding', 0], ['lamp', '落地灯/台灯', '盏', 'sf_lamp', 0], ['fan', '吊扇（产品）', '台', 'sf_fan', 0], ['decor', '配饰包', '项', 'decor', 0]],
    study:   [['desk', '书桌椅', '套', 'sf_desk', 1], ['shelf', '成品书架', '个', 'sf_shelf', 0], ['lamp', '台灯', '盏', 'sf_lamp', 0], ['fan', '吊扇（产品）', '台', 'sf_fan', 0]],
    out:     [['outdoor', '户外桌椅', '套', 'sf_outdoor', 1], ['umbrella', '遮阳伞', '把', 'sf_umbrella', 0], ['plant', '绿植', '盆', 'sf_plant', 0]]
  };
  const softPack = (label, list) => ({ g: 'soft', label, icon: '🛋️', wide: true, inputs: list.map(([k, l, u, , d]) => ({ k, label: l, unit: u, def: () => d, opt: true })), lines: (r, g, v) => list.map(([k, l, , c]) => [c, num(v[k]), l]) });
  const SOFT_CODES = [...new Set(Object.values(SOFT).flat().map(x => x[3]))];
  const CEIL_STYLES = ['平顶', '四周 L-box 灯槽（中间不吊）', '叠级+灯槽', '双层回字形叠级', '弧形造型', '木纹格栅', '铝扣板（厨卫）'];
  // 天花按做法出项目：板面积、叠级/灯槽长度、灯带、刷漆
  function ceilLines(g, v, style) {
    // 窗帘盒不在这里算：选了「窗帘」又有吊顶时，窗帘那项会自动加窗帘盒（按窗宽），避免重复收费
    const box = r2(g.perim * 2), pel = [];
    if (style === '木纹格栅') return [['ceil_slat', g.floor, '格栅面积'], ...pel];
    if (style === '铝扣板（厨卫）') return [['ceil_alu', g.floor, '扣板面积'], ...pel];
    if (style === '四周 L-box 灯槽（中间不吊）') return [['plaster_ceiling', box, '周长 × 2 尺宽 L-box'], ['ceiling_step', g.perim, '= 周长'], ['led_strip', g.perim, '= 周长'], ['paint_ceiling', g.floor, '全天花刷漆'], ...pel];
    const base = [['plaster_ceiling', g.floor, '= 吊顶面积'], ['paint_ceiling', g.floor, '= 吊顶面积']];
    if (style === '叠级+灯槽') return [...base, ['ceiling_step', g.perim, '= 周长'], ['led_strip', g.perim, '= 周长'], ...pel];
    if (style === '双层回字形叠级') return [...base, ['ceiling_step', r2(g.perim * 2), '两层 = 周长 × 2'], ['led_strip', g.perim, '= 周长'], ...pel];
    if (style === '弧形造型') return [...base, ['ceil_curve', g.perim, '弧形造型长度'], ['led_strip', g.perim, '= 周长'], ...pel];
    return [...base, ...pel];
  }
  const SPEC_CATS = {
    tile: { label: '地面与瓷砖', icon: '🟫', keys: {
      material:  { label: '干区地面材料', opts: ['瓷砖', 'SPC 石塑地板', '强化复合木地板'], std: '瓷砖', codes: ['floor_tile', 'laminate', 'wood_floor'], packs: ['floor'], noPrice: true },
      floorSize: { label: '地砖尺寸', opts: ['600×600 mm', '300×600 mm', '600×1200 mm', '800×800 mm', '750×1500 mm', '900×1800 mm', '1200×1200 mm'], std: '600×600 mm', codes: ['floor_tile', 'porch_tile'] },
      wallSize:  { label: '墙砖尺寸', opts: ['300×600 mm', '600×600 mm', '600×1200 mm', '750×1500 mm'], std: '300×600 mm', codes: ['wall_tile'] },
      finish:    { label: '地砖表面', opts: ['普通亮面', '质感', '质感亮面', '质感哑面', '哑光', '柔光', '亮光', '防滑'], std: room => (room && (ROOMS[room.type].wet || ROOMS[room.type].outdoor) ? '防滑' : '哑光'), codes: ['floor_tile', 'porch_tile'], noPrice: true },
      wallFinish:{ label: '墙砖表面', opts: ['普通亮面', '质感', '质感亮面', '质感哑面', '哑光', '柔光', '亮光'], std: '亮光', codes: ['wall_tile'], noPrice: true },
      supply:    { label: '瓷砖供应', opts: ['包工包料', '客户自备砖'], std: '包工包料', codes: TILE_CODES, mod: { '客户自备砖': { matZero: true } } },
      woodGrade: { label: '地板档次', opts: ['标准 5 mm', '加厚 8 mm', '多层实木复合'], std: '标准 5 mm', codes: ['wood_floor'] }
    } },
    wall: { label: '墙面', icon: '🖌️', keys: {
      method: { label: '墙面做法', opts: ['乳胶漆', '墙纸', '艺术漆'], std: '乳胶漆', codes: ['paint_wall', 'wallpaper', 'art_paint'], packs: ['wall_finish'], noPrice: true },
      brand:  { label: '油漆品牌', opts: ['Nippon Paint', 'Dulux', 'Jotun'], std: 'Nippon Paint', codes: ['paint_wall'] },
      base:   { label: '基层处理', opts: ['旧墙局部修补', '新墙满批', '铲除旧漆重做'], std: '旧墙局部修补', codes: ['skim'] }
    } },
    ceiling: { label: '天花', icon: '⬜', keys: {
      // 天花做法（马来西亚常见）：在「② 房间」逐间定；「平顶」「叠级+灯槽」沿用旧名，旧报价不受影响
      style: { scope: true, label: '天花做法', opts: CEIL_STYLES, std: '平顶', codes: ['plaster_ceiling', 'ceil_slat', 'ceil_alu'], packs: ['ceiling', 'bath_ceil'], noPrice: true },
      board: { label: '天花板材', opts: ['普通石膏板', '防潮石膏板', '硅酸钙板'], std: room => (room && ROOMS[room.type].wet ? '防潮石膏板' : '普通石膏板'), codes: ['plaster_ceiling'] },
      slat:  { label: '格栅材料', opts: ['铝合金木纹格栅', 'WPC 木塑格栅', '实木格栅'], std: '铝合金木纹格栅', codes: ['ceil_slat'] },
      alu:   { label: '铝扣板规格', opts: ['300×300 mm', '300×600 mm', '条形扣板'], std: '300×300 mm', codes: ['ceil_alu'] }
    } },
    cabinet: { label: '定制柜', icon: '🗄️', keys: {
      body:     { label: '柜体板材', opts: ['多层实木板', '防潮颗粒板', '铝合金'], std: '多层实木板', codes: CAB_CODES },
      door:     { label: '门板饰面', opts: ['双饰面', 'PET', '烤漆', '木皮'], std: '双饰面', codes: CAB_CODES },
      hardware: { label: '五金', opts: ['阻尼铰链+缓冲滑轨', 'Blum', 'Hettich', '悍高（HIGOLD）', 'DTC（东泰）'], std: '阻尼铰链+缓冲滑轨', codes: CAB_CODES },
      light:    { label: '柜内灯', opts: ['不做', '感应灯带'], std: '不做', codes: CAB_CODES },
      counter:  { label: '厨房台面', opts: ['石英石', '岩板', '花岗岩'], std: '石英石', codes: ['counter'] }
    } },
    // 浴室柜：成品/定制、材质这些可以整组卫生间一起定；尺寸每间单独填
    vanity: { label: '浴室柜', icon: '🪞', keys: {
      kind:   { scope: true, label: '浴室柜类型', opts: ['成品浴室柜', '定制浴室柜'], std: '成品浴室柜', codes: ['vanity', 'vanity_custom'], noPrice: true },
      body:   { label: '柜体材质', opts: ['PVC 防水板', '铝合金', '防潮多层实木板'], std: 'PVC 防水板', codes: ['vanity', 'vanity_custom'] },
      top:    { label: '台面与台盆', opts: ['陶瓷一体盆', '石英石台面 + 台下盆', '岩板台面 + 台下盆'], std: '陶瓷一体盆', codes: ['vanity', 'vanity_custom'] },
      mirror: { label: '镜子', opts: ['防雾镜', 'LED 智能镜', '镜柜'], std: '防雾镜', codes: ['mirror'] }
    } },
    demo: { label: '拆旧', icon: '⛏️', keys: {
      scope: { scope: true, label: '拆除范围', opts: ['地砖 + 墙砖全拆', '只拆地砖（墙砖保留）', '只拆墙砖（地砖保留）'], std: '地砖 + 墙砖全拆', codes: ['demo_floor', 'demo_wall_tile', 'demo_piece'], packs: ['bath_demo'], noPrice: true }
    } },
    wet: { label: '防水与墙砖', icon: '💧', keys: {
      wpHeight: { scope: true, label: '防水高度', opts: ['淋浴区 1.8 m + 其余上翻 30 cm', '淋浴区到顶 + 其余上翻 30 cm', '全部墙面到顶'], std: '淋浴区 1.8 m + 其余上翻 30 cm', codes: ['wp'], packs: ['bath_tile'], noPrice: true },
      wallTile: { scope: true, label: '墙砖铺到', opts: ['满墙到顶', '到吊顶下（约 8 尺）', '半墙 4 尺（上面刷漆）'], std: '满墙到顶', codes: ['wall_tile'], packs: ['bath_tile'], noPrice: true }
    } },
    stairs: { label: '楼梯', icon: '🪜', keys: {
      finish:    { scope: true, label: '踏步做法', opts: ['瓷砖踏步', '实木踏板', '石材踏步', '原踏步打磨油漆'], std: '瓷砖踏步', codes: STAIR_CODES, noPrice: true },
      rail:      { scope: true, label: '扶手栏杆做法', opts: Object.keys(RAIL_CODES), std: '不锈钢立柱 + 木扶手', codes: Object.values(RAIL_CODES), noPrice: true },
      stepLight: { scope: true, label: '踏步灯做法', opts: ['嵌墙踏步灯', '踏步下 LED 灯带', '人体感应踏步灯'], std: '嵌墙踏步灯', codes: ['stair_steplight', 'stair_steplight_sensor', 'led_strip'], packs: ['stair_step_light'], noPrice: true },
      wood:      { label: '木种', opts: ['菠萝格（Merbau）', '柚木', '橡木', '实木复合'], std: '菠萝格（Merbau）', codes: ['stair_wood', 'stair_wood_land'] },
      stone:     { label: '石材', opts: ['花岗岩', '大理石', '水磨石'], std: '花岗岩', codes: ['stair_stone', 'stair_stone_land'] },
      paint:     { label: '踏步油漆', opts: ['木器清漆', '地坪漆', '彩色水泥漆'], std: '木器清漆', codes: ['stair_paint', 'stair_paint_area'] },
      nosing:    { label: '防滑处理', opts: ['铝合金防滑条', '开防滑槽', '不做'], std: '铝合金防滑条', codes: ['stair_tread', 'stair_stone'] },
      railColor: { label: '栏杆颜色', opts: ['黑色', '白色', '木色', '不锈钢本色', '香槟金'], std: '黑色', codes: Object.values(RAIL_CODES), noPrice: true }
    } },
    // 阳光棚 / 阳光房 / 雨棚：马来西亚常见做法
    canopy: { label: '阳光棚/阳光房', icon: '⛱️', keys: {
      roof:  { label: '顶面材料', opts: ['阳光板（Polycarbonate）', '夹胶钢化玻璃', '铝合金隔热板（三明治板）', '金属浪板（Metal Deck）', '铝合金百叶（可调）'], std: '阳光板（Polycarbonate）', codes: ['awning'] },
      frame: { label: '框架', opts: ['镀锌钢（防锈漆）', '铝合金', '不锈钢'], std: '镀锌钢（防锈漆）', codes: ['awning', 'sunroom_wall'] },
      wall:  { label: '四周围合', opts: ['铝合金推拉窗', '铝合金折叠门', '固定玻璃 + 部分推拉', '无框玻璃'], std: '铝合金推拉窗', codes: ['sunroom_wall'] },
      glass: { label: '围合玻璃', opts: ['6 mm 钢化透明', '8 mm 钢化透明', '夹胶玻璃', '隔热 Low-E 玻璃', '茶色/灰色钢化玻璃'], std: '6 mm 钢化透明', codes: ['sunroom_wall'] },
      color: { label: '框架颜色', opts: ['黑色', '白色', '香槟', '灰色'], std: '黑色', codes: ['awning', 'sunroom_wall'], noPrice: true }
    } },
    soft: { label: '软装', icon: '🛋️', keys: {
      grade: { label: '软装档次', opts: ['经济', '中档', '高档'], std: '中档', codes: SOFT_CODES },
      style: { label: '风格', opts: ['现代简约', '奶油风', '北欧', '新中式', '轻奢', '侘寂/原木'], std: '现代简约', codes: SOFT_CODES, noPrice: true }
    } },
    shower: { label: '淋浴区', icon: '🚿', keys: {
      base:  { scope: true, label: '淋浴区地面', opts: ['瓷砖找坡 + 石材挡水条', '成品淋浴盘', '地面找坡（不做挡水）'], std: '瓷砖找坡 + 石材挡水条', codes: SCREEN_CODES, noPrice: true },
      type:  { scope: true, label: '隔断形式', opts: ['一字型', 'L 型', '钻石型', '浴帘杆（不做玻璃）'], std: '一字型', codes: SCREEN_CODES, noPrice: true },
      glass: { label: '玻璃', opts: ['8 mm 钢化透明', '10 mm 钢化透明', '8 mm 钢化磨砂', '8 mm 长虹玻璃'], std: '8 mm 钢化透明', codes: ['screen', 'screen_l', 'screen_diamond'] },
      frame: { label: '五金颜色', opts: ['不锈钢本色', '哑黑', '枪灰', '拉丝金'], std: '不锈钢本色', codes: ['screen', 'screen_l', 'screen_diamond'] }
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
  const GROUPS = [['demo', '拆旧'], ['floor', '地面'], ['wall', '墙面'], ['ceil', '天花'], ['mep', '水电'], ['wet', '防水与瓷砖'], ['fix', '洁具设备'], ['cab', '定制柜'], ['open', '门窗窗帘'], ['out', '户外'], ['soft', '软装家具']];
  const BIG_TILE = ['750×1500 mm', '900×1800 mm', '1200×1200 mm'];
  // [输入键, 名称, 单位, 价目编号, 默认数量]
  const HW = [['n', '碗碟拉篮（地柜抽拉）', '套', 'cab_basket', 1], ['spice', '调味拉篮（窄柜）', '套', 'hw_spice', 0], ['corner', '转角拉篮（小怪物/飞碟）', '套', 'hw_corner', 0],
    ['tall', '高身柜拉篮（储物高柜）', '套', 'hw_tall', 0], ['lift', '吊柜升降拉篮', '套', 'hw_lift', 0], ['rack', '吊柜碗碟沥水架', '套', 'hw_rack', 0],
    ['bin', '水槽柜垃圾桶拉出', '套', 'hw_bin', 0], ['cutlery', '抽屉刀叉餐具分隔盘', '个', 'hw_cutlery', 0], ['rice', '米箱', '个', 'hw_rice', 0], ['flap', '吊柜上翻门支撑（气撑/上翻器）', '套', 'hw_flap', 0]];
  const cabSqft = (label, icon, code, w, h, hw) => ({ g: 'cab', label, icon, ...(hw ? { wide: true } : {}),
    inputs: [{ k: 'w', label: '宽', unit: '尺', def: w }, { k: 'h', label: '高', unit: '尺', def: h }, ...(hw || []).map(([k, l, u, , d]) => ({ k, label: l, unit: u, def: () => d, opt: true }))],
    lines: (r, g, v, picked, sp) => [[code, r2(v.w * v.h), `宽 ${v.w} × 高 ${v.h}`], ...(sp('cabinet', 'light') === '感应灯带' ? [['led_strip', v.w, '柜内灯带 = 柜宽']] : []), ...(hw || []).map(([k, l, , c]) => [c, num(v[k]), l])] });
  // 衣柜功能配件：每种填数量，0 = 不要（挂衣杆、层板、普通抽屉已含在衣柜单价里）
  const WHW = [['pants', '抽拉裤架', '个', 'whw_pants', 0], ['basket', '抽拉衣物拉篮', '个', 'whw_basket', 0], ['lift', '下拉升降衣架', '个', 'whw_lift', 0],
    ['mirror', '柜内旋转/推拉镜', '个', 'whw_mirror', 0], ['jewel', '首饰/领带格抽屉', '个', 'whw_jewel', 0], ['shoe', '抽拉鞋架', '个', 'whw_shoe', 0], ['safe', '保险箱位（含加固）', '个', 'whw_safe', 0]];
  const tileExtra = (sp, area) => (BIG_TILE.includes(sp('tile', 'floorSize')) ? [['big_tile_extra', area, '大板砖铺贴加价']] : []);
  const PACKS = {
    demo_floor:     { g: 'demo', area: ['floor'], label: '拆旧地砖', icon: '⛏️', lines: (r, g) => [['demo_floor', g.floor, '拆除面积']] },
    demo_skin:      { g: 'demo', area: ['wall'], label: '铲旧墙皮', icon: '🧽', lines: (r, g) => [['demo_skin', g.wall, '墙面面积']] },
    demo_wall_tile: { g: 'demo', area: ['wall'], label: '拆旧墙砖', icon: '⛏️', lines: (r, g) => [['demo_wall_tile', g.wall, '墙砖面积']] },
    demo_ceiling:   { g: 'demo', area: ['floor'], label: '拆旧天花', icon: '⛏️', lines: (r, g) => [['demo_ceiling', g.floor, '旧天花面积']] },
    // 卫生间拆旧：每间拆的范围、面积、旧洁具件数可能不同（组页面每间单独填）
    bath_demo:      { g: 'demo', area: ['floor', 'wall'], label: '拆旧（地砖+墙砖+洁具）', icon: '⛏️', perRoom: true,
                      inputs: [{ k: 'pcs', label: '旧洁具件数', unit: '件', def: () => 3, opt: true }],
                      lines: (r, g, v, picked, sp) => { const sc = sp('demo', 'scope');
                        return [...(sc !== '只拆墙砖（地砖保留）' ? [['demo_floor', g.floor, '地面']] : []), ...(sc !== '只拆地砖（墙砖保留）' ? [['demo_wall_tile', g.wall, '墙面']] : []), ['demo_piece', v.pcs, '旧马桶/面盆/花洒等']]; } },

    floor:          { g: 'floor', area: ['floor'], label: '地面翻新', icon: '🟫', hint: '材料在「④ 选材」定',
                      lines: (r, g, v, picked, sp) => sp('tile', 'material') === '瓷砖'
                        ? [['screed', g.floor, '地面找平'], ['floor_tile', g.floor, '地面'], ['grout', g.floor, '= 地砖面积'], ['skirting', g.skirt, '周长 − 门宽'], ...tileExtra(sp, g.floor)]
                        // SPC 和强化复合木地板分开定价
                        : [[sp('tile', 'material') === '强化复合木地板' ? 'wood_floor' : 'laminate', g.floor, '地面'], ['skirting', g.skirt, '周长 − 门宽']] },
    wall_finish:    { g: 'wall', area: ['wall'], label: '墙面翻新', icon: '🖌️', hint: '做法在「④ 选材」定',
                      lines: (r, g, v, picked, sp) => {
                        // 厨房贴了操作区墙砖的部分不再批灰刷漆
                        const tiled = picked.kitchen_tile ? r2(packValues(r, 'kitchen_tile', g).back * 2.5) : 0, a = r2(Math.max(0, g.wall - tiled)), f = tiled ? `墙面 − 操作区墙砖 ${tiled}` : '墙面';
                        return [['skim', a, f], [{ '乳胶漆': 'paint_wall', '墙纸': 'wallpaper', '艺术漆': 'art_paint' }[sp('wall', 'method')], a, f]];
                      } },
    ceiling:        { g: 'ceil', area: ['floor'], label: '天花吊顶', icon: '⬜', hint: '平顶、L-box、叠级、格栅、铝扣板等做法选上后在卡片里定；窗帘盒随「窗帘」自动加',
                      lines: (r, g, v, picked, sp) => ceilLines(g, v, sp('ceiling', 'style')) },
    ceil_paint:     { g: 'ceil', area: ['floor'], label: '天花重刷（不吊顶）', icon: '🖌️', lines: (r, g) => [['paint_ceiling', g.floor, '天花面积']] },
    cornice:        { g: 'ceil', label: '石膏线', icon: '〰️', lines: (r, g) => [['cornice', g.perim, '= 周长']] },
    bath_ceil:      { g: 'ceil', area: ['floor'], label: '防潮天花', icon: '⬜', lines: (r, g, v, picked, sp) => ceilLines(g, v, sp('ceiling', 'style')) },

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
    // 卫生间防水+铺贴：防水做多高、墙砖铺多高、壁龛、腰线每间可能不同（组页面每间单独填）
    bath_tile:      { g: 'wet', area: ['floor', 'wall'], label: '防水+地砖+墙砖', icon: '🧱', perRoom: true,
                      inputs: [{ k: 'niche', label: '壁龛', unit: '个', def: () => 0, opt: true }, { k: 'border', label: '腰线/花砖', unit: '延尺', def: () => 0, opt: true }],
                      lines: (r, g, v, picked, sp) => {
                        const wpH = sp('wet', 'wpHeight'), wt = sp('wet', 'wallTile'), H = g.H || 9;
                        const wp = wpH === '全部墙面到顶' ? [r2(g.floor + g.wall), '地面 + 全部墙面'] : wpH === '淋浴区到顶 + 其余上翻 30 cm' ? [r2(g.floor + g.perim + 6 * H), `地面 + 周长×上翻1尺 + 淋浴区墙 6×${H} 到顶`] : [r2(g.floor + g.perim + 36), '地面 + 周长×上翻1尺 + 淋浴区墙 6×6'];
                        const tileH = wt === '半墙 4 尺（上面刷漆）' ? 4 : wt === '到吊顶下（约 8 尺）' ? Math.min(8, H) : H, wallTile = r2(g.wall * Math.min(1, tileH / H));
                        return [['wp', wp[0], wp[1]], ['flood_test', 1, '做防水就要闭水'], ['slope', g.floor, '往地漏找坡'], ['floor_tile', g.floor, '地面'], ['wall_tile', wallTile, tileH >= H ? '满墙到顶' : `铺到 ${tileH} 尺高`], ['grout', r2(g.floor + wallTile), '地砖+墙砖'],
                          ...(wt === '半墙 4 尺（上面刷漆）' ? [['paint_wall', r2(g.wall - wallTile), '4 尺以上墙面刷防潮漆']] : []),
                          ['drain', 2, '淋浴区 + 干区'], ['threshold', g.doors, '每个门口一条挡水'], ['niche', v.niche, '淋浴区墙内壁龛'], ['tile_border', v.border, '腰线/花砖'], ...tileExtra(sp, g.floor)]; } },
    wet_tile:       { g: 'wet', area: ['floor'], label: '防水+地砖', icon: '🧱',
                      lines: (r, g, v, picked, sp) => [['wp', g.floor, '地面'], ['flood_test', 1, '做防水就要闭水'], ['slope', g.floor, '往地漏找坡'], ['floor_tile', g.floor, '地面'], ['grout', g.floor, '= 地砖面积'], ['drain', 1, '地漏'], ...tileExtra(sp, g.floor)] },
    bath_move:      { g: 'wet', area: ['floor'], label: '改马桶/排水位置', icon: '↔️', lines: (r, g) => [['bath_drop', g.floor, '改位置要降板+二次排水']] },

    sanitary:       { g: 'fix', label: '洁具（马桶+花洒+排风）', icon: '🚽', lines: () => [['toilet', 1, ''], ['shower', 1, ''], ['exhaust', 1, '卫生间必配'], ['bath_acc', 1, '毛巾架/纸巾架/挂钩']] },
    // 淋浴区：每间尺寸不同，单独填；淋浴盘/挡水、隔断形式、玻璃、五金颜色可整组一起定，也可每间不同
    shower_area:    { g: 'fix', label: '淋浴区（淋浴盘/挡水 + 玻璃隔断）', icon: '🚿', perRoom: true,
                      inputs: [{ k: 'w', label: '淋浴区宽', unit: 'cm', def: () => 90 }, { k: 'd', label: '淋浴区深', unit: 'cm', def: () => 90 }, { k: 'h', label: '隔断高', unit: 'cm', def: () => 200 }],
                      lines: (r, g, v, picked, sp) => { const type = sp('shower', 'type'), base = sp('shower', 'base'), size = `宽 ${v.w} × 深 ${v.d} cm`;
                        return [...(base === '成品淋浴盘' ? [['shower_tray', 1, size]] : []),
                          type === '浴帘杆（不做玻璃）' ? ['curtain_rod', 1, '宽 ' + v.w + ' cm'] : [{ '一字型': 'screen', 'L 型': 'screen_l', '钻石型': 'screen_diamond' }[type] || 'screen', 1, `${type}，宽 ${v.w} × 深 ${v.d} × 高 ${v.h} cm`]]; } },
    // 浴室柜：每间填自己的尺寸（cm），报价单上逐间列出尺寸；定制的按柜宽（延尺）计价
    vanity:         { g: 'fix', label: '浴室柜+镜子', icon: '🪞', perRoom: true,
                      inputs: [{ k: 'w', label: '柜宽', unit: 'cm', def: () => 80 }, { k: 'd', label: '柜深', unit: 'cm', def: () => 48 }, { k: 'h', label: '柜高', unit: 'cm', def: () => 85 }],
                      lines: (r, g, v, picked, sp) => { const size = `宽 ${v.w} × 深 ${v.d} × 高 ${v.h} cm`;
                        return [sp('vanity', 'kind') === '定制浴室柜' ? ['vanity_custom', r2(num(v.w) / 30.48), size + '，按柜宽计'] : ['vanity', 1, size], ['mirror', 1, '宽度配合浴室柜']]; } },
    rack:           { g: 'fix', label: '晾衣架', icon: '👕', lines: () => [['rack', 1, '']] },

    cabinets:       { g: 'cab', label: '橱柜（地柜+吊柜+台面）', icon: '🗄️',
                      inputs: [{ k: 'low', label: '地柜长度', unit: '尺', def: (r, g) => r2(g.L + g.W - 3) }, { k: 'up', label: '吊柜长度', unit: '尺', def: (r, g) => r2(g.L) }],
                      lines: (r, g, v, picked, sp) => [['cab_low', v.low, '地柜长度'], ['counter', v.low, '= 地柜长度'], ['cab_up', v.up, '吊柜长度'], ['sink', 1, '厨房必配'], ['hood', 1, '烟机灶具安装'], ...(sp('cabinet', 'light') === '感应灯带' ? [['led_strip', v.up, '吊柜底灯带 = 吊柜长度']] : [])] },
    // 橱柜功能五金：每种填数量，0 = 不要；碗碟拉篮沿用原「拉篮」编号和数量
    cab_basket:     { g: 'cab', label: '橱柜功能五金', icon: '🧺', wide: true, inputs: HW.map(([k, label, unit, , d]) => ({ k, label, unit, def: () => d, opt: true })),
                      lines: (r, g, v) => HW.map(([k, label, , code]) => [code, num(v[k]), label]) },
    wardrobe:       cabSqft('衣柜', '🚪', 'wardrobe', (r, g) => r2(Math.min(g.L, g.W) - 2), () => 8, WHW),
    tv_cab:         cabSqft('电视柜/背景墙', '📺', 'tv_cab', () => 8, () => 3),
    altar:          cabSqft('神龛/神台柜', '🗄️', 'altar_cab', () => 4, () => 7),
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

    // 楼梯踏步：做法（瓷砖 / 实木踏板 / 石材 / 原踏步油漆）在房间里定，材料（木种、石材、防滑）到「④ 选材」
    stair_tile:     { g: 'floor', label: '楼梯踏步', icon: '🪜', perRoom: true,
                      inputs: [{ k: 'n', label: '踏步', unit: '级', def: () => 18 }, { k: 'w', label: '楼梯宽', unit: '尺', def: () => 3.5 }, { k: 'land', label: '休息平台', unit: '平方尺', def: () => 0, opt: true }],
                      lines: (r, g, v, picked, sp) => { const f = sp('stairs', 'finish'), c = { '实木踏板': 'stair_wood', '石材踏步': 'stair_stone', '原踏步打磨油漆': 'stair_paint' }[f] || 'stair_tread';
                        return [[c, v.n, `${f}，${v.n} 级 × 宽 ${v.w} 尺`], ...(num(v.land) > 0 ? [[c === 'stair_tread' ? 'floor_tile' : c === 'stair_paint' ? 'stair_paint_area' : c + '_land', v.land, '休息平台']] : [])]; } },
    stair_rail:     { g: 'open', label: '楼梯扶手/栏杆', icon: '🪜', perRoom: true,
                      inputs: [{ k: 'len', label: '扶手长度', unit: '尺', def: (r, g) => r2(g.L + 3) }, { k: 'top', label: '楼上走廊护栏', unit: '尺', def: () => 0, opt: true }],
                      lines: (r, g, v, picked, sp) => { const t = sp('stairs', 'rail'), c = RAIL_CODES[t] || 'stair_rail';
                        return [[c, v.len, `${t}，楼梯段`], [c, v.top, `${t}，楼上走廊护栏`]]; } },
    // 踏步灯：要不要做是一个单独项目；做的话选嵌墙灯 / 踏步下灯带 / 感应灯
    stair_step_light: { g: 'mep', label: '踏步灯', icon: '💡', perRoom: true,
                      inputs: [{ k: 'n', label: '踏步灯', unit: '个', def: () => 6 }],
                      lines: (r, g, v, picked, sp) => { const t = sp('stairs', 'stepLight'), sv = (r.vals && r.vals.stair_tile) || {}, steps = num(sv.n) || 18, w = num(sv.w) || 3.5;
                        return t === '踏步下 LED 灯带' ? [['led_strip', r2(steps * w), `每级踏步下 × 楼梯宽（${steps} 级 × ${w} 尺）`]] : [[t === '人体感应踏步灯' ? 'stair_steplight_sensor' : 'stair_steplight', v.n, t]]; } },
    stair_light:    { g: 'mep', label: '楼梯灯（上下双控）', icon: '💡', inputs: [{ k: 'n', label: '灯', unit: '套', def: () => 2 }], lines: (r, g, v) => [['stair_light', v.n, '套数']] },
    scaffold:       { g: 'demo', label: '挑空/高处脚手架', icon: '🏗️', inputs: [{ k: 'n', label: '处数', unit: '处', def: () => 1 }], lines: (r, g, v) => [['scaffold', v.n, '处数']] },
    porch_tile:     { g: 'out', area: ['floor'], label: '防滑地砖', icon: '🟫', lines: (r, g, v, picked, sp) => [['screed', g.floor, '地面找平'], ['porch_tile', g.floor, '地面'], ...tileExtra(sp, g.floor)] },
    drain_ch:       { g: 'out', label: '排水沟', icon: '〰️', inputs: [{ k: 'len', label: '排水沟长度', unit: '尺', def: (r, g) => g.W }], lines: (r, g, v) => [['drain_ch', v.len, '排水沟长度']] },
    // 阳光棚只做顶；阳光房是顶 + 四周玻璃围合。面积、围合长度和高度每家不同，现场量；顶面、框架、玻璃到「④ 选材」
    sun_canopy:     { g: 'out', label: '阳光棚（只做顶）', icon: '⛱️', hint: '封顶挡雨遮阳，四周不封；可能要物业/市政同意',
                      inputs: [{ k: 'area', label: '顶棚面积', unit: '平方尺', def: (r, g) => g.floor }], lines: (r, g, v) => [['awning', v.area, '顶棚面积']] },
    sunroom:        { g: 'out', label: '阳光房（顶 + 四周玻璃）', icon: '🏡', hint: '顶棚 + 玻璃围合成半室内空间；一般要物业/市政同意',
                      inputs: [{ k: 'area', label: '顶面面积', unit: '平方尺', def: (r, g) => g.floor }, { k: 'len', label: '玻璃围合长度', unit: '尺', def: (r, g) => r2(g.L + 2 * g.W) }, { k: 'h', label: '围合高度', unit: '尺', def: (r, g) => g.H || 9 }],
                      lines: (r, g, v) => [['awning', v.area, '顶面面积'], ['sunroom_wall', r2(v.len * v.h), `玻璃围合 ${v.len} 尺 × 高 ${v.h} 尺`]] },
    // 车廊上的棚叫「车棚」：做法、材料和雨棚一样（同一个价目编号），只是名称不同
    carport:        { g: 'out', label: '车棚', icon: '⛱️', inputs: [{ k: 'area', label: '车棚面积', unit: '平方尺', def: (r, g) => g.floor }], lines: (r, g, v) => [['awning', v.area, '车棚面积']] },
    soft_living:    softPack('客厅软装', SOFT.living),
    soft_dining:    softPack('餐厅软装', SOFT.dining),
    soft_bed:       softPack('卧室软装', SOFT.bed),
    soft_study:     softPack('书房软装', SOFT.study),
    soft_out:       softPack('户外软装', SOFT.out),
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
    { k: 'extension', landed: true, grp: 'out', label: '加建/扩建（地基+砌墙+屋顶）', icon: '🏗️', why: '会自动加上扩建图纸及市政局申请；已经按房间加了「加建空间」的不要在这里重复', inputs: [{ k: 'area', label: '加建面积', unit: '平方尺', def: () => 100 }], lines: v => [['extension', v.area, '加建面积']] },
    { k: 'awning', landed: true, grp: 'out', label: '雨棚', icon: '⛱️', inputs: [{ k: 'area', label: '雨棚面积', unit: '平方尺', def: () => 200 }], lines: v => [['awning', v.area, '雨棚面积']] },
    { k: 'roof_fix', landed: true, grp: 'out', label: '屋顶补漏', icon: '🏠', inputs: [{ k: 'n', label: '漏点', unit: '处', def: () => 1 }], lines: v => [['roof_fix', v.n, '漏点处数']] },
    { k: 'ext_paint', landed: true, grp: 'out', label: '外墙油漆', icon: '🎨', inputs: [{ k: 'area', label: '外墙面积', unit: '平方尺', def: () => 1500 }], lines: v => [['ext_paint', v.area, '外墙面积']] },
    { k: 'downpipe', landed: true, grp: 'out', label: '换雨水管', icon: '🌧️', inputs: [{ k: 'len', label: '长度', unit: '尺', def: () => 40 }], lines: v => [['downpipe', v.len, '雨水管长度']] },
    { k: 'fence', landed: true, grp: 'out', label: '围墙/栏杆', icon: '🧱', inputs: [{ k: 'len', label: '长度', unit: '尺', def: () => 40 }], lines: v => [['fence', v.len, '围墙长度']] },
    { k: 'termite', landed: true, grp: 'struct', label: '白蚁防治', icon: '🐜', why: '有地房屋拆地面、加建、木作多时建议做', inputs: [{ k: 'area', label: '处理面积', unit: '平方尺', def: () => 1000 }], lines: v => [['termite', v.area, '处理面积']] },
    { k: 'roro', grp: 'struct', label: '大垃圾箱租用（RORO bin）', icon: '🗑️', why: '大拆大改时代替按车清运；选了会提醒去掉自动的「建筑垃圾清运」', inputs: [{ k: 'n', label: '箱数', unit: '个', def: () => 1 }], lines: v => [['roro_bin', v.n, '箱数']] },
    { k: 'insurance', grp: 'struct', label: '工程保险（CAR）', icon: '🛡️', why: '工程一切险，客户或物业要求时购买', lines: () => [['car_insurance', 1, '']] },
    { k: 'drain_ch', landed: true, grp: 'out', label: '户外排水沟', icon: '〰️', inputs: [{ k: 'len', label: '长度', unit: '尺', def: () => 40 }], lines: v => [['drain_ch', v.len, '排水沟长度']] }
  ];
  // 手动增项：价目表没有的项目，员工自己填名称、单位、数量、单价和归属阶段
  const EXTRA_UNITS = ['项', '平方尺', '延尺', '个', '套', '樘', '处'];

  // 自动收的杂项（可对某单免收）
  const AUTO_FEES = ['setout', 'protect', 'permit', 'pipe_test', 'carry_up', 'waste_out', 'clean'];
  // contRate = 不可预见费 %（默认 0 不收）
  const SETTINGS = { designRate: 8, mgmtRate: 6, contRate: 0, sst: 0, pay: [['签约定金', 30], ['水电隐蔽验收通过', 30], ['泥水瓷砖验收通过', 30], ['竣工验收交付', 10]] };

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
    // 门：新版逐樘记录（doorList，每樘 位置/宽/高），旧数据只有门数（doors）
    const dl = Array.isArray(room.doorList) ? room.doorList : null;
    const L = num(room.L), W = num(room.W), H = num(room.H) || num(house && house.H) || 9, doors = dl ? dl.length : Math.max(0, Math.round(num(room.doors)));
    const doorA = dl ? r2(dl.reduce((t, x) => t + ((num(x.w) * num(x.h)) || 21), 0)) : doors * 21, doorW = dl ? r2(dl.reduce((t, x) => t + (num(x.w) || 3), 0)) : doors * 3;
    const wins = (room.windows || []).map(x => ({ w: num(x.w), h: num(x.h) }));
    const winW = r2(wins.reduce((t, x) => t + x.w, 0)), winA = r2(wins.reduce((t, x) => t + x.w * x.h, 0));
    const floor = r2(L * W), perim = r2(2 * (L + W));
    const wall = r2(Math.max(0, perim * H - doorA - winA));
    const skirt = r2(Math.max(0, perim - doorW));
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
    const base = mat + aux + lab, spec = [], tbdKeys = [], priceTbd = [], ref = [];
    let tile = null, supplied = false;
    const variantMode = TILE_CODES.includes(code); // 新报价一律按规格片价；缺价明确待定，避免套用旧面积砖材价
    if (P[code].ref && !(project.prices && project.prices[code])) ref.push(P[code].name);
    specKeysFor(code, pack).forEach(([cat, k, key]) => {
      const s = specOf(project, room, cat, k, planId, pack);
      spec.push(s.v);
      if (!s.decided && !key.scope) tbdKeys.push(cat);
      if (TILE_CODES.includes(code) && cat === 'tile' && (k === 'floorSize' || k === 'wallSize')) {
        // 砖材只按「尺寸＋表面」片价算；尺寸行只管铺贴：大砖辅料/人工比标准多多少（公司填了才加）
        if (variantMode) { if (s.v !== stdOf(key, room)) { const add = OPTION_PRICES[`${cat}.${k}.${s.v}`]?.[code]; if (add) { aux += num(add.aux); lab += num(add.lab); } } return; }
        const id = `${cat}.${k}.${s.v}@${code}`, price = TILE_PIECE_PRICES[id];
        const dims = s.v.match(/^(\d+)×(\d+) mm$/);
        if (dims && price !== undefined && Number.isFinite(Number(price))) {
          tile = { size: s.v, width: +dims[1], height: +dims[2], price: +price, waste: num(p.waste) };
          mat = 0;
          return;
        }
      }
      if (key.noPrice || s.v === stdOf(key, room)) return;
      const mod = key.mod && key.mod[s.v];
      if (mod && mod.matZero) { mat = 0; supplied = true; return; }
      const add = OPTION_PRICES[`${cat}.${k}.${s.v}`]?.[code];
      if (add) { mat += num(add.mat); aux += num(add.aux); lab += num(add.lab); }
      // 公司没填价差：有参考百分比就先按参考价算，并标「参考价」
      else if (OPTION_REF[`${cat}.${k}.${s.v}`] !== undefined) { mat += base * OPTION_REF[`${cat}.${k}.${s.v}`] / 100; ref.push(`${key.label}：${s.v}`); }
      else priceTbd.push(`${key.label}：${s.v}`);
    });
    if (variantMode) {
      const sizeKey = code === 'wall_tile' ? 'wallSize' : 'floorSize', finishKey = code === 'wall_tile' ? 'wallFinish' : 'finish';
      const size = specOf(project, room, 'tile', sizeKey, planId, pack).v;
      const finish = specOf(project, room, 'tile', finishKey, planId, pack).v;
      const dims = size.match(/^(\d+)×(\d+) mm$/), own = TILE_PIECE_PRICES[`tile.size.${size}.${finish}`] ?? TILE_PIECE_PRICES[`tile.${sizeKey}.${size}.${finish}@${code}`];
      // 公司没填片价：先用市场参考片价，并标「参考价」
      const price = own ?? TILE_PIECE_REF[`tile.size.${size}.${finish}`];
      if (own === undefined && price !== undefined && !supplied) ref.push(`${size} · ${finish} 砖材片价`);
      mat = 0;
      if (!supplied && dims && price !== undefined && Number.isFinite(Number(price))) tile = { size, finish, width: +dims[1], height: +dims[2], price: +price, waste: num(p.waste), splitPricing: true };
      else if (!supplied) priceTbd.push(`${P[code].name}：${size} · ${finish} 砖材片价`);
    }
    const areaUnit = P[code].unit === '平方尺' && !!P[code].companyPrice;
    return { unit: areaUnit ? r4(mat + aux + lab) : r2(mat + aux + lab), lab: areaUnit ? r4(lab) : r2(lab), matUnit: mat, layUnit: aux + lab, customerSupplied: supplied, tile: supplied ? null : tile, splitPricing: variantMode, spec: spec.join(' · '), tbd: [...new Set(tbdKeys)], priceTbd, ref };
  }
  const roomLabel = (room, project) => (levelsOf(project) > 1 ? `${room.level || 1}楼 · ` : '') + room.name;
  const levelsOf = project => Math.max(1, ...project.rooms.map(r => r.level || 1));

  function buildLines(project, planId) {
    const lines = [];
    const push = (room, code, qty, formula, from, pack, item) => {
      qty = r2(num(qty));
      if (!(qty > 0) || !P[code]) return;
      let unit, lab = 0, matUnit = 0, layUnit = 0, customerSupplied = false, tile = null, splitPricing = false, spec = '', tbd = [], priceTbd = [], ref = [];
      if (item) unit = r2(num(item.price));
      else ({ unit, lab, matUnit, layUnit, customerSupplied, tile, splitPricing, spec, tbd, priceTbd, ref } = pricedLine(project, room, code, pack, planId));
      let total = Math.round(qty * unit);
      if (tile) {
        const tileArea = tile.width * tile.height / 1000000;
        tile.areaM2 = r2(qty / 10.7639);
        tile.theoretical = qty / 10.7639 / tileArea;
        // 报价面积已四舍五入到 0.01 平方尺；允许这半格的测量误差，避免整数边界多算一片。
        const roundingTolerance = 0.005 / 10.7639 / tileArea * (1 + tile.waste / 100) + 1e-9;
        tile.pieces = Math.max(1, Math.ceil(tile.theoretical * (1 + tile.waste / 100) - roundingTolerance));
        tile.materialTotal = r2(tile.pieces * tile.price);
        tile.areaTotal = r2(qty * unit);
        total = Math.round(tile.materialTotal + tile.areaTotal);
        unit = r2((tile.materialTotal + tile.areaTotal) / qty);
      }
      lines.push({ roomId: room ? room.id : null, room: room ? roomLabel(room, project) : '全屋', code, pack, name: item ? (String(item.name || '').trim() || P[code].name) : P[code].name, unitName: (item && item.unit) || P[code].unit, stage: (item && item.stage) || P[code].stage, qty, formula, from, unit, total, tile, splitPricing, matUnit, layUnit, customerSupplied, spec, tbd, priceTbd, ref, custom: !!item, unpriced: item ? !(unit > 0) : !!P[code].unpriced && !(unit > 0) });
      // 赠送：这间这一项照常列出、写明原价，但不收钱
      const last = lines[lines.length - 1];
      // 送产品不送人工：材料+辅料（含损耗）免收，人工安装照收
      if (room && room.gift && room.gift[code] && !item) { last.gift = true; last.labUnit = lab; last.total = Math.round(qty * lab); last.giftValue = total - last.total; }
    };
    const anyWork = project.rooms.some(r => (r.packs || []).length) || Object.keys(project.house || {}).some(k => project.house[k] && project.house[k].on) || (project.extras || []).length > 0;
    // 自动收的杂项：在「③ 全屋 → 收费」里逐项列出，员工可以对某单免收（project.waive）
    // 数量可手动改（project.feeQty），单价可手动改（project.prices，和价目表改价同一处）
    const auto = (code, qty, f, from) => {
      if ((project.waive || {})[code]) return;
      const mq = (project.feeQty || {})[code];
      if (mq !== undefined && mq !== '') push(null, code, num(mq), `手动填写（自动算 ${r2(qty)}）`, from); else push(null, code, qty, f, from);
    };
    // 成品保护按施工房间地面面积算（平方尺）
    if (anyWork) { auto('setout', 1, '每单必做', '全屋'); auto('protect', Math.max(1, r2(project.rooms.filter(r => !ROOMS[r.type].outdoor && (r.packs || []).length).reduce((t, r) => t + geo(r, project).floor, 0))), '施工房间地面面积合计', '全屋'); }
    if (anyWork && HOUSES[project.houseType] && !HOUSES[project.houseType].landed) auto('permit', 1, '公寓有管理处，装修要先申请', '全屋');
    project.rooms.forEach(room => {
      const g = geo(room, project), picked = {};
      (room.packs || []).forEach(c => { picked[c] = true; });
      (room.packs || []).forEach(code => {
        const pk = PACKS[code]; if (!pk) return;
        const sp = (cat, k) => specOf(project, room, cat, k, planId, code).v;
        const v = packValues(room, code, g), g2 = { ...g };
        (pk.area || []).forEach(k => { g2[k] = v[k]; });
        // 每一行数量都能在「④ 选材」明细里直接改（room.lineQty，键 = 工项:编号:第几次出现）
        const seen = {};
        pk.lines(room, g2, v, picked, sp).forEach(([c, q, f, it]) => {
          const key = `${code}:${c}:${seen[c] = (seen[c] || 0) + 1}`, ov = room.lineQty && room.lineQty[key], n = lines.length;
          if (ov !== undefined && ov !== '' && !it) push(room, c, num(ov), `手动改（自动算 ${r2(num(q))}）`, pk.label, code, it); else push(room, c, q, f, pk.label, code, it);
          if (lines.length > n) { lines[n].lq = key; lines[n].lqAuto = r2(num(q)); }
        });
      });
    });
    // 加建：标了「加建」的房间按地面面积加结构；整单只申请一次准证
    project.rooms.forEach(room => { if (room.ext) push(room, 'extension', geo(room, project).floor, '加建面积 = 这间地面面积', '加建结构'); });
    const hs = project.house || {};
    HOUSE_ITEMS.forEach(item => { const q = hs[item.k]; if (q && q.on) item.lines(houseValues(q, item)).forEach(([c, qty, f]) => push(null, c, qty, f, item.label)); });
    // 人工增加项：挂在某个房间（roomId）或全屋
    if (project.rooms.some(r => r.ext) || (hs.extension && hs.extension.on)) push(null, 'ext_permit', 1, '有加建就要先申请批准（整单一次）', '加建');
    (project.extras || []).forEach(x => push(project.rooms.find(r => r.id === x.roomId) || null, 'custom_item', x.qty, '人工增加', '人工增加项', 'extra', x));
    const indoor = project.rooms.filter(r => !ROOMS[r.type].outdoor);
    const worked = indoor.filter(r => (r.packs || []).length);
    const waterPts = lines.filter(l => l.code === 'water_pt').reduce((t, l) => t + l.qty, 0);
    if (waterPts > 0) auto('pipe_test', 1, `全屋 ${waterPts} 个水点位，封槽前必须打压`, '自动');
    const upQty = worked.filter(r => (r.level || 1) > 1).reduce((t, r) => t + geo(r, project).floor * ((r.level || 1) - 1), 0);
    if (upQty > 0) auto('carry_up', upQty, '楼上施工房间面积 × 楼层', '自动');
    if (anyWork) {
      const sum = cs => lines.filter(l => cs.includes(l.code)).reduce((t, l) => t + l.qty, 0);
      const demoArea = sum(['demo_floor', 'demo_skin', 'demo_wall_tile', 'demo_ceiling']), wallArea = sum(['demo_wall']), pieces = sum(['demo_piece']);
      // 砸墙渣土最重：每 100 平方尺 1 车（同旧版）
      auto('waste_out', 1 + ceil(demoArea / 400) + ceil(wallArea / 100) + ceil(pieces / 10), `基础 1 车 + 铲除面积 ${r2(demoArea)}÷400 + 砸墙 ${r2(wallArea)}÷100 + 旧件 ${pieces}÷10（进位）`, '自动');
      auto('clean', worked.reduce((t, r) => t + geo(r, project).floor, 0), '施工房间地面面积合计', '自动');
    }
    return lines;
  }

  function totals(project, lines) {
    const direct = lines.reduce((t, l) => t + l.total, 0);
    const s = { ...SETTINGS, ...(project.settings || {}) };
    // 设计费只按「有施工的室内房间」面积算：只做客厅就不收全屋设计费
    const floorSum = project.rooms.filter(r => !ROOMS[r.type].outdoor && (r.packs || []).length).reduce((t, r) => t + geo(r, project).floor, 0);
    const design = project.design === false ? 0 : Math.round(floorSum * num(s.designRate));
    // 软装（stage soft：家具、灯饰、配饰、窗帘）按产品价收，不收管理费和不可预见费
    const soft = lines.filter(l => l.stage === 'soft').reduce((t, l) => t + l.total, 0), hard = direct - soft;
    const mgmt = Math.round(hard * num(s.mgmtRate) / 100), cont = Math.round(hard * num(s.contRate) / 100);
    const before = direct + design + mgmt + cont;
    const discount = Math.min(Math.round(num(project.discount)), before);
    const sst = Math.round((before - discount) * num(s.sst) / 100);
    const total = before - discount + sst;
    const byStage = STAGES.map(st => ({ ...st, total: lines.filter(l => l.stage === st.id).reduce((t, l) => t + l.total, 0) })).filter(x => x.total > 0);
    let paid = 0;
    const pay = s.pay.map(([name, pct], i, a) => { const amt = i === a.length - 1 ? total - paid : Math.round(total * pct / 100); paid += amt; return { name, pct, amt }; });
    const gift = lines.reduce((t, l) => t + (l.gift ? l.giftValue : 0), 0);
    return { direct, hard, soft, design, mgmt, cont, discount, gift, sst, total, floorSum: r2(floorSum), byStage, pay, settings: s };
  }

  // 一个房间里要定选材的「位置」：每个选了的范围项目是一个位置，只列出当前真正用到的选项
  const PLACE_LABEL = { floor: '地面', wall_finish: '墙面', ceiling: '天花', bath_ceil: '天花', kitchen_tile: '地砖与墙砖', bath_tile: '防水与瓷砖', bath_demo: '拆旧', vanity: '浴室柜与镜子', shower_area: '淋浴区', wet_tile: '地砖', porch_tile: '地砖', electric: '灯具', cabinets: '橱柜与台面', stair_tile: '楼梯踏步', stair_rail: '扶手栏杆', stair_step_light: '踏步灯', sun_canopy: '阳光棚', sunroom: '阳光房', awning: '雨棚', carport: '车棚', soft_living: '客厅软装', soft_dining: '餐厅软装', soft_bed: '卧室软装', soft_study: '书房软装', soft_out: '户外软装' };
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
  // 阳台各家开口不同（栏杆、推拉门、实墙几面），按墙面面积算的项目要员工现场量好填实际面积，不能用默认四面墙
  const wallUnconfirmed = room => (ROOMS[room.type].confirmWall ? (room.packs || []).filter(c => PACKS[c] && (PACKS[c].area || []).includes('wall') && !(room.vals && room.vals[c] && room.vals[c].wall !== undefined && room.vals[c].wall !== '')) : []);
  function checks(project, lines, mode) {
    const red = [], yellow = [];
    if (!project.houseType) red.push({ m: '还没选房屋类型', go: 'house' });
    if (!project.rooms.length) red.push({ m: '还没有房间', go: 'house' });
    project.rooms.forEach(room => {
      const g = geo(room, project), label = roomLabel(room, project), packs = room.packs || [];
      if (!(g.L > 0 && g.W > 0)) red.push({ m: `「${label}」请填写长和宽`, go: room.id });
      else if (!room.measured && packs.length) (mode === 'formal' ? red : yellow).push({ m: `「${label}」尺寸还是默认值，${mode === 'formal' ? '请现场量好后点「尺寸已确认」' : '预估先按默认尺寸算'}`, go: room.id });
      (room.windows || []).forEach((x, i) => { if (!(num(x.w) > 0 && num(x.h) > 0)) red.push({ m: `「${label}」第 ${i + 1} 樘窗请填写宽和高`, go: room.id }); });
      wallUnconfirmed(room).forEach(c => red.push({ m: `「${label}」${PACKS[c].label}：阳台墙面要现场确认，请填实际面积（现在按四面墙算 ${g.wall} 平方尺，实际通常只有 2–3 面实墙，还要扣推拉门）`, go: room.id }));
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
        // 可选配件（功能五金、衣柜配件）填 0 就是不要，不算错
        inputsOf(c).forEach(i => { if (!i.opt && !(v[i.k] > 0)) red.push({ m: `「${label}」${pk.label}：${i.label}要大于 0`, go: room.id }); });
      });
      if (packs.includes('ceiling') && packs.includes('ceil_paint')) red.push({ m: `「${label}」同时选了「天花吊顶」和「天花重刷」，吊顶已含天花油漆，请去掉一个`, go: room.id });
      if (room.type === 'bath' && packs.includes('sanitary') && !packs.includes('bath_tile')) yellow.push({ m: `「${label}」换洁具但不做防水瓷砖，确认原防水没问题`, go: room.id });
    });
    if (project.house?.roro?.on && lines.some(l => l.code === 'waste_out')) yellow.push({ m: '租了大垃圾箱，又按车清运建筑垃圾，确认是否要在「收费」里免收「建筑垃圾清运」', go: 'all' });
    ['awning', 'drain_ch'].forEach(k => { if (project.house?.[k]?.on && project.rooms.some(r => (r.packs || []).includes(k) || (k === 'awning' && (r.packs || []).includes('carport')))) red.push({ m: `「${PACKS[k].label}」在车廊/前院和全屋项目都选了，会重复收费，请去掉一个`, go: 'all' }); });
    if (project.house?.extension?.on && project.rooms.some(r => r.ext)) yellow.push({ m: '全屋项目选了「加建/扩建」，房间里也有加建空间，确认面积没有重复算', go: 'all' });
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
    // 参考价：能出报价，但提醒这些价公司还没核定
    const refs = [...new Set(lines.flatMap(l => l.ref || []))];
    if (refs.length) yellow.push({ m: `有 ${refs.length} 项用的是参考价（公司还没核定）：${refs.slice(0, 6).join('、')}${refs.length > 6 ? ' 等' : ''}`, go: 'price' });
    return { red, yellow };
  }

  // ---------- 沿用到其他空间：复制，不是联动；复制后每间仍可单独改 ----------
  // 哪些房间也能做这个工项（同类房间排前面）
  // 空间分组：先分室内/室外，再按做法相近的类型分。按类型一起选做法、同类房间排前面，都用这一套。
  // 洗衣房、楼梯、加建做法和别的差别大，各自单独一组；阳台按室外做（防滑砖、排水）。
  const SPACE_GROUPS = [
    { id: 'bed', label: '卧室', icon: '🛏️', types: ['master', 'bedroom', 'study'] },
    { id: 'bath', label: '卫浴', icon: '🚿', types: ['bath'] },
    { id: 'kitchen', label: '厨房', icon: '🍳', types: ['kitchen'] },
    { id: 'laundry', label: '洗衣房', icon: '🧺', types: ['laundry'] },
    { id: 'hall', label: '公共区', icon: '🛋️', types: ['living', 'dining', 'family', 'corridor', 'store'] },
    { id: 'stairs', label: '楼梯', icon: '🪜', types: ['stairs'] },
    { id: 'ext', label: '加建', icon: '🏗️', types: ['extension'] },
    { id: 'out', label: '室外', icon: '🌳', out: true, types: ['yard', 'porch', 'balcony'] }
  ];
  const kinOf = type => (SPACE_GROUPS.find(x => x.types.includes(type)) || { id: type }).id;
  const kinLabel = type => (SPACE_GROUPS.find(x => x.id === kinOf(type)) || { label: ROOMS[type].label }).label;
  // 房间按分组顺序排（室内在前、室外在后），同组内按楼层
  // 房间属于哪一组：标了「加建部分」的房间不管原来是什么类型，都归加建组
  const roomGroup = r => (r.ext ? 'ext' : kinOf(r.type));
  const groupIdx = r => { const i = SPACE_GROUPS.findIndex(x => x.id === roomGroup(r)); return i < 0 ? SPACE_GROUPS.length : i; };
  const sortRooms = rooms => rooms.map((r, i) => [r, i]).sort((a, b) => groupIdx(a[0]) - groupIdx(b[0]) || (a[0].level || 1) - (b[0].level || 1) || a[1] - b[1]).map(x => x[0]);
  // 一组房间一起开/关一个工项：只加到这类房间做得了的；数量各按自己尺寸算
  function setPackFor(project, ids, code, on) {
    const pk = PACKS[code]; let n = 0;
    ids.forEach(id => {
      const r = project.rooms.find(x => x.id === id); if (!r || !pk) return;
      r.packs = r.packs || [];
      if (!on) { if (r.packs.includes(code)) { r.packs = r.packs.filter(x => x !== code); n++; } return; }
      if (r.packs.includes(code) || !ROOMS[r.type].packs.includes(code)) return;
      if (pk.pick) r.packs = r.packs.filter(x => PACKS[x].pick !== pk.pick);
      r.packs.push(code); n++;
      if (pk.items && !(r.items || []).length) r.items = [{ name: '', qty: 1, price: 0 }];
    });
    return n;
  }
  function roomsFor(project, fromId, code) {
    const from = project.rooms.find(r => r.id === fromId), k = kinOf(from.type);
    // 全屋其他房间都列出（避免漏项）：同类在前，这类房间一般做这项的其次，一般不做的放最后
    const rank = r => (kinOf(r.type) === k ? 0 : 2) + (ROOMS[r.type].packs.includes(code) ? 0 : 4);
    return project.rooms.filter(r => r.id !== fromId).sort((a, b) => rank(a) - rank(b));
  }
  // 把一个工项的开/关、非面积类的数字（点位数、台数…）、这个位置的选材，从一间复制到另一间。
  // 面积类数字不复制：每间按自己的尺寸算。
  function copyPack(project, fromId, toId, code, on) {
    const from = project.rooms.find(r => r.id === fromId), to = project.rooms.find(r => r.id === toId), pk = PACKS[code];
    if (!from || !to || !pk) return false;
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
      // 整间复制只搬这类房间做得了的；单项沿用（copyPack）由员工自己点，可以加到任何房间
      (from.packs || []).forEach(c => { if (!ROOMS[to.type].packs.includes(c) || !copyPack(project, fromId, id, c, true)) (skipped[id] = skipped[id] || []).push(c); });
    });
    return skipped;
  }

  function newRoom(type, level, n) {
    const t = ROOMS[type];
    return { id: 'r' + Math.random().toString(36).slice(2, 9), type, level: level || 1, name: t.label + (n > 1 ? ' ' + n : ''), L: t.L, W: t.W, doors: t.doors, doorList: Array.from({ length: t.doors || 0 }, () => ({ w: 3, h: 7 })), windows: [], packs: [], vals: {}, measured: false, ...(t.ext ? { ext: true } : {}) };
  }
  function presetRooms(houseType) {
    const l = layoutsFor(houseType).find(x => x.id === DEFAULT_LAYOUT[houseType]) || layoutsFor(houseType)[0];
    return layoutRooms(houseType, l);
  }
  // 旧草稿迁移：原来「地砖/木地板」「平顶/造型吊顶」「刷漆」是范围卡片，现在材料移到选材
  function migrate(project) {
    const pl = plans(project)[0];
    project.rooms.forEach(r => {
      // 门数 → 逐樘门（默认 3×7 尺）
      if (!Array.isArray(r.doorList)) r.doorList = Array.from({ length: Math.max(0, Math.round(num(r.doors))) }, () => ({ w: 3, h: 7 }));
      const set = (cat, k, v) => { ((pl.roomSpecs[r.id] = pl.roomSpecs[r.id] || {})[cat] = pl.roomSpecs[r.id][cat] || {})[k] = v; };
      const has = c => (r.packs || []).includes(c), swap = (from, to) => { r.packs = r.packs.filter(x => x !== from); if (!r.packs.includes(to)) r.packs.push(to); if (r.vals?.[from]) { r.vals[to] = r.vals[from]; delete r.vals[from]; } };
      if (has('laminate')) { swap('laminate', 'floor'); set('tile', 'material', 'SPC 石塑地板'); }
      if (has('floor_tile')) { swap('floor_tile', 'floor'); set('tile', 'material', '瓷砖'); }
      if (has('ceil_feature')) { swap('ceil_feature', 'ceiling'); set('ceiling', 'style', '叠级+灯槽'); }
      if (has('ceil_flat')) { swap('ceil_flat', 'ceiling'); set('ceiling', 'style', '平顶'); }
      if (has('paint')) swap('paint', 'wall_finish');
      if (r.type === 'porch' && has('awning')) swap('awning', 'carport');
      // 淋浴隔断从「洁具」里拆出来成为「淋浴区」：旧报价里选了洁具的卫生间补上淋浴区，金额不变（只迁移一次）
      if (!(project.mig || {}).shower && has('sanitary') && !has('shower_area')) r.packs.push('shower_area');
    });
    project.mig = { ...(project.mig || {}), shower: 1 };
    return project;
  }

  const api = { HOUSES, ROOMS, PACKS, GROUPS, HOUSE_ITEMS, HOUSE_GROUPS, EXTRA_UNITS, SPEC_CATS, SETTINGS, PRICE: P, STAGES, OPTION_PRICES, OPTION_REF, TILE_PIECE_PRICES, TILE_PIECE_REF, geo, inputsOf, packValues, houseValues, unitPrice, buildLines, totals, checks, specOf, stdOf, specKeysFor, specStatus, placesOf, plans, activePlan, LAYOUTS, layoutsFor, layoutRooms, DEFAULT_LAYOUT, roomsFor, kinOf, kinLabel, AUTO_FEES, wallUnconfirmed, SPACE_GROUPS, sortRooms, roomGroup, setPackFor, copyPack, copyRoom, newRoom, presetRooms, migrate, roomLabel, num, r2 };
  root.QV2 = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
