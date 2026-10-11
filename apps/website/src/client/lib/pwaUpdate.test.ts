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
  });
});
