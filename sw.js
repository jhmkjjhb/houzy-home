// HOUZY HOME Service Worker
// 版本号由 .githooks/pre-commit 自动注入(git 短 hash + 时间戳)
// 改了此文件后请确保 hook 已启用:bash scripts/setup-pwa.sh
const CACHE_VERSION = 'e012605-20260602154101';
const CACHE_NAME = 'houzy-' + CACHE_VERSION;

// 安装时预缓存的基础资源(可选,首次安装就缓存)
const PRECACHE = [
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
  '/favicon.svg',
  '/portal/houzy-brand.css',
  '/portal/houzy-icons.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE).catch(() => {/* 任何一个失败也不阻塞安装 */}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // 清理所有旧版本缓存,只留当前版本
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k.startsWith('houzy-') && k !== CACHE_NAME)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只处理 GET 请求
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 只处理 http(s) 请求 — 忽略 chrome-extension://、ws://、blob: 等
  // (浏览器规定这些 scheme 不能放 Cache,放了就报错)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 1) Supabase API — 永不缓存(订单/库存等实时数据)
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) {
    return; // 走浏览器默认网络请求
  }

  // 2) 跨域第三方资源(Tailwind CDN / supabase-js / jsdelivr / SheetJS 等)
  //    策略:stale-while-revalidate(优先用缓存秒回,后台静默更新)
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(req).then(cached => {
          const network = fetch(req).then(resp => {
            if (resp && resp.status === 200) cache.put(req, resp.clone());
            return resp;
          }).catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  // 3) 同源 HTML / 导航请求 — network-first
  //    总是先去服务器拿新版本,网络挂了才用缓存兜底
  const isHTML = req.destination === 'document'
              || req.mode === 'navigate'
              || url.pathname.endsWith('.html')
              || url.pathname === '/' || url.pathname.endsWith('/');
  if (isHTML) {
    event.respondWith(
      fetch(req).then(resp => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return resp;
      }).catch(() =>
        caches.match(req).then(c => c || caches.match('/portal/login.html'))
      )
    );
    return;
  }

  // 4) 同源静态资源(CSS/JS/图标/字体) — cache-first
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return resp;
      });
    })
  );
});

// 接收页面发来的 SKIP_WAITING 消息(可选,前端可以加按钮触发立即更新)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
