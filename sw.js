// 音蔵 Service Worker (cache bust by VERSION)
const VERSION = '20250830174020';
const CACHE_NAME = `otokura-v${VERSION}`;
// scope 対応: GitHub Pages のサブパスでも動くように、登録スコープ基準でパスを組み立て
const SCOPE = (self.registration && self.registration.scope) || '/';
const base = (p) => new URL(p, SCOPE).pathname + (p.includes('?') ? '' : `?v=${VERSION}`);
const CORE = [
  new URL('.', SCOPE).pathname, // スコープ直下
  base('index.html'),
  base('assets/css/style.css'),
  base('src/js/main.js'),
  base('src/js/ui.js'),
  base('src/js/storage.js'),
  base('src/js/db.js'),
  base('src/js/metrics.js'),
  base('src/js/player.js'),
  base('manifest.webmanifest'),
  base('assets/icons/icon-192.png'),
  base('assets/icons/icon-512.png'),
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
        // fallback to scope-relative index for navigation
        if (e.request.mode === 'navigate') return caches.match(base('index.html'));
        throw new Error('offline');
      }
    })());
  }
});
