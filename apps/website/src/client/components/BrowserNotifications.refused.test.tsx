// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registerWebPushSubscription = vi.fn();
vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: {
      registerWebPushSubscription: (...args: unknown[]) => registerWebPushSubscription(...args),
    },
  };
});

const unsubscribe = vi.fn(async () => true);
const stale = {
  toJSON: () => ({ endpoint: "https://jmt17.google.com/fcm/send/synthetic", keys: {} }),
  unsubscribe,
};
vi.mock("../lib/webPush", () => ({
  browserDeviceName: () => "Browser on Linux",
  browserPushAvailability: () => ({ status: "available", permission: "granted" }),
  currentWebPushSubscription: async () => stale,
  enableWebPush: vi.fn(),
  requestWebPushPermission: vi.fn(),
}));

let root: Root;
let host: HTMLDivElement;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  registerWebPushSubscription.mockReset();
  unsubscribe.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("a browser subscription the server refuses", () => {
  it("shows the validation detail and removes the old subscription on request", async () => {
    const { ApiRequestError } = await import("../lib/api");
    const { BrowserNotifications } = await import("./BrowserNotifications");
    registerWebPushSubscription.mockRejectedValueOnce(
      new ApiRequestError(400, {
        error: "Invalid browser push subscription",
        issues: [{ message: "Push endpoint must use a known browser push service" }],
      }),
    );
    await act(async () => root.render(<BrowserNotifications />));
    await flush();

    expect(host.textContent).toContain(
      "Invalid browser push subscription: Push endpoint must use a known browser push service.",
    );
    const remove = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Remove old subscription"),
    );
    expect(remove).toBeDefined();

    await act(async () => remove?.click());
    await flush();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Enable notifications");
    expect(host.textContent).not.toContain("Remove old subscription");
  });

  it("offers no removal for a server error that is not a validation refusal", async () => {
    const { ApiRequestError } = await import("../lib/api");
    const { BrowserNotifications } = await import("./BrowserNotifications");
    registerWebPushSubscription.mockRejectedValueOnce(
      new ApiRequestError(503, { error: "Browser push is not configured" }),
    );
    await act(async () => root.render(<BrowserNotifications />));
    await flush();
    expect(host.textContent).toContain("Browser push is not configured");
    expect(host.textContent).toContain("Try again");
    expect(host.textContent).not.toContain("Remove old subscription");
  });
});
