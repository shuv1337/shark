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

function cacheKey(path) {
  return new Request(path, { credentials: "same-origin" });
}

async function cacheHolds(cache, path) {
  return Boolean(await cache.match(path));
}

async function shellCacheComplete(cache) {
  if (!(await cacheHolds(cache, "/board"))) return false;
  for (const path of PRECACHE) {
    if (!(await cacheHolds(cache, path))) return false;
  }
  return true;
}

async function previousShellCacheNames() {
  const names = await caches.keys();
  return names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
}

async function dropPreviousShellCaches() {
  await Promise.all((await previousShellCacheNames()).map((name) => caches.delete(name)));
}

async function copyMissing(from, to) {
  for (const path of [...PRECACHE, ...SHELL_DOCUMENTS]) {
    if (await cacheHolds(to, path)) continue;
    const hit = await from.match(path);
    if (!hit?.ok) continue;
    try {
      await to.put(cacheKey(path), hit);
    } catch {
      // The previous cache still has the copy this one refused.
    }
  }
}

/*
 * A signed-out install stores nothing: precache requests 401 and the failure is
 * swallowed so push registration still succeeds. Dropping every other
 * shark-shell cache then would delete the last offline copy. Keep those caches
 * until this one holds /board and the precache, after copying whatever they
 * still have so this worker can serve it.
 */
async function retainPreviousUntilComplete() {
  const current = await caches.open(CACHE_NAME);
  if (!(await shellCacheComplete(current))) {
    const previous = (await previousShellCacheNames()).reverse();
    for (const name of previous) await copyMissing(await caches.open(name), current);
  }
  if (await shellCacheComplete(current)) await dropPreviousShellCaches();
}

function shellDocument(pathname) {
  if (SHELL_DOCUMENTS.includes(pathname)) return pathname;
  if (pathname.startsWith("/board/")) return "/board";
  if (pathname.startsWith("/inbox/")) return "/inbox";
  if (pathname.startsWith("/teams/")) return "/teams";
  return null;
}

function responsePath(response) {
  try {
    const url = new URL(response.url);
    if (url.origin !== self.location.origin) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function contentType(response) {
  try {
    return (response.headers?.get("content-type") || "").toLowerCase();
  } catch {
    return "";
  }
}

function storableShell(response) {
  if (!response?.ok || response.redirected) return false;
  const path = responsePath(response);
  if (!path || path === "/login" || path.startsWith("/login/")) return false;
  return contentType(response).includes("text/html");
}

function storableAsset(response) {
  if (!response?.ok || response.redirected) return false;
  const path = responsePath(response);
  if (path === null || path === "/login" || path.startsWith("/login/")) return false;
  return !contentType(response).includes("text/html");
}

async function remember(path, response) {
  const current = await caches.open(CACHE_NAME);
  await current.put(cacheKey(path), response);
  if (await shellCacheComplete(current)) await dropPreviousShellCaches();
}

async function matchPrevious(path) {
  for (const name of (await previousShellCacheNames()).reverse()) {
    const hit = await (await caches.open(name)).match(path);
    if (hit) return hit;
  }
  return undefined;
}

async function matchAny(path) {
  if (!path) return undefined;
  const current = await caches.open(CACHE_NAME);
  return (await current.match(path)) || matchPrevious(path);
}

async function respondWithAsset(path, request) {
  const cached = await matchAny(path);
  if (cached) return cached;
  const response = await fetch(request);
  if (storableAsset(response)) {
    try {
      await remember(path, response.clone());
    } catch {
      // The page still needs the response when the cache refuses it.
    }
  }
  return response;
}

async function respondWithNavigation(pathname, request) {
  try {
    const response = await fetch(request);
    const shell = shellDocument(pathname);
    if (shell && storableShell(response)) {
      try {
        await remember(shell, response.clone());
      } catch {
        // The page still loads; the next visit can try again.
      }
    }
    return response;
  } catch {
    const shell =
      (await matchAny(pathname)) ||
      (await matchAny(shellDocument(pathname))) ||
      (await matchAny("/board"));
    return shell || offlineResponse();
  }
}

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
    retainPreviousUntilComplete()
      .catch(() => {
        // A cache failure must not keep the new push handlers from taking over.
      })
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
    event.respondWith(respondWithAsset(url.pathname, request));
    return;
  }

  const networkOnlyNavigation =
    ["/api", "/hooks", "/mcp", "/.well-known"].some(
      (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    ) || /\/[^/]+\.[^/]+$/.test(url.pathname);
  if (networkOnlyNavigation) return;

  if (request.mode === "navigate") {
    event.respondWith(respondWithNavigation(url.pathname, request));
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
