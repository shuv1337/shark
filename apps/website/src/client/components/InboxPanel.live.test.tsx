// @vitest-environment happy-dom
import type { InboxItemDto, InboxPageDto } from "@hark/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { InboxPanel } from "./InboxPanel";

vi.mock("../lib/api", () => ({ api: { listInbox: vi.fn() } }));

const item: InboxItemDto = {
  id: "ibox:event:synthetic",
  kind: "notification",
  sourceName: "Synthetic source",
  sourceImageUrl: null,
  title: "Original notification",
  body: "Synthetic notification body",
  imageUrl: null,
  url: null,
  status: "accepted",
  result: "Accepted",
  accepted: 1,
  failed: 0,
  needsAction: false,
  readAt: null,
  occurredAt: "2026-07-30T19:00:00.000Z",
  updatedAt: "2026-07-30T19:00:00.000Z",
  action: null,
};

const page = (items = [item], nextCursor: string | null = null): InboxPageDto => ({
  items,
  nextCursor,
  unresolvedCount: 0,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("live inbox refresh", () => {
  let container: HTMLDivElement;
  let root: Root;
  let worker: EventTarget;

  const button = (label: string) => {
    const result = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === label,
    );
    if (!result) throw new Error(`Missing button: ${label}`);
    return result;
  };
  const push = async () => {
    await act(async () => {
      worker.dispatchEvent(new MessageEvent("message", { data: { type: "hark:inbox-updated" } }));
    });
  };
  const mount = async () => {
    await act(async () => root.render(<InboxPanel />));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    worker = new EventTarget();
    vi.stubGlobal("navigator", { serviceWorker: worker });
    vi.mocked(api.listInbox).mockReset().mockResolvedValue(page());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches and renders the newest inbox when a worker push message arrives", async () => {
    await mount();
    expect(container.textContent).toContain("Original notification");
    const newest = { ...item, id: "ibox:event:new", title: "New push notification" };
    vi.mocked(api.listInbox).mockResolvedValue({ ...page([newest, item]), unresolvedCount: 2 });

    await push();

    expect(api.listInbox).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("New push notification");
    expect(container.textContent).toContain("2 waiting");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(api.listInbox).toHaveBeenCalledTimes(3);
  });

  it.each(["success", "error"])(
    "ignores stale %s from a pre-push request after changing filters",
    async (outcome) => {
      const stale = deferred<InboxPageDto>();
      vi.mocked(api.listInbox).mockReturnValueOnce(stale.promise);
      await mount();
      await act(async () => button("Notifications").click());
      vi.mocked(api.listInbox).mockResolvedValue(page([{ ...item, title: "Current filter item" }]));
      await push();
      expect(api.listInbox).toHaveBeenLastCalledWith("notifications", undefined);

      await act(async () => {
        if (outcome === "error") stale.reject(new Error("Stale request failure"));
        else stale.resolve(page([{ ...item, title: "Stale item" }]));
      });
      expect(button("Notifications").getAttribute("aria-pressed")).toBe("true");
      expect(container.textContent).toContain("Current filter item");
      expect(container.textContent).not.toContain("Stale item");
      expect(container.textContent).not.toContain("Stale request failure");
    },
  );

  it("discards pending pagination and prevents new pagination until push refresh completes", async () => {
    vi.mocked(api.listInbox).mockResolvedValueOnce(page([item], "synthetic-cursor"));
    await mount();
    const older = deferred<InboxPageDto>();
    vi.mocked(api.listInbox).mockReturnValueOnce(older.promise);
    await act(async () => button("Load older").click());
    const newest = deferred<InboxPageDto>();
    vi.mocked(api.listInbox).mockReturnValueOnce(newest.promise);
    await push();
    expect(button("Load older").disabled).toBe(true);
    await act(async () => {
      older.resolve(page([{ ...item, id: "old", title: "Stale older item" }]));
    });
    expect(button("Load older").disabled).toBe(true);
    expect(container.textContent).toContain("Refreshing…");
    expect(container.textContent).not.toContain("Stale older item");
    await act(async () => {
      newest.resolve(page([{ ...item, title: "Newest push item" }], "new-cursor"));
    });
    expect(container.textContent).toContain("Newest push item");
    expect(button("Load older").disabled).toBe(false);
  });

  it("stops push and follow-up reads after the inbox unmounts", async () => {
    await mount();
    await push();
    expect(api.listInbox).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    await push();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(api.listInbox).toHaveBeenCalledTimes(2);
  });
});
