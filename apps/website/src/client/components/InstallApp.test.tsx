// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallAppSection } from "./InstallApp";

/**
 * Installing is a different act in every browser, so the section is tested one
 * browser at a time: the platform detectors are the seam, and each of them
 * must produce exactly one of the four paths — and nothing at all where none
 * of them applies.
 */
const detect = {
  standalone: false,
  install: false,
  ios: false,
  macSafari: false,
};
const promptInstall = vi.fn(async () => "accepted" as const);
const checkForUpdate = vi.fn(async () => false);

vi.mock("../lib/pwaInstall", () => ({
  isStandalone: () => detect.standalone,
  canInstall: () => detect.install,
  isIosSafari: () => detect.ios,
  isMacSafari: () => detect.macSafari,
  promptInstall: () => promptInstall(),
  subscribeToInstallAvailability: () => () => {},
}));

vi.mock("../lib/pwaUpdate", () => ({
  checkForUpdate: () => checkForUpdate(),
  serviceWorkerVersion: async () => "0f1e2d3c4b5a6978",
}));

describe("install app section", () => {
  let container: HTMLDivElement;
  let root: Root;

  const text = () => container.textContent ?? "";
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((node) =>
      (node.textContent ?? "").includes(label),
    );
  const mount = async () => {
    await act(async () => root.render(<InstallAppSection />));
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.assign(detect, { standalone: false, install: false, ios: false, macSafari: false });
    promptInstall.mockClear();
    checkForUpdate.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders nothing where no install path exists", async () => {
    await mount();
    expect(container.innerHTML).toBe("");
  });

  it("offers the Chromium prompt and reports its outcome", async () => {
    detect.install = true;
    await mount();
    const install = button("Install SHark");
    expect(install).toBeDefined();

    await act(async () => install?.click());
    expect(promptInstall).toHaveBeenCalledOnce();
    expect(text()).toContain("Installed. Look for SHark alongside your other apps.");
  });

  it("says so plainly when the Chromium prompt is declined", async () => {
    detect.install = true;
    promptInstall.mockResolvedValueOnce("dismissed" as never);
    await mount();
    await act(async () => button("Install SHark")?.click());
    expect(text()).toContain("Not installed. You can install it any time from here.");
  });

  it("walks iOS Safari through Add to Home Screen, in three steps", async () => {
    detect.ios = true;
    await mount();
    expect(container.querySelectorAll("ol li")).toHaveLength(3);
    expect(text()).toContain("Share");
    expect(text()).toContain("Add to Home Screen");
    expect(text()).toContain("Add");
    // The share mark is drawn, not a character standing in for an icon.
    expect(container.querySelector("ol li svg")).not.toBeNull();
    expect(button("Install SHark")).toBeUndefined();
  });

  it("gives macOS Safari the Add to Dock line", async () => {
    detect.macSafari = true;
    await mount();
    expect(text()).toContain("Add to Dock");
    expect(button("Install SHark")).toBeUndefined();
  });

  /** Standalone takes precedence: an installed app has nothing left to install. */
  it("reports the running build and checks for updates when already installed", async () => {
    detect.standalone = true;
    detect.install = true;
    await mount();
    expect(text()).toContain("Installed");
    expect(text()).toContain("0f1e2d3c4b5a6978");
    expect(button("Install SHark")).toBeUndefined();

    await act(async () => button("Check for updates")?.click());
    expect(checkForUpdate).toHaveBeenCalledOnce();
    expect(text()).toContain("You are on the latest build.");
  });

  it("points at the reload bar when an update is already waiting", async () => {
    detect.standalone = true;
    checkForUpdate.mockResolvedValueOnce(true);
    await mount();
    await act(async () => button("Check for updates")?.click());
    expect(text()).toContain("A new build is ready.");
  });
});
