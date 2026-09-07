import { beforeEach, describe, expect, it, vi } from "vitest";
import { pushJsonBytes, WEB_PUSH_PAYLOAD_BYTE_LIMIT } from "./push-preview";

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
  beforeEach(() => {
    mock.statusCode = 201;
    mock.payloads.length = 0;
  });

  async function rows() {
    const { encryptWebPushSubscription } = await import("./token");
    const now = new Date();
    return ["web-preview-1", "web-preview-2"].map((id) => ({
      id,
      userId: "synthetic-user",
      endpointHash: `${id}-hash`,
      subscriptionCiphertext: encryptWebPushSubscription(
        JSON.stringify({
          endpoint: `https://push.example.com/send/${id}`,
          keys: { p256dh: "synthetic", auth: "synthetic" },
        }),
      ),
      deviceName: "Browser",
      active: true,
      expirationAt: null,
      createdAt: now,
      lastSeenAt: now,
    }));
  }

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

    mock.statusCode = 201;
    mock.payloads.length = 0;
    const withdrawn = await sendWebPushNotifications([row], {
      v: 1,
      command: "notification.withdraw",
      eventId: "evt_1",
      tag: "event-evt_1",
    });
    expect(withdrawn).toEqual({ accepted: 1, errors: [], staleSubscriptionIds: [] });
    expect(JSON.parse(mock.payloads[0] ?? "{}")).toEqual({
      v: 1,
      command: "notification.withdraw",
      eventId: "evt_1",
      tag: "event-evt_1",
    });

    mock.statusCode = 410;
    const stale = await sendWebPushNotifications([row], { title: "SHark", body: "Again" });
    expect(stale.accepted).toBe(0);
    expect(stale.staleSubscriptionIds).toEqual(["web_1"]);
  });

  it("fits actual serialized web JSON and preserves original content and identity", async () => {
    const { sendWebPushNotifications } = await import("./web-push");
    const input = {
      title: "\u0000".repeat(80),
      body: "気".repeat(2000),
      imageUrl: `https://example.com/${"気".repeat(2028)}`,
      url: `https://example.com/${"界".repeat(2028)}`,
      eventId: "event-synthetic",
      tag: "interaction-synthetic",
    };
    const saved = structuredClone(input);
    const result = await sendWebPushNotifications(await rows(), input);
    expect(result).toEqual({ accepted: 2, errors: [], staleSubscriptionIds: [] });
    expect(mock.payloads).toHaveLength(2);
    for (const serialized of mock.payloads) {
      expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(
        WEB_PUSH_PAYLOAD_BYTE_LIMIT,
      );
      const preview = JSON.parse(serialized);
      expect(preview).toMatchObject({ title: input.title, tag: input.tag, eventId: input.eventId });
      expect(preview.body.endsWith("…")).toBe(true);
      expect(preview.imageUrl).toBeUndefined();
      expect(preview.url).toBeUndefined();
    }
    expect(input).toEqual(saved);
  });

  it("sends an exact-budget web payload unchanged", async () => {
    const { sendWebPushNotifications } = await import("./web-push");
    const base = { title: "Title", body: "", url: "/dashboard", eventId: "event-synthetic" };
    const input = { ...base, body: "a".repeat(WEB_PUSH_PAYLOAD_BYTE_LIMIT - pushJsonBytes(base)) };
    await sendWebPushNotifications(await rows(), input);
    expect(Buffer.byteLength(mock.payloads[0] ?? "")).toBe(WEB_PUSH_PAYLOAD_BYTE_LIMIT);
    expect(mock.payloads[0]).toBe(JSON.stringify(input));
  });

  it("rejects unshrinkable shared metadata without sending or expiring any subscription", async () => {
    const { sendWebPushNotifications } = await import("./web-push");
    const result = await sendWebPushNotifications(await rows(), {
      v: 1,
      command: "notification.withdraw",
      eventId: "sensitive".repeat(1000),
    });
    expect(result).toEqual({
      accepted: 0,
      errors: ["Push payload metadata exceeds the 3993-byte budget"],
      staleSubscriptionIds: [],
    });
    expect(mock.payloads).toEqual([]);
  });
});
