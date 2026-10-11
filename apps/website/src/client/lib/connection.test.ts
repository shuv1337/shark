// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import {
  isOffline,
  OFFLINE_HINT,
  offlineProps,
  reportNetworkFailure,
  reportNetworkSuccess,
  resetConnection,
} from "./connection";

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
}

describe("connection state", () => {
  beforeEach(() => {
    setOnline(true);
    resetConnection();
  });

  afterEach(() => {
    setOnline(true);
    resetConnection();
    vi.unstubAllGlobals();
  });

  it("follows the OS link", () => {
    expect(isOffline()).toBe(false);
    setOnline(false);
    expect(isOffline()).toBe(true);
  });

  /**
   * The whole reason this is not just `navigator.onLine`: a captive portal and
   * a network with no route out both report themselves as online.
   */
  it("trusts a failed request over a link that claims to be up", () => {
    expect(isOffline()).toBe(false);
    reportNetworkFailure();
    expect(isOffline()).toBe(true);
    reportNetworkSuccess();
    expect(isOffline()).toBe(false);
  });

  it("disables a control with the reason, and nothing while online", () => {
    expect(offlineProps(false)).toEqual({});
    expect(offlineProps(true)).toEqual({ disabled: true, title: OFFLINE_HINT });
  });
});

describe("the API layer's report", () => {
  beforeEach(() => {
    setOnline(true);
    resetConnection();
  });

  afterEach(() => {
    setOnline(true);
    resetConnection();
    vi.unstubAllGlobals();
  });

  it("goes offline when a request never reaches the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(api.getBoard()).rejects.toThrow(TypeError);
    expect(isOffline()).toBe(true);
  });

  /** A 401 or a 500 proves the server answered, so the link is fine. */
  it("comes back on any response at all, including a failure", async () => {
    reportNetworkFailure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })),
    );
    await expect(api.getBoard()).rejects.toThrow("Unauthorized");
    expect(isOffline()).toBe(false);
  });

  /** An abort is this app's own doing, not a verdict on the network. */
  it("stays online when a request is aborted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("Aborted", "AbortError");
      }),
    );
    await expect(api.getBoard()).rejects.toThrow("Aborted");
    expect(isOffline()).toBe(false);
  });
});
