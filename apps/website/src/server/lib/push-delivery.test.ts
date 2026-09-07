import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({
  env: {
    BETTER_AUTH_SECRET: "s".repeat(32),
    VAPID_PUBLIC_KEY: "synthetic-public",
    VAPID_PRIVATE_KEY: "synthetic-private",
    VAPID_SUBJECT: "mailto:synthetic@example.com",
  },
}));

const delivery = vi.hoisted(() => ({ expo: vi.fn(), web: vi.fn(), macos: vi.fn() }));
vi.mock("expo-server-sdk", () => ({
  Expo: class {
    chunkPushNotifications(messages: unknown[]) {
      return messages.length ? [messages] : [];
    }
    sendPushNotificationsAsync = delivery.expo;
  },
}));
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: delivery.web },
}));
vi.mock("./apns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./apns")>()),
  sendNotificationPush: delivery.macos,
}));

import { sendPushFanout, sendPushMessages } from "./push";
import { EXPO_MESSAGE_BYTE_BUDGET, pushJsonBytes } from "./push-preview";
import { encryptMacosApnsToken, encryptWebPushSubscription } from "./token";

describe("push delivery budgets", () => {
  beforeEach(() => {
    delivery.expo.mockReset().mockImplementation(async (messages: Array<{ to: string }>) =>
      messages.map(({ to }) =>
        to.includes("stale")
          ? {
              status: "error",
              message: "Unregistered",
              details: { error: "DeviceNotRegistered" },
            }
          : { status: "ok", id: "synthetic-ticket" },
      ),
    );
    delivery.web.mockReset().mockResolvedValue({ statusCode: 201 });
    delivery.macos.mockReset().mockResolvedValue({ accepted: true, reason: null });
  });

  it("budgets array recipients individually and preserves skipped/stale ticket mapping", async () => {
    const recipients = Array.from(
      { length: 100 },
      (_, index) => `ExponentPushToken[synthetic-${index}]`,
    );
    recipients.push("ExponentPushToken[stale]");
    const data = { eventId: "synthetic-event", responseToken: "synthetic-response" };
    const input = [
      {
        to: "ExponentPushToken[oversized]",
        body: "Body",
        data: { responseToken: "secret".repeat(1000) },
      },
      { to: recipients, title: "Title", body: "気".repeat(2000), data },
    ];
    const saved = structuredClone(input);
    const result = await sendPushMessages(input);
    expect(result).toEqual({
      accepted: 100,
      errors: ["Push payload metadata exceeds the 3328-byte budget", "Unregistered"],
      staleTokens: ["ExponentPushToken[stale]"],
      staleSubscriptionIds: [],
      staleMacosDeviceIds: [],
    });
    const sent = delivery.expo.mock.calls[0]?.[0] as Array<{
      to: string;
      body: string;
      data: unknown;
    }>;
    expect(sent).toHaveLength(101);
    for (const message of sent) {
      expect(typeof message.to).toBe("string");
      expect(pushJsonBytes(message)).toBeLessThanOrEqual(EXPO_MESSAGE_BYTE_BUDGET);
      expect(message.body.endsWith("…")).toBe(true);
      expect(message.data).toEqual(data);
    }
    expect(input).toEqual(saved);
  });

  it("does not send or mark targets stale when a bodyless command cannot fit", async () => {
    const result = await sendPushMessages([
      {
        to: "ExponentPushToken[synthetic]",
        _contentAvailable: true,
        data: { v: 1, command: "notification.withdraw", eventId: "private".repeat(1000) },
      },
    ]);
    expect(result).toEqual({
      accepted: 0,
      errors: ["Push payload metadata exceeds the 3328-byte budget"],
      staleTokens: [],
      staleSubscriptionIds: [],
      staleMacosDeviceIds: [],
    });
    expect(delivery.expo).not.toHaveBeenCalled();
  });

  it("retains sibling provider success when Expo metadata cannot fit", async () => {
    const now = new Date();
    const result = await sendPushFanout({
      expoMessages: [
        {
          to: "ExponentPushToken[synthetic]",
          title: "Title",
          body: "Body",
          data: { responseToken: "private".repeat(1000) },
        },
      ],
      webSubscriptions: [
        {
          id: "web-synthetic",
          userId: "user-synthetic",
          endpointHash: "synthetic-hash",
          subscriptionCiphertext: encryptWebPushSubscription(
            JSON.stringify({
              endpoint: "https://push.example/send/synthetic",
              keys: { p256dh: "synthetic", auth: "synthetic" },
            }),
          ),
          deviceName: "Browser",
          active: true,
          expirationAt: null,
          createdAt: now,
          lastSeenAt: now,
        },
      ],
      webPayload: { title: "Title", body: "Body", eventId: "synthetic" },
      macosDevices: [
        {
          id: "mac-synthetic",
          userId: "user-synthetic",
          apnsTokenHash: "synthetic-hash",
          apnsTokenCiphertext: encryptMacosApnsToken("a".repeat(64)),
          environment: "sandbox",
          privacyMode: "standard",
          deviceName: "Mac",
          active: true,
          createdAt: now,
          lastSeenAt: now,
        },
      ],
      macosPayload: { title: "Title", body: "Body", data: { eventId: "synthetic" } },
    });
    expect(result).toEqual({
      accepted: 2,
      errors: ["Push payload metadata exceeds the 3328-byte budget"],
      staleTokens: [],
      staleSubscriptionIds: [],
      staleMacosDeviceIds: [],
    });
    expect(delivery.expo).not.toHaveBeenCalled();
    expect(delivery.web).toHaveBeenCalledOnce();
    expect(delivery.macos).toHaveBeenCalledOnce();
  });
});
