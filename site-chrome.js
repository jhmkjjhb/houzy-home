/* Shared header links, phone menu and footer for the inner pages (collections, craft, partner),
   so they match the homepage. Each page keeps its own 中文/EN toggle; labels follow <html lang>. */
(function () {
  var WA = 'https://wa.me/60105898786';
  var T = {
    zh: { shop: '商城', portal: '客户中心', book: '预约', menu: '菜单', close: '关闭', styles: '风格系列', craft: '精工工艺',
          packages: '整装套餐', store: '线上商城', story: '品牌故事', more: '更多', follow: '关注', contact: '联系',
          hours: '每天 10:00 – 19:30', careers: '企业招聘', partner: '合作伙伴', brand: '品牌手册', staff: '员工入口',
          copy: '© 2026 HOUZY HOME SDN. BHD. 版权所有' },
    en: { shop: 'Shop', portal: 'Customer Portal', book: 'Book', menu: 'Menu', close: 'Close', styles: 'Styles', craft: 'Craftsmanship',
          packages: 'Renovation Packages', store: 'Online Shop', story: 'Our Story', more: 'More', follow: 'Follow', contact: 'Contact',
          hours: 'Daily 10:00 – 19:30', careers: 'Careers', partner: 'Partner with HOUZY', brand: 'Brand & Identity', staff: 'Staff',
          copy: '© 2026 HOUZY HOME SDN. BHD. All rights reserved.' }
  };
  var ext = ' target="_blank" rel="noopener"';
  function k(key) { return '<span data-hz="' + key + '"></span>'; }

  // Header: the homepage's four links, before the page's own language toggle.
  var right = document.querySelector('.nav-right, .bar-r');
  if (!right) return;
  var nav = document.createElement('span');
  nav.className = 'hz-nav';
  nav.innerHTML = '<a href="https://houzyhomestore.com"' + ext + '>' + k('shop') + '</a><a href="' + WA + '"' + ext + '>WhatsApp</a>' +
    '<a href="/portal/login.html">' + k('portal') + '</a><a href="/#contact">' + k('book') + '</a>';
  var lang = right.querySelector('.lang');
  right.insertBefore(nav, lang);
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
  addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });

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
    var t = T[(document.documentElement.lang || '').indexOf('zh') === 0 ? 'zh' : 'en'];
    document.querySelectorAll('[data-hz]').forEach(function (el) { el.textContent = t[el.dataset.hz]; });
    burger.setAttribute('aria-label', t.menu); menu.querySelector('.hz-mx').setAttribute('aria-label', t.close);
  }
  words();
  new MutationObserver(words).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
})();
