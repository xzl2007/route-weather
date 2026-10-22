/* 路线天气体检 · Service Worker
 * ------------------------------------------------------------
 * 只缓存本站外壳（HTML/CSS/JS/字体图标），不缓存：
 *   · Open-Meteo / OSRM / 天地图的接口响应（由 localStorage 管缓存与过期）
 *   · 地图瓦片（量大且随位置变化）
 * 导航请求走「网络优先」，保证更新能及时生效；断网时回落到缓存外壳。
 */

const CACHE = 'rwc-shell-v8';

const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/config.js',
  'js/points.js',
  'js/api.js',
  'js/routing.js',
  'js/scoring.js',
  'js/storage.js',
  'js/geocode.js',
  'js/map.js',
  'js/app.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[sw] 预缓存失败：', err))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // 接口与瓦片交给网络

  if (req.mode === 'navigate') {
    // 网络优先：保证刷新即最新；离线回落缓存外壳
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
    );
    return;
  }

  // 静态资源：先给缓存（快），后台顺便更新
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      const network = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || network;
    })
  );
});
