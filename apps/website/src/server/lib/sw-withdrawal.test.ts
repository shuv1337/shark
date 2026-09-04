import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sw = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../public/sw.js"),
  "utf8",
);

describe("service worker withdrawal", () => {
  it("closes tagged notifications and never shows a withdrawal banner", () => {
    expect(sw).toContain('payload.command === "notification.withdraw"');
    expect(sw).toContain("event.waitUntil(withdrawPresentedNotifications(payload))");
    expect(sw).toContain("return;");
    expect(sw).toContain("getNotifications({ tag: payload.tag })");
    expect(sw.indexOf("withdrawPresentedNotifications(payload)")).toBeLessThan(
      sw.indexOf("showNotification"),
    );
  });
});
