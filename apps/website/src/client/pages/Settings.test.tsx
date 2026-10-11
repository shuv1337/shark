// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "./Settings";

const session = { user: { id: "usr_synthetic", email: "operator@example.test", image: null } };

vi.mock("../lib/auth", () => ({
  useSession: () => ({ data: session, isPending: false }),
  signOut: vi.fn(async () => {}),
  signInWithApple: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  // `ServicesSection` only uses this for an `instanceof` check on a failure.
  ApiRequestError: Error,
  api: {
    listServices: vi.fn(async () => ({ services: [] })),
    listDevices: vi.fn(async () => ({ devices: [] })),
    listApiTokens: vi.fn(async () => ({ tokens: [] })),
  },
}));

vi.mock("../lib/oauth-api", () => ({
  oauthApi: { listClients: vi.fn(async () => ({ clients: [] })) },
}));

vi.mock("../lib/webPush", () => ({
  browserPushAvailability: () => ({ status: "unsupported" }),
  browserDeviceName: () => "Synthetic browser",
  currentWebPushSubscription: vi.fn(async () => null),
  enableWebPush: vi.fn(),
  requestWebPushPermission: vi.fn(),
}));

describe("settings page", () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrolled: string[];

  const mount = async (path: string) => {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Settings />} path="/settings" />
          </Routes>
        </MemoryRouter>,
      ),
    );
  };
  const railLinks = () =>
    [...container.querySelectorAll("nav[aria-label='Settings sections'] a")] as HTMLAnchorElement[];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    scrolled = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.id);
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders every section, anchored for deep links", async () => {
    await mount("/settings");
    for (const id of ["account", "notifications", "devices", "services", "mcp"]) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(railLinks().map((link) => link.getAttribute("href"))).toEqual([
      "/settings#account",
      "/settings#notifications",
      "/settings#devices",
      "/settings#services",
      "/settings#mcp",
    ]);
  });

  it("scrolls to the section a hash names and marks it in the rail", async () => {
    await mount("/settings#devices");
    expect(scrolled).toContain("devices");
    const current = railLinks().filter((link) => link.getAttribute("aria-current"));
    expect(current.map((link) => link.textContent)).toEqual(["Devices"]);
  });

  it("marks Account current with no hash, and follows a rail link", async () => {
    await mount("/settings");
    expect(
      railLinks()
        .filter((link) => link.getAttribute("aria-current"))
        .map((link) => link.textContent),
    ).toEqual(["Account"]);

    const mcp = railLinks().find((link) => link.textContent === "Connected MCP clients");
    await act(async () => mcp?.click());
    expect(scrolled).toContain("mcp");
    expect(
      railLinks()
        .filter((link) => link.getAttribute("aria-current"))
        .map((link) => link.textContent),
    ).toEqual(["Connected MCP clients"]);
  });

  it("leaves the install section to Phase 2b rather than promising a button", async () => {
    await mount("/settings");
    expect(container.textContent).not.toContain("Install SHark");
  });
});
