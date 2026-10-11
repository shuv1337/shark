// @vitest-environment happy-dom
import type { BoardAskDto, InboxDetailDto, ServiceDto } from "@hark/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_HINT, resetConnection } from "../lib/connection";
import { Board } from "../pages/Board";
import { AskCard } from "./board/AskCard";
import { InboxDetailContent, InboxPanel } from "./InboxPanel";
import { ServicesSection } from "./ServicesSection";

/**
 * Offline, a control that only sends something to the server says why it
 * cannot instead of letting the tap land and reporting a failure afterwards.
 *
 * What must *not* happen is the other half of this: nothing already on screen
 * is hidden, replaced with an error, or unlinked. Reading is always available.
 */
vi.mock("../lib/api", () => {
  // Declared inside the factory because `vi.mock` is hoisted above the file.
  const boardAsk = {
    key: "fm:FM-1:pick",
    revision: 1,
    agent: "Firstmate (box)",
    agentDisplay: null,
    body: null,
    kind: "decision",
    options: [{ id: "ship", label: "Ship now", style: "primary" }],
    allowText: false,
    allowLater: false,
    priority: "p1",
    taskId: null,
    links: [],
    status: "open",
    digest: "a".repeat(64),
    snoozeUntil: null,
    expiresAt: null,
    answer: null,
    cancelReason: null,
    callback: null,
    ackedAt: null,
    lastAssertedAt: "2026-10-11T11:00:00.000Z",
    createdAt: "2026-10-11T10:00:00.000Z",
    updatedAt: "2026-10-11T11:00:00.000Z",
    aged: false,
  };
  const unread = {
    id: "ibox:event:1",
    kind: "notification",
    sourceName: "Codex",
    sourceImageUrl: null,
    title: "Deploy finished",
    body: "Staging is green.",
    imageUrl: null,
    url: null,
    status: "delivered",
    result: null,
    accepted: 1,
    failed: 0,
    needsAction: false,
    readAt: null,
    occurredAt: "2026-10-11T10:00:00.000Z",
    updatedAt: "2026-10-11T10:00:00.000Z",
    action: null,
  };
  return {
    ApiRequestError: Error,
    api: {
      getBoard: async () => ({
        waiting: [
          {
            ...boardAsk,
            id: "bask_synthetic",
            title: "Ship the board or wait?",
          },
        ],
        withAgent: [],
        inFlight: [],
        queued: [],
        notes: [],
        done: [],
        crew: [],
        cursor: "cursor-synthetic",
      }),
      getInboxCounts: async () => ({ unread: 1, needsAction: 0 }),
      listInbox: async () => ({ items: [unread], nextCursor: null, unresolvedCount: 1 }),
    },
  };
});

vi.mock("../lib/oauth-api", () => ({ oauthApi: { listClients: vi.fn(async () => ({})) } }));

/** The board's live stream is a real EventSource; nothing here needs it. */
vi.mock("../lib/boardUpdates", () => ({ subscribeToBoardUpdates: () => () => {} }));

vi.mock("../lib/auth", () => {
  // One stable object: a new identity per render would re-run the effects that
  // depend on the session and the page would never settle.
  const session = {
    data: { user: { id: "usr_synthetic", email: "operator@example.test", image: null } },
    isPending: false,
  };
  return {
    useSession: () => session,
    signOut: vi.fn(async () => {}),
    signInWithApple: vi.fn(),
  };
});

const ask: BoardAskDto = {
  id: "bask_synthetic",
  key: "fm:FM-1:pick",
  revision: 1,
  agent: "Firstmate (box)",
  agentDisplay: null,
  title: "Ship the board or wait?",
  body: null,
  kind: "decision",
  options: [
    { id: "ship", label: "Ship now", style: "primary" },
    { id: "wait", label: "Wait", style: "neutral" },
  ],
  allowText: true,
  allowLater: true,
  priority: "p1",
  taskId: null,
  links: [],
  status: "open",
  digest: "a".repeat(64),
  snoozeUntil: null,
  expiresAt: null,
  answer: null,
  cancelReason: null,
  callback: null,
  ackedAt: null,
  lastAssertedAt: "2026-10-11T11:00:00.000Z",
  createdAt: "2026-10-11T10:00:00.000Z",
  updatedAt: "2026-10-11T11:00:00.000Z",
  aged: false,
};

const detail: InboxDetailDto = {
  item: {
    id: "ibox:interaction:1",
    kind: "interaction",
    title: "Approve the deploy?",
    body: "Staging is green.",
    sourceName: "Codex",
    sourceImageUrl: null,
    imageUrl: null,
    url: null,
    status: "pending",
    result: null,
    accepted: 1,
    failed: 0,
    needsAction: true,
    readAt: null,
    occurredAt: "2026-10-11T10:00:00.000Z",
    updatedAt: "2026-10-11T10:00:00.000Z",
    action: {
      interactionId: "int_synthetic",
      expiresAt: "2026-10-12T10:00:00.000Z",
    },
  },
  events: [],
} as unknown as InboxDetailDto;

