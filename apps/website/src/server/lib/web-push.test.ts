import type { Agent } from "node:https";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { outbound } from "./outbound";
import { pushJsonBytes, WEB_PUSH_PAYLOAD_BYTE_LIMIT } from "./push-preview";

process.env.NODE_ENV = "test";
process.env.VAPID_PUBLIC_KEY = "public-key";
process.env.VAPID_PRIVATE_KEY = "private-key";
process.env.VAPID_SUBJECT = "mailto:operator@example.com";

const mock = vi.hoisted(() => ({
  statusCode: 201,
  hang: false,
  payloads: [] as string[],
  endpoints: [] as string[],
  agents: [] as Agent[],
  vapid: [] as string[],
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (subject: string, publicKey: string, privateKey: string) => {
      mock.vapid.push(subject, publicKey, privateKey);
    },
    sendNotification: async (
      subscription: { endpoint: string },
      payload: string,
      options: { agent: Agent },
    ) => {
      mock.endpoints.push(subscription.endpoint);
      mock.agents.push(options.agent);
      mock.payloads.push(payload);
      if (mock.hang) await new Promise(() => undefined);
      if (mock.statusCode !== 201) {
        throw Object.assign(new Error("push rejected"), { statusCode: mock.statusCode });
      }
      return { statusCode: 201 };
    },
  },
}));

