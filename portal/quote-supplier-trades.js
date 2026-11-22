// Supplier inquiry routing is by the contractor's actual trade, not by the
// quote page's broad construction phase. Material/auxiliary/labour stay as
// separate columns on each matched price-book item.
(function (root) {
  const GROUPS = [
    ['site', '拆改与现场管理'],
    ['electric', '电工与弱电'],
    ['plumbing', '给排水与水工'],
    ['hvac', '空调与暖通'],
    ['waterproof', '防水'],
    ['masonry', '泥水与瓷砖'],
    ['flooring', '木地板与楼梯'],
    ['ceiling', '天花与轻木作'],
    ['painting', '批灰、油漆与墙面饰面'],
    ['cabinetry', '定制柜与台面'],
    ['openings', '门窗、栏杆与玻璃'],
    ['bathroom', '卫浴洁具与安装'],
    ['equipment', '设备安装与收尾'],
    ['outdoor', '户外与扩建'],
    ['soft', '家具与软装'],
    ['special', '其他定制项目']
  ].map(([id, name], order) => ({ id, name, order }));
  const byId = Object.fromEntries(GROUPS.map(x => [x.id, x]));
  // Only product/material choices belong to manufacturer price requests.
  // Work-method choices (for example tile installation size or wall prep)
  // remain with the construction contractor.
  const MATERIAL_SPEC_KEYS = {
    tile: ['supply', 'stone', 'solidWood', 'woodGrade'], wall: ['brand'],
    ceiling: ['board', 'slat', 'alu'],
    cabinet: ['body', 'grade', 'door', 'doorStyle', 'handle', 'edge', 'back', 'top', 'kick', 'hardware', 'wardrobeDoor', 'light', 'counter'],
    vanity: ['kind', 'body', 'top', 'mirror'], stairs: ['wood', 'stone', 'paint', 'nosing'],
    canopy: ['roof', 'frame', 'wall', 'glass'], door2: ['slide', 'glass', 'frame', 'tub'],
    doorwin: ['doorMat', 'winType', 'winOpen', 'screen'],
    bathkit: ['toiletKind', 'sanBrand', 'shower', 'heater', 'sink', 'tap', 'exhaust', 'acc', 'drain'],
    base: ['stone', 'skirting', 'grout', 'wp', 'pipe', 'wire', 'cornice'],
    soft2: ['curtain', 'rack', 'fanBrand'],
    outer: ['mainDoor', 'grille', 'extPaint', 'cctvRes', 'cctvBrand', 'doorbell', 'gateType', 'gateMotor'],
    craft: ['toilet', 'casing', 'bay', 'tatami', 'bar', 'softPanel', 'mirror', 'stone', 'gblock', 'mosaic', 'border', 'raise', 'deck', 'purifier'],
    panel: ['slab', 'board'], soft: ['grade'], shower: ['glass', 'frame'],
    switch: ['brand', 'smartType', 'platform'], lighting: ['grade']
  };
  const MAP = {};
  const assign = (trade, codes) => codes.trim().split(/\s+/).forEach(code => { MAP[code] = trade; });

  assign('site', `setout protect permit demo_piece demo_floor demo_ceiling demo_skin demo_wall_tile demo_wall struct reno_permit engineer carry_up scaffold waste_out termite roro_bin car_insurance`);
  assign('masonry', `build_wall door_open glass_block screed slope floor_tile wall_tile skirting grout threshold window_sill pipe_box stair_tread big_tile_extra niche tile_border stair_stone stair_stone_land stone_floor bay_window culture_stone mosaic floor_border floor_raise slab_wall`);
  assign('electric', `wire circuit db_box net fan_point cctv doorbell three_phase garden_light audio_wire db_move lv_box panel light led_strip exhaust stair_light stair_steplight stair_steplight_sensor ceiling_fan smart_switch smart_sensor smart_ir smart_hub`);
  assign('plumbing', `water_pt pipe_test gas main_pipe water_filter sewer wall_core hot_insul bath_drop drain water_pump ro_filter`);
  assign('hvac', `aircon_pipe`);
  assign('waterproof', `wp flood_test`);
  assign('flooring', `laminate stair_wood stair_wood_land wood_floor solid_wood floor_refinish`);
  assign('ceiling', `drywall plaster_ceiling ceiling_step cornice curtain_box ceil_slat ceil_alu ceil_curve`);
  assign('painting', `skim paint_wall paint_ceiling ext_paint wallpaper art_paint stair_paint stair_paint_area damp_proof wall_mesh wall_cloth`);
  assign('cabinetry', `cab_low cab_up counter wardrobe shoe_cab tv_cab laundry_cab sideboard headboard bookcase cab_basket desk hw_spice hw_corner hw_tall hw_lift hw_rack hw_bin hw_cutlery hw_rice hw_flap whw_pants whw_basket whw_lift whw_mirror whw_jewel whw_shoe whw_safe altar_cab wall_panel wine_cab tatami bar_counter vanity_custom soft_panel`);
  assign('openings', `door balc_seal stair_rail grille main_door window_new fly_screen rail_glass rail_iron rail_wood rail_black rail_alu slide_door glass_part window_casing mirror_wall smart_lock`);
  assign('bathroom', `bath_acc mirror toilet vanity shower screen heater sink shower_tray screen_l screen_diamond bathtub mop_sink`);
  assign('equipment', `hood rack clean formaldehyde`);
  assign('outdoor', `extension ext_permit awning fence autogate drain_ch outdoor_paving outdoor_tile outdoor_planter roof_fix sunroom_wall porch_tile downpipe decking`);
  assign('soft', `curtain decor sf_sofa sf_coffee sf_side sf_rug sf_pendant sf_art sf_fan sf_dining sf_bed sf_night sf_dresser sf_bedding sf_lamp sf_desk sf_shelf sf_outdoor sf_umbrella sf_plant fan_unit curtain_rod curtain_motor`);
  assign('special', `custom_item`);

  function baseCode(id, type) {
    if (type === '瓷砖片价' || /^tile\.size\./.test(id)) return 'floor_tile';
    return String(id).includes('@') ? String(id).split('@').pop() : id;
  }
  function isMaterialItem(id, type, materialValue) {
    if (type === '瓷砖片价') return true;
    if (type === '项目单价') return Number(materialValue) > 0 && baseCode(id, type) !== 'struct';
    if (type !== '选材价差') return false;
    const first = String(id).indexOf('.'), second = String(id).indexOf('.', first + 1);
    if (first < 0 || second < 0 || !String(id).includes('@')) return false;
    const category = String(id).slice(0, first), key = String(id).slice(first + 1, second);
    return (MATERIAL_SPEC_KEYS[category] || []).includes(key);
  }
  function resolve(id, type) {
    const code = baseCode(id, type), group = byId[MAP[code]];
    return group ? { ...group, code } : { ...byId.special, id: 'unassigned', name: '工种待确认', code };
  }
  function audit(price) {
    return Object.keys(price || {}).filter(code => !MAP[code]);
  }
  const api = { GROUPS, MAP, MATERIAL_SPEC_KEYS, baseCode, resolve, isMaterialItem, audit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QV2_SUPPLIER_TRADES = api;
})(typeof window !== 'undefined' ? window : globalThis);
