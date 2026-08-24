const ROK_CACHE = 'rok-lite-v9-88-online-tiempo-real-audit';
const ROK_SHELL = [
  './',
  './index.html',
  './style.css?v=rok-v9-88-online-tiempo-real-audit',
  './rok-layout-scale.js?v=rok-v9-88-online-tiempo-real-audit',
  './game.js?v=rok-v9-88-online-tiempo-real-audit',
  './firebase-online.js?v=rok-v9-88-online-tiempo-real-audit',
  './assets/kast-cell-icon.jpg',
  './assets/pwa/rok-icon-192.png',
  './assets/pwa/rok-icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(ROK_CACHE)
      .then(cache => cache.addAll(ROK_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== ROK_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(ROK_CACHE).then(cache => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(ROK_CACHE).then(cache => cache.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
