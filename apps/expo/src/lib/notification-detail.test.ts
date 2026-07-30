import { describe, expect, it } from "vitest";
import {
  clearNotificationDetail,
  detailFromNotification,
  getNotificationDetail,
  setNotificationDetail,
} from "./notification-detail";

describe("notification detail routing", () => {
  it("preserves the complete delivered message for the detail screen", () => {
    const detail = detailFromNotification({
      date: 1_787_000_000_000,
      request: {
        content: {
          title: "Long build report",
          body: "The entire long body remains available after the compact iOS banner is dismissed.",
          data: {
            eventId: "anot_1",
            sourceName: "Release bot",
            avatarUrl: "https://example.com/bot.png",
          },
        },
      },
    } as never);

    expect(detail).toMatchObject({
      eventId: "anot_1",
      title: "Long build report",
      body: "The entire long body remains available after the compact iOS banner is dismissed.",
      sourceName: "Release bot",
      avatarUrl: "https://example.com/bot.png",
    });
  });

  it("retains a cold-launch detail until the destination screen reads it", () => {
    const detail = {
      eventId: "evt_1",
      title: "Deploy",
      body: "Complete",
      sourceName: "CI",
      avatarUrl: null,
      receivedAt: new Date(0).toISOString(),
    };
    setNotificationDetail(detail);
    expect(getNotificationDetail()).toEqual(detail);
    clearNotificationDetail();
    expect(getNotificationDetail()).toBeNull();
  });
});
