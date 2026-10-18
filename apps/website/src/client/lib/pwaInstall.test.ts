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

  it("tells subscribers when the install prompt arrives and when it is spent", async () => {
    const helpers = await import("./pwaInstall");
    const changed = vi.fn();
    const unsubscribe = helpers.subscribeToInstallAvailability(changed);

    const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted"; platform: string }>;
    };
    event.prompt = vi.fn().mockResolvedValue(undefined);
    event.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
    window.dispatchEvent(event);
    expect(changed).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("appinstalled"));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(helpers.canInstall()).toBe(false);

    unsubscribe();
    window.dispatchEvent(new Event("appinstalled"));
    expect(changed).toHaveBeenCalledTimes(2);
  });

  /** Desktop Safari has no prompt, but it has had "Add to Dock" since Sonoma. */
  it("tells desktop Safari apart from Chromium and from an iPad", async () => {
    const agents: Array<[string, number, boolean]> = [
      [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Version/18.0 Safari/605.1.15",
        0,
        true,
      ],
      [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
        0,
        false,
      ],
      [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Version/18.0 Safari/605.1.15",
        5,
        false,
      ],
      [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
        0,
        false,
      ],
    ];
    for (const [userAgent, maxTouchPoints, expected] of agents) {
      vi.resetModules();
      vi.stubGlobal("window", {
        addEventListener: vi.fn(),
        matchMedia: () => ({ matches: false }),
      });
      vi.stubGlobal("navigator", { userAgent, maxTouchPoints, standalone: false });
      const helpers = await import("./pwaInstall");
      expect(helpers.isMacSafari(), userAgent).toBe(expected);
    }
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
