import { describe, expect, it } from "vitest";
import { activeSection, type SectionIntersection, visibleSections } from "./sectionSpy";

const ORDER = ["account", "notifications", "devices", "services", "mcp"];

const entry = (id: string, isIntersecting: boolean): SectionIntersection => ({
  isIntersecting,
  target: { id },
});

describe("section spy", () => {
  it("adds and removes sections as the observer reports them", () => {
    const first = visibleSections([], [entry("account", true)], ORDER);
    expect(first).toEqual(["account"]);

    // An observer only reports what changed, so the running set carries over.
    const second = visibleSections(first, [entry("notifications", true)], ORDER);
    expect(second).toEqual(["account", "notifications"]);

    expect(visibleSections(second, [entry("account", false)], ORDER)).toEqual(["notifications"]);
  });

  it("keeps document order whatever order the entries arrive in", () => {
    expect(visibleSections([], [entry("mcp", true), entry("devices", true)], ORDER)).toEqual([
      "devices",
      "mcp",
    ]);
  });

  it("ignores a section that is not on the page", () => {
    expect(visibleSections([], [entry("install", true)], ORDER)).toEqual([]);
  });

  it("marks the upper of two neighbours caught by the same band", () => {
    expect(activeSection(["devices", "services"], "account")).toBe("devices");
  });

  it("holds the last answer when the band catches nothing", () => {
    expect(activeSection([], "services")).toBe("services");
  });
});
