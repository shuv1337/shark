// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

const session = { user: { id: "usr_synthetic", email: "operator@example.test", image: null } };

vi.mock("../lib/auth", () => ({
  useSession: () => ({ data: session, isPending: false }),
  signOut: vi.fn(async () => {}),
  signInWithApple: vi.fn(),
}));

function shell(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/board" element={<p>board page</p>} />
          <Route path="/board/ask/:id" element={<p>ask page</p>} />
          <Route path="/dashboard" element={<p>inbox page</p>} />
          <Route path="/dashboard/teams/:id" element={<p>team page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const shellAt = (path: string) => renderToStaticMarkup(shell(path));

/** The active links, as the DOM marks them: `<a aria-current="page" …>Label</a>`. */
function currentLabels(html: string): string[] {
  return [...html.matchAll(/<a[^>]*aria-current="page"[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]*)/g)].map(
    (match) => match[1] ?? "",
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, "hark");
});

describe("app shell", () => {
  it("renders the primary navigation around the page", () => {
    const html = shellAt("/board");
    expect(html).toContain("board page");
    expect(html).toContain(">Board<");
    expect(html).toContain(">Inbox<");
    expect(html).toContain(">Docs<");
    // The brand mark, the header navigation, and the phone tab bar.
    expect(html.match(/href="\/board"/g)?.length).toBe(3);
    expect(html).toContain("operator@example.test");
  });

  it("marks only the current route with aria-current", () => {
    expect(currentLabels(shellAt("/board"))).toEqual(["Board", "Board"]);
    expect(currentLabels(shellAt("/dashboard"))).toEqual(["Inbox", "Inbox"]);
  });

  it("keeps the section marked on a page nested under it", () => {
    // A push deep link to one ask is still the board; a team is still the inbox.
    expect(currentLabels(shellAt("/board/ask/bask_synthetic"))).toEqual(["Board", "Board"]);
    expect(currentLabels(shellAt("/dashboard/teams/team_synthetic"))).toEqual(["Inbox", "Inbox"]);
  });

  it("renders the page alone inside the SHark iPhone web view", () => {
    Object.defineProperty(window, "hark", { configurable: true, value: {} });
    const html = shellAt("/board");
    expect(html).toContain("board page");
    expect(html).not.toContain('aria-label="Primary"');
    expect(html).not.toContain("operator@example.test");
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
