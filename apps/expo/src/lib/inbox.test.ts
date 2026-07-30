import { describe, expect, it } from "vitest";
import { inboxIdFromNotificationData } from "./inbox";

describe("inbox notification routing", () => {
  it("routes webhook, agent, and interaction pushes to their durable item", () => {
    expect(inboxIdFromNotificationData({ eventId: "evt_1" })).toBe("ibox:event:evt_1");
    expect(inboxIdFromNotificationData({ eventId: "anot_1" })).toBe(
      "ibox:agent_notification:anot_1",
    );
    expect(inboxIdFromNotificationData({ interactionId: "int_1", eventId: "evt_1" })).toBe(
      "ibox:interaction:int_1",
    );
  });

  it("ignores payloads without a stable server identifier", () => {
    expect(inboxIdFromNotificationData(null)).toBeNull();
    expect(inboxIdFromNotificationData({ eventId: 1 })).toBeNull();
    expect(inboxIdFromNotificationData({})).toBeNull();
  });
});
