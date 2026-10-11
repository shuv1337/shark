// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

describe("PWA install helpers", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("captures and consumes the Chromium install prompt", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: typeof prompt;
      userChoice: Promise<{ outcome: "accepted"; platform: string }>;
    };
    event.prompt = prompt;
    event.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
    const helpers = await import("./pwaInstall");

    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(helpers.canInstall()).toBe(true);
    await expect(helpers.promptInstall()).resolves.toBe("accepted");
    expect(prompt).toHaveBeenCalledOnce();
    expect(helpers.canInstall()).toBe(false);
  });

  it("detects standalone mode and iOS Safari", async () => {
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      matchMedia: vi.fn().mockReturnValue({ matches: true }),
    });
    vi.stubGlobal("navigator", {
      standalone: false,
      maxTouchPoints: 5,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit Safari/604.1",
    });
    const helpers = await import("./pwaInstall");
    expect(helpers.isStandalone()).toBe(true);
    expect(helpers.isIosSafari()).toBe(true);
  });
});
