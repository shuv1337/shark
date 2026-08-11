import { describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.VAPID_PUBLIC_KEY = "public-key";
process.env.VAPID_PRIVATE_KEY = "private-key";
process.env.VAPID_SUBJECT = "mailto:operator@example.com";

const mock = vi.hoisted(() => ({
  statusCode: 201,
  payloads: [] as string[],
  vapid: [] as string[],
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (subject: string, publicKey: string, privateKey: string) => {
      mock.vapid.push(subject, publicKey, privateKey);
    },
    sendNotification: async (_subscription: unknown, payload: string) => {
      mock.payloads.push(payload);
      if (mock.statusCode !== 201) {
        throw Object.assign(new Error("push rejected"), { statusCode: mock.statusCode });
      }
      return { statusCode: 201 };
    },
  },
}));

describe("sendWebPushNotifications", () => {
  it("uses VAPID and classifies expired subscriptions as stale", async () => {
    const { encryptWebPushSubscription } = await import("./token");
    const { sendWebPushNotifications } = await import("./web-push");
    const now = new Date();
    const row = {
      id: "web_1",
      userId: "user_1",
      endpointHash: "hash",
      subscriptionCiphertext: encryptWebPushSubscription(
        JSON.stringify({
          endpoint: "https://push.example.com/send/one",
          keys: { p256dh: "p256dh", auth: "auth" },
        }),
      ),
      deviceName: "Linux",
      active: true,
      expirationAt: null,
      createdAt: now,
      lastSeenAt: now,
    };

    mock.statusCode = 201;
    const accepted = await sendWebPushNotifications([row], {
      title: "SHark",
      body: "Build complete",
      url: "/dashboard",
    });
    expect(accepted).toEqual({ accepted: 1, errors: [], staleSubscriptionIds: [] });
    expect(mock.vapid).toEqual(["mailto:operator@example.com", "public-key", "private-key"]);
    expect(JSON.parse(mock.payloads[0] ?? "{}")).toMatchObject({
      title: "SHark",
      body: "Build complete",
      url: "/dashboard",
    });

    mock.statusCode = 410;
    const stale = await sendWebPushNotifications([row], { title: "SHark", body: "Again" });
    expect(stale.accepted).toBe(0);
    expect(stale.staleSubscriptionIds).toEqual(["web_1"]);
  });
});
