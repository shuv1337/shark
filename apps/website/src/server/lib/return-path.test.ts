import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

const APP_URL = "https://shark.shuv.dev";

describe("where sign-in lands", () => {
  /**
   * The board, matching the manifest's `start_url` and the client's own
   * default, so the installed app and the browser agree on where "signed in"
   * begins. `/dashboard` is still a working redirect for old push links and
   * the iPhone app's registered web app, but nothing defaults to it any more.
   */
  it("defaults to the board when nothing was requested", () => {
    for (const value of [null, undefined, ""]) {
      expect(safeReturnPath(value, APP_URL)).toBe("/board");
    }
  });

  it("keeps a requested same-site path, with its query", () => {
    expect(safeReturnPath("/board/ask/bask_synthetic", APP_URL)).toBe("/board/ask/bask_synthetic");
    expect(safeReturnPath("/inbox?filter=needs_action", APP_URL)).toBe(
      "/inbox?filter=needs_action",
    );
    expect(safeReturnPath("/settings#devices", APP_URL)).toBe("/settings");
  });

  it("falls back to the board rather than anywhere it should not go", () => {
    for (const value of [
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example",
      "/.//evil.example",
      "/api/inbox",
      "/hooks/x",
      "/login?next=/login",
      "/board\u0000",
    ]) {
      expect(safeReturnPath(value, APP_URL), value).toBe("/board");
    }
  });
});
