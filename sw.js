/* RouteWeather 山途智行 · Service Worker
 * 只缓存本站外壳，不缓存天气/路径/POI 接口与地图瓦片。
 */
const CACHE = 'rwc-shell-v92';

const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'css/redesign.css',
  'css/product-ui.css',
  'css/immersive-ui.css',
  'css/readability.css',
  'js/config.js',
  'js/points.js',
  'js/api.js',
  'js/routing.js',
  'js/scoring.js',
  'js/storage.js',
  'js/geocode.js',
  'js/route-segments.js',
  'js/poi.js',
  'js/map.js',
  'js/app.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/routeweather.svg',
  'assets/hero-alpine.webp',
  'assets/hero-alpine-road.png',
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
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
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

  e.respondWith(
    caches.match(req).then(hit => {
      const network = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(async () => hit || (await caches.match(req, { ignoreSearch: true })) || Response.error());
      return hit || network;
    })
  );
});