describe("sendWebPushNotifications", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mock.statusCode = 201;
    mock.hang = false;
    mock.payloads.length = 0;
    mock.endpoints.length = 0;
    mock.agents.length = 0;
    vi.restoreAllMocks();
    vi.spyOn(outbound, "resolve").mockResolvedValue([{ address: "142.250.0.10", family: 4 }]);
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
          endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
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
          endpoint: "https://updates.push.services.mozilla.com/wpush/v2/one",
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
    expect(outbound.resolve).toHaveBeenCalledTimes(1);
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

  async function row(id: string, endpoint: string) {
    const { encryptWebPushSubscription } = await import("./token");
    const now = new Date();
    return {
      id,
      userId: "synthetic-user",
      endpointHash: `${id}-hash`,
      subscriptionCiphertext: encryptWebPushSubscription(
        JSON.stringify({ endpoint, keys: { p256dh: "synthetic", auth: "synthetic" } }),
      ),
      deviceName: "Browser",
      active: true,
      expirationAt: null,
      createdAt: now,
      lastSeenAt: now,
    };
  }

  it("never sends to stored endpoints outside the push-service allowlist and prunes them", async () => {
    const { sendWebPushNotifications } = await import("./web-push");
    const result = await sendWebPushNotifications(
      [
        await row("web_private", "https://127.0.0.1:8443/internal"),
        await row("web_metadata", "https://169.254.169.254/latest/meta-data/"),
        await row("web_other", "https://push.example.com/send/synthetic"),
        await row("web_port", "https://fcm.googleapis.com:8443/fcm/send/synthetic"),
        await row("web_fcm", "https://fcm.googleapis.com/fcm/send/synthetic"),
      ],
      { title: "SHark", body: "Synthetic" },
    );
    expect(mock.endpoints).toEqual(["https://fcm.googleapis.com/fcm/send/synthetic"]);
    expect(result.accepted).toBe(1);
    expect(result.staleSubscriptionIds).toEqual([
      "web_private",
      "web_metadata",
      "web_other",
      "web_port",
    ]);
  });

  it("sends to an absolute-form endpoint by its plain name without pruning it", async () => {
    const resolve = vi.mocked(outbound.resolve);
    const { sendWebPushNotifications } = await import("./web-push");
    const result = await sendWebPushNotifications(
      [await row("web_absolute", "https://web.push.apple.com./synthetic")],
      { title: "SHark", body: "Synthetic" },
    );
    expect(mock.endpoints).toEqual(["https://web.push.apple.com/synthetic"]);
    expect(resolve.mock.calls.map((call) => call[0])).toEqual(["web.push.apple.com"]);
    expect(result).toMatchObject({ accepted: 1, staleSubscriptionIds: [] });
  });

  it("skips an allowlisted host that resolves to a private address without pruning it", async () => {
    vi.spyOn(outbound, "resolve").mockResolvedValue([
      { address: "142.250.0.10", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    const { sendWebPushNotifications } = await import("./web-push");
    const result = await sendWebPushNotifications(
      [await row("web_rebound", "https://web.push.apple.com/synthetic")],
      { title: "SHark", body: "Synthetic" },
    );
    expect(mock.endpoints).toEqual([]);
    expect(result).toEqual({
      accepted: 0,
      errors: ["Browser subscription web_rebound resolved to a blocked destination"],
      staleSubscriptionIds: [],
    });
  });

  it("gives up on a resolver that never answers without sending or pruning", async () => {
    vi.spyOn(outbound, "resolve").mockReturnValue(new Promise(() => undefined));
    const { sendWebPushNotifications, WEB_PUSH_TIMEOUT_MS } = await import("./web-push");
    const subscription = await row("web_stalled_dns", "https://fcm.googleapis.com/fcm/send/x");
    vi.useFakeTimers();
    let settled = false;
    const pending = sendWebPushNotifications([subscription], { title: "SHark", body: "Synthetic" });
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(WEB_PUSH_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({
      accepted: 0,
      errors: ["Browser subscription web_stalled_dns timed out resolving its push service"],
      staleSubscriptionIds: [],
    });
    expect(mock.endpoints).toEqual([]);
  });

  it("gives up on a push request that never answers within the same deadline", async () => {
    mock.hang = true;
    const { sendWebPushNotifications, WEB_PUSH_TIMEOUT_MS } = await import("./web-push");
    const subscription = await row("web_stalled_send", "https://web.push.apple.com/synthetic");
    vi.useFakeTimers();
    const pending = sendWebPushNotifications([subscription], { title: "SHark", body: "Synthetic" });
    await vi.advanceTimersByTimeAsync(WEB_PUSH_TIMEOUT_MS);
    expect(await pending).toEqual({
      accepted: 0,
      errors: ["Browser subscription web_stalled_send timed out"],
      staleSubscriptionIds: [],
    });
    expect(mock.endpoints).toEqual(["https://web.push.apple.com/synthetic"]);
  });

  it("reports a resolver failure as such, not as a blocked destination, and keeps the row", async () => {
    vi.spyOn(outbound, "resolve").mockRejectedValue(
      Object.assign(new Error("getaddrinfo ENOTFOUND fcm.googleapis.com"), { code: "ENOTFOUND" }),
    );
    const { sendWebPushNotifications } = await import("./web-push");
    const result = await sendWebPushNotifications(
      [await row("web_dns_down", "https://fcm.googleapis.com/fcm/send/synthetic")],
      { title: "SHark", body: "Synthetic" },
    );
    expect(result).toEqual({
      accepted: 0,
      errors: ["Browser subscription web_dns_down could not resolve its push service (ENOTFOUND)"],
      staleSubscriptionIds: [],
    });
    expect(mock.endpoints).toEqual([]);
  });

  it("connects only to the validated addresses", async () => {
    const resolve = vi
      .spyOn(outbound, "resolve")
      .mockResolvedValue([{ address: "2a00:1450:4001::a", family: 6 }]);
    const { sendWebPushNotifications } = await import("./web-push");
    await sendWebPushNotifications(
      [await row("web_wns", "https://wns2-synthetic.notify.windows.com/w/?token=synthetic")],
      { title: "SHark", body: "Synthetic" },
    );
    expect(resolve).toHaveBeenCalledWith("wns2-synthetic.notify.windows.com");
    expect(mock.agents).toHaveLength(1);
    const lookup = (
      mock.agents[0] as Agent & { options: { lookup?: (...args: unknown[]) => void } }
    ).options.lookup;
    const all = await new Promise((resolve) =>
      lookup?.("rebound.example", { all: true }, (_error: unknown, addresses: unknown) =>
        resolve(addresses),
      ),
    );
    expect(all).toEqual([{ address: "2a00:1450:4001::a", family: 6 }]);
    const single = await new Promise((resolve) =>
      lookup?.("rebound.example", {}, (_error: unknown, address: unknown, family: unknown) =>
        resolve([address, family]),
      ),
    );
    expect(single).toEqual(["2a00:1450:4001::a", 6]);
  });
});
