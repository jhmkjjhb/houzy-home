/* Shared header links, phone menu and footer for the inner pages (collections, craft, partner),
   so they match the homepage, plus the homepage's five-language picker (languages in site-lang.js).
   Each page provides window.houzySetLang(code); labels follow <html lang>. */
(function () {
  var WA = 'https://wa.me/60105898786';
  var T = {
    'zh-CN': { shop: '商城', portal: '客户中心', book: '预约', menu: '菜单', close: '关闭', styles: '风格系列', craft: '精工工艺',
          packages: '整装套餐', store: '线上商城', story: '品牌故事', more: '更多', follow: '关注', contact: '联系',
          hours: '每天 10:00 – 19:30', careers: '企业招聘', partner: '合作伙伴', brand: '品牌手册', staff: '员工入口',
          copy: '© 2026 HOUZY HOME SDN. BHD. · 中国合屋整装控股广州有限公司 版权所有' },
    en: { shop: 'Shop', portal: 'Customer Portal', book: 'Book', menu: 'Menu', close: 'Close', styles: 'Styles', craft: 'Craftsmanship',
          packages: 'Renovation Packages', store: 'Online Shop', story: 'Our Story', more: 'More', follow: 'Follow', contact: 'Contact',
          hours: 'Daily 10:00 – 19:30', careers: 'Careers', partner: 'Partner with HOUZY', brand: 'Brand & Identity', staff: 'Staff',
          copy: '© 2026 HOUZY HOME SDN. BHD. · 中国合屋整装控股广州有限公司 All rights reserved.' },
    'zh-TW': { shop: '商城', portal: '客戶中心', book: '預約', menu: '選單', close: '關閉', styles: '風格系列', craft: '精工工藝',
          packages: '整裝套餐', store: '線上商城', story: '品牌故事', more: '更多', follow: '關注', contact: '聯絡',
          hours: '每天 10:00 – 19:30', careers: '企業招聘', partner: '合作夥伴', brand: '品牌手冊', staff: '員工入口',
          copy: '© 2026 HOUZY HOME SDN. BHD. · 中国合屋整装控股广州有限公司 版權所有', lang: '語言' },
    ms: { shop: 'Kedai', portal: 'Portal Pelanggan', book: 'Tempah', menu: 'Menu', close: 'Tutup', styles: 'Gaya', craft: 'Ketukangan',
          packages: 'Pakej Renovasi', store: 'Kedai Dalam Talian', story: 'Kisah Kami', more: 'Lagi', follow: 'Ikuti', contact: 'Hubungi',
          hours: 'Setiap hari 10:00 – 19:30', careers: 'Kerjaya', partner: 'Jadi rakan HOUZY', brand: 'Jenama & Visual', staff: 'Staf',
          copy: '© 2026 HOUZY HOME SDN. BHD. · 中国合屋整装控股广州有限公司 Hak cipta terpelihara.', lang: 'Bahasa' },
    th: { shop: 'ร้านค้า', portal: 'พอร์ทัลลูกค้า', book: 'จอง', menu: 'เมนู', close: 'ปิด', styles: 'สไตล์', craft: 'งานฝีมือ',
          packages: 'แพ็กเกจรีโนเวท', store: 'ร้านค้าออนไลน์', story: 'เรื่องราวของเรา', more: 'เพิ่มเติม', follow: 'ติดตาม', contact: 'ติดต่อ',
          hours: 'ทุกวัน 10:00 – 19:30', careers: 'ร่วมงานกับเรา', partner: 'ร่วมงานกับ HOUZY', brand: 'แบรนด์ & ภาพ', staff: 'พนักงาน',
          copy: '© 2026 HOUZY HOME SDN. BHD. · 中国合屋整装控股广州有限公司 สงวนลิขสิทธิ์', lang: 'ภาษา' }
  };
  T['zh-CN'].lang = '语言'; T.en.lang = 'Language';
  var ext = ' target="_blank" rel="noopener"';
  function k(key) { return '<span data-hz="' + key + '"></span>'; }

  // Header: the homepage's four links, then the language picker (replaces the page's old 中文/EN toggle).
  var right = document.querySelector('.nav-right, .bar-r');
  if (!right) return;
  var nav = document.createElement('span');
  nav.className = 'hz-nav';
  nav.innerHTML = '<a href="https://houzyhomestore.com"' + ext + '>' + k('shop') + '</a><a href="' + WA + '"' + ext + '>WhatsApp</a>' +
    '<a href="/portal/login.html">' + k('portal') + '</a><a href="/#contact">' + k('book') + '</a>';
  var lang = document.createElement('div');
  lang.className = 'hz-lang';
  lang.innerHTML = '<button type="button" class="hz-lang-btn" aria-haspopup="true" aria-expanded="false"></button><div class="hz-lang-menu" hidden>' +
    HOUZY_LANGS.map(function (l) { return '<button type="button" lang="' + l[0] + '" data-code="' + l[0] + '">' + l[1] + '</button>'; }).join('') + '</div>';
  var oldLang = right.querySelector('.lang');
  if (oldLang) oldLang.replaceWith(lang); else right.appendChild(lang);
  right.insertBefore(nav, lang);
  var langBtn = lang.firstChild, langMenu = lang.lastChild;
  function setLangMenu(open) { langMenu.hidden = !open; langBtn.setAttribute('aria-expanded', String(open)); }
  langBtn.addEventListener('click', function () { setLangMenu(langMenu.hidden); });
  langMenu.addEventListener('click', function (e) {
    var b = e.target.closest('[data-code]'); if (!b) return;
    try { localStorage.setItem('houzy-lang', b.dataset.code); } catch (err) {}
    if (window.houzySetLang) window.houzySetLang(b.dataset.code);
    setLangMenu(false);
  });
  document.addEventListener('click', function (e) { if (!lang.contains(e.target)) setLangMenu(false); });
  var burger = document.createElement('button');
  burger.type = 'button'; burger.className = 'hz-burger'; burger.setAttribute('aria-controls', 'hzMenu'); burger.setAttribute('aria-expanded', 'false');
  right.appendChild(burger);
  document.documentElement.classList.add('hz-chrome');

  // Phone menu, same order as the homepage menu with Customer Portal first.
  var menu = document.createElement('nav');
  menu.className = 'hz-menu'; menu.id = 'hzMenu';
  menu.innerHTML = '<button class="hz-mx" type="button">×</button>' +
    '<a class="hz-portal" href="/portal/login.html">' + k('portal') + '</a>' +
    '<a class="hz-h" href="/collections.html">' + k('styles') + '</a><a class="hz-h" href="/craft.html">' + k('craft') + '</a>' +
    '<a class="hz-h" href="/#packages">' + k('packages') + '</a><a class="hz-h" href="https://houzyhomestore.com"' + ext + '>' + k('store') + '</a>' +
    '<a class="hz-h" href="/#about">' + k('story') + '</a>' +
    '<p class="hz-row"><a href="' + WA + '"' + ext + '>WhatsApp</a><a href="/#contact">' + k('book') + '</a></p>';
  document.body.appendChild(menu);
  function setMenu(open) {
    menu.classList.toggle('open', open); burger.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  }
  burger.addEventListener('click', function () { setMenu(true); });
  menu.querySelector('.hz-mx').addEventListener('click', function () { setMenu(false); });
  menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  addEventListener('keydown', function (e) { if (e.key === 'Escape') { setMenu(false); setLangMenu(false); } });

  // Footer: the homepage's columns (staff manual and academy stay on the homepage only).
  var foot = document.createElement('footer');
  foot.className = 'hz-ft';
  foot.innerHTML =
    '<div><span class="hz-s">HOUZY HOME SDN. BHD.</span><p>141, Jalan Mutiara Emas 10/19<br>Taman Mount Austin, 81100 Johor Bahru<br>' + k('hours') + '</p></div>' +
    '<div><span class="hz-s">' + k('more') + '</span><ul><li><a href="/#careers">' + k('careers') + '</a></li><li><a href="/partner.html">' + k('partner') + '</a></li>' +
      '<li><a href="/brand.html"' + ext + '>' + k('brand') + '</a></li><li><a href="/hub/">' + k('staff') + '</a></li></ul></div>' +
    '<div><span class="hz-s">' + k('follow') + '</span><ul><li><a href="https://www.instagram.com/houzyhome" target="_blank" rel="noopener noreferrer">Instagram</a></li>' +
      '<li><a href="https://www.facebook.com/share/1ETsA9Cttx/" target="_blank" rel="noopener noreferrer">Facebook</a></li>' +
      '<li><a href="https://xhslink.com/m/1sEcjBUkPek" target="_blank" rel="noopener noreferrer">小红书</a></li><li><a href="https://houzyhomestore.com"' + ext + '>' + k('store') + '</a></li></ul></div>' +
    '<div><span class="hz-s">' + k('contact') + '</span><p><a href="' + WA + '"' + ext + '>WhatsApp +60 10-589 8786</a></p></div>' +
    '<p class="hz-copy">' + k('copy') + '</p>';
  var old = document.querySelector('footer.foot');
  if (old) old.replaceWith(foot); else document.body.insertBefore(foot, menu);

  function words() {
    var code = document.documentElement.lang, t = T[code] || T.en;
    var l = HOUZY_LANGS.filter(function (x) { return x[0] === code; })[0] || HOUZY_LANGS[0];
    langBtn.textContent = l[2] + ' ▾'; langBtn.setAttribute('aria-label', t.lang + ': ' + l[1]);
    langMenu.querySelectorAll('[data-code]').forEach(function (b) { b.setAttribute('aria-current', String(b.dataset.code === code)); });
    document.querySelectorAll('[data-hz]').forEach(function (el) { el.textContent = t[el.dataset.hz]; });
    burger.setAttribute('aria-label', t.menu); menu.querySelector('.hz-mx').setAttribute('aria-label', t.close);
  }
  words();
  new MutationObserver(words).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
})();
