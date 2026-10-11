// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { publishBoardWaiting, refreshInboxCounts, resetNavCounts } from "../lib/counts";
import { AppShell } from "./AppShell";

const session = { user: { id: "usr_synthetic", email: "operator@example.test", image: null } };

vi.mock("../lib/auth", () => ({
  useSession: () => ({ data: session, isPending: false }),
  signOut: vi.fn(async () => {}),
  signInWithApple: vi.fn(),
}));

/** The nav badges read the board and the inbox; no test here goes to a server. */
vi.mock("../lib/api", () => ({
  api: {
    getBoard: vi.fn(async () => ({ waiting: [] })),
    getInboxCounts: vi.fn(async () => ({ unread: 0, needsAction: 0 })),
  },
}));

function shell(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/board" element={<p>board page</p>} />
          <Route path="/board/ask/:id" element={<p>ask page</p>} />
          <Route path="/inbox" element={<p>inbox page</p>} />
          <Route path="/inbox/:id" element={<p>item page</p>} />
          <Route path="/teams" element={<p>teams page</p>} />
          <Route path="/teams/:id" element={<p>team page</p>} />
          <Route path="/settings" element={<p>settings page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const shellAt = (path: string) => renderToStaticMarkup(shell(path));

/** The labels of the links the DOM marks with `aria-current="page"`. */
function currentLabels(html: string): string[] {
  const host = document.createElement("div");
  host.innerHTML = html;
  return [...host.querySelectorAll("a[aria-current='page']")].map((link) =>
    // The badge's screen-reader text hangs off the same link; the label is the
    // first thing in it either way.
    (link.textContent ?? "").replace(/,.*$/, "").trim(),
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, "hark");
  resetNavCounts();
});

describe("app shell", () => {
  it("renders the primary navigation around the page", () => {
    const html = shellAt("/board");
    expect(html).toContain("board page");
    for (const label of ["Board", "Inbox", "Teams", "Settings"]) {
      // Once in the header navigation, once in the phone tab bar.
      expect(html.match(new RegExp(`>${label}<`, "g"))?.length, label).toBe(2);
    }
    // Docs is a reference you read once: it lives in the account menu.
    expect(html).not.toContain(">Docs<");
    // The brand mark, the header navigation, and the phone tab bar.
    expect(html.match(/href="\/board"/g)?.length).toBe(3);
    expect(html).toContain("operator@example.test");
  });

  it("marks only the current route with aria-current", () => {
    expect(currentLabels(shellAt("/board"))).toEqual(["Board", "Board"]);
    expect(currentLabels(shellAt("/inbox"))).toEqual(["Inbox", "Inbox"]);
    expect(currentLabels(shellAt("/teams"))).toEqual(["Teams", "Teams"]);
    expect(currentLabels(shellAt("/settings"))).toEqual(["Settings", "Settings"]);
  });

  it("keeps the section marked on a page nested under it", () => {
    // A push deep link to one ask is still the board; one item is still the
    // inbox; one team is still Teams.
    expect(currentLabels(shellAt("/board/ask/bask_synthetic"))).toEqual(["Board", "Board"]);
    expect(currentLabels(shellAt("/inbox/ibox%3Aevent%3A1"))).toEqual(["Inbox", "Inbox"]);
    expect(currentLabels(shellAt("/teams/team_synthetic"))).toEqual(["Teams", "Teams"]);
  });

  it("renders the page alone inside the SHark iPhone web view", () => {
    Object.defineProperty(window, "hark", { configurable: true, value: {} });
    const html = shellAt("/board");
    expect(html).toContain("board page");
    expect(html).not.toContain('aria-label="Primary"');
    expect(html).not.toContain("operator@example.test");
  });
});

describe("navigation badges", () => {
  const inbox = (unread: number, needsAction: number) => {
    vi.mocked(api.getInboxCounts).mockResolvedValue({ unread, needsAction });
    return refreshInboxCounts();
  };

  it("shows no badge when nothing is waiting", () => {
    const html = shellAt("/board");
    expect(html).not.toContain("waiting on you");
    expect(html).not.toContain("unread");
    expect(html).not.toContain("needs your response");
  });

  it("counts board asks and unread inbox items, in the header and the tab bar", async () => {
    publishBoardWaiting(3);
    await inbox(2, 0);

    const html = shellAt("/board");
    expect(html.match(/3 waiting on you/g)).toHaveLength(2);
    expect(html.match(/2 unread/g)).toHaveLength(2);
  });

  /**
   * Unread and needs-action are different facts: an approval you have read is
   * no longer unread but is still waiting on you. The count never absorbs it.
   */
  it("counts only what is unread, whatever needs an answer", async () => {
    await inbox(2, 5);
    const html = shellAt("/inbox");
    expect(html.match(/2 unread/g)).toHaveLength(2);
    // Not 7: the two numbers are never added together.
    expect(html).not.toContain("7 unread");
    expect(html).not.toContain(">7<");
    // The dot is the inbox's other signal, and the count already carries one.
    expect(html).not.toContain("needs your response");
  });

  it("falls back to a dot when something needs an answer and nothing is unread", async () => {
    await inbox(0, 3);
    const html = shellAt("/inbox");
    expect(html.match(/needs your response/g)).toHaveLength(2);
    expect(html).not.toContain("3 unread");
  });

  it("caps the counts instead of widening the navigation", async () => {
    publishBoardWaiting(140);
    await inbox(12, 0);

    const html = shellAt("/board");
    // Header has room for three characters; a phone tab does not.
    expect(html).toContain("99+");
    expect(html).toContain("9+");
    expect(html).toContain("140 waiting on you");
  });
});

describe("account menu", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  const trigger = () => {
    const button = container.querySelector<HTMLButtonElement>("button[aria-haspopup='menu']");
    if (!button) throw new Error("Missing account menu trigger");
    return button;
  };

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(shell("/board")));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const items = () => [...container.querySelectorAll<HTMLElement>("[role='menuitem']")];
  const label = (element: Element | null | undefined) => element?.textContent?.trim();
  const press = async (key: string) => {
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  };

  it("opens to the account, the self-hosted badge, docs and sign out", async () => {
    expect(container.querySelector("[role='menu']")).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().getAttribute("aria-controls")).toBeNull();

    await act(async () => trigger().click());

    const menu = container.querySelector("[role='menu']");
    expect(menu).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(menu?.id);
    expect(menu?.textContent).toContain("operator@example.test");
    expect(menu?.textContent).toContain("Self-hosted");
    expect(label(items()[0])).toBe("Docs");
    expect(label(items()[1])).toBe("Sign out");
  });

  it("moves focus to the first item on open", async () => {
    await act(async () => trigger().click());
    expect(document.activeElement).toBe(items()[0]);
  });

  it("cycles with the arrow keys and jumps with Home and End", async () => {
    await act(async () => trigger().click());

    await press("ArrowDown");
    expect(label(document.activeElement)).toBe("Sign out");
    // Past the end, back to the top.
    await press("ArrowDown");
    expect(label(document.activeElement)).toBe("Docs");
    // Before the start, round to the bottom.
    await press("ArrowUp");
    expect(label(document.activeElement)).toBe("Sign out");
    await press("Home");
    expect(label(document.activeElement)).toBe("Docs");
    await press("End");
    expect(label(document.activeElement)).toBe("Sign out");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    await act(async () => trigger().click());
    await press("Escape");
    expect(container.querySelector("[role='menu']")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("returns focus to the trigger from the phone close button", async () => {
    await act(async () => trigger().click());
    const dismiss = [...container.querySelectorAll("button")].find(
      (node) => node.getAttribute("aria-label") === "Close account menu",
    );
    await act(async () => dismiss?.click());
    expect(container.querySelector("[role='menu']")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on an outside click without stealing focus back", async () => {
    await act(async () => trigger().click());
    const outside = document.createElement("button");
    document.body.append(outside);

    await act(async () => {
      outside.focus();
      window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });

    expect(container.querySelector("[role='menu']")).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
