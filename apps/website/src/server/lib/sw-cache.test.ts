import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../public/sw.js"),
  "utf8",
)
  .replace("/* __PRECACHE__ */ []", '["/assets/x.js"]')
  .replace('"__VERSION__"', '"test-version"');

function harness() {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const asset = new Response("cached asset");
  const shells = new Map(
    ["board", "inbox", "teams", "settings"].map((name) => [
      `/${name}`,
      new Response(`cached ${name} shell`, { headers: { "Content-Type": "text/html" } }),
    ]),
  );
  const match = vi.fn(async (request: { url: string } | string) => {
    const path = typeof request === "string" ? request : new URL(request.url).pathname;
    if (path === "/assets/x.js") return asset;
    return shells.get(path);
  });
  const cache = { add: vi.fn(), match };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
  };
  const fetchMock = vi.fn();
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  const shown: Array<[string, Record<string, unknown>]> = [];
  const opened: string[] = [];
  class WorkerRequest {
    url: string;

    constructor(path: string) {
      this.url = path;
    }
  }
  runInNewContext(source, {
    self: {
      addEventListener: (name: string, listener: (event: Record<string, unknown>) => void) =>
        listeners.set(name, listener),
      location: { origin: "https://shark.example" },
      registration: {
        showNotification: vi.fn((title: string, options: Record<string, unknown>) => {
          shown.push([title, options]);
        }),
        getNotifications: vi.fn(),
      },
      skipWaiting,
    },
    clients: {
      matchAll: vi.fn().mockResolvedValue([]),
      claim: vi.fn(),
      openWindow: vi.fn((url: string) => opened.push(url)),
    },
    caches,
    fetch: fetchMock,
    Request: WorkerRequest,
    Response,
    URL,
    Set,
  });

  async function dispatchFetch(path: string, mode = "cors") {
    let responsePromise: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      request: { method: "GET", mode, url: `https://shark.example${path}` },
      respondWith: (promise: Promise<Response>) => {
        responsePromise = promise;
      },
    });
    return responsePromise;
  }

  async function dispatch(name: string, event: Record<string, unknown>) {
    const pending: Promise<unknown>[] = [];
    listeners.get(name)?.({ ...event, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  }

  return {
    cache,
    caches,
    fetchMock,
    listeners,
    skipWaiting,
    shown,
    opened,
    dispatch,
    dispatchFetch,
    removeShells: () => {
      shells.clear();
    },
  };
}

describe("service worker cache boundary", () => {
  it("never intercepts or caches API GET requests", async () => {
    const worker = harness();
    expect(await worker.dispatchFetch("/api/inbox")).toBeUndefined();
    expect(worker.caches.open).not.toHaveBeenCalled();
    expect(worker.cache.add).not.toHaveBeenCalled();
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it.each(["/api/inbox", "/hooks/x", "/mcp", "/.well-known/x", "/foo.json"])(
    "does not use an app shell for navigation to %s",
    async (path) => {
      const worker = harness();
      expect(await worker.dispatchFetch(path, "navigate")).toBeUndefined();
      expect(worker.caches.open).not.toHaveBeenCalled();
      expect(worker.fetchMock).not.toHaveBeenCalled();
    },
  );

  it("serves an exact precached asset from cache", async () => {
    const worker = harness();
    const response = await worker.dispatchFetch("/assets/x.js");
    expect(await response?.text()).toBe("cached asset");
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the requested cached shell, then board, then offline HTML", async () => {
    const worker = harness();
    worker.fetchMock.mockRejectedValue(new Error("offline"));
    const shell = await worker.dispatchFetch("/inbox", "navigate");
    expect(await shell?.text()).toBe("cached inbox shell");

    const board = await worker.dispatchFetch("/dashboard", "navigate");
    expect(await board?.text()).toBe("cached board shell");

    worker.removeShells();
    const offline = await worker.dispatchFetch("/inbox", "navigate");
    expect(offline?.status).toBe(503);
    expect(await offline?.text()).toContain("You're offline");
  });

  it("precaches only the current app page shells", async () => {
    const worker = harness();
    const pending: Promise<unknown>[] = [];
    worker.listeners.get("install")?.({
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);
    expect(worker.cache.add.mock.calls.map(([request]) => request.url)).toEqual([
      "/assets/x.js",
      "/board",
      "/inbox",
      "/teams",
      "/settings",
    ]);
  });

  it("calls skipWaiting only for the explicit message", async () => {
    const worker = harness();
    const pending: Promise<unknown>[] = [];
    worker.listeners.get("install")?.({
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    worker.listeners.get("message")?.({
      data: { type: "hark:skip-waiting" },
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);
    expect(worker.skipWaiting).toHaveBeenCalledOnce();
  });
});

const CACHE_NAME = "shark-shell-test-version";

/**
 * A response the worker can judge the way a browser fetch result is judged.
 * `url` and `redirected` are otherwise fixed by the platform, and `clone()`
 * does not keep own properties, so the worker must decide before it clones.
 */
function page(
  body: string,
  init: { status?: number; type?: string; url?: string; redirected?: boolean } = {},
) {
  const response = new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": init.type ?? "text/html; charset=utf-8" },
  });
  if (init.url !== undefined) Object.defineProperty(response, "url", { value: init.url });
  if (init.redirected !== undefined) {
    Object.defineProperty(response, "redirected", { value: init.redirected });
  }
  return response;
}

function storageHarness(options: { addFails?: boolean; putFails?: boolean } = {}) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const deleted: string[] = [];
  let claims = 0;

  const pathOf = (request: string | { url: string }) => {
    const url = typeof request === "string" ? request : request.url;
    return url.startsWith("http") ? new URL(url).pathname : url;
  };

  const open = (name: string) => {
    let entries = stores.get(name);
    if (!entries) {
      entries = new Map();
      stores.set(name, entries);
    }
    const bucket = entries;
    return {
      async add(request: { url: string }) {
        if (options.addFails) throw new TypeError("unauthorized");
        const path = pathOf(request);
        bucket.set(
          path,
          new Response(`stored ${path}`, {
            headers: {
              "content-type": path.endsWith(".js") ? "text/javascript" : "text/html",
            },
          }),
        );
      },
      async match(request: string | { url: string }) {
        const hit = bucket.get(pathOf(request));
        return hit ? hit.clone() : undefined;
      },
      async put(request: string | { url: string }, response: Response) {
        if (options.putFails) throw new TypeError("quota");
        bucket.set(pathOf(request), response.clone());
      },
    };
  };

  class WorkerRequest {
    url: string;

    constructor(path: string) {
      this.url = path;
    }
  }

  const fetchMock = vi.fn();
  runInNewContext(source, {
    self: {
      addEventListener: (name: string, listener: (event: Record<string, unknown>) => void) =>
        listeners.set(name, listener),
      location: { origin: "https://shark.example" },
      registration: { showNotification: vi.fn(), getNotifications: vi.fn() },
      skipWaiting: vi.fn().mockResolvedValue(undefined),
    },
    clients: {
      matchAll: vi.fn().mockResolvedValue([{ url: "https://shark.example/board" }]),
      claim: () => {
        claims += 1;
        return Promise.resolve();
      },
      openWindow: vi.fn(),
    },
    caches: {
      open: async (name: string) => open(name),
      keys: async () => [...stores.keys()],
      delete: async (name: string) => {
        deleted.push(name);
        return stores.delete(name);
      },
    },
    fetch: fetchMock,
    Request: WorkerRequest,
    Response,
    URL,
    Set,
  });

  async function dispatch(name: string, event: Record<string, unknown> = {}) {
    const pending: Promise<unknown>[] = [];
    listeners.get(name)?.({
      ...event,
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);
  }

  async function dispatchFetch(path: string, mode = "cors") {
    let responsePromise: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      request: { method: "GET", mode, url: `https://shark.example${path}` },
      respondWith: (promise: Promise<Response>) => {
        responsePromise = promise;
      },
    });
    return responsePromise;
  }

  return {
    deleted,
    claims: () => claims,
    names: () => [...stores.keys()],
    body: async (name: string, path: string) => {
      const hit = stores.get(name)?.get(path);
      return hit ? hit.clone().text() : undefined;
    },
    fetchMock,
    dispatch,
    dispatchFetch,
    seed(name: string, bodies: Record<string, string>) {
      const entries = new Map<string, Response>();
      for (const [path, body] of Object.entries(bodies)) {
        entries.set(
          path,
          new Response(body, {
            headers: {
              "content-type": path.endsWith(".js") ? "text/javascript" : "text/html",
            },
          }),
        );
      }
      stores.set(name, entries);
    },
  };
}

const PREVIOUS = "shark-shell-previous";
const PREVIOUS_SHELLS = {
  "/board": "previous board",
  "/inbox": "previous inbox",
  "/teams": "previous teams",
  "/settings": "previous settings",
  "/assets/x.js": "previous asset",
};

/**
 * Install records a new shark-shell cache even when every `cache.add` fails,
 * which is what a signed-out browser does: pages and assets answer 401, and
 * that failure is swallowed so the push worker can still install. Activation
 * used to delete every other shark-shell cache anyway.
 */
describe("service worker shell retention", () => {
  it("keeps an old shell and its differently hashed assets together until a fresh shell is ready", async () => {
    const worker = storageHarness({ addFails: true });
    worker.seed(PREVIOUS, {
      "/board": '<script src="/assets/old.js"></script>',
      "/assets/old.js": "old bundle",
    });
    await worker.dispatch("install");
    await worker.dispatch("activate");
    worker.fetchMock.mockRejectedValue(new Error("offline"));
    expect(await (await worker.dispatchFetch("/board", "navigate"))?.text()).toContain("old.js");
    expect(await (await worker.dispatchFetch("/assets/old.js"))?.text()).toBe("old bundle");

    // Fetching new assets alone cannot make an old document a current shell.
    worker.fetchMock.mockResolvedValue(
      page("new bundle", {
        type: "text/javascript",
        url: "https://shark.example/assets/x.js",
      }),
    );
    await worker.dispatchFetch("/assets/x.js");
    expect(worker.names()).toContain(PREVIOUS);
    expect(await worker.body(CACHE_NAME, "/board")).toBeUndefined();
    worker.fetchMock.mockResolvedValue(
      page('<script src="/assets/x.js"></script>', {
        url: "https://shark.example/board",
      }),
    );
    await worker.dispatchFetch("/board", "navigate");
    expect(worker.names()).not.toContain(PREVIOUS);
    worker.fetchMock.mockRejectedValue(new Error("offline"));
    expect(await (await worker.dispatchFetch("/inbox", "navigate"))?.text()).toContain("x.js");
  });

  it("does not delete the previous shell cache when the new one stored nothing", async () => {
    const worker = storageHarness({ addFails: true, putFails: true });
    worker.seed(PREVIOUS, PREVIOUS_SHELLS);
    await worker.dispatch("install");
    await worker.dispatch("activate");

    expect(worker.deleted).toEqual([]);
    expect(worker.names()).toContain(PREVIOUS);
    expect(await worker.body(CACHE_NAME, "/board")).toBeUndefined();
    expect(worker.claims()).toBe(1);

    worker.fetchMock.mockRejectedValue(new Error("offline"));
    const board = await worker.dispatchFetch("/board", "navigate");
    expect(await board?.text()).toBe("previous board");
    const inbox = await worker.dispatchFetch("/inbox", "navigate");
    expect(await inbox?.text()).toBe("previous inbox");
  });

  it("does not copy previous documents into the current build cache", async () => {
    const worker = storageHarness({ addFails: true });
    worker.seed(PREVIOUS, PREVIOUS_SHELLS);
    await worker.dispatch("install");
    await worker.dispatch("activate");

    expect(worker.deleted).toEqual([]);
    expect(worker.names()).toContain(PREVIOUS);
    expect(await worker.body(CACHE_NAME, "/inbox")).toBeUndefined();
    expect(await worker.body(CACHE_NAME, "/assets/x.js")).toBeUndefined();

    worker.fetchMock.mockRejectedValue(new Error("offline"));
    const inbox = await worker.dispatchFetch("/inbox", "navigate");
    expect(await inbox?.text()).toBe("previous inbox");
  });

  it("deletes the previous cache when install itself stored /board and the precache", async () => {
    const worker = storageHarness();
    worker.seed(PREVIOUS, PREVIOUS_SHELLS);
    await worker.dispatch("install");
    await worker.dispatch("activate");

    expect(worker.deleted).toEqual([PREVIOUS]);
    expect(await worker.body(CACHE_NAME, "/board")).toBe("stored /board");
    expect(await worker.body(CACHE_NAME, "/assets/x.js")).toBe("stored /assets/x.js");
  });

  it("refills an empty shell from a later signed-in navigation, then drops the stale cache", async () => {
    const worker = storageHarness({ addFails: true });
    worker.seed(PREVIOUS, { "/inbox": "previous inbox" });
    await worker.dispatch("install");
    await worker.dispatch("activate");
    expect(worker.deleted).toEqual([]);

    worker.fetchMock.mockImplementation(async (request: { url: string }) => {
      const path = new URL(request.url).pathname;
      if (path === "/board/ask/bask_1") {
        return page("<!doctype html>signed-in board", {
          url: "https://shark.example/board/ask/bask_1",
        });
      }
      if (path === "/assets/x.js") {
        return page("signed-in asset", {
          type: "text/javascript",
          url: "https://shark.example/assets/x.js",
        });
      }
      throw new Error(`unexpected ${request.url}`);
    });

    await worker.dispatchFetch("/board/ask/bask_1", "navigate");
    expect(await worker.body(CACHE_NAME, "/board")).toContain("signed-in board");
    expect(worker.deleted).toEqual([]);
    expect(worker.names()).toContain(PREVIOUS);

    await worker.dispatchFetch("/assets/x.js");
    expect(worker.deleted).toEqual([PREVIOUS]);
    expect(worker.names()).not.toContain(PREVIOUS);

    worker.fetchMock.mockRejectedValue(new Error("offline"));
    const settings = await worker.dispatchFetch("/settings", "navigate");
    expect(await settings?.text()).toContain("signed-in board");
  });

  it("does not cache an asset outside the current precache", async () => {
    const worker = storageHarness({ addFails: true });
    worker.fetchMock.mockResolvedValue(
      page("unlisted", {
        type: "text/javascript",
        url: "https://shark.example/assets/unlisted.js",
      }),
    );
    expect(await (await worker.dispatchFetch("/assets/unlisted.js"))?.text()).toBe("unlisted");
    expect(await worker.body(CACHE_NAME, "/assets/unlisted.js")).toBeUndefined();
  });

  it("does not cache a signed-out page or a document outside the four shells", async () => {
    const worker = storageHarness({ addFails: true });
    await worker.dispatch("install");
    await worker.dispatch("activate");
    worker.fetchMock.mockImplementation(async (request: { url: string }) => {
      const path = new URL(request.url).pathname;
      if (path === "/board") return page("denied", { status: 401, url: request.url });
      if (path === "/settings") {
        return page("sign in", {
          url: "https://shark.example/login?next=%2Fsettings",
          redirected: true,
        });
      }
      return page("docs", { url: request.url });
    });

    await worker.dispatchFetch("/board", "navigate");
    await worker.dispatchFetch("/settings", "navigate");
    await worker.dispatchFetch("/docs", "navigate");

    expect(await worker.body(CACHE_NAME, "/board")).toBeUndefined();
    expect(await worker.body(CACHE_NAME, "/settings")).toBeUndefined();
    expect(await worker.body(CACHE_NAME, "/docs")).toBeUndefined();
    expect(worker.names()).toEqual([CACHE_NAME]);
  });
});

/**
 * A push with no URL of its own, and a tap on a notification that carries
 * none, both open the inbox: that is where the notification's own record is.
 * `/dashboard` was the old default and still redirects there, so nothing that
 * was sent before this change breaks.
 */
describe("service worker notification routing", () => {
  it("defaults a push payload's URL to the inbox", async () => {
    const worker = harness();
    await worker.dispatch("push", { data: { json: () => ({ title: "SHark", body: "Hi" }) } });
    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0]?.[1].data).toMatchObject({ url: "/inbox" });
  });

  it("keeps a URL the payload supplies", async () => {
    const worker = harness();
    await worker.dispatch("push", {
      data: { json: () => ({ title: "SHark", url: "/board/ask/bask_1" }) },
    });
    expect(worker.shown[0]?.[1].data).toMatchObject({ url: "/board/ask/bask_1" });
  });

  it("opens the inbox when a tapped notification carries no URL", async () => {
    const worker = harness();
    await worker.dispatch("notificationclick", {
      notification: { close: vi.fn(), data: {} },
    });
    expect(worker.opened).toEqual(["https://shark.example/inbox"]);
  });

  it("still opens an old /dashboard deep link, which the app redirects", async () => {
    const worker = harness();
    await worker.dispatch("notificationclick", {
      notification: { close: vi.fn(), data: { url: "/dashboard" } },
    });
    expect(worker.opened).toEqual(["https://shark.example/dashboard"]);
  });

  /**
   * A service can point a tap at its own site on purpose — a CI run, a pull
   * request — so leaving this origin is allowed when it was written as an
   * absolute URL.
   */
  it.each([
    "https://ci.example.com/builds/42",
    "http://ci.example.com/builds/42",
    "https://github.com/org/repo/pull/82#files",
  ])("opens the absolute external link %s a service asked for", async (url) => {
    const worker = harness();
    await worker.dispatch("notificationclick", { notification: { close: vi.fn(), data: { url } } });
    expect(worker.opened).toEqual([url]);
  });

  /**
   * A URL dressed up as this one. Credentials put the real host in the part a
   * reader scans first while the origin is somewhere else, and a string that
   * is not absolute can still resolve off-origin.
   */
  it.each([
    ["credentials that read like this host", "https://shark.example@evil.test/"],
    ["credentials with a password", "https://shark.example:hunter2@evil.test/inbox"],
    ["a protocol-relative host", "//evil.test/inbox"],
    ["a backslash the parser treats as a slash", "/\\evil.test"],
    ["three slashes", "///evil.test"],
    ["a non-http scheme", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<h1>hi"],
  ])("falls back to the inbox for %s", async (_label, url) => {
    const worker = harness();
    await worker.dispatch("notificationclick", { notification: { close: vi.fn(), data: { url } } });
    expect(worker.opened).toEqual(["https://shark.example/inbox"]);
  });

  it("keeps a same-origin path that merely looks odd", async () => {
    const worker = harness();
    await worker.dispatch("notificationclick", {
      notification: { close: vi.fn(), data: { url: "/inbox/ibox%3Aevent%3A1?from=push" } },
    });
    expect(worker.opened).toEqual(["https://shark.example/inbox/ibox%3Aevent%3A1?from=push"]);
  });
});
