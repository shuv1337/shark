// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

describe("PWA update helpers", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("registers once and announces an already-waiting worker", async () => {
    const registration = new EventTarget() as ServiceWorkerRegistration;
    Object.assign(registration, { waiting: { postMessage: vi.fn() }, installing: null });
    const register = vi.fn().mockResolvedValue(registration);
    const serviceWorker = Object.assign(new EventTarget(), { register, controller: {} });
    vi.stubGlobal("navigator", { serviceWorker });
    const helpers = await import("./pwaUpdate");
    const callback = vi.fn();
    helpers.onUpdateAvailable(callback);

    await Promise.all([helpers.registerServiceWorker(), helpers.registerServiceWorker()]);
    expect(register).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(callback).toHaveBeenCalledWith(registration);
  });

  /**
   * The session that discovers a new build is the one that should offer it.
   * `register()` resolves while the install is still running, so by the time
   * anything can listen `updatefound` has already fired and the only handle
   * left is `registration.installing`.
   */
  it("announces a worker that was still installing when it registered", async () => {
    const installing = Object.assign(new EventTarget(), { state: "installing" });
    const registration = Object.assign(new EventTarget(), { waiting: null, installing });
    const serviceWorker = Object.assign(new EventTarget(), {
      register: vi.fn().mockResolvedValue(registration),
      controller: {},
    });
    vi.stubGlobal("navigator", { serviceWorker });
    const helpers = await import("./pwaUpdate");
    const callback = vi.fn();
    helpers.onUpdateAvailable(callback);
    await helpers.registerServiceWorker();
    expect(callback).not.toHaveBeenCalled();

    // The install finishes: it is now the waiting build.
    Object.assign(registration, { waiting: { postMessage: vi.fn() } });
    Object.assign(installing, { state: "installed" });
    installing.dispatchEvent(new Event("statechange"));
    expect(callback).toHaveBeenCalledWith(registration);
  });

  /** A worker that installs with no controller is this browser's first. */
  it("stays quiet for the very first worker, which has nothing to replace", async () => {
    const installing = Object.assign(new EventTarget(), { state: "installing" });
    const registration = Object.assign(new EventTarget(), { waiting: null, installing });
    vi.stubGlobal("navigator", {
      serviceWorker: Object.assign(new EventTarget(), {
        register: vi.fn().mockResolvedValue(registration),
        controller: null,
      }),
    });
    const helpers = await import("./pwaUpdate");
    const callback = vi.fn();
    helpers.onUpdateAvailable(callback);
    await helpers.registerServiceWorker();

    Object.assign(registration, { waiting: { postMessage: vi.fn() } });
    Object.assign(installing, { state: "installed" });
    installing.dispatchEvent(new Event("statechange"));
    expect(callback).not.toHaveBeenCalled();
  });

  /** It may already be installed by the time anything attaches a listener. */
  it("catches an install that finished before it looked", async () => {
    const registration = Object.assign(new EventTarget(), {
      waiting: { postMessage: vi.fn() },
      installing: Object.assign(new EventTarget(), { state: "installed" }),
    });
    vi.stubGlobal("navigator", {
      serviceWorker: Object.assign(new EventTarget(), {
        register: vi.fn().mockResolvedValue(registration),
        controller: {},
      }),
    });
    const helpers = await import("./pwaUpdate");
    const callback = vi.fn();
    helpers.onUpdateAvailable(callback);
    await helpers.registerServiceWorker();
    expect(callback).toHaveBeenCalledWith(registration);
  });

  it("reports the build the controlling worker is running", async () => {
    const serviceWorker = new EventTarget() as EventTarget & { controller: unknown };
    const postMessage = vi.fn(() => {
      serviceWorker.dispatchEvent(
        Object.assign(new Event("message"), {
          data: { type: "hark:sw-version", version: "0f1e2d3c4b5a6978" },
        }),
      );
    });
    serviceWorker.controller = { postMessage };
    vi.stubGlobal("navigator", { serviceWorker });
    const helpers = await import("./pwaUpdate");

    await expect(helpers.serviceWorkerVersion()).resolves.toBe("0f1e2d3c4b5a6978");
    expect(postMessage).toHaveBeenCalledWith({ type: "hark:get-version" });
  });

  /** No worker in control is the ordinary first-load case, not an error. */
  it("reports no build when nothing controls the page", async () => {
    vi.stubGlobal("navigator", {
      serviceWorker: Object.assign(new EventTarget(), { controller: null }),
    });
    const helpers = await import("./pwaUpdate");
    await expect(helpers.serviceWorkerVersion()).resolves.toBeNull();
  });

  it("checks for a newer worker and says whether one is waiting", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const registration = Object.assign(new EventTarget(), {
      waiting: null,
      installing: null,
      update,
    }) as unknown as ServiceWorkerRegistration;
    const serviceWorker = Object.assign(new EventTarget(), {
      register: vi.fn().mockResolvedValue(registration),
      controller: {},
    });
    vi.stubGlobal("navigator", { serviceWorker });
    const helpers = await import("./pwaUpdate");

    await expect(helpers.checkForUpdate()).resolves.toBe(false);
    expect(update).toHaveBeenCalledOnce();

    Object.assign(registration, { waiting: { postMessage: vi.fn() } });
    await expect(helpers.checkForUpdate()).resolves.toBe(true);
  });

  /**
   * `update()` resolves once the script is fetched, which can be before the
   * worker it started has installed. Answering then would let Settings say
   * "latest build" over an install in flight.
   */
  it("waits for an install that update() started before answering", async () => {
    const installing = Object.assign(new EventTarget(), { state: "installing" });
    const registration = Object.assign(new EventTarget(), {
      waiting: null,
      installing,
      update: vi.fn().mockResolvedValue(undefined),
    }) as unknown as ServiceWorkerRegistration;
    vi.stubGlobal("navigator", {
      serviceWorker: Object.assign(new EventTarget(), {
        register: vi.fn().mockResolvedValue(registration),
        controller: {},
      }),
    });
    const helpers = await import("./pwaUpdate");
    await helpers.registerServiceWorker();

    let settled = false;
    const check = helpers.checkForUpdate().then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    Object.assign(registration, { waiting: { postMessage: vi.fn() } });
    Object.assign(installing, { state: "installed" });
    installing.dispatchEvent(new Event("statechange"));
    await expect(check).resolves.toBe(true);
  });

  /** A worker stuck installing must not leave "Checking…" on the button. */
  it("gives up waiting on an install that never finishes", async () => {
    const registration = Object.assign(new EventTarget(), {
      waiting: null,
      installing: Object.assign(new EventTarget(), { state: "installing" }),
      update: vi.fn().mockResolvedValue(undefined),
    }) as unknown as ServiceWorkerRegistration;
    vi.stubGlobal("navigator", {
      serviceWorker: Object.assign(new EventTarget(), {
        register: vi.fn().mockResolvedValue(registration),
        controller: {},
      }),
    });
    const helpers = await import("./pwaUpdate");
    await helpers.registerServiceWorker();
    await expect(helpers.checkForUpdate(5)).resolves.toBe(false);
  });

  it("asks the waiting worker to activate and reloads on controller change", async () => {
    const reload = vi.fn();
    const serviceWorker = Object.assign(new EventTarget(), { controller: {} });
    const postMessage = vi.fn(() => serviceWorker.dispatchEvent(new Event("controllerchange")));
    const registration = Object.assign(new EventTarget(), {
      waiting: { postMessage },
      installing: null,
    }) as unknown as ServiceWorkerRegistration;
    Object.assign(serviceWorker, { register: vi.fn().mockResolvedValue(registration) });
    vi.stubGlobal("navigator", { serviceWorker });
    vi.stubGlobal("window", { location: { reload } });
    const helpers = await import("./pwaUpdate");
    await helpers.registerServiceWorker();

    await expect(helpers.applyUpdate()).resolves.toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: "hark:skip-waiting" });
    expect(reload).toHaveBeenCalledOnce();

    // Pressing Reload twice must not reload the page it just loaded.
    await expect(helpers.applyUpdate()).resolves.toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});
