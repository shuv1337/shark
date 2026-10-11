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
      registration: { showNotification: vi.fn(), getNotifications: vi.fn() },
      skipWaiting,
    },
    clients: { matchAll: vi.fn(), claim: vi.fn(), openWindow: vi.fn() },
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

  return {
    cache,
    caches,
    fetchMock,
    listeners,
    skipWaiting,
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
