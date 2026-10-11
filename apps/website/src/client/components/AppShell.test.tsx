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

  /**
   * One header per page. A second wordmark means a page kept its own header
   * after moving inside the shell, which is what every page did before.
   */
  it("renders exactly one brand wordmark", () => {
    for (const path of ["/board", "/dashboard", "/dashboard/teams/team_synthetic"]) {
      const host = document.createElement("div");
      host.innerHTML = shellAt(path);
      expect(host.querySelectorAll("[src*='shark-devil-mark']")).toHaveLength(1);
    }
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

  it("opens to the account, the self-hosted badge, docs and sign out", async () => {
    expect(container.querySelector("[role='menu']")).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    await act(async () => trigger().click());

    const menu = container.querySelector("[role='menu']");
    expect(menu).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(menu?.textContent).toContain("operator@example.test");
    expect(menu?.textContent).toContain("Self-hosted");
    expect(menu?.textContent).toContain("Docs");
    expect(menu?.textContent).toContain("Sign out");
  });

  it("closes on Escape", async () => {
    await act(async () => trigger().click());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector("[role='menu']")).toBeNull();
  });
});
