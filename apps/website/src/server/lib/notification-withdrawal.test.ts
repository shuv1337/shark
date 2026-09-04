import { describe, expect, it } from "vitest";
import {
  buildMacosWithdrawalPayload,
  buildNotificationWithdrawalPushMessages,
  buildWebWithdrawalPayload,
  notificationEventTag,
} from "./notification-withdrawal";

describe("notificationEventTag", () => {
  it("derives a stable event-specific identifier", () => {
    expect(notificationEventTag("evt_1")).toBe("event-evt_1");
  });
});

describe("withdrawal payloads", () => {
  it("keeps Expo, web, and macOS commands aligned on the event id", () => {
    expect(buildNotificationWithdrawalPushMessages(["ExponentPushToken[a]"], "evt_1")).toEqual([
      {
        to: "ExponentPushToken[a]",
        data: { v: 1, command: "notification.withdraw", eventId: "evt_1" },
        _contentAvailable: true,
      },
    ]);
    expect(buildWebWithdrawalPayload("evt_1")).toEqual({
      v: 1,
      command: "notification.withdraw",
      eventId: "evt_1",
      tag: "event-evt_1",
    });
    expect(buildMacosWithdrawalPayload("evt_1")).toEqual({
      data: { v: 1, command: "notification.withdraw", eventId: "evt_1" },
    });
  });
});
