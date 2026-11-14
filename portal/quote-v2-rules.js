// 新版报价器的计算规则（不含界面）。
// 原则：员工只「点选要做什么」并确认尺寸；每一项的数量都由下面写死的公式算出，
// 同样的输入永远得到同样的清单和金额。单价只来自价目表，这里不写价格。
(function (root) {
  const P = root.QV2_PRICE || (typeof require !== 'undefined' ? require('./quote-v2-price.js').PRICE : {});
  const STAGES = root.QV2_STAGES || (typeof require !== 'undefined' ? require('./quote-v2-price.js').STAGES : []);
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
  const PRESETS = {
    condo:     [[1, ['living', 'dining', 'kitchen', 'master', 'bedroom', 'bedroom', 'bath', 'bath', 'laundry']]],
    apartment: [[1, ['living', 'kitchen', 'master', 'bedroom', 'bedroom', 'bath', 'laundry']]],
    townhouse: [[1, ['living', 'dining', 'kitchen', 'master', 'bedroom', 'bedroom', 'bath', 'bath', 'balcony']]],
    terrace:   [[1, ['porch', 'living', 'dining', 'kitchen', 'bath']], [2, ['master', 'bedroom', 'bedroom', 'bath', 'bath']]],
    semi:      [[1, ['porch', 'living', 'dining', 'kitchen', 'bedroom', 'bath', 'laundry']], [2, ['master', 'bedroom', 'bedroom', 'study', 'bath', 'bath']]],
    bungalow:  [[1, ['porch', 'living', 'dining', 'kitchen', 'bedroom', 'bath', 'laundry']], [2, ['master', 'bedroom', 'bedroom', 'bedroom', 'bath', 'bath', 'balcony']]]
  };

  // ---------- 空间类型：默认尺寸、门数、可选工程 ----------
  const DRY = ['demo_floor', 'demo_skin', 'floor_tile', 'laminate', 'paint', 'ceil_flat', 'ceil_feature', 'cornice', 'electric', 'aircon', 'fan', 'curtain', 'sill', 'door', 'window_new'];
  const ROOMS = {
    living:  { label: '客厅', icon: '🛋️', L: 20, W: 14, doors: 0, packs: [...DRY, 'tv_cab', 'shoe_cab'] },
    dining:  { label: '餐厅', icon: '🍽️', L: 12, W: 10, doors: 0, packs: [...DRY, 'sideboard'] },
    master:  { label: '主人房', icon: '🛏️', L: 14, W: 12, doors: 1, packs: [...DRY, 'wardrobe', 'headboard'] },
    bedroom: { label: '卧室', icon: '🛏️', L: 11, W: 10, doors: 1, packs: [...DRY, 'wardrobe', 'desk'] },
    study:   { label: '书房', icon: '📚', L: 10, W: 9, doors: 1, packs: [...DRY, 'bookcase', 'desk'] },
    kitchen: { label: '厨房', icon: '🍳', L: 10, W: 8, doors: 0, packs: ['demo_floor', 'demo_wall_tile', 'kitchen_tile', 'cabinets', 'kitchen_water', 'electric', 'paint', 'ceil_flat', 'aircon', 'sill', 'door', 'window_new'] },
    bath:    { label: '卫生间', icon: '🚿', L: 8, W: 5, doors: 1, packs: ['bath_demo', 'bath_tile', 'sanitary', 'vanity', 'heater', 'bath_water', 'bath_move', 'bath_ceil', 'electric', 'door', 'window_new'] },
    laundry: { label: '洗衣区', icon: '🧺', L: 8, W: 5, doors: 0, packs: ['demo_floor', 'wet_tile', 'laundry_water', 'laundry_cab', 'rack', 'electric', 'paint', 'window_new'] },
    balcony: { label: '阳台', icon: '🌿', L: 10, W: 4, doors: 0, packs: ['demo_floor', 'wet_tile', 'rack', 'electric', 'balc_seal'] },
    porch:   { label: '车廊/前院', icon: '🚗', L: 20, W: 18, doors: 0, outdoor: true, packs: ['porch_tile', 'drain_ch', 'awning', 'garden_light'] }
  };

  // ---------- 工程包：一个按钮 = 一组必然一起做的项目 ----------
  // group 决定卡片分组；pick 同组只能选一个（例如地面只能选瓷砖或木地板）；
  // inputs 是这个工程唯一需要员工确认的数字，全部有默认值，不留空格。
  const GROUPS = [['demo', '拆旧'], ['floor', '地面'], ['wall', '墙面'], ['ceil', '天花'], ['mep', '水电'], ['wet', '防水与瓷砖'], ['fix', '洁具设备'], ['cab', '定制柜'], ['open', '门窗窗帘'], ['out', '户外']];
  const PACKS = {
    demo_floor:     { g: 'demo', label: '拆旧地砖', icon: '⛏️', lines: (r, g) => [['demo_floor', g.floor, `地面 ${g.L}×${g.W}`]] },
    demo_skin:      { g: 'demo', label: '铲旧墙皮', icon: '🧽', lines: (r, g) => [['demo_skin', g.wall, '墙面面积']] },
    demo_wall_tile: { g: 'demo', label: '拆旧墙砖', icon: '⛏️', lines: (r, g) => [['demo_skin', g.wall, '墙面面积']] },
    bath_demo:      { g: 'demo', label: '拆旧（地砖+墙砖+洁具）', icon: '⛏️', lines: (r, g) => [['demo_floor', g.floor, '地面'], ['demo_skin', g.wall, '墙面'], ['demo_piece', 3, '旧马桶/面盆/花洒']] },

    floor_tile:     { g: 'floor', pick: 'floor', label: '铺地砖', icon: '🟫', lines: (r, g) => [['screed', g.floor, '地面找平'], ['floor_tile', g.floor, '地面'], ['grout', g.floor, '= 地砖面积'], ['skirting', g.skirt, '周长 − 门宽']] },
    laminate:       { g: 'floor', pick: 'floor', label: '铺木地板/SPC', icon: '🪵', lines: (r, g) => [['laminate', g.floor, '地面'], ['skirting', g.skirt, '周长 − 门宽']] },

    paint:          { g: 'wall', label: '墙面批灰刷漆', icon: '🖌️', lines: (r, g) => [['skim', g.wall, '墙面'], ['paint_wall', g.wall, '墙面']] },

    ceil_flat:      { g: 'ceil', pick: 'ceil', label: '平顶吊顶', icon: '⬜', lines: (r, g) => [['plaster_ceiling', g.floor, '= 地面面积'], ['paint_ceiling', g.floor, '= 地面面积']] },
    ceil_feature:   { g: 'ceil', pick: 'ceil', label: '造型吊顶+灯槽', icon: '✨', lines: (r, g) => [['plaster_ceiling', g.floor, '= 地面面积'], ['paint_ceiling', g.floor, '= 地面面积'], ['ceiling_step', g.perim, '= 周长'], ['led_strip', g.perim, '= 周长']] },
    cornice:        { g: 'ceil', label: '石膏线', icon: '〰️', lines: (r, g) => [['cornice', g.perim, '= 周长']] },
    bath_ceil:      { g: 'ceil', label: '防潮天花', icon: '⬜', lines: (r, g) => [['plaster_ceiling', g.floor, '= 地面面积'], ['paint_ceiling', g.floor, '= 地面面积']] },

    electric:       { g: 'mep', label: '插座开关+灯位', icon: '💡',
                      inputs: [{ k: 'pts', label: '插座/开关', unit: '个', def: (r, g) => ceil(g.floor / 30) + 2 }, { k: 'lights', label: '灯位', unit: '个', def: (r, g) => ceil(g.floor / 50) + 1 }],
                      lines: (r, g, v) => [['wire', v.pts, '插座/开关点位'], ['panel', v.pts, '= 点位数'], ['light', v.lights, '灯位']] },
    aircon:         { g: 'mep', label: '空调预埋', icon: '❄️', inputs: [{ k: 'n', label: '空调', unit: '台', def: () => 1 }],
                      lines: (r, g, v) => [['aircon_pipe', v.n, '空调台数'], ['circuit', v.n, '每台一条专用回路']] },
    fan:            { g: 'mep', label: '吊扇', icon: '🌀', inputs: [{ k: 'n', label: '吊扇', unit: '台', def: () => 1 }],
                      lines: (r, g, v) => [['fan_point', v.n, '吊扇台数']] },
    kitchen_water:  { g: 'mep', label: '水路改造', icon: '🚰', inputs: [{ k: 'n', label: '水点位', unit: '个', def: () => 2 }],
                      lines: (r, g, v) => [['water_pt', v.n, '水点位']] },
    bath_water:     { g: 'mep', label: '水路改造', icon: '🚰', inputs: [{ k: 'n', label: '水点位', unit: '个', def: () => 5 }],
                      lines: (r, g, v) => [['water_pt', v.n, '水点位'], ['pipe_box', 1, '下水立管包封']] },
    laundry_water:  { g: 'mep', label: '洗衣机水位', icon: '🚰', inputs: [{ k: 'n', label: '水点位', unit: '个', def: () => 2 }],
                      lines: (r, g, v) => [['water_pt', v.n, '水点位']] },
    heater:         { g: 'fix', label: '热水器', icon: '♨️', lines: () => [['heater', 1, '每个卫生间 1 台'], ['circuit', 1, '热水器专用回路']] },

    kitchen_tile:   { g: 'wet', label: '地砖+操作区墙砖+防水', icon: '🧱', inputs: [{ k: 'back', label: '操作区墙砖长度', unit: '尺', def: (r, g) => r2(g.L + g.W - 3) }],
                      lines: (r, g, v) => [['wp', g.floor, '厨房地面'], ['flood_test', 1, '做防水就要闭水'], ['screed', g.floor, '地面找平'], ['floor_tile', g.floor, '地面'], ['wall_tile', r2(v.back * 2.5), `操作区 ${v.back}×2.5 尺高`], ['grout', r2(g.floor + v.back * 2.5), '地砖+墙砖'], ['drain', 1, '厨房地漏']] },
    bath_tile:      { g: 'wet', label: '防水+地砖+满墙砖', icon: '🧱',
                      lines: (r, g) => [['wp', r2(g.floor + g.perim + 36), '地面 + 周长×上翻1尺 + 淋浴区墙 6×6'], ['flood_test', 1, '做防水就要闭水'], ['slope', g.floor, '往地漏找坡'], ['floor_tile', g.floor, '地面'], ['wall_tile', g.wall, '满墙'], ['grout', r2(g.floor + g.wall), '地砖+墙砖'], ['drain', 2, '淋浴区 + 干区'], ['threshold', g.doors, '每个门口一条挡水']] },
    wet_tile:       { g: 'wet', label: '防水+地砖', icon: '🧱',
                      lines: (r, g) => [['wp', g.floor, '地面'], ['flood_test', 1, '做防水就要闭水'], ['slope', g.floor, '往地漏找坡'], ['floor_tile', g.floor, '地面'], ['grout', g.floor, '= 地砖面积'], ['drain', 1, '地漏']] },
    bath_move:      { g: 'wet', label: '改马桶/排水位置', icon: '↔️', lines: (r, g) => [['bath_drop', g.floor, '改位置要降板+二次排水']] },

    sanitary:       { g: 'fix', label: '洁具（马桶+花洒+淋浴隔断）', icon: '🚽', lines: () => [['toilet', 1, ''], ['shower', 1, ''], ['screen', 1, ''], ['exhaust', 1, '卫生间必配'], ['bath_acc', 1, '毛巾架/纸巾架/挂钩']] },
    vanity:         { g: 'fix', label: '浴室柜+镜子', icon: '🪞', lines: () => [['vanity', 1, ''], ['mirror', 1, '']] },
    rack:           { g: 'fix', label: '晾衣架', icon: '👕', lines: () => [['rack', 1, '']] },

    cabinets:       { g: 'cab', label: '橱柜（地柜+吊柜+台面）', icon: '🗄️',
                      inputs: [{ k: 'low', label: '地柜长度', unit: '尺', def: (r, g) => r2(g.L + g.W - 3) }, { k: 'up', label: '吊柜长度', unit: '尺', def: (r, g) => r2(g.L) }],
                      lines: (r, g, v) => [['cab_low', v.low, '地柜长度'], ['counter', v.low, '= 地柜长度'], ['cab_up', v.up, '吊柜长度'], ['sink', 1, '厨房必配'], ['hood', 1, '烟机灶具安装']] },
    wardrobe:       { g: 'cab', label: '衣柜', icon: '🚪', inputs: [{ k: 'len', label: '衣柜长度', unit: '尺', def: (r, g) => r2(Math.min(g.L, g.W) - 2) }], lines: (r, g, v) => [['wardrobe', v.len, '衣柜长度']] },
    tv_cab:         { g: 'cab', label: '电视柜', icon: '📺', inputs: [{ k: 'len', label: '电视柜长度', unit: '尺', def: () => 8 }], lines: (r, g, v) => [['tv_cab', v.len, '电视柜长度']] },
    shoe_cab:       { g: 'cab', label: '鞋柜', icon: '👟', inputs: [{ k: 'len', label: '鞋柜长度', unit: '尺', def: () => 4 }], lines: (r, g, v) => [['shoe_cab', v.len, '鞋柜长度']] },
    sideboard:      { g: 'cab', label: '餐边柜', icon: '🍶', inputs: [{ k: 'len', label: '餐边柜长度', unit: '尺', def: () => 6 }], lines: (r, g, v) => [['sideboard', v.len, '餐边柜长度']] },
    headboard:      { g: 'cab', label: '床头背景', icon: '🖼️', inputs: [{ k: 'len', label: '背景墙宽', unit: '尺', def: () => 8 }], lines: (r, g, v) => [['headboard', v.len, '背景墙宽']] },
    bookcase:       { g: 'cab', label: '书柜/储物柜', icon: '📚', inputs: [{ k: 'len', label: '柜长度', unit: '尺', def: () => 6 }], lines: (r, g, v) => [['bookcase', v.len, '柜长度']] },
    desk:           { g: 'cab', label: '书桌', icon: '🖥️', inputs: [{ k: 'len', label: '书桌长度', unit: '尺', def: () => 4 }], lines: (r, g, v) => [['desk', v.len, '书桌长度']] },
    laundry_cab:    { g: 'cab', label: '洗衣柜', icon: '🗄️', inputs: [{ k: 'len', label: '洗衣柜长度', unit: '尺', def: () => 4 }], lines: (r, g, v) => [['laundry_cab', v.len, '洗衣柜长度']] },

    door:           { g: 'open', label: '换门', icon: '🚪', needDoors: true, lines: (r, g) => [['door', g.doors, '= 房间门数']] },
    window_new:     { g: 'open', label: '换窗', icon: '🪟', needWindows: true, lines: (r, g) => [['window_new', g.winA, '各樘窗 宽×高 合计']] },
    curtain:        { g: 'open', label: '窗帘', icon: '🎐', needWindows: true, lines: (r, g, v, picked) => [['curtain', g.winW, '各樘窗宽合计'], ...(picked.ceil_flat || picked.ceil_feature ? [['curtain_box', g.winW, '有吊顶 → 窗帘盒 = 窗宽']] : [])] },
    sill:           { g: 'open', label: '窗台石', icon: '▭', needWindows: true, lines: (r, g) => [['window_sill', g.winW, '各樘窗宽合计']] },
    balc_seal:      { g: 'open', label: '封阳台', icon: '🪟', lines: (r, g) => [['balc_seal', g.L, '= 阳台长度']] },

    porch_tile:     { g: 'out', label: '防滑地砖', icon: '🟫', lines: (r, g) => [['screed', g.floor, '地面找平'], ['porch_tile', g.floor, '地面']] },
    drain_ch:       { g: 'out', label: '排水沟', icon: '〰️', inputs: [{ k: 'len', label: '排水沟长度', unit: '尺', def: (r, g) => g.W }], lines: (r, g, v) => [['drain_ch', v.len, '排水沟长度']] },
    awning:         { g: 'out', label: '雨棚', icon: '⛱️', inputs: [{ k: 'area', label: '雨棚面积', unit: '平方尺', def: (r, g) => g.floor }], lines: (r, g, v) => [['awning', v.area, '雨棚面积']] },
    garden_light:   { g: 'out', label: '户外灯', icon: '💡', inputs: [{ k: 'n', label: '灯位', unit: '个', def: () => 2 }], lines: (r, g, v) => [['garden_light', v.n, '灯位']] }
  };

  // ---------- 全屋项目：不属于某个房间 ----------
  const HOUSE_ITEMS = [
    { k: 'wall_demo', label: '拆墙/开门洞', icon: '🔨', inputs: [{ k: 'area', label: '拆墙面积', unit: '平方尺', def: () => 40 }], lines: v => [['demo_wall', v.area, '拆墙面积']] },
    { k: 'load_wall', label: '动承重墙', icon: '🏗️', why: '必须结构工程师签字', inputs: [{ k: 'n', label: '处数', unit: '处', def: () => 1 }], lines: v => [['struct', v.n, '处数'], ['engineer', 1, '动承重墙必须有']] },
    { k: 'reno_permit', label: '改建申请（市政局准证）', icon: '📄', lines: () => [['reno_permit', 1, '']] },
    { k: 'db_box', label: '换配电箱', icon: '🔌', lines: () => [['db_box', 1, '']] },
    { k: 'three_phase', label: '单相改三相电', icon: '⚡', landed: true, lines: () => [['three_phase', 1, '']] },
    { k: 'net', label: '网络/电视线', icon: '📶', inputs: [{ k: 'n', label: '点位', unit: '个', def: () => 4 }], lines: v => [['net', v.n, '点位']] },
    { k: 'gas', label: '燃气管道', icon: '🔥', lines: () => [['gas', 1, '']] },
    { k: 'main_pipe', label: '换进户主水管', icon: '🚰', landed: true, inputs: [{ k: 'len', label: '长度', unit: '尺', def: () => 30 }], lines: v => [['main_pipe', v.len, '主水管长度']] },
    { k: 'water_filter', label: '全屋净水器', icon: '💧', lines: () => [['water_filter', 1, '']] },
    { k: 'sewer', label: '排污管/化粪池接驳', icon: '🕳️', landed: true, lines: () => [['sewer', 1, '']] },
    { k: 'downpipe', label: '换雨水管', icon: '🌧️', landed: true, inputs: [{ k: 'len', label: '长度', unit: '尺', def: () => 40 }], lines: v => [['downpipe', v.len, '雨水管长度']] },
    { k: 'pump', label: '水泵/水箱', icon: '🛢️', landed: true, lines: () => [['water_pump', 1, '']] },
    { k: 'cctv', label: '监控 CCTV', icon: '📹', inputs: [{ k: 'n', label: '摄像头', unit: '个', def: () => 4 }], lines: v => [['cctv', v.n, '摄像头数量']] },
    { k: 'doorbell', label: '可视门铃', icon: '🔔', lines: () => [['doorbell', 1, '']] },
    { k: 'main_door', label: '换大门', icon: '🚪', lines: () => [['main_door', 1, '']] },
    { k: 'autogate', label: '自动大门', icon: '🚧', landed: true, lines: () => [['autogate', 1, '']] },
    { k: 'fence', label: '围墙/栏杆', icon: '🧱', landed: true, inputs: [{ k: 'len', label: '长度', unit: '尺', def: () => 40 }], lines: v => [['fence', v.len, '围墙长度']] },
    { k: 'roof_fix', label: '屋顶补漏', icon: '🏠', landed: true, inputs: [{ k: 'n', label: '漏点', unit: '处', def: () => 1 }], lines: v => [['roof_fix', v.n, '漏点处数']] },
    { k: 'ext_paint', label: '外墙油漆', icon: '🎨', landed: true, inputs: [{ k: 'area', label: '外墙面积', unit: '平方尺', def: () => 1500 }], lines: v => [['ext_paint', v.area, '外墙面积']] }
  ];

  const SETTINGS = { designRate: 8, mgmtRate: 6, sst: 0, pay: [['签约定金', 30], ['水电隐蔽验收通过', 30], ['泥水瓷砖验收通过', 30], ['竣工验收交付', 10]] };

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
  function packValues(room, code, g) {
    const pk = PACKS[code], saved = (room.vals && room.vals[code]) || {}, v = {};
    (pk.inputs || []).forEach(i => { v[i.k] = saved[i.k] !== undefined && saved[i.k] !== '' ? num(saved[i.k]) : i.def(room, g); });
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
  const roomLabel = (room, project) => (levelsOf(project) > 1 ? `${room.level || 1}楼 · ` : '') + room.name;
  const levelsOf = project => Math.max(1, ...project.rooms.map(r => r.level || 1));

  function buildLines(project) {
    const lines = [];
    const push = (room, code, qty, formula, from) => {
      qty = r2(num(qty));
      if (!(qty > 0) || !P[code]) return;
      const unit = unitPrice(code, project.prices);
      lines.push({ roomId: room ? room.id : null, room: room ? roomLabel(room, project) : '全屋', code, name: P[code].name, unitName: P[code].unit, stage: P[code].stage, qty, formula, from, unit, total: Math.round(qty * unit), unpriced: !!P[code].unpriced && !(unit > 0) });
    };
    const anyWork = project.rooms.some(r => (r.packs || []).length) || Object.keys(project.house || {}).some(k => project.house[k] && project.house[k].on);
    if (anyWork) { push(null, 'setout', 1, '每单必做', '全屋'); push(null, 'protect', 1, '每单必做', '全屋'); }
    project.rooms.forEach(room => {
      const g = geo(room, project), picked = {};
      (room.packs || []).forEach(c => { picked[c] = true; });
      (room.packs || []).forEach(code => {
        const pk = PACKS[code]; if (!pk) return;
        pk.lines(room, g, packValues(room, code, g), picked).forEach(([c, q, f]) => push(room, c, q, f, pk.label));
      });
    });
    const hs = project.house || {};
    HOUSE_ITEMS.forEach(item => { const q = hs[item.k]; if (q && q.on) item.lines(houseValues(q, item)).forEach(([c, qty, f]) => push(null, c, qty, f, item.label)); });
    // 自动跟随的全屋项目
    const indoor = project.rooms.filter(r => !ROOMS[r.type].outdoor);
    const worked = indoor.filter(r => (r.packs || []).length);
    const waterPts = lines.filter(l => l.code === 'water_pt').reduce((t, l) => t + l.qty, 0);
    if (waterPts > 0) push(null, 'pipe_test', 1, `全屋 ${waterPts} 个水点位，封槽前必须打压`, '自动');
    const up = worked.filter(r => (r.level || 1) > 1);
    const upQty = up.reduce((t, r) => t + geo(r, project).floor * ((r.level || 1) - 1), 0);
    if (upQty > 0) push(null, 'carry_up', upQty, '楼上施工房间面积 × 楼层', '自动');
    if (anyWork) {
      const demoArea = lines.filter(l => ['demo_floor', 'demo_skin', 'demo_wall'].includes(l.code)).reduce((t, l) => t + l.qty, 0);
      const pieces = lines.filter(l => l.code === 'demo_piece').reduce((t, l) => t + l.qty, 0);
      push(null, 'waste_out', 1 + ceil(demoArea / 400) + ceil(pieces / 10), `基础 1 车 + 拆旧面积 ${r2(demoArea)}÷400 + 旧件 ${pieces}÷10（进位）`, '自动');
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

  // 检查：red = 不处理不能出报价单；yellow = 提醒确认
  function checks(project, lines) {
    const red = [], yellow = [];
    if (!project.houseType) red.push({ m: '还没选房屋类型', go: 'house' });
    if (!project.rooms.length) red.push({ m: '还没有房间', go: 'house' });
    project.rooms.forEach(room => {
      const g = geo(room, project), label = roomLabel(room, project), packs = room.packs || [];
      if (!(g.L > 0 && g.W > 0)) red.push({ m: `「${label}」请填写长和宽`, go: room.id });
      else if (!room.measured && packs.length) red.push({ m: `「${label}」尺寸还是默认值，请现场量好后点「尺寸已确认」`, go: room.id });
      (room.windows || []).forEach((x, i) => { if (!(num(x.w) > 0 && num(x.h) > 0)) red.push({ m: `「${label}」第 ${i + 1} 樘窗请填写宽和高`, go: room.id }); });
      packs.forEach(c => {
        const pk = PACKS[c]; if (!pk) return;
        if (pk.needWindows && !(g.wins.length)) red.push({ m: `「${label}」选了${pk.label}，请先加窗户尺寸`, go: room.id });
        if (pk.needDoors && !(g.doors > 0)) red.push({ m: `「${label}」选了换门，但门数是 0`, go: room.id });
        const v = packValues(room, c, g);
        (pk.inputs || []).forEach(i => { if (!(v[i.k] > 0)) red.push({ m: `「${label}」${pk.label}：${i.label}要大于 0`, go: room.id }); });
      });
      if (packs.includes('ceil_feature') && !packs.includes('electric')) yellow.push({ m: `「${label}」做了灯槽，但没选插座开关+灯位`, go: room.id });
      if (ROOMS[room.type] && room.type === 'bath' && packs.includes('sanitary') && !packs.includes('bath_tile')) yellow.push({ m: `「${label}」换洁具但不做防水瓷砖，确认原防水没问题`, go: room.id });
    });
    const seen = {};
    lines.filter(l => l.unpriced).forEach(l => { if (!seen[l.code]) { seen[l.code] = 1; red.push({ m: `「${l.name}」单价待公司核定，请到价格页填写`, go: 'price' }); } });
    return { red, yellow };
  }

  function newRoom(type, level, n) {
    const t = ROOMS[type];
    return { id: 'r' + Math.random().toString(36).slice(2, 9), type, level: level || 1, name: t.label + (n > 1 ? ' ' + n : ''), L: t.L, W: t.W, doors: t.doors, windows: [], packs: [], vals: {}, measured: false };
  }
  function presetRooms(houseType) {
    const out = [], count = {};
    (PRESETS[houseType] || []).forEach(([lv, types]) => types.forEach(t => { count[t] = (count[t] || 0) + 1; out.push(newRoom(t, lv, count[t])); }));
    // 只出现一次的不加编号
    out.forEach(r => { if (count[r.type] === 1) r.name = ROOMS[r.type].label; });
    return out;
  }

  const api = { HOUSES, ROOMS, PACKS, GROUPS, HOUSE_ITEMS, SETTINGS, PRICE: P, STAGES, geo, packValues, houseValues, unitPrice, buildLines, totals, checks, newRoom, presetRooms, roomLabel, num, r2 };
  root.QV2 = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
