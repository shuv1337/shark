const PRECACHE = /* __PRECACHE__ */ [];
const VERSION = "__VERSION__";
const CACHE_PREFIX = "shark-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const SHELL_DOCUMENTS = ["/board", "/inbox", "/teams", "/settings"];
const PRECACHE_PATHS = new Set(PRECACHE);

/*
 * Privacy rule: no authenticated JSON is ever cached. Only the build's exact
 * hashed asset allowlist and the four HTML shell documents may enter this cache.
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

  const networkOnlyNavigation =
    ["/api", "/hooks", "/mcp", "/.well-known"].some(
      (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    ) || /\/[^/]+\.[^/]+$/.test(url.pathname);
  if (networkOnlyNavigation) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const shell = (await cache.match(url.pathname)) || (await cache.match("/board"));
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
      url: typeof payload.url === "string" ? payload.url : "/inbox",
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

/*
 * Where a tapped notification opens.
 *
 * A service can set a tap URL on another site deliberately — a CI run, a pull
 * request — so an absolute http(s) URL is allowed to leave this origin. What
 * is not allowed is a URL dressed up as this one. `https://shark.example@evil.test/`
 * has origin `evil.test` and a username that reads like the real host, and a
 * string that is not absolute can still resolve somewhere else entirely:
 * `//evil.test`, `/\evil.test` and `///evil.test` all parse into another
 * origin against this one. So credentials are refused outright, and anything
 * that was not written as an absolute URL has to still be on this origin
 * after parsing. Everything else falls back to the inbox.
 */
function notificationTarget(raw) {
  const fallback = new URL("/inbox", self.location.origin);
  if (typeof raw !== "string" || raw === "") return fallback;
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  let candidate;
  try {
    candidate = new URL(raw, self.location.origin);
  } catch {
    return fallback;
  }
  if (candidate.protocol !== "https:" && candidate.protocol !== "http:") return fallback;
  if (candidate.username || candidate.password) return fallback;
  if (!absolute && candidate.origin !== self.location.origin) return fallback;
  return candidate;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // A notification with no URL of its own opens the inbox, where its own
  // record is. `/dashboard` still redirects, so older payloads keep working.
  const target = notificationTarget(event.notification.data?.url);

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url === target.href);
      if (existing) return existing.focus();
      return clients.openWindow(target.href);
    }),
  );
});
