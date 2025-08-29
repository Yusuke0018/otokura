// 音蔵 Service Worker (cache bust by VERSION)
const VERSION = '20250829212418';
const CACHE_NAME = `otokura-v${VERSION}`;
const CORE = [
  '/',
  `/index.html?v=${VERSION}`,
  `/assets/css/style.css?v=${VERSION}`,
  `/src/js/main.js?v=${VERSION}`,
  `/src/js/ui.js?v=${VERSION}`,
  `/src/js/storage.js?v=${VERSION}`,
  `/src/js/db.js?v=${VERSION}`,
  `/src/js/metrics.js?v=${VERSION}`,
  `/src/js/player.js?v=${VERSION}`,
  `/manifest.webmanifest?v=${VERSION}`,
  `/assets/icons/icon-192.png?v=${VERSION}`,
  `/assets/icons/icon-512.png?v=${VERSION}`,
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const net = await fetch(e.request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(e.request, net.clone());
        return net;
      } catch {
        const match = await caches.match(e.request, { ignoreSearch: false });
        if (match) return match;
        // fallback to index for navigation
        if (e.request.mode === 'navigate') return caches.match(`/index.html?v=${VERSION}`);
        throw new Error('offline');
      }
    })());
  }
});

