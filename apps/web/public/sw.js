// Service Worker fuer CS Portfolio Tracker PWA
// Wichtig: Kein cache-first fuer Navigation/HTML, sonst bleiben alte App-Versionen haengen.
const CACHE_NAME = "cs-portfolio-v2";
const STATIC_ASSETS = ["/icon.png", "/manifest.json"];
const CS_UPDATE_NOTIFICATION_TAG = "cs-updates-latest";

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

async function fetchLatestCsUpdate() {
  try {
    const response = await fetch("/api/index.php/api/v1/cs-updates?limit=1", {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const items = Array.isArray(payload?.data?.items) ? payload.data.items : [];
    return items[0] || null;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const latest = await fetchLatestCsUpdate();
      const title = latest?.title || "Neues CS Update";
      const body = latest?.summary || "Ein neues Counter-Strike Update ist verfuegbar.";
      const targetUrl = "/#/cs-updates";

      await self.registration.showNotification(title, {
        body,
        icon: "/icon.png",
        badge: "/icon.png",
        tag: CS_UPDATE_NOTIFICATION_TAG,
        renotify: true,
        data: {
          url: targetUrl,
          itemId: latest?.id || null,
        },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const targetUrl = event.notification?.data?.url || "/#/cs-updates";
      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          if (typeof client.navigate === "function") {
            await client.navigate(targetUrl);
          }
          await client.focus();
          return;
        }
      }
      await clients.openWindow(targetUrl);
    })(),
  );
});
