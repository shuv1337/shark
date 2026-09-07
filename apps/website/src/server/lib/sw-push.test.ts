import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const sw = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../public/sw.js"),
  "utf8",
);

function workerHarness() {
  type WorkerEvent = {
    data?: { json: () => unknown; text?: () => string };
    waitUntil: (promise: Promise<unknown>) => void;
  };
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const windows = [{ postMessage: vi.fn() }, { postMessage: vi.fn() }];
  const clients = { matchAll: vi.fn().mockResolvedValue(windows) };
  const registration = {
    showNotification: vi.fn().mockResolvedValue(undefined),
    getNotifications: vi.fn().mockResolvedValue([]),
  };
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  runInNewContext(sw, {
    self: {
      addEventListener: (name: string, listener: (event: WorkerEvent) => void) =>
        listeners.set(name, listener),
      registration,
      skipWaiting,
    },
    clients,
  });
  const dispatch = async (name: string, data?: WorkerEvent["data"]) => {
    const pending: Promise<unknown>[] = [];
    listeners.get(name)?.({ data, waitUntil: (promise) => pending.push(promise) });
    return Promise.allSettled(pending);
  };
  const push = (payload: unknown) => dispatch("push", { json: () => payload });
  return { windows, clients, registration, skipWaiting, dispatch, push };
}

describe("service worker push updates", () => {
  it("activates the new push handler while existing dashboard tabs remain open", async () => {
    const worker = workerHarness();
    await worker.dispatch("install");
    expect(worker.skipWaiting).toHaveBeenCalledOnce();
  });

  it.each(["notification-event-synthetic", "interaction-synthetic"])(
    "notifies all open pages and presents a %s push",
    async (tag) => {
      const worker = workerHarness();
      await worker.push({ title: "Synthetic alert", body: "Test body", eventId: "synthetic", tag });
      expect(worker.clients.matchAll).toHaveBeenCalledWith({
        type: "window",
        includeUncontrolled: true,
      });
      for (const page of worker.windows) {
        expect(page.postMessage).toHaveBeenCalledWith({ type: "hark:inbox-updated" });
      }
      expect(worker.registration.showNotification).toHaveBeenCalledWith(
        "Synthetic alert",
        expect.objectContaining({ body: "Test body", tag }),
      );
    },
  );

  it("refreshes pages and closes matching withdrawals without showing a banner", async () => {
    const worker = workerHarness();
    const tagged = { close: vi.fn() };
    const matching = { data: { eventId: "synthetic" }, close: vi.fn() };
    const unrelated = { data: { eventId: "other" }, close: vi.fn() };
    worker.registration.getNotifications
      .mockResolvedValueOnce([tagged])
      .mockResolvedValueOnce([matching, unrelated]);

    await worker.push({ command: "notification.withdraw", eventId: "synthetic", tag: "test-tag" });

    expect(worker.registration.getNotifications).toHaveBeenNthCalledWith(1, { tag: "test-tag" });
    expect(tagged.close).toHaveBeenCalledOnce();
    expect(matching.close).toHaveBeenCalledOnce();
    expect(unrelated.close).not.toHaveBeenCalled();
    expect(worker.registration.showNotification).not.toHaveBeenCalled();
    for (const page of worker.windows) {
      expect(page.postMessage).toHaveBeenCalledWith({ type: "hark:inbox-updated" });
    }
  });

  it("refreshes the inbox even if notification presentation fails", async () => {
    const worker = workerHarness();
    worker.registration.showNotification.mockRejectedValue(new Error("Presentation unavailable"));
    const settled = await worker.push({ title: "Synthetic alert" });
    expect(settled.some((result) => result.status === "rejected")).toBe(true);
    expect(worker.windows[0]?.postMessage).toHaveBeenCalledWith({ type: "hark:inbox-updated" });
  });

  it("handles text-only and empty pushes while refreshing open inboxes", async () => {
    const worker = workerHarness();
    await worker.dispatch("push", {
      json: () => {
        throw new Error("Invalid JSON");
      },
      text: () => "Synthetic text",
    });
    expect(worker.registration.showNotification).toHaveBeenCalledWith(
      "SHark",
      expect.objectContaining({ body: "Synthetic text" }),
    );
    await worker.dispatch("push");
    expect(worker.windows[0]?.postMessage).toHaveBeenCalledTimes(2);
  });
});
