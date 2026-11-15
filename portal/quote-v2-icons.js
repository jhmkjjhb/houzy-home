// 新版报价器线性图标（与后台 houzy-icons.js 同风格：24 网格、1.8 描边、跟随文字颜色）。
// 计算规则里的图标仍用 emoji 作为代号（便于阅读），显示时由这里换成统一的线条图标。
(function (root) {
  const I = {
    sofa: '<path d="M4 11V9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/><path d="M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v4H2z"/><path d="M5 17v2M19 17v2"/>',
    bed: '<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M2 16h20"/><path d="M6 10V7.5A1.5 1.5 0 0 1 7.5 6h3A1.5 1.5 0 0 1 12 7.5V10"/>',
    dining: '<path d="M4 3v6a2 2 0 0 0 4 0V3M6 11v10"/><path d="M18 21V3c-2 1-3.5 3.5-3.5 7v3H18"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    pot: '<path d="M3 10h18"/><path d="M5 10v7a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-7"/><path d="M9 6.5c0-2 6-2 6 0"/><path d="M12 4.5v-2"/>',
    shower: '<path d="M4 21V8a4 4 0 0 1 8 0"/><path d="M8.5 9h7"/><path d="M10 13v1M13 13v1M16 13v1M11.5 17v1M14.5 17v1"/>',
    washer: '<rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M7.5 5.5h2"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z"/><path d="M2 21c0-3 1.9-5.4 5-6"/>',
    car: '<path d="M5 17H3v-5l2.2-5h13.6L21 12v5h-2"/><path d="M3 12h18"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 17h6"/>',
    tv: '<rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 21h8"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    door: '<path d="M3 21h18"/><path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17"/><path d="M14.5 12h.01"/>',
    stairs: '<path d="M3 21h5v-5h5v-5h5V6h3"/>',
    tree: '<path d="M12 22v-6"/><path d="M12 16a5 5 0 0 0 5-5 5 5 0 0 0-2-4 3 3 0 0 0-6 0 5 5 0 0 0-2 4 5 5 0 0 0 5 5z"/>',
    walk: '<circle cx="13" cy="4" r="2"/><path d="m9 21 3-8 3 3v5"/><path d="m6 12 3-4 4 1 3 3"/>',
    hammer: '<path d="m15 12-8.5 8.5a2.1 2.1 0 0 1-3-3L12 9"/><path d="m17.6 15.2 4.2-4.2"/><path d="m20 12.6-8.6-8.6a2 2 0 0 0-2.8 0L7 5.6l2 2 1.4-1.4L18 14"/>',
    scraper: '<path d="m4 20 6-6"/><path d="m14 4 6 6-6 6-6-6z"/>',
    tile: '<rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    brick: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 10h18M3 15h18M9 5v5M15 10v5M9 15v4"/>',
    roller: '<rect x="3" y="3" width="14" height="6" rx="1"/><path d="M17 6h3v5h-8v3"/><rect x="10" y="14" width="4" height="7" rx="1"/>',
    ceiling: '<path d="M3 5h18"/><path d="M6 5v3h12V5"/><path d="M12 8v3"/><path d="M9 14a3 3 0 0 1 6 0z"/><path d="M12 17v1"/>',
    wave: '<path d="M3 9c3-3 6 3 9 0s6 3 9 0"/><path d="M3 15c3-3 6 3 9 0s6 3 9 0"/>',
    bulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
    plug: '<path d="M9 2v6M15 2v6"/><path d="M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    drop: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12.5 5 12 2.5C11.5 5 10 7.4 8 9s-3 3.5-3 6a7 7 0 0 0 7 7z"/>',
    tap: '<path d="M4 8h9a3 3 0 0 1 3 3v2"/><path d="M4 5v6"/><path d="M9 5v3"/><path d="M16 17v.5M16 20.5v.5"/>',
    snow: '<path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19"/>',
    fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-5 2-7 5-7 0 3-2 6-5 7"/><path d="M14 12c5 0 7 2 7 5-3 0-6-2-7-5"/><path d="M12 14c0 5-2 7-5 7 0-3 2-6 5-7"/><path d="M10 12c-5 0-7-2-7-5 3 0 6 2 7 5"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.3 1.1 1.4 2 2.5 2.8z"/>',
    toilet: '<path d="M5 3h4v9H5z"/><path d="M5 12h14a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="m9.5 16-1 5h7l-1-5"/>',
    mirror: '<ellipse cx="12" cy="9" rx="6" ry="7"/><path d="M12 16v5M9 21h6"/>',
    hanger: '<path d="M12 6a2 2 0 1 1 2 2c-1 0-2 .6-2 2l8.6 6.2a1 1 0 0 1-.6 1.8H4a1 1 0 0 1-.6-1.8L12 10"/>',
    cabinet: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 12h16M10 7.5h4M10 16.5h4"/>',
    shoe: '<path d="M3 17v-4c2 0 3.5-1 4.5-3l1.5-3 4 1.5-1 2.5c3 1.5 9 1 9 5v1z"/><path d="M3 17h19v2H3z"/>',
    frame: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="m3 16 5-5 4 4 3-3 6 6"/>',
    desk: '<path d="M3 8h18"/><path d="M5 8v12M19 8v12"/><path d="M14 8v6h5"/>',
    plusbox: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>',
    curtain: '<path d="M3 3h18"/><path d="M5 3v18c2-3 3-12 1-18"/><path d="M19 3v18c-2-3-3-12-1-18"/>',
    screen: '<rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M3 9l6-6M3 15 15 3M3 21 21 3M9 21l12-12M15 21l6-6"/>',
    window: '<rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M12 3v18M3 12h18"/>',
    sill: '<path d="M2 15h20v3H2z"/><path d="M5 15V5h14v10"/><path d="M12 5v10"/>',
    move: '<path d="M3 12h18"/><path d="m7 8-4 4 4 4"/><path d="m17 8 4 4-4 4"/>',
    awning: '<path d="M2 10 12 4l10 6z"/><path d="M12 10v11"/><path d="M5 10v2M19 10v2"/>',
    scaffold: '<path d="M5 21V3M19 21V3M5 7h14M5 12h14M5 17h14"/><path d="m5 12 14-5M5 17l14-5"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    wifi: '<path d="M2 9a15 15 0 0 1 20 0"/><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M12 20h.01"/>',
    pipe: '<path d="M3 7h8v10h10"/><path d="M3 4v6M21 14v6"/>',
    tank: '<ellipse cx="12" cy="5" rx="7" ry="2.5"/><path d="M5 5v14c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5"/><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
    camera: '<rect x="2" y="7" width="14" height="10" rx="2"/><path d="m16 11 6-3v8l-6-3"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    gate: '<path d="M3 21V4M21 21V4M3 8h18M3 16h18M8 8v8M13 8v8M18 8v8"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    rain: '<path d="M7 3h10v4H7z"/><path d="M12 7v9a3 3 0 0 0 3 3h5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    photo: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>'
  };
  // emoji 代号 → 图标
  const E = {
    '🛋️': 'sofa', '🛏️': 'bed', '🍽️': 'dining', '📚': 'book', '🍳': 'pot', '🚿': 'shower', '🧺': 'washer', '🌿': 'leaf', '🚗': 'car', '📦': 'box',
    '🚶': 'walk', '🪜': 'stairs', '🌳': 'tree', '⛏️': 'hammer', '🔨': 'hammer', '🧽': 'scraper', '🟫': 'tile', '🧱': 'brick', '🖌️': 'roller', '🎨': 'roller',
    '⬜': 'ceiling', '〰️': 'wave', '💡': 'bulb', '🔌': 'plug', '⚡': 'zap', '💧': 'drop', '🚰': 'tap', '❄️': 'snow', '🌀': 'fan', '♨️': 'flame', '🔥': 'flame',
    '🚽': 'toilet', '🪞': 'mirror', '👕': 'hanger', '🗄️': 'cabinet', '🍶': 'cabinet', '🚪': 'door', '📺': 'tv', '👟': 'shoe', '🖼️': 'frame', '🖥️': 'desk',
    '🪑': 'plusbox', '🎐': 'curtain', '🦟': 'screen', '🪟': 'window', '▭': 'sill', '↔️': 'move', '⛱️': 'awning', '🏗️': 'scaffold', '📄': 'doc', '📶': 'wifi',
    '🕳️': 'pipe', '🛢️': 'tank', '📹': 'camera', '🔔': 'bell', '🔒': 'lock', '🚧': 'gate', '🏠': 'home', '🌧️': 'rain'
  };
  const norm = s => String(s || '').replace(/️/g, '');
  const byNorm = {}; Object.entries(E).forEach(([k, v]) => { byNorm[norm(k)] = v; });
  root.QV2_ICON = function (code, cls) {
    const n = I[code] ? code : byNorm[norm(code)];
    if (!n) return '';
    return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;
  };
  root.QV2_ICON.names = Object.keys(I);
  root.QV2_ICON.missing = codes => codes.filter(c => !byNorm[norm(c)]);
})(typeof window !== 'undefined' ? window : globalThis);