const service: ServiceDto = {
  id: "svc_synthetic",
  title: "Acme CRM",
  imageUrl: null,
  url: null,
  webhookUrl: "https://shark.example/hooks/synthetic",
  createdAt: "2026-10-11T10:00:00.000Z",
} as unknown as ServiceDto;

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
}

describe("mutations while offline", () => {
  let container: HTMLDivElement;
  let root: Root;

  const buttons = () => [...container.querySelectorAll("button")];
  const named = (label: string) =>
    buttons().find((node) => (node.textContent ?? "").trim() === label);
  const mount = async (node: React.ReactNode) => {
    await act(async () => root.render(node));
  };
  const goOffline = async () => {
    await act(async () => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
  };
  const goOnline = async () => {
    await act(async () => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setOnline(true);
    resetConnection();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    setOnline(true);
    resetConnection();
    vi.unstubAllGlobals();
  });

  it("disables answering an ask with a reason, and restores it", async () => {
    await mount(<AskCard ask={ask} onChanged={() => {}} />);
    for (const label of ["Ship now", "Wait"]) {
      expect(named(label)?.disabled, label).toBe(false);
    }

    await goOffline();
    for (const label of ["Ship now", "Wait"]) {
      const control = named(label);
      expect(control?.disabled, label).toBe(true);
      expect(control?.title, label).toBe(OFFLINE_HINT);
    }
    // The ask itself is still readable, which is the point of keeping it.
    expect(container.textContent).toContain("Ship the board or wait?");

    await goOnline();
    for (const label of ["Ship now", "Wait"]) {
      expect(named(label)?.disabled, label).toBe(false);
      expect(named(label)?.title, label).toBe("");
    }
  });

  /**
   * Opening a form is not a write, so a reply can still be drafted offline and
   * sent when the link returns. Only the button that sends it is held back.
   */
  it("still opens the reply and later forms, and disables sending and snoozing", async () => {
    await mount(<AskCard ask={ask} onChanged={() => {}} />);
    await goOffline();

    expect(named("Reply…")?.disabled).toBe(false);
    await act(async () => named("Reply…")?.click());
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea?.disabled).toBe(false);
    expect(named("Send reply")?.title).toBe(OFFLINE_HINT);

    expect(named("Later")?.disabled).toBe(false);
    await act(async () => named("Later")?.click());
    expect(named("Snooze")?.disabled).toBe(true);
    expect(named("Snooze")?.title).toBe(OFFLINE_HINT);
  });

  it("disables dismissing an inbox request but keeps the item on screen", async () => {
    await mount(<InboxDetailContent detail={detail} onDismiss={() => {}} />);
    expect(named("Dismiss")?.disabled).toBe(false);

    await goOffline();
    expect(named("Dismiss")?.disabled).toBe(true);
    expect(named("Dismiss")?.title).toBe(OFFLINE_HINT);
    expect(container.textContent).toContain("Approve the deploy?");
    expect(container.textContent).toContain("Staging is green.");
  });

  it("disables marking the inbox read while still showing the list", async () => {
    await mount(
      <MemoryRouter initialEntries={["/inbox"]}>
        <InboxPanel />
      </MemoryRouter>,
    );
    expect(named("Mark all read")?.disabled).toBe(false);

    await goOffline();
    expect(named("Mark all read")?.disabled).toBe(true);
    expect(named("Mark all read")?.title).toBe(OFFLINE_HINT);
    // The list that was loaded is still the list, not an error paragraph.
    expect(container.textContent).toContain("Deploy finished");
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  /**
   * The point of the whole thing: going offline must not take the board away.
   * The lanes stay, the "Could not load the board" paragraph never appears —
   * the shell's banner is the one place that says what is going on.
   */
  it("keeps the loaded board on screen, with no error paragraph", async () => {
    await mount(
      <MemoryRouter initialEntries={["/board"]}>
        <Board />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain("Ship the board or wait?");

    await goOffline();
    expect(container.textContent).toContain("Ship the board or wait?");
    expect(container.textContent).not.toContain("Could not load the board");
    expect(container.querySelector(".text-danger")).toBeNull();
    // And the one action it offers is held back with its reason.
    expect(named("Ship now")?.title).toBe(OFFLINE_HINT);
  });

  it("disables the settings forms that write, and leaves copying alone", async () => {
    await mount(
      <ServicesSection
        devices={[]}
        onChanged={() => {}}
        onTokenRevoked={() => {}}
        services={[service]}
        tokens={[]}
      />,
    );
    await goOffline();

    for (const label of ["New service", "Edit", "Rotate token", "Delete"]) {
      const control = named(label);
      expect(control?.disabled, label).toBe(true);
      expect(control?.title, label).toBe(OFFLINE_HINT);
    }
    // Copying a webhook URL is local; it has no business being disabled.
    expect(named("Copy webhook")?.disabled).toBe(false);
  });
});
