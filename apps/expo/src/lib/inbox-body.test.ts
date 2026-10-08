import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Linking: { openURL: vi.fn(async () => undefined) },
  Alert: { alert: vi.fn() },
}));

import {
  compositeIdForPushEvent,
  isHttpUrl,
  linkifyBody,
  openBodyLink,
  openTopLevelDestination,
} from "./inbox-body";

describe("linkifyBody", () => {
  it("returns plain text untouched", () => {
    expect(linkifyBody("No links here.")).toEqual([{ text: "No links here." }]);
  });

  it("splits http(s) links out of surrounding text", () => {
    const segments = linkifyBody("Release notes: https://example.com/releases/2 and more.");
    expect(segments).toEqual([
      { text: "Release notes: " },
      { text: "https://example.com/releases/2", url: "https://example.com/releases/2" },
      { text: " and more." },
    ]);
  });

  it("drops trailing sentence punctuation from links", () => {
    const segments = linkifyBody("See https://example.com/a. Then stop.");
    expect(segments[1]).toEqual({ text: "https://example.com/a", url: "https://example.com/a" });
  });

  it("leaves app schemes and dangerous destinations as plain text", () => {
    const custom = linkifyBody("Open example-app://incidents/42 now");
    expect(custom).toEqual([{ text: "Open example-app://incidents/42 now" }]);

    for (const body of [
      "run javascript://alert(1) now",
      "read file:///etc/passwd now",
      "data URL data://text/html,x here",
      "blob blob://https://example.com/id",
    ]) {
      const segments = linkifyBody(body);
      expect(
        segments.every((segment) => segment.url === undefined),
        body,
      ).toBe(true);
    }
  });

  it("handles multiline bodies with several links", () => {
    const segments = linkifyBody("a https://one.example\nb https://two.example\nc");
    expect(segments.filter((segment) => segment.url)).toHaveLength(2);
    expect(segments.map((segment) => segment.text).join("")).toBe(
      "a https://one.example\nb https://two.example\nc",
    );
  });
});

describe("openBodyLink", () => {
  it("opens http(s) links directly after revalidation", async () => {
    const openUrl = vi.fn(async () => undefined);
    const confirm = vi.fn(async () => true);
    expect(await openBodyLink("https://example.com/x", { openUrl, confirm })).toBe(true);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/x");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("rejects non-http(s) schemes even if a user would confirm", async () => {
    const openUrl = vi.fn(async () => undefined);
    const denied = vi.fn(async () => false);
    expect(await openBodyLink("example-app://x", { openUrl, confirm: denied })).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();

    const approved = vi.fn(async () => true);
    expect(await openBodyLink("example-app://x", { openUrl, confirm: approved })).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
    expect(approved).not.toHaveBeenCalled();
  });

  it("blocks dangerous schemes at tap time even if stored content mutated", async () => {
    const openUrl = vi.fn(async () => undefined);
    const confirm = vi.fn(async () => true);
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,x",
      "blob:https://example.com/id",
      "about:blank",
      "not a url",
    ]) {
      expect(await openBodyLink(url, { openUrl, confirm }), url).toBe(false);
    }
    expect(openUrl).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("openTopLevelDestination", () => {
  it("opens only validated web destinations", async () => {
    const openUrl = vi.fn(async () => undefined);
    expect(await openTopLevelDestination("https://example.com/open", { openUrl })).toBe(true);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/open");
    expect(await openTopLevelDestination("shortcuts://run-shortcut?name=X", { openUrl })).toBe(
      false,
    );
    expect(await openTopLevelDestination("javascript:alert(1)", { openUrl })).toBe(false);
  });
});

describe("isHttpUrl", () => {
  it("accepts only http and https", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("example-app://x")).toBe(false);
    expect(isHttpUrl("nope")).toBe(false);
  });
});

describe("compositeIdForPushEvent", () => {
  it("maps agent notification IDs and webhook event IDs to their origins", () => {
    expect(compositeIdForPushEvent("anot_abc123")).toBe("notification:anot_abc123");
    expect(compositeIdForPushEvent("evt_abc123")).toBe("event:evt_abc123");
    expect(compositeIdForPushEvent("hark-welcome-1")).toBe("event:hark-welcome-1");
  });
});
