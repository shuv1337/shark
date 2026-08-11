import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserPushAvailability,
  enableWebPush,
  requestWebPushPermission,
  urlBase64ToUint8Array,
} from "./webPush";

describe("browser push helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("decodes an unpadded URL-safe VAPID public key", () => {
    vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"));
    expect([...urlBase64ToUint8Array("AQID-v8")]).toEqual([1, 2, 3, 250, 255]);
  });

  it("reports unsupported outside a secure service-worker context", () => {
    expect(browserPushAvailability()).toEqual({ status: "unsupported" });
  });

  it("distinguishes blocked notification permission", () => {
    vi.stubGlobal("window", {
      isSecureContext: true,
      PushManager: class {},
      Notification: class {},
    });
    vi.stubGlobal("navigator", { serviceWorker: {} });
    vi.stubGlobal("Notification", { permission: "denied" });
    expect(browserPushAvailability()).toEqual({ status: "denied" });
  });

  it("requests notification permission independently of subscription setup", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal("window", {
      isSecureContext: true,
      PushManager: class {},
      Notification: class {},
    });
    vi.stubGlobal("navigator", { serviceWorker: {} });
    vi.stubGlobal("Notification", { permission: "default", requestPermission });

    await expect(requestWebPushPermission()).resolves.toBeUndefined();
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("creates a user-visible push subscription after permission is granted", async () => {
    const subscription = { endpoint: "https://push.example/subscription" } as PushSubscription;
    const subscribe = vi.fn().mockResolvedValue(subscription);
    const register = vi.fn().mockResolvedValue({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe,
      },
    });

    vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"));
    vi.stubGlobal("window", {
      isSecureContext: true,
      PushManager: class {},
      Notification: class {},
    });
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    vi.stubGlobal("Notification", { permission: "granted" });

    await expect(enableWebPush("AQID")).resolves.toBe(subscription);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3]),
    });
  });
});
