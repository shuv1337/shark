// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

const session = { user: { id: "usr_synthetic", email: "operator@example.test", image: null } };

vi.mock("./lib/auth", () => ({
  useSession: () => ({ data: session, isPending: false }),
  signOut: vi.fn(async () => {}),
  signInWithApple: vi.fn(),
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
  ["/docs", "Docs"],
  ["/privacy", "Private deployment"],
  ["/terms", "Personal use"],
  ["/oauth/consent", "Nothing to authorize"],
  ["/board", "Board"],
  ["/board/ask/bask_synthetic", "Board"],
  ["/dashboard", "Inbox"],
  ["/dashboard/teams/team_synthetic", "Loading this team"],
  ["/join/invite-code", "Checking your invite"],
  ["/cli/authorize", "Authorize a command-line client"],
];

describe("routes", () => {
  it.each(ROUTES)("resolves %s to a page", (path, expected) => {
    expect(render(path)).toContain(expected);
  });

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
  it.each(["/board", "/dashboard", "/docs", "/dashboard/teams/team_synthetic"])(
    "renders exactly one brand wordmark at %s",
    (path) => {
      const host = document.createElement("div");
      host.innerHTML = render(path);
      expect(host.querySelectorAll("[src*='shark-devil-mark']")).toHaveLength(1);
    },
  );

  it("gives the docs the shell's navigation", () => {
    const html = render("/docs");
    // The phone tab bar is the only primary nav under `md`, so the docs need it.
    expect(html.match(/aria-label="Primary"/g)).toHaveLength(2);
    expect(html).toContain('aria-current="page"');
  });
});
