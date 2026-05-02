// Service Worker für CS Portfolio Tracker PWA
const CACHE_NAME = 'cs-portfolio-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(['/','/icon.png']))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request).catch(() => new Response('Offline - resource not available in cache.', { status: 503, statusText: 'Service Unavailable', headers: { 'Content-Type': 'text/plain' } })))
  );
});

