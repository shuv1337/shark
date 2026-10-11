// @vitest-environment happy-dom
import type {
  BoardAskDto,
  InboxDetailDto,
  ServiceDto,
  TeamDto,
  TeamMemberDto,
} from "@hark/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_HINT, resetConnection } from "../lib/connection";
import { Board } from "../pages/Board";
import { TeamPage } from "../pages/Team";
import { ActivityLogSection } from "./ActivityLog";
import { AskCard } from "./board/AskCard";
import { InboxDetailContent, InboxDetailView, InboxPanel } from "./InboxPanel";
import { ServicesSection } from "./ServicesSection";
import { MembersSection } from "./team/Members";

/**
 * Offline, a control that only sends something to the server says why it
 * cannot instead of letting the tap land and reporting a failure afterwards.
 *
 * What must *not* happen is the other half of this: nothing already on screen
 * is hidden, replaced with an error, or unlinked. Reading is always available.
 */
/** Flipped by the reconnect test so the board can fail and then recover. */
const board = vi.hoisted(() => ({ fails: false }));

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
      getBoard: async () => {
        if (board.fails) throw new TypeError("Failed to fetch");
        return {
          waiting: [{ ...boardAsk, id: "bask_synthetic", title: "Ship the board or wait?" }],
          withAgent: [],
          inFlight: [],
          queued: [],
          notes: [],
          done: [],
          crew: [],
          cursor: "cursor-synthetic",
        };
      },
      getInboxCounts: async () => ({ unread: 1, needsAction: 0 }),
      listInbox: async () => ({ items: [unread], nextCursor: null, unresolvedCount: 1 }),
      listEvents: async () => {
        throw new TypeError("Failed to fetch");
      },
      getTeam: async () => {
        throw new TypeError("Failed to fetch");
      },
      getInboxItem: async () => {
        throw new TypeError("Failed to fetch");
      },
      listTeamApps: async () => ({ apps: [] }),
      listTeamInvites: async () => ({ invites: [] }),
      listOncallGroups: async () => ({ groups: [] }),
      listTeamPages: async () => ({ pages: [], nextCursor: null }),
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

const team = {
  id: "team_synthetic",
  name: "Platform",
  role: "owner",
  memberCount: 2,
  appCount: 0,
  oncallGroupCount: 0,
  plan: "free",
  seats: { used: 2, available: null, billable: 0 },
  createdAt: "2026-10-11T10:00:00.000Z",
} as unknown as TeamDto;

const members = [
  {
    userId: "usr_synthetic",
    name: "Cap",
    email: "operator@example.test",
    image: null,
    role: "owner",
    joinedAt: "2026-10-11T10:00:00.000Z",
  },
  {
    userId: "usr_other",
    name: "Mate",
    email: "mate@example.test",
    image: null,
    role: "member",
    joinedAt: "2026-10-11T10:00:00.000Z",
  },
] as unknown as TeamMemberDto[];

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
    board.fails = false;
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

  /**
   * The activity log polls, so offline it fails every ten seconds. The shell
   * says it once; a red box under the log repeating it is noise.
   */
  it("keeps the activity log quiet offline rather than stacking load errors", async () => {
    await goOffline();
    await mount(<ActivityLogSection />);
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(container.textContent).not.toContain("Could not load activity");
    expect(container.textContent).not.toContain("Failed to fetch");
    // And it says what is actually true instead of a skeleton for something
    // that is not coming.
    expect(container.textContent).toContain("Activity has not loaded in this browser yet");
  });

  /**
   * Offline with nothing cached is not the same as a notification that does
   * not exist; saying "not available" would be a lie about the operator's data.
   */
  it("explains a cold inbox item offline instead of calling it unavailable", async () => {
    await goOffline();
    await mount(
      <MemoryRouter initialEntries={["/inbox/ibox%3Aevent%3A1"]}>
        <InboxDetailView id="ibox:event:1" />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain("This notification has not loaded yet");
    expect(container.textContent).not.toContain("This notification is not available");
    expect(container.textContent).not.toContain("Failed to fetch");
  });

  it("explains a cold team page offline instead of printing the load error", async () => {
    await goOffline();
    await mount(
      <MemoryRouter initialEntries={["/teams/team_synthetic"]}>
        <Routes>
          <Route element={<TeamPage />} path="/teams/:teamId" />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.textContent).toContain("This team has not loaded in this browser yet");
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(container.textContent).not.toContain("Could not load this team");
    expect(container.textContent).not.toContain("Try again");
  });

  /**
   * A page that stopped showing its load error because the shell was saying
   * "offline" is still holding that error. Without a refetch on reconnect it
   * would simply reappear the moment the banner left — the worst possible
   * moment, because the page is about to be correct again.
   */
  it("clears the suppressed error and reads again when the network returns", async () => {
    board.fails = true;
    await mount(
      <MemoryRouter initialEntries={["/board"]}>
        <Board />
      </MemoryRouter>,
    );
    await goOffline();
    expect(container.textContent).not.toContain("Failed to fetch");

    board.fails = false;
    await goOnline();
    // Not the error resurfacing as the banner leaves: the board itself.
    expect(container.textContent).not.toContain("Failed to fetch");
    expect(container.textContent).not.toContain("Could not load the board");
    expect(container.textContent).toContain("Ship the board or wait?");
  });

  it("disables the team writes with the same reason", async () => {
    await mount(
      <MemoryRouter initialEntries={["/teams/team_synthetic"]}>
        <MembersSection
          members={members}
          onChanged={() => {}}
          team={team}
          viewerId="usr_synthetic"
        />
      </MemoryRouter>,
    );
    expect(named("Invite")?.disabled).toBe(false);

    await goOffline();
    for (const label of ["Invite", "Make owner", "Remove"]) {
      const control = named(label);
      expect(control?.disabled, label).toBe(true);
      expect(control?.title, label).toBe(OFFLINE_HINT);
    }
    // The roster itself is still readable.
    expect(container.textContent).toContain("mate@example.test");
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
