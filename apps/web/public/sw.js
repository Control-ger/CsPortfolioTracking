// Service Worker fuer CS Portfolio Tracker PWA
// Wichtig: Kein cache-first fuer Navigation/HTML, sonst bleiben alte App-Versionen haengen.
const CACHE_NAME = "cs-portfolio-v2";
const STATIC_ASSETS = ["/icon.png", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // API immer direkt aus dem Netz holen.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Navigations-Requests: network-first, damit neue Deploys sofort wirksam sind.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response("Offline - navigation unavailable.", {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "Content-Type": "text/plain" },
          })
      )
    );
    return;
  }

  // Statische Assets: network-first mit Cache-Fallback.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(
        () =>
          caches.match(event.request).then(
            (cached) =>
              cached ||
              new Response("Offline - resource not available in cache.", {
                status: 503,
                statusText: "Service Unavailable",
                headers: { "Content-Type": "text/plain" },
              })
          )
      )
  );
});
