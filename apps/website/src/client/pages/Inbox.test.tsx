// @vitest-environment happy-dom
import type { InboxDetailDto, InboxItemDto } from "@hark/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { resetNavCounts, useNavCounts } from "../lib/counts";
import { Inbox } from "./Inbox";

const session = { user: { id: "usr_synthetic", email: "operator@example.test", image: null } };

vi.mock("../lib/auth", () => ({
  useSession: () => ({ data: session, isPending: false }),
  signOut: vi.fn(async () => {}),
  signInWithApple: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  // `InboxDetailView` only uses this for an `instanceof` check on a failure.
  ApiRequestError: Error,
  api: {
    listInbox: vi.fn(),
    getInboxItem: vi.fn(),
    getInboxCounts: vi.fn(),
    markInboxItemRead: vi.fn(),
    markAllInboxRead: vi.fn(),
    listLiveActivities: vi.fn(),
    listEvents: vi.fn(),
    getBoard: vi.fn(async () => ({ waiting: [] })),
  },
}));

/** Stands in for the navigation badge, which reads the same shared counts. */
function Badge() {
  return <p data-testid="badge">{useNavCounts().inboxUnread}</p>;
}

const item: InboxItemDto = {
  id: "ibox:interaction:int_1",
  kind: "interaction",
  sourceName: "Deploy Agent",
  sourceImageUrl: null,
  title: "Production approval",
  body: "Approve the reviewed release after the checks pass.",
  imageUrl: null,
  url: null,
  status: "pending",
  result: null,
  accepted: 1,
  failed: 0,
  needsAction: true,
  readAt: null,
  occurredAt: "2026-07-30T19:00:00.000Z",
  updatedAt: "2026-07-30T19:00:00.000Z",
  action: {
    interactionId: "int_1",
    kind: "approval",
    choices: ["approve", "deny"],
    actionDigest: "a".repeat(64),
    primaryLabel: "Approve",
    secondaryLabel: "Deny",
    expiresAt: "2026-07-30T20:00:00.000Z",
  },
};

const detail: InboxDetailDto = {
  item,
  events: [
    {
      id: "event_1",
      kind: "created",
      detail: "Accepted by one device.",
      result: "Pending",
      accepted: 1,
      failed: 0,
      occurredAt: item.occurredAt,
    },
  ],
};

describe("inbox pages", () => {
  let container: HTMLDivElement;
  let root: Root;
  /** What the server would answer right now, as actions change it. */
  let unread = 3;

  const mount = async (path: string) => {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Inbox />} path="/inbox" />
            <Route element={<Inbox />} path="/inbox/:id" />
          </Routes>
          <Badge />
        </MemoryRouter>,
      ),
    );
  };
  const badge = () => container.querySelector("[data-testid='badge']")?.textContent;
  const click = async (element: Element | null | undefined) => {
    if (!element) throw new Error("Nothing to click");
    await act(async () => (element as HTMLElement).click());
  };
  const row = () => container.querySelector(`a[href='/inbox/${encodeURIComponent(item.id)}']`);
  const back = () =>
    [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Inbox");

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetNavCounts();
    vi.mocked(api.listInbox)
      .mockReset()
      .mockResolvedValue({ items: [item], nextCursor: null, unresolvedCount: 1 });
    vi.mocked(api.getInboxItem).mockReset().mockResolvedValue(detail);
    vi.mocked(api.markInboxItemRead).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(api.markAllInboxRead).mockReset().mockResolvedValue({ ok: true });
    unread = 3;
    vi.mocked(api.getInboxCounts)
      .mockReset()
      .mockImplementation(async () => ({ unread, needsAction: 1 }));
    vi.mocked(api.listLiveActivities).mockReset().mockResolvedValue({ activities: [] });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("lists items with the filters and the Activity view", async () => {
    await mount("/inbox");
    expect(container.textContent).toContain("Production approval");
    for (const label of ["All", "Needs action", "Active", "Failed", "Notifications", "Activity"]) {
      expect([...container.querySelectorAll("button")].map((node) => node.textContent)).toContain(
        label,
      );
    }
  });

  it("swaps the list for the delivery log on the Activity filter", async () => {
    vi.mocked(api.listEvents).mockResolvedValue({ events: [] });
    await mount("/inbox");
    await click(
      [...container.querySelectorAll("button")].find((node) => node.textContent === "Activity"),
    );
    expect(api.listEvents).toHaveBeenCalled();
    expect(container.textContent).toContain("Latest webhook delivery attempts");
    expect(container.textContent).not.toContain("Production approval");
  });

  it("opens an item as its own page and marks it read", async () => {
    await mount("/inbox");
    await click(row());

    expect(api.getInboxItem).toHaveBeenCalledWith(item.id);
    expect(api.markInboxItemRead).toHaveBeenCalledWith(item.id);
    expect(container.textContent).toContain("Timeline");
    expect(container.textContent).toContain("Accepted by one device.");
    expect(container.textContent).toContain("Needs your response");
    // The detail replaces the list rather than floating over it.
    expect(row()).toBeNull();
  });

  it("goes back to the list it came from", async () => {
    await mount("/inbox");
    await click(row());
    await click(back());

    expect(container.textContent).toContain("Production approval");
    expect(row()).not.toBeNull();
  });

  it("opens a deep-linked item, and its back link lands on the inbox", async () => {
    await mount(`/inbox/${encodeURIComponent(item.id)}`);
    expect(api.getInboxItem).toHaveBeenCalledWith(item.id);
    expect(container.textContent).toContain("Production approval");

    // Nothing to pop: a push deep link is the first entry in the history.
    await click(back());
    expect(row()).not.toBeNull();
  });

  it("names the problem when an item cannot be loaded", async () => {
    vi.mocked(api.getInboxItem).mockRejectedValue(new Error("Item not found"));
    await mount(`/inbox/${encodeURIComponent(item.id)}`);
    expect(container.textContent).toContain("This notification is not available");
    expect(container.textContent).toContain("Item not found");
  });

  /**
   * The badge is the exact unread total from the server, so every action that
   * changes read state asks for it again rather than adjusting a local guess.
   */
  it("drops the badge when opening an unread item reads it", async () => {
    await mount("/inbox");
    expect(badge()).toBe("3");

    unread = 2;
    await click(row());

    expect(api.markInboxItemRead).toHaveBeenCalledWith(item.id);
    expect(badge()).toBe("2");
  });

  it("leaves the badge alone for an item that was already read", async () => {
    vi.mocked(api.getInboxItem).mockResolvedValue({
      ...detail,
      item: { ...item, readAt: "2026-07-30T19:30:00.000Z" },
    });
    await mount("/inbox");
    unread = 2;
    await click(row());

    expect(api.markInboxItemRead).not.toHaveBeenCalled();
    expect(badge()).toBe("3");
  });

  it("zeroes the badge on mark all read", async () => {
    await mount("/inbox");
    expect(badge()).toBe("3");

    unread = 0;
    await click(
      [...container.querySelectorAll("button")].find(
        (node) => node.textContent === "Mark all read",
      ),
    );

    expect(api.markAllInboxRead).toHaveBeenCalled();
    expect(badge()).toBe("0");
  });
});
