// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAppBadge, setAppBadge } from "./appBadge";

describe("app badge helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses supported badge APIs and normalizes the count", async () => {
    const setBadge = vi.fn().mockResolvedValue(undefined);
    const clearBadge = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { setAppBadge: setBadge, clearAppBadge: clearBadge });

    await setAppBadge(3.8);
    await clearAppBadge();
    expect(setBadge).toHaveBeenCalledWith(3);
    expect(clearBadge).toHaveBeenCalledOnce();
  });

  it("is a no-op when app badges are unsupported", async () => {
    vi.stubGlobal("navigator", {});
    await expect(setAppBadge(2)).resolves.toBeUndefined();
    await expect(clearAppBadge()).resolves.toBeUndefined();
  });
});
