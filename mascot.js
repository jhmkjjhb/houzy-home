/* Site-wide 8% offer mascot: a small geometric gold-line cat rises at a random spot along the bottom
   once per visit, after the visitor has been on the page a while. Closing it hides it for the rest of the day.
   Text follows <html lang>, so it switches with each page's own language buttons. */
(function () {
  var LINK = '/campaign/renewal-2026.html#calculator', DELAY = 8000;
  var TEXT = {
    'en':    ['Ready for a new home?', 'Save 8% — see how much', 'Close'],
    'zh-CN': ['想装新家？先省 8%。', '算算能省多少 →', '关闭'],
    'zh-TW': ['想裝新家？先省 8%。', '算算能省多少 →', '關閉'],
    'ms':    ['Rumah baharu? Jimat 8%.', 'Kira penjimatan →', 'Tutup'],
    'th':    ['บ้านใหม่ในฝัน? ลด 8%', 'ดูว่าประหยัดเท่าไร →', 'ปิด']
  };
  var store = function (k, v) { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch (e) { return null; } };
  var once = function (k) { try { if (sessionStorage.getItem(k)) return false; sessionStorage.setItem(k, '1'); return true; } catch (e) { return true; } };
  var today = new Date().toISOString().slice(0, 10);
  // ?cat in the address shows the cat straight away, ignoring the once-a-visit and closed-today limits (for checking it).
  var preview = /[?&]cat\b/.test(location.search);
  if (preview) DELAY = 500;
  else {
  if (location.pathname.indexOf('/campaign/') === 0) return;      // already on the offer page
  if (store('houzy-mascot-closed') === today) return;              // closed today
  if (!once('houzy-mascot-shown')) return;                         // once per visit
  }

  var css = '.hz-m{position:fixed;z-index:40;display:flex;align-items:flex-end;gap:10px;color:var(--ink,#1b1e1b);font-family:var(--sans,system-ui,sans-serif);transition:transform .7s cubic-bezier(.2,.8,.2,1),opacity .4s ease;opacity:0}' +
    '.hz-m.in{opacity:1;transform:none!important}' +
    '.hz-m.in.quiet{opacity:0;pointer-events:none}' +
    '.hz-m svg{width:64px;height:auto;flex:none;display:block}' +
    '.hz-m .hz-w{position:relative;margin-bottom:22px}.hz-m .hz-b{display:block;padding:12px 30px 12px 14px;background:var(--bg,#eceee8);border:1px solid #b08d57;font-size:13px;line-height:1.55;letter-spacing:.04em;text-decoration:none;color:inherit;max-width:210px;cursor:pointer}' +
    '.hz-m .hz-b b{display:block;font-weight:400}.hz-m .hz-b span{display:block;margin-top:2px;text-decoration:underline;text-underline-offset:3px;opacity:.75}' +
    '.hz-m .hz-x{position:absolute;top:2px;right:2px;width:26px;height:26px;padding:0;border:0;background:none;color:inherit;font-size:16px;line-height:1;cursor:pointer}' +
    '.hz-m a:focus-visible,.hz-m button:focus-visible{outline:2px solid currentColor;outline-offset:3px}' +
    '.hz-m.bl{left:16px;bottom:16px;transform:translateY(calc(100% + 20px))}.hz-m.br{right:16px;bottom:16px;flex-direction:row-reverse;transform:translateY(calc(100% + 20px))}' +
    '.hz-m.bm{left:58%;bottom:16px;transform:translateY(calc(100% + 20px))}' +
    '@media(max-width:899px){.hz-m.bm{left:auto;right:12px;flex-direction:row-reverse}.hz-m.bl,.hz-m.bm,.hz-m.br{bottom:70px}.hz-m svg{width:54px}.hz-m .hz-w{margin-bottom:18px}.hz-m .hz-b{font-size:12px}}' +
    '@media(prefers-reduced-motion:reduce){.hz-m{transition:opacity .3s ease;transform:none!important}}';

  // Original cat in a Song-dynasty spirit, built only from circles, arcs and straight lines:
  // half-dome body, round head, triangle ears in the brand green, arc tail, half-closed eyes, one fine gold line.
  var svg = '<svg viewBox="32 34 70 62" fill="none" stroke="#b08d57" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M38 92A24 30 0 0 1 86 92z" fill="var(--bg,#eceee8)"/>' +                     // body: half dome
    '<path d="M86 92A15 15 0 0 0 96 70"/>' +                                                // tail: arc
    '<path d="M38.2 54L37 39.5L45.5 47.6z" fill="#193d30"/><path d="M48.5 47.6L57 39.5L55.8 54z" fill="#193d30"/>' + // ears in brand green
    '<circle cx="47" cy="58" r="12" fill="var(--bg,#eceee8)"/>' +                           // head
    '<path d="M42 59h4M50 59h4" stroke-width="1"/>' +                                       // eyes: half closed
    '</svg>';

  function build() {
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    var box = document.createElement('div');
    box.className = 'hz-m ' + ['bl', 'bm', 'br'][Math.floor(Math.random() * 3)];
    box.setAttribute('role', 'complementary');
    box.innerHTML = svg + '<div class="hz-w"><a class="hz-b" href="' + LINK + '"><b></b><span></span></a><button class="hz-x" type="button">×</button></div>';
    var bubble = box.querySelector('.hz-b'), x = box.querySelector('.hz-x');
    function words() {
      var t = TEXT[document.documentElement.lang] || TEXT[(document.documentElement.lang || '').slice(0, 2)] || TEXT.en;
      bubble.querySelector('b').textContent = t[0]; bubble.querySelector('span').textContent = t[1];
      x.setAttribute('aria-label', t[2]); box.setAttribute('aria-label', t[0]);
    }
    words();
    new MutationObserver(words).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    x.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      store('houzy-mascot-closed', today); box.classList.remove('in');
      setTimeout(function () { box.remove(); }, 700);
    });
    document.body.appendChild(box);
    var packages = document.getElementById('packages');
    if (packages && 'IntersectionObserver' in window) {
      var packageObserver = new IntersectionObserver(function (entries) {
        box.classList.toggle('quiet', entries[0].isIntersecting && window.matchMedia('(max-width:899px)').matches);
      });
      packageObserver.observe(packages);
    }
    requestAnimationFrame(function () { requestAnimationFrame(function () { box.classList.add('in'); }); });
  }
  setTimeout(build, DELAY);
})();
