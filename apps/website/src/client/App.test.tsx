// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const session = { user: { id: "usr_synthetic", email: "operator@example.test", image: null } };

vi.mock("./lib/auth", () => ({
  useSession: () => ({ data: session, isPending: false }),
  signOut: vi.fn(async () => {}),
  signInWithApple: vi.fn(),
}));

/**
 * These tests are about routing, not data. Every API call refuses, so a page
 * renders its loading or error state and nothing reaches a server.
 */
vi.mock("./lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/api")>()),
  api: new Proxy(
    {},
    { get: () => vi.fn(async () => Promise.reject(new Error("No server in these tests"))) },
  ),
}));

/**
 * The consent page has its own auth client, whose session hook opens a request
 * while it renders. Stub the module so no test reaches the network.
 */
vi.mock("./lib/oauth-api", () => ({
  oauthAuthClient: { useSession: () => ({ data: session, isPending: false }) },
  getOAuthClientInfo: vi.fn(async () => ({ client_id: "mcp_synthetic" })),
  signedOAuthQuery: vi.fn(() => ""),
  submitOAuthConsent: vi.fn(async () => "/"),
}));

function render(path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

/** Every route the router answers, with text only that page renders. */
const ROUTES: [path: string, expected: string][] = [
  ["/", "POST a webhook"],
  ["/docs", "MCP server"],
  ["/privacy", "Private deployment"],
  ["/terms", "Personal use"],
  ["/oauth/consent", "Nothing to authorize"],
  ["/board", "Board"],
  ["/board/ask/bask_synthetic", "Board"],
  ["/inbox", "Complete notification, interaction, and Live Activity history."],
  ["/inbox/ibox%3Aevent%3Asynthetic", "Loading this notification"],
  ["/teams", "Share apps with the people you work with"],
  ["/teams/team_synthetic", "Loading this team"],
  ["/settings", "This browser, your devices, and everything allowed to reach them."],
  ["/join/invite-code", "Checking your invite"],
  ["/cli/authorize", "Authorize a command-line client"],
];

describe("routes", () => {
  it.each(ROUTES)("resolves %s to a page", (path, expected) => {
    expect(render(path)).toContain(expected);
  });

  /**
   * Push deep links, the iPhone app's registered web app, and the sign-in
   * callback all still point at `/dashboard`. They have to land on a page.
   */
  it("renders the not-found page for an unknown path", () => {
    const html = render("/board/ask");
    expect(html).toContain("There is nothing at this address");
    expect(html).toContain("/board/ask");
    expect(html).toContain("Go to the board");
  });

  it("keeps the not-found page inside the app shell", () => {
    const html = render("/definitely-not-a-route");
    expect(html).toContain("There is nothing at this address");
    expect(html).toContain('aria-label="Primary"');
  });

  it("keeps the OAuth consent decision on a page of its own", () => {
    const html = render("/oauth/consent");
    expect(html).not.toContain('aria-label="Primary"');
  });

  /**
   * One header per page, checked against the real tree rather than stub
   * routes. A second wordmark means a page kept its own header after moving
   * inside the shell, which is what every page had before.
   */
  it.each(["/board", "/inbox", "/teams", "/settings", "/docs", "/teams/team_synthetic"])(
    "renders exactly one brand wordmark at %s",
    (path) => {
      const host = document.createElement("div");
      host.innerHTML = render(path);
      expect(host.querySelectorAll("[src*='shark-devil-mark']")).toHaveLength(1);
    },
  );

  /** One `<h1>` per page, so the page announces what it is exactly once. */
  it.each(["/board", "/inbox", "/teams", "/settings"])("gives %s a single heading", (path) => {
    const host = document.createElement("div");
    host.innerHTML = render(path);
    expect(host.querySelectorAll("h1")).toHaveLength(1);
  });

  it("gives the docs the shell's navigation", () => {
    const html = render("/docs");
    // The phone tab bar is the only primary nav under `md`, so the docs need it.
    expect(html.match(/aria-label="Primary"/g)).toHaveLength(2);
    // Docs is not one of the four destinations, so none of them is current.
    expect(html).not.toContain('aria-current="page"');
  });
});

/**
 * `<Navigate>` only moves on a real render, so the redirects are checked in the
 * DOM: where did the router actually land?
 */
describe("legacy redirects", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function Here() {
    return <p data-testid="here">{useLocation().pathname}</p>;
  }

  async function mount(path: string): Promise<string | undefined> {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <App />
          <Here />
        </MemoryRouter>,
      ),
    );
    return container.querySelector("[data-testid='here']")?.textContent ?? undefined;
  }

  it.each([
    ["/dashboard", "/inbox"],
    ["/dashboard/teams/team_synthetic", "/teams/team_synthetic"],
  ])("redirects %s to %s", async (from, to) => {
    expect(await mount(from)).toBe(to);
  });
});
