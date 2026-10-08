import { describe, expect, it } from "vitest";
import {
  buildBridgeScript,
  buildResolveScript,
  fallbackTint,
  isAppOrigin,
  isDarkColor,
  parseBridgeMessage,
  pickStripColor,
  resolveLaunchUrl,
  webAppFromNotificationData,
  webViewSource,
} from "./web-apps";

const app = { url: "https://shark.example/board", origin: "https://shark.example" };

describe("web app helpers", () => {
  it("resolves deep links only on the app origin", () => {
    expect(resolveLaunchUrl(app, "https://shark.example/board/ask/1")).toBe(
      "https://shark.example/board/ask/1",
    );
    expect(resolveLaunchUrl(app, "https://evil.example/board")).toBe(app.url);
    expect(resolveLaunchUrl(app)).toBe(app.url);
    expect(isAppOrigin("https://shark.example:443/x", app.origin)).toBe(true);
    expect(isAppOrigin("http://shark.example/x", app.origin)).toBe(false);
  });

  it("extracts the app to open from push data", () => {
    expect(
      webAppFromNotificationData({ appId: "app_abcdefgh", url: "https://shark.example/board" }),
    ).toEqual({ appId: "app_abcdefgh", url: "https://shark.example/board" });
    expect(webAppFromNotificationData({ appId: "app_abcdefgh", url: "javascript:1" })).toEqual({
      appId: "app_abcdefgh",
    });
    expect(webAppFromNotificationData({ appId: "anot_x" })).toBeNull();
    expect(webAppFromNotificationData({ eventId: "evt_1" })).toBeNull();
    expect(webAppFromNotificationData(null)).toBeNull();
  });

  it("parses only versioned bridge messages", () => {
    expect(parseBridgeMessage(JSON.stringify({ hark: 1, type: "getToken", id: "7" }))).toEqual({
      type: "getToken",
      id: "7",
    });
    expect(parseBridgeMessage(JSON.stringify({ hark: 1, type: "close" }))).toEqual({
      type: "close",
    });
    expect(
      parseBridgeMessage(JSON.stringify({ hark: 1, type: "theme", color: "#fff", background: 1 })),
    ).toEqual({ type: "theme", color: "#fff", background: null });
    expect(parseBridgeMessage(JSON.stringify({ type: "getToken", id: "7" }))).toBeNull();
    expect(parseBridgeMessage("not json")).toBeNull();
    expect(
      parseBridgeMessage(JSON.stringify({ hark: 1, type: "getToken", id: "x".repeat(40) })),
    ).toBeNull();
  });

  it("never embeds a token in the bridge and guards the resolver by origin", () => {
    const script = buildBridgeScript(app.origin);
    expect(script).toContain(JSON.stringify(app.origin));
    expect(script).toContain("getToken");
    expect(script).not.toContain("hark_");
    const resolve = buildResolveScript(app.origin, "3", { token: "pass.jwt" });
    expect(resolve).toContain('"3"');
    expect(resolve).toContain('"pass.jwt"');
    expect(resolve).toContain(`window.location.origin !== ${JSON.stringify(app.origin)}`);
    const failed = buildResolveScript(app.origin, "4", { error: "consent_required" });
    expect(failed).toContain('"consent_required"');
    expect(failed).toContain("null");
  });

  it("accepts only simple colors for the status strip", () => {
    expect(pickStripColor("#0C1119", null)).toBe("#0C1119");
    expect(pickStripColor(null, "rgb(12, 17, 25)")).toBe("rgb(12, 17, 25)");
    expect(pickStripColor("rgba(0, 0, 0, 0)", "rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(pickStripColor("url(javascript:1)", "transparent")).toBeNull();
    expect(isDarkColor("#0C1119")).toBe(true);
    expect(isDarkColor("#FAFAF9")).toBe(false);
    expect(isDarkColor("rgb(12, 17, 25)")).toBe(true);
  });

  it("tints letter tiles deterministically", () => {
    expect(fallbackTint("Sharkboard")).toEqual(fallbackTint("Sharkboard"));
    expect(fallbackTint("")).toBeDefined();
  });

  it("posts the pass to enter only for apps on SHark's own origin", () => {
    const shark = "https://shark.example";
    expect(webViewSource(`${shark}/board/ask/bask_1?x=1`, shark, shark, "p.a+ss")).toEqual({
      uri: `${shark}/apps/enter`,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Shark-Entry": "1" },
      body: "pass=p.a%2Bss&next=%2Fboard%2Fask%2Fbask_1%3Fx%3D1",
    });
    expect(webViewSource("https://other.example/", "https://other.example", shark, "pass")).toEqual(
      { uri: "https://other.example/" },
    );
    expect(webViewSource(`${shark}/board`, shark, shark, null)).toEqual({ uri: `${shark}/board` });
    expect(webViewSource(`${shark}/board`, shark, null, "pass")).toEqual({ uri: `${shark}/board` });
  });
});
