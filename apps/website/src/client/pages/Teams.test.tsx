// @vitest-environment happy-dom
import type { TeamDto } from "@hark/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, isMissingRoute } from "../lib/api";
import { Teams } from "./Teams";

const session = { user: { id: "usr_synthetic", email: "operator@example.test", image: null } };

vi.mock("../lib/auth", () => ({
  useSession: () => ({ data: session, isPending: false }),
  signOut: vi.fn(async () => {}),
  signInWithApple: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: { listTeams: vi.fn(), createTeam: vi.fn() },
  isMissingRoute: vi.fn(() => false),
}));

const team: TeamDto = {
  id: "team_synthetic",
  name: "Platform",
  role: "owner",
  plan: "free",
  memberCount: 2,
  appCount: 1,
  oncallGroupCount: 1,
  seats: { used: 2, available: 5, billable: 0 },
  createdAt: "2026-07-30T19:00:00.000Z",
};

describe("teams page", () => {
  let container: HTMLDivElement;
  let root: Root;

  const mount = async () => {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/teams"]}>
          <Routes>
            <Route element={<Teams />} path="/teams" />
          </Routes>
        </MemoryRouter>,
      ),
    );
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(isMissingRoute).mockReturnValue(false);
    vi.mocked(api.listTeams)
      .mockReset()
      .mockResolvedValue({ teams: [team] });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("links each team to its own page, not the old dashboard address", async () => {
    await mount();
    const link = container.querySelector("a[href='/teams/team_synthetic']");
    expect(link?.textContent).toContain("Platform");
    expect(container.querySelector("a[href^='/dashboard']")).toBeNull();
  });

  it("teaches what a team is when there are none, and offers the way in", async () => {
    vi.mocked(api.listTeams).mockResolvedValue({ teams: [] });
    await mount();
    expect(container.textContent).toContain("No teams yet");
    expect(container.textContent).toContain("on-call rotation");
    expect([...container.querySelectorAll("button")].map((node) => node.textContent)).toContain(
      "New team",
    );
  });

  it("says so when the server predates teams", async () => {
    vi.mocked(api.listTeams).mockRejectedValue(new Error("Not found"));
    vi.mocked(isMissingRoute).mockReturnValue(true);
    await mount();
    expect(container.textContent).toContain("Teams are not available on this server");
  });

  it("names the problem when teams cannot be loaded", async () => {
    vi.mocked(api.listTeams).mockRejectedValue(new Error("boom"));
    await mount();
    expect(container.textContent).toContain("Could not load your teams.");
  });
});
