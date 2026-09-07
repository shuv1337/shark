import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeToInboxUpdates } from "./inboxUpdates";

describe("inbox update subscription", () => {
  const worker = new EventTarget();
  const page = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  let unsubscribe: (() => void) | undefined;

  const push = () =>
    worker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "hark:inbox-updated" },
      }),
    );

  beforeEach(() => {
    vi.useFakeTimers();
    document.visibilityState = "visible";
    vi.stubGlobal("navigator", { serviceWorker: worker });
    vi.stubGlobal("window", page);
    vi.stubGlobal("document", document);
  });

  afterEach(() => {
    unsubscribe?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("refreshes immediately on push and once more after a burst has settled", () => {
    const refresh = vi.fn();
    unsubscribe = subscribeToInboxUpdates(refresh);

    push();
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    push();
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.runAllTimers();
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("ignores other service worker messages and malformed data", () => {
    const refresh = vi.fn();
    unsubscribe = subscribeToInboxUpdates(refresh);
    for (const data of [null, undefined, "hark:inbox-updated", {}, { type: "other" }]) {
      worker.dispatchEvent(new MessageEvent("message", { data }));
    }
    vi.runAllTimers();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes on focus and when returning to a visible tab", () => {
    const refresh = vi.fn();
    unsubscribe = subscribeToInboxUpdates(refresh);
    document.visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    page.dispatchEvent(new Event("focus"));
    expect(refresh).not.toHaveBeenCalled();

    document.visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    page.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps resume refresh available in browsers without service workers", () => {
    vi.stubGlobal("navigator", {});
    const refresh = vi.fn();
    unsubscribe = subscribeToInboxUpdates(refresh);
    page.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("removes listeners and cancels the delayed refresh when unsubscribed", () => {
    const refresh = vi.fn();
    unsubscribe = subscribeToInboxUpdates(refresh);
    push();
    unsubscribe();
    push();
    page.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    vi.runAllTimers();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
