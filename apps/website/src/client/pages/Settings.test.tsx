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

/**
 * The install section only exists where there is something to install, so the
 * platform detectors are stubbed per test. happy-dom is none of these
 * browsers, which is also the Firefox-desktop case: no section, version only.
 */
const install = { standalone: false, prompt: false, ios: false, macSafari: false };

vi.mock("../lib/pwaInstall", () => ({
  isStandalone: () => install.standalone,
  canInstall: () => install.prompt,
  isIosSafari: () => install.ios,
  isMacSafari: () => install.macSafari,
  promptInstall: vi.fn(async () => "accepted"),
  subscribeToInstallAvailability: () => () => {},
}));

vi.mock("../lib/pwaUpdate", () => ({
  checkForUpdate: vi.fn(async () => false),
  serviceWorkerVersion: async () => "0f1e2d3c4b5a6978",
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
    Object.assign(install, { standalone: false, prompt: false, ios: false, macSafari: false });
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

  /**
   * Where nothing can be installed there is no section and no rail entry, but
   * the build line stays: it is what gets read back when someone is asked
   * which version they are on.
   */
  it("shows the build alone where there is nothing to install", async () => {
    await mount("/settings");
    expect(container.querySelector("#install")).toBeNull();
    expect(container.textContent).not.toContain("Install SHark");
    expect(railLinks().map((link) => link.getAttribute("href"))).not.toContain("/settings#install");
    expect(container.textContent).toContain("0f1e2d3c4b5a6978");
  });

  it("adds the install section and its rail entry on Chromium", async () => {
    install.prompt = true;
    await mount("/settings");
    expect(container.querySelector("#install")).not.toBeNull();
    expect(container.textContent).toContain("Install SHark");
    expect(
      railLinks()
        .map((link) => link.getAttribute("href"))
        .at(-1),
    ).toBe("/settings#install");
    expect(railLinks().at(-1)?.textContent).toBe("Install app");
  });

  it("gives iOS Safari the Add to Home Screen steps instead of a button", async () => {
    install.ios = true;
    await mount("/settings");
    expect(container.textContent).toContain("Add to Home Screen");
    expect(container.textContent).not.toContain("Install SHark");
  });

  it("reports the build and offers an update check when already installed", async () => {
    install.standalone = true;
    await mount("/settings");
    const section = container.querySelector("#install");
    expect(section?.textContent).toContain("Installed");
    expect(section?.textContent).toContain("0f1e2d3c4b5a6978");
    expect(section?.textContent).toContain("Check for updates");
  });
});
