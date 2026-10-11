const PRECACHE = /* __PRECACHE__ */ [];
const VERSION = "__VERSION__";
const CACHE_PREFIX = "shark-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const SHELL_DOCUMENTS = ["/board", "/dashboard"];
const PRECACHE_PATHS = new Set(PRECACHE);

/*
 * Privacy rule: no authenticated JSON is ever cached. Only the build's exact
 * hashed asset allowlist and the two HTML shell documents may enter this cache.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const path of [...PRECACHE, ...SHELL_DOCUMENTS]) {
        try {
          await cache.add(new Request(path, { credentials: "same-origin" }));
        } catch {
          // A signed-out browser cannot fetch private assets or shells. That must
          // not make installation fail; the next worker can still handle push.
        }
      }
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "hark:skip-waiting") {
    event.waitUntil(self.skipWaiting());
  }
  if (event.data?.type === "hark:get-version") {
    event.source?.postMessage({ type: "hark:sw-version", version: VERSION });
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/assets/") && PRECACHE_PATHS.has(url.pathname)) {
    event.respondWith(
      caches
        .open(CACHE_NAME)
        .then((cache) => cache.match(request))
        .then((cached) => cached || fetch(request)),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const shell = await cache.match("/board");
        return shell || offlineResponse();
      }),
    );
  }
});

function offlineResponse() {
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0F1115"><title>SHark — Offline</title><style>body{margin:0;background:#0F1115;color:#fafafa;font:16px system-ui;display:grid;min-height:100vh;place-items:center}main{text-align:center;padding:2rem}button{font:inherit;padding:.7rem 1rem;border:0;border-radius:.5rem;cursor:pointer}</style><main><h1>You\'re offline</h1><p>Reconnect to open SHark.</p><button onclick="location.reload()">Retry</button></main>',
    { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 },
  );
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() };
  }

  // Notify every open page, including tabs opened before the worker registered.
  // Keep this independent of notification presentation or withdrawal failures.
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) client.postMessage({ type: "hark:inbox-updated" });
    }),
  );

  if (payload.command === "notification.withdraw") {
    event.waitUntil(withdrawPresentedNotifications(payload));
    return;
  }

  const title = typeof payload.title === "string" ? payload.title : "SHark";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "You have a new SHark alert.",
    icon: "/app-store-icon.png",
    badge: "/favicon.png",
    data: {
      url: typeof payload.url === "string" ? payload.url : "/dashboard",
      ...(typeof payload.eventId === "string" ? { eventId: payload.eventId } : {}),
    },
  };
  if (typeof payload.imageUrl === "string") options.image = payload.imageUrl;
  if (typeof payload.tag === "string") options.tag = payload.tag;

  event.waitUntil(self.registration.showNotification(title, options));
});

async function withdrawPresentedNotifications(payload) {
  const eventId = typeof payload.eventId === "string" ? payload.eventId : "";
  if (!eventId) return;

  const tagged =
    typeof payload.tag === "string"
      ? await self.registration.getNotifications({ tag: payload.tag })
      : [];
  for (const notification of tagged) notification.close();

  const remaining = await self.registration.getNotifications();
  for (const notification of remaining) {
    if (notification.data?.eventId === eventId) notification.close();
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  let target = new URL("/dashboard", self.location.origin);
  try {
    const candidate = new URL(event.notification.data?.url || "/dashboard", self.location.origin);
    if (candidate.protocol === "https:" || candidate.protocol === "http:") target = candidate;
  } catch {
    // Keep the safe dashboard fallback.
  }

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url === target.href);
      if (existing) return existing.focus();
      return clients.openWindow(target.href);
    }),
  );
});
