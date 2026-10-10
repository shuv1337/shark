import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { outbound, type RequestFn } from "../lib/outbound";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const sent: Array<Record<string, unknown>> = [];
const webSent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const macosSent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const authState = vi.hoisted(() => ({ authenticated: false }));
const billingTestState = vi.hoisted(() => ({
  pro: false,
  accountPerMinute: null as number | null,
}));

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () =>
        authState.authenticated
          ? { user: { id: "user_1", name: "Test User", email: "test@example.com", image: null } }
          : null,
    },
  },
}));

vi.mock("../lib/billing", () => ({
  getBilling: async () => ({
    configured: true,
    plan: billingTestState.pro ? "pro" : "free",
    priceMonthly: 8,
    features: { deviceRouting: billingTestState.pro },
    limits: {
      devices: billingTestState.pro ? null : 1,
      notificationsPerMonth: billingTestState.pro ? 100_000 : 10_000,
      servicePerMinute: billingTestState.pro ? 300 : 60,
      accountPerMinute: billingTestState.accountPerMinute ?? (billingTestState.pro ? 1500 : 300),
    },
    usage: { notificationsRemaining: 10_000 },
  }),
  checkNotificationAllowance: async () => true,
  trackNotification: async () => undefined,
  hasAutumn: () => false,
  clearBillingCache: () => undefined,
  createCheckout: async () => "https://example.com/checkout",
  createBillingPortal: async () => "https://example.com/portal",
}));

vi.mock("expo-server-sdk", () => {
  class Expo {
    // biome-ignore lint/complexity/noUselessConstructor: mock parity with the SDK
    constructor(_options?: unknown) {}
    chunkPushNotifications(messages: Array<Record<string, unknown>>) {
      return [messages];
    }
    async sendPushNotificationsAsync(chunk: Array<Record<string, unknown>>) {
      if (
        chunk.some(
          (message) => typeof message.to === "string" && message.to.includes("withdraw-throw"),
        )
      ) {
        throw new Error("synthetic withdrawal failure");
      }
      sent.push(...chunk);
      return chunk.map((message) =>
        typeof message.to === "string" && message.to.includes("stale")
          ? {
              status: "error",
              message: "device gone",
              details: { error: "DeviceNotRegistered" },
            }
          : { status: "ok", id: "ticket" },
      );
    }
  }
  return { Expo, default: Expo };
});

vi.mock("../lib/web-push", () => ({
  sendWebPushNotifications: async (
    rows: Array<{ id: string }>,
    payload: Record<string, unknown>,
  ) => {
    if (typeof payload.eventId === "string" && payload.eventId.includes("withdraw_throw")) {
      throw new Error("synthetic withdrawal failure");
    }
    webSent.push(...rows.map((row) => ({ id: row.id, payload })));
    return { accepted: rows.length, errors: [], staleSubscriptionIds: [] };
  },
}));

vi.mock("../lib/macos-push", () => ({
  sendMacosPushNotifications: async (
    rows: Array<{ id: string }>,
    payload: Record<string, unknown>,
  ) => {
    macosSent.push(...rows.map((row) => ({ id: row.id, payload, kind: "alert" })));
    return { accepted: rows.length, errors: [], staleMacosDeviceIds: [] };
  },
  sendMacosSilentPush: async (rows: Array<{ id: string }>, payload: Record<string, unknown>) => {
    macosSent.push(...rows.map((row) => ({ id: row.id, payload, kind: "silent" })));
    return { accepted: rows.length, errors: [], staleMacosDeviceIds: [] };
  },
}));

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let hashWebhookToken: typeof import("../lib/token")["hashWebhookToken"];

const TOKEN = "whk_test-token-abcdefghijklmnopqrstuv";

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ hashWebhookToken } = await import("../lib/token"));
  const { runMigrations } = await import("../db/migrate");
  runMigrations();

  const now = new Date();
  await db.insert(schema.user).values({
    id: "user_1",
    name: "Test User",
    email: "test@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.service).values({
    id: "svc_1",
    userId: "user_1",
    title: "Acme CRM",
    imageUrl: "https://example.com/default.png",
    url: "https://example.com/app",
    tokenHash: hashWebhookToken(TOKEN),
    createdAt: now,
    updatedAt: now,
  });
});

/** Synthetic DNS and socket so callback delivery never leaves the process. */
function stubCallbackTransport(address = "93.184.216.34", status = 204) {
  vi.spyOn(outbound, "resolve").mockImplementation(async () => [{ address, family: 4 }]);
  return vi.spyOn(outbound, "request").mockImplementation(((
    _options: RequestOptions,
    onResponse: (response: IncomingMessage) => void,
  ) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () =>
      queueMicrotask(() => onResponse({ statusCode: status, resume() {} } as IncomingMessage));
    return req as unknown as ClientRequest;
  }) as RequestFn);
}

async function post(token: string, body: unknown, idempotencyKey?: string) {
  return app.request(`/hooks/${token}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /hooks/:token", () => {
  it("fits an interaction push preview while retaining the complete webhook and inbox prompt", async () => {
    const { eq } = await import("drizzle-orm");
    const { hashInteractionResponseToken } = await import("../lib/token");
    const { EXPO_MESSAGE_BYTE_BUDGET } = await import("../lib/push-preview");
    const prompt = `${'💥\\"\u0001'.repeat(300)}done`;
    const now = new Date();
    await db.insert(schema.device).values({
      id: "dev_hook_preview",
      userId: "user_1",
      expoPushToken: "ExponentPushToken[hook-preview]",
      platform: "ios",
      active: true,
      interactionSchemaVersion: 1,
      createdAt: now,
      lastSeenAt: now,
    });
    const previousPro = billingTestState.pro;
    billingTestState.pro = true;
    sent.length = 0;
    try {
      const response = await post(TOKEN, {
        title: "Release approval",
        body: prompt,
        deviceIds: ["dev_hook_preview"],
        response: { type: "approval", expiresInSeconds: 300 },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { eventId: string; delivered: number };
      expect(body.delivered).toBe(1);
      const [event] = await db.select().from(schema.event).where(eq(schema.event.id, body.eventId));
      const [interaction] = await db
        .select()
        .from(schema.interaction)
        .where(eq(schema.interaction.eventId, body.eventId));
      expect(event).toMatchObject({ body: prompt, status: "accepted", deliveredCount: 1 });
      expect(interaction).toMatchObject({ prompt, title: "Release approval", acceptedCount: 1 });
      expect(sent).toHaveLength(1);
      const preview = sent[0];
      expect(Buffer.byteLength(JSON.stringify(preview), "utf8")).toBeLessThanOrEqual(
        EXPO_MESSAGE_BYTE_BUDGET,
      );
      expect(preview?.body).not.toBe(prompt);
      expect(preview?.body).toEqual(expect.stringMatching(/…$/));
      expect(preview).toMatchObject({
        to: "ExponentPushToken[hook-preview]",
        title: "Release approval",
        categoryId: "HARK_APPROVAL_V1",
        data: {
          eventId: body.eventId,
          interactionId: interaction?.id,
          actionDigest: interaction?.actionDigest,
          responseToken: expect.any(String),
        },
      });
      const responseToken =
        (preview?.data as { responseToken: string } | undefined)?.responseToken ?? "";
      expect(hashInteractionResponseToken(responseToken)).toBe(interaction?.responseTokenHash);
      authState.authenticated = true;
      const detail = await app.request(
        `/api/inbox/${encodeURIComponent(`ibox:interaction:${interaction?.id}`)}`,
      );
      expect(detail.status).toBe(200);
      expect(await detail.json()).toMatchObject({
        item: {
          title: "Release approval",
          body: prompt,
          imageUrl: "https://example.com/default.png",
          url: "https://example.com/app",
        },
      });
    } finally {
      authState.authenticated = false;
      billingTestState.pro = previousPro;
      await db.delete(schema.device).where(eq(schema.device.id, "dev_hook_preview"));
    }
  });

  it("makes an existing webhook indistinguishable from unknown after allowlist removal", async () => {
    const { env } = await import("../env");
    const previous = [...env.ALLOWED_EMAILS];
    env.ALLOWED_EMAILS.splice(0, env.ALLOWED_EMAILS.length, "somebody-else@example.com");
    try {
      const response = await post(TOKEN, { body: "must not deliver" });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ ok: false, error: "Unknown webhook" });
    } finally {
      env.ALLOWED_EMAILS.splice(0, env.ALLOWED_EMAILS.length, ...previous);
    }
  });

  it("404s on an unknown token without leaking details", async () => {
    const res = await post("whk_wrong", { body: "hi" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "Unknown webhook" });
  });

  it("400s on an invalid payload", async () => {
    const res = await post(TOKEN, { title: "no body" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toBe("Invalid payload");
  });

  it("reports no devices when none are registered", async () => {
    const res = await post(TOKEN, { body: "hello" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; delivered: number; message?: string };
    expect(json.ok).toBe(true);
    expect(json.delivered).toBe(0);
    expect(json.message).toContain("No active notification targets");
  });

  it("delivers to active devices and resolves overrides", async () => {
    const now = new Date();
    await db.insert(schema.device).values({
      id: "dev_1",
      userId: "user_1",
      expoPushToken: "ExponentPushToken[a]",
      platform: "ios",
      active: true,
      interactionSchemaVersion: 1,
      createdAt: now,
      lastSeenAt: now,
    });

    sent.length = 0;
    const res = await post(TOKEN, { body: "Build failed", title: "CI" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; delivered: number; eventId: string };
    expect(json.ok).toBe(true);
    expect(json.delivered).toBe(1);
    expect(json.eventId).toMatch(/^evt_/);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[a]",
      title: "CI",
      body: "Build failed",
      mutableContent: true,
      priority: "high",
      // Falls back to the service image when the webhook has no override.
      richContent: { image: "https://example.com/default.png" },
    });
    const data = sent[0]?.data as Record<string, unknown>;
    expect(data.sourceName).toBe("CI");
    expect(data.conversationId).toBe("hark-svc_1");
    expect(JSON.stringify(sent[0])).not.toContain("user_1");
  });

  it("delivers to all active devices by default on Pro", async () => {
    const now = new Date();
    await db.insert(schema.device).values({
      id: "dev_2",
      userId: "user_1",
      expoPushToken: "ExponentPushToken[b]",
      platform: "ios",
      active: true,
      interactionSchemaVersion: 1,
      createdAt: now,
      lastSeenAt: now,
    });

    billingTestState.pro = true;
    sent.length = 0;
    const res = await post(TOKEN, { body: "Everyone" });
    billingTestState.pro = false;

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, delivered: 2 });
    expect(sent.map((message) => message.to).sort()).toEqual([
      "ExponentPushToken[a]",
      "ExponentPushToken[b]",
    ]);
  });

  it("routes a Pro notification only to selected devices", async () => {
    billingTestState.pro = true;
    sent.length = 0;
    const res = await post(TOKEN, { body: "Only A", deviceIds: ["dev_1"] });
    billingTestState.pro = false;

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, delivered: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("ExponentPushToken[a]");
  });

  it("creates and resolves a Pro approval through the webhook event", async () => {
    billingTestState.pro = true;
    sent.length = 0;
    const created = await post(TOKEN, {
      body: "Deploy production?",
      title: "CI",
      imageUrl: "https://example.com/ci.png",
      deviceIds: ["dev_1"],
      response: {
        type: "approval",
        correlationId: "deploy-184",
        expiresInSeconds: 900,
        callback: {
          url: "https://ci.example.com/hark-response",
          token: "private-callback-token",
        },
      },
    });
    billingTestState.pro = false;
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { eventId: string };
    expect(createdBody).toMatchObject({
      ok: true,
      delivered: 1,
      response: { status: "pending" },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      categoryId: "HARK_APPROVAL_V1",
      richContent: { image: "https://example.com/ci.png" },
    });
    const data = sent[0]?.data as {
      interactionId: string;
      responseToken: string;
      avatarUrl: string;
    };
    expect(data.avatarUrl).toBe("https://example.com/ci.png");

    const callbackRequest = stubCallbackTransport();
    const response = await app.request(`/api/interaction-responses/${data.interactionId}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        deviceId: "dev_1",
        responseToken: data.responseToken,
      }),
    });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(callbackRequest).toHaveBeenCalledOnce());
    const callbackOptions = callbackRequest.mock.calls[0]?.[0];
    if (!callbackOptions) throw new Error("Expected callback request");
    expect(callbackOptions).toMatchObject({
      host: "93.184.216.34",
      path: "/hark-response",
      servername: "ci.example.com",
    });
    expect(callbackOptions.headers).toMatchObject({
      host: "ci.example.com",
      authorization: "Bearer private-callback-token",
    });
    vi.restoreAllMocks();
    const status = await app.request(`/hooks/${TOKEN}/events/${createdBody.eventId}`);
    expect(await status.json()).toMatchObject({
      ok: true,
      event: {
        id: createdBody.eventId,
        response: { status: "approved", action: "approve", correlationId: "deploy-184" },
      },
    });
  });

  it("re-validates interaction callback destinations at delivery", async () => {
    const { eq } = await import("drizzle-orm");
    const { deliverInteractionCallbacks } = await import("../lib/interaction-callbacks");
    billingTestState.pro = true;
    sent.length = 0;
    const created = await post(TOKEN, {
      body: "Deploy staging?",
      deviceIds: ["dev_1"],
      response: {
        type: "approval",
        correlationId: "deploy-185",
        expiresInSeconds: 900,
        callback: { url: "https://ci.example.com/hark-response", token: "private-callback-token" },
      },
    });
    billingTestState.pro = false;
    expect(created.status).toBe(200);
    const data = sent[0]?.data as { interactionId: string; responseToken: string };

    // The name now resolves to the metadata address; the write-time check passed.
    const callbackRequest = stubCallbackTransport("169.254.169.254");
    const response = await app.request(`/api/interaction-responses/${data.interactionId}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "deny",
        deviceId: "dev_1",
        responseToken: data.responseToken,
      }),
    });
    expect(response.status).toBe(200);
    await deliverInteractionCallbacks();
    const [row] = await db
      .select()
      .from(schema.interaction)
      .where(eq(schema.interaction.id, data.interactionId));
    expect(row).toMatchObject({
      callbackStatus: "failed",
      callbackAttempts: 1,
      callbackLastError: "blocked_destination",
    });

    // A literal private URL stored by an older path is refused without resolving.
    await db
      .update(schema.interaction)
      .set({
        callbackUrl: "https://10.0.0.9/hook",
        callbackStatus: "pending",
        callbackAttempts: 0,
        callbackNextAttemptAt: new Date(0),
      })
      .where(eq(schema.interaction.id, data.interactionId));
    await deliverInteractionCallbacks();
    const [literal] = await db
      .select()
      .from(schema.interaction)
      .where(eq(schema.interaction.id, data.interactionId));
    expect(literal).toMatchObject({
      callbackStatus: "failed",
      callbackLastError: "blocked_destination",
    });
    expect(callbackRequest).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("requires Pro for webhook responses", async () => {
    const response = await post(TOKEN, {
      body: "Deploy?",
      response: { type: "approval" },
    });
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "Interactive responses are unavailable",
    });
  });

  it("records credential text responses as replied", async () => {
    billingTestState.pro = true;
    sent.length = 0;
    const created = await post(TOKEN, {
      body: "Reply?",
      deviceIds: ["dev_1"],
      response: { type: "text" },
    });
    billingTestState.pro = false;
    const createdBody = (await created.json()) as { eventId: string };
    const data = sent[0]?.data as { interactionId: string; responseToken: string };
    const response = await app.request(`/api/interaction-responses/${data.interactionId}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "reply",
        response: "Build 11 works",
        deviceId: "dev_1",
        responseToken: data.responseToken,
      }),
    });
    expect(response.status).toBe(200);
    const status = await app.request(`/hooks/${TOKEN}/events/${createdBody.eventId}`);
    expect(await status.json()).toMatchObject({
      event: { response: { status: "replied", action: "reply", text: "Build 11 works" } },
    });
  });

  it("requires Pro for targeted device routing", async () => {
    const res = await post(TOKEN, { body: "Only A", deviceIds: ["dev_1"] });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "Device routing is unavailable",
    });
  });

  it("rejects device IDs owned by another account", async () => {
    const now = new Date();
    await db.insert(schema.user).values({
      id: "user_2",
      name: "Other User",
      email: "other@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.device).values({
      id: "dev_foreign",
      userId: "user_2",
      expoPushToken: "ExponentPushToken[foreign]",
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });

    billingTestState.pro = true;
    sent.length = 0;
    const res = await post(TOKEN, { body: "No leak", deviceIds: ["dev_foreign"] });
    billingTestState.pro = false;

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Invalid device selection" });
    expect(sent).toHaveLength(0);
  });

  it("treats reordered device IDs as the same idempotent request", async () => {
    billingTestState.pro = true;
    sent.length = 0;
    const first = await post(TOKEN, { body: "Both", deviceIds: ["dev_1", "dev_2"] }, "targeted-1");
    const second = await post(TOKEN, { body: "Both", deviceIds: ["dev_2", "dev_1"] }, "targeted-1");
    billingTestState.pro = false;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, idempotent: true, delivered: 2 });
    expect(sent).toHaveLength(2);
  });

  it("suppresses duplicate requests with the same idempotency key", async () => {
    sent.length = 0;
    const first = await post(TOKEN, { body: "Only once", title: "CI" }, "deploy-184");
    const firstJson = (await first.json()) as { eventId: string; delivered: number };
    const second = await post(TOKEN, { body: "Only once", title: "CI" }, "deploy-184");
    const secondJson = (await second.json()) as {
      eventId: string;
      delivered: number;
      idempotent: boolean;
    };

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondJson.eventId).toBe(firstJson.eventId);
    expect(secondJson.idempotent).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("rejects an idempotency key reused with a different payload", async () => {
    const res = await post(TOKEN, { body: "Different body" }, "deploy-184");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "Idempotency-Key was already used with a different payload",
    });
  });

  it("deactivates devices Expo reports as unregistered", async () => {
    const now = new Date();
    await db.insert(schema.device).values({
      id: "dev_stale",
      userId: "user_1",
      expoPushToken: "ExponentPushToken[stale]",
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });

    billingTestState.pro = true;
    const res = await post(TOKEN, { body: "ping" });
    billingTestState.pro = false;
    expect(res.status).toBe(200);

    const { eq } = await import("drizzle-orm");
    const [stale] = await db.select().from(schema.device).where(eq(schema.device.id, "dev_stale"));
    expect(stale?.active).toBe(false);
  });

  it("never returns provider error detail when every push fails", async () => {
    const now = new Date();
    const failToken = "whk_fail-only-abcdefghijklmnopqrstu";
    await db.insert(schema.user).values({
      id: "user_fail",
      name: "Fail User",
      email: "fail@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.service).values({
      id: "svc_fail",
      userId: "user_fail",
      title: "Fail only",
      tokenHash: hashWebhookToken(failToken),
      createdAt: now,
      updatedAt: now,
    });
    // The Expo mock only fails this token, and it is unique across devices.
    const { eq } = await import("drizzle-orm");
    await db
      .delete(schema.device)
      .where(eq(schema.device.expoPushToken, "ExponentPushToken[stale]"));
    await db.insert(schema.device).values({
      id: "dev_fail_only",
      userId: "user_fail",
      expoPushToken: "ExponentPushToken[stale]",
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });

    const res = await post(failToken, { body: "ping" });
    expect(res.status).toBe(502);
    const raw = await res.text();
    expect(raw).not.toContain("ExponentPushToken");
    expect(raw).not.toContain("device gone");
    expect(JSON.parse(raw)).toEqual({ ok: false, error: "Push delivery failed" });
  });

  it("rejects unauthenticated access to the services API", async () => {
    const res = await app.request("/api/services");
    expect(res.status).toBe(401);
  });

  it("enforces the per-service rate limit", async () => {
    const now = new Date();
    const limitToken = "whk_limit-test-abcdefghijklmnopqrst";
    await db.insert(schema.service).values({
      id: "svc_limit",
      userId: "user_1",
      title: "Limited",
      tokenHash: hashWebhookToken(limitToken),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.event).values(
      Array.from({ length: 60 }, (_, index) => ({
        id: `evt_limit_${index}`,
        serviceId: "svc_limit",
        title: "Limited",
        body: "test",
        status: "accepted",
        deliveredCount: 1,
        createdAt: now,
      })),
    );

    const res = await post(limitToken, { body: "one too many" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "Service rate limit exceeded",
      retryAfterSeconds: 60,
    });
  });

  it("counts recent interactions toward the webhook account rate limit", async () => {
    const now = new Date();
    await db.insert(schema.user).values({
      id: "user_hook_combined_rate",
      name: "Combined Rate",
      email: "combined-rate@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    const combinedToken = "whk_combined-rate-abcdefghijklmnopqr";
    await db.insert(schema.service).values({
      id: "svc_hook_combined_rate",
      userId: "user_hook_combined_rate",
      title: "Combined",
      tokenHash: hashWebhookToken(combinedToken),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.apiToken).values({
      id: "tok_hook_combined_rate",
      userId: "user_hook_combined_rate",
      name: "Combined",
      tokenHash: "hook_combined_hash",
      prefix: "hark_combine",
      scopes: ["interactions:create"],
      createdAt: now,
    });
    await db.insert(schema.interaction).values({
      id: "int_hook_combined_rate",
      userId: "user_hook_combined_rate",
      requesterTokenId: "tok_hook_combined_rate",
      title: "Recent",
      prompt: "Count this",
      kind: "approval",
      status: "pending",
      choices: ["approve", "deny"],
      actionDigest: "combined-rate-digest",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
    });

    billingTestState.accountPerMinute = 1;
    const response = await post(combinedToken, { body: "one too many" });
    billingTestState.accountPerMinute = null;
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "Account rate limit exceeded" });
  });

  it("routes an ordinary webhook to a targeted browser subscription", async () => {
    billingTestState.pro = true;
    const now = new Date();
    await db.insert(schema.webPushSubscription).values({
      id: "web_hook_target",
      userId: "user_1",
      endpointHash: "web-hook-endpoint-hash",
      subscriptionCiphertext: "encrypted-by-test-boundary",
      deviceName: "Linux",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });
    webSent.length = 0;
    const response = await post(TOKEN, {
      body: "Browser build complete",
      title: "CI",
      deviceIds: ["web_hook_target"],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, delivered: 1 });
    expect(webSent).toEqual([
      {
        id: "web_hook_target",
        payload: {
          title: "CI",
          body: "Browser build complete",
          url: "https://example.com/app",
          imageUrl: "https://example.com/default.png",
          eventId: expect.stringMatching(/^evt_/),
          tag: expect.stringMatching(/^event-evt_/),
        },
      },
    ]);
  });
});

async function seedWithdrawFixture(input: {
  suffix: string;
  status?: string;
  expoToken?: string | null;
  extraExpoToken?: string;
  includeWeb?: boolean;
  includeMacos?: boolean;
  includeInteraction?: boolean;
}) {
  const now = new Date();
  const token = `whk_withdraw-${input.suffix}`.padEnd(36, "x");
  const userId = `user_withdraw_${input.suffix}`;
  const serviceId = `svc_withdraw_${input.suffix}`;
  const eventId = `evt_withdraw_${input.suffix}`;
  await db.insert(schema.user).values({
    id: userId,
    name: `Withdraw ${input.suffix}`,
    email: `withdraw-${input.suffix}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.service).values({
    id: serviceId,
    userId,
    title: "Withdraw Test",
    tokenHash: hashWebhookToken(token),
    createdAt: now,
    updatedAt: now,
  });
  if (input.expoToken !== null) {
    await db.insert(schema.device).values({
      id: `dev_withdraw_${input.suffix}`,
      userId,
      expoPushToken: input.expoToken ?? `ExponentPushToken[withdraw-${input.suffix}]`,
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });
  }
  if (input.extraExpoToken) {
    await db.insert(schema.device).values({
      id: `dev_withdraw_${input.suffix}_extra`,
      userId,
      expoPushToken: input.extraExpoToken,
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });
  }
  if (input.includeWeb) {
    await db.insert(schema.webPushSubscription).values({
      id: `web_withdraw_${input.suffix}`,
      userId,
      endpointHash: `web-withdraw-${input.suffix}`,
      subscriptionCiphertext: "encrypted-by-test-boundary",
      deviceName: "Linux",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });
  }
  if (input.includeMacos) {
    await db.insert(schema.macosDevice).values({
      id: `mac_withdraw_${input.suffix}`,
      userId,
      apnsTokenHash: input.suffix.padEnd(64, "c"),
      apnsTokenCiphertext: "ciphertext",
      environment: "sandbox",
      deviceName: "Mac",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });
  }
  await db.insert(schema.event).values({
    id: eventId,
    serviceId,
    title: "CI",
    body: "Old result",
    status: input.status ?? "accepted",
    deliveredCount: 1,
    createdAt: now,
  });
  if (input.includeInteraction) {
    await db.insert(schema.interaction).values({
      id: `int_withdraw_${input.suffix}`,
      userId,
      requesterServiceId: serviceId,
      eventId,
      title: "CI",
      prompt: "Continue?",
      kind: "approval",
      status: "pending",
      choices: ["approve", "deny"],
      actionDigest: `withdraw-${input.suffix}`,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
    });
  }
  return { token, eventId, userId };
}

describe("POST /hooks/:token/events/:eventId/withdraw", () => {
  it("authenticates ownership, fans out silently, and cancels a pending response", async () => {
    const { token, eventId } = await seedWithdrawFixture({
      suffix: "ok",
      includeWeb: true,
      includeMacos: true,
      includeInteraction: true,
    });

    const denied = await app.request(`/hooks/whk_wrong/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(denied.status).toBe(404);
    expect(await denied.json()).toEqual({ ok: false, error: "Event not found" });

    sent.length = 0;
    webSent.length = 0;
    macosSent.length = 0;
    const response = await app.request(`/hooks/${token}/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      eventId,
      status: "withdrawn",
      accepted: 3,
    });
    expect(sent).toEqual([
      {
        to: "ExponentPushToken[withdraw-ok]",
        data: { v: 1, command: "notification.withdraw", eventId },
        _contentAvailable: true,
      },
    ]);
    expect(webSent).toEqual([
      {
        id: "web_withdraw_ok",
        payload: {
          v: 1,
          command: "notification.withdraw",
          eventId,
          tag: `event-${eventId}`,
        },
      },
    ]);
    expect(macosSent).toEqual([
      {
        id: "mac_withdraw_ok",
        kind: "silent",
        payload: { data: { v: 1, command: "notification.withdraw", eventId } },
      },
    ]);

    const { eq } = await import("drizzle-orm");
    const [savedEvent] = await db.select().from(schema.event).where(eq(schema.event.id, eventId));
    const [savedInteraction] = await db
      .select()
      .from(schema.interaction)
      .where(eq(schema.interaction.id, "int_withdraw_ok"));
    const [inbox] = await db
      .select()
      .from(schema.inboxItem)
      .where(eq(schema.inboxItem.entityId, "int_withdraw_ok"));
    const timeline = await db
      .select()
      .from(schema.inboxItemEvent)
      .where(eq(schema.inboxItemEvent.inboxItemId, "ibox:interaction:int_withdraw_ok"));
    expect(savedEvent?.status).toBe("withdrawn");
    expect(savedInteraction).toMatchObject({ status: "canceled" });
    expect(savedInteraction?.canceledAt).toBeInstanceOf(Date);
    expect(inbox).toMatchObject({ status: "canceled", result: "Canceled" });
    expect(inbox?.readAt).toBeInstanceOf(Date);
    expect(timeline).toContainEqual(
      expect.objectContaining({ kind: "withdrawal", dedupeKey: "withdrawal", result: "Withdrawn" }),
    );

    const repeated = await app.request(`/hooks/${token}/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual({
      ok: true,
      eventId,
      status: "withdrawn",
      accepted: 0,
      idempotent: true,
    });
    expect(sent).toHaveLength(1);
    expect(webSent).toHaveLength(1);
    expect(macosSent).toHaveLength(1);
  });

  it("does not treat a missing event as withdrawable", async () => {
    const { token } = await seedWithdrawFixture({ suffix: "missing" });
    const response = await app.request(`/hooks/${token}/events/evt_does_not_exist/withdraw`, {
      method: "POST",
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "Event not found" });
    expect(sent.filter((message) => message.to === "ExponentPushToken[withdraw-missing]")).toEqual(
      [],
    );
  });

  it("rejects an in-flight event without sending", async () => {
    const { token, eventId } = await seedWithdrawFixture({
      suffix: "inflight",
      status: "withdraw_processing",
    });
    sent.length = 0;
    const response = await app.request(`/hooks/${token}/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "Event is still processing" });
    expect(sent).toEqual([]);
  });

  it("marks withdrawn when no targets remain", async () => {
    const { token, eventId } = await seedWithdrawFixture({
      suffix: "none",
      expoToken: null,
    });
    sent.length = 0;
    const response = await app.request(`/hooks/${token}/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      eventId,
      status: "withdrawn",
      accepted: 0,
    });
    expect(sent).toEqual([]);
    const { eq } = await import("drizzle-orm");
    const [savedEvent] = await db.select().from(schema.event).where(eq(schema.event.id, eventId));
    const [inbox] = await db
      .select()
      .from(schema.inboxItem)
      .where(eq(schema.inboxItem.entityId, eventId));
    expect(savedEvent?.status).toBe("withdrawn");
    expect(inbox).toMatchObject({ status: "withdrawn", result: "Withdrawn" });
    expect(inbox?.readAt).toBeInstanceOf(Date);
  });

  it("records withdraw_partial when some targets accept", async () => {
    const { token, eventId } = await seedWithdrawFixture({
      suffix: "partial",
      extraExpoToken: "ExponentPushToken[withdraw-partial-stale]",
    });
    sent.length = 0;
    const response = await app.request(`/hooks/${token}/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      eventId,
      status: "withdraw_partial",
      accepted: 1,
    });
    const { eq } = await import("drizzle-orm");
    const [savedEvent] = await db.select().from(schema.event).where(eq(schema.event.id, eventId));
    const [stale] = await db
      .select()
      .from(schema.device)
      .where(eq(schema.device.id, "dev_withdraw_partial_extra"));
    const [inbox] = await db
      .select()
      .from(schema.inboxItem)
      .where(eq(schema.inboxItem.entityId, eventId));
    expect(savedEvent?.status).toBe("withdraw_partial");
    expect(stale?.active).toBe(false);
    expect(inbox).toMatchObject({ status: "withdraw_partial", result: "Partially withdrawn" });
  });

  it("restores the prior status when every command is rejected", async () => {
    const { token, eventId } = await seedWithdrawFixture({
      suffix: "fail",
      expoToken: "ExponentPushToken[withdraw-fail-stale]",
    });
    const response = await app.request(`/hooks/${token}/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Withdrawal delivery failed",
    });
    const { eq } = await import("drizzle-orm");
    const [savedEvent] = await db.select().from(schema.event).where(eq(schema.event.id, eventId));
    const [savedDevice] = await db
      .select()
      .from(schema.device)
      .where(eq(schema.device.id, "dev_withdraw_fail"));
    expect(savedEvent?.status).toBe("accepted");
    expect(savedDevice?.active).toBe(false);
  });

  it("restores the prior status when fanout throws", async () => {
    const { token, eventId } = await seedWithdrawFixture({
      suffix: "throw",
      includeWeb: true,
    });
    const response = await app.request(`/hooks/${token}/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(response.status).toBe(500);
    const { eq } = await import("drizzle-orm");
    const [savedEvent] = await db.select().from(schema.event).where(eq(schema.event.id, eventId));
    expect(savedEvent?.status).toBe("accepted");
  });
});

describe("POST /hooks/:token/events/:eventId/withdraw", () => {
  it("authenticates ownership, sends a silent command, and cancels a pending response", async () => {
    const now = new Date();
    const token = "whk_withdraw-test-abcdefghijklmnopqr";
    const eventId = "evt_withdraw_test";
    await db.insert(schema.user).values({
      id: "user_withdraw",
      name: "Withdraw Test",
      email: "withdraw@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.service).values({
      id: "svc_withdraw",
      userId: "user_withdraw",
      title: "Withdraw Test",
      tokenHash: hashWebhookToken(token),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.device).values({
      id: "dev_withdraw",
      userId: "user_withdraw",
      expoPushToken: "ExponentPushToken[withdraw]",
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });
    await db.insert(schema.event).values({
      id: eventId,
      serviceId: "svc_withdraw",
      title: "CI",
      body: "Old result",
      status: "accepted",
      deliveredCount: 1,
      createdAt: now,
    });
    await db.insert(schema.interaction).values({
      id: "int_withdraw",
      userId: "user_withdraw",
      requesterServiceId: "svc_withdraw",
      eventId,
      title: "CI",
      prompt: "Continue?",
      kind: "approval",
      status: "pending",
      choices: ["approve", "deny"],
      actionDigest: "withdraw-digest",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
    });

    const denied = await app.request(`/hooks/whk_wrong/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(denied.status).toBe(404);
    expect(await denied.json()).toEqual({ ok: false, error: "Event not found" });

    sent.length = 0;
    const response = await app.request(`/hooks/${token}/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      eventId,
      status: "withdrawn",
      accepted: 1,
    });
    expect(sent).toEqual([
      {
        to: "ExponentPushToken[withdraw]",
        data: { v: 1, command: "notification.withdraw", eventId },
        _contentAvailable: true,
      },
    ]);

    const { eq } = await import("drizzle-orm");
    const [savedEvent] = await db.select().from(schema.event).where(eq(schema.event.id, eventId));
    const [savedInteraction] = await db
      .select()
      .from(schema.interaction)
      .where(eq(schema.interaction.id, "int_withdraw"));
    expect(savedEvent?.status).toBe("withdrawn");
    // Withdrawal marks the event read so it cannot linger as a ghost unread item.
    expect(savedEvent?.readAt).toBeInstanceOf(Date);
    expect(savedInteraction).toMatchObject({ status: "canceled" });
    expect(savedInteraction?.canceledAt).toBeInstanceOf(Date);

    const repeated = await app.request(`/hooks/${token}/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual({
      ok: true,
      eventId,
      status: "withdrawn",
      accepted: 0,
      idempotent: true,
    });
    expect(sent).toHaveLength(1);
  });

  it("does not mark an event withdrawn when Expo rejects every command", async () => {
    const now = new Date();
    const token = "whk_withdraw-fail-abcdefghijklmnopqr";
    const eventId = "evt_withdraw_upstream_fail";
    await db.insert(schema.user).values({
      id: "user_withdraw_upstream_fail",
      name: "Withdraw Failure",
      email: "withdraw-upstream-fail@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.service).values({
      id: "svc_withdraw_upstream_fail",
      userId: "user_withdraw_upstream_fail",
      title: "Withdraw Failure",
      tokenHash: hashWebhookToken(token),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.device).values({
      id: "dev_withdraw_upstream_fail",
      userId: "user_withdraw_upstream_fail",
      expoPushToken: "ExponentPushToken[withdraw-stale]",
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });
    await db.insert(schema.event).values({
      id: eventId,
      serviceId: "svc_withdraw_upstream_fail",
      title: "CI",
      body: "Old result",
      status: "accepted",
      deliveredCount: 1,
      createdAt: now,
    });

    const response = await app.request(`/hooks/${token}/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Withdrawal delivery failed",
    });

    const { eq } = await import("drizzle-orm");
    const [savedEvent] = await db.select().from(schema.event).where(eq(schema.event.id, eventId));
    const [savedDevice] = await db
      .select()
      .from(schema.device)
      .where(eq(schema.device.id, "dev_withdraw_upstream_fail"));
    expect(savedEvent?.status).toBe("accepted");
    expect(savedDevice?.active).toBe(false);
  });
});

describe("webhook project, summary, and body capacity", () => {
  it("stores project, summary, and bodyFormat and reuses projects case-insensitively", async () => {
    const { and, eq } = await import("drizzle-orm");
    sent.length = 0;
    const first = await post(TOKEN, {
      body: "Deploy finished",
      project: "Acme App",
      summary: "Deploy digest",
      bodyFormat: "markdown",
    });
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as { eventId: string; message?: string };
    expect(firstJson.message).toBeUndefined();

    const [firstEvent] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.id, firstJson.eventId));
    expect(firstEvent).toMatchObject({
      summary: "Deploy digest",
      bodyFormat: "markdown",
      readAt: null,
    });
    expect(firstEvent?.projectId).toMatch(/^prj_/);

    // NFC + case-insensitive identity: "acme APP" reuses the same project.
    const second = await post(TOKEN, { body: "Second", project: "acme APP" });
    const secondJson = (await second.json()) as { eventId: string };
    const [secondEvent] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.id, secondJson.eventId));
    expect(secondEvent?.projectId).toBe(firstEvent?.projectId);

    const [projectRow] = await db
      .select()
      .from(schema.project)
      .where(
        and(eq(schema.project.userId, "user_1"), eq(schema.project.normalizedName, "acme app")),
      );
    // The display name keeps the first sender's casing.
    expect(projectRow?.name).toBe("Acme App");

    // The push carries the summary and the project metadata, never the raw body.
    expect(sent[0]).toMatchObject({ body: "Deploy digest" });
    expect(((sent[0]?.data ?? {}) as Record<string, unknown>).projectId).toBe(
      firstEvent?.projectId,
    );
  });

  it("keeps the replayed event's original project when the name is reused", async () => {
    const { eq } = await import("drizzle-orm");
    const first = await post(TOKEN, { body: "Replay", project: "Replay Project" }, "replay-prj");
    const firstJson = (await first.json()) as { eventId: string };
    const [firstEvent] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.id, firstJson.eventId));

    const replay = await post(TOKEN, { body: "Replay", project: "Replay Project" }, "replay-prj");
    const replayJson = (await replay.json()) as { eventId: string; idempotent?: boolean };
    expect(replayJson.idempotent).toBe(true);
    expect(replayJson.eventId).toBe(firstJson.eventId);
    const [replayEvent] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.id, replayJson.eventId));
    expect(replayEvent?.projectId).toBe(firstEvent?.projectId);
  });

  it("scopes projects to the token owner's account", async () => {
    const { eq } = await import("drizzle-orm");
    const now = new Date();
    const otherToken = "whk_project-isolation-abcdefghijklmn";
    await db.insert(schema.user).values({
      id: "user_prj_other",
      name: "Other",
      email: "prj-other@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.service).values({
      id: "svc_prj_other",
      userId: "user_prj_other",
      title: "Other service",
      tokenHash: hashWebhookToken(otherToken),
      createdAt: now,
      updatedAt: now,
    });

    const response = await post(otherToken, { body: "Hi", project: "Acme App" });
    expect(response.status).toBe(200);
    const rows = await db
      .select()
      .from(schema.project)
      .where(eq(schema.project.normalizedName, "acme app"));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.userId))).toEqual(new Set(["user_1", "user_prj_other"]));
  });

  it("degrades to Unfiled with a message instead of failing at the project cap", async () => {
    const { eq } = await import("drizzle-orm");
    const { MAX_PROJECTS_PER_ACCOUNT } = await import("@hark/contracts");
    const now = new Date();
    const existing = await db
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(eq(schema.project.userId, "user_1"));
    const fillers = Array.from(
      { length: MAX_PROJECTS_PER_ACCOUNT - existing.length },
      (_, index) => ({
        id: `prj_fill_${index}`,
        userId: "user_1",
        name: `Filler ${index}`,
        normalizedName: `filler ${index}`,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await db.insert(schema.project).values(fillers);

    const response = await post(TOKEN, { body: "Over cap", project: "Brand New Project" });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { ok: boolean; eventId: string; message?: string };
    expect(json.ok).toBe(true);
    expect(json.message).toContain("Project limit reached");

    const [row] = await db.select().from(schema.event).where(eq(schema.event.id, json.eventId));
    expect(row?.projectId).toBeNull();

    // An existing project still resolves at the cap.
    const reuse = await post(TOKEN, { body: "Reuse", project: "ACME app" });
    const reuseJson = (await reuse.json()) as { eventId: string; message?: string };
    expect(reuseJson.message).toBeUndefined();
    const [reuseRow] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.id, reuseJson.eventId));
    expect(reuseRow?.projectId).toMatch(/^prj_/);

    await db.delete(schema.project).where(eq(schema.project.name, "Filler 0"));
  });

  it("accepts an 8,000-character body and keeps the push below the APNs cap", async () => {
    const { eq } = await import("drizzle-orm");
    sent.length = 0;
    const body = `head ${"気配り🚀 ".repeat(1_100)}tail`.slice(0, 8_000);
    const response = await post(TOKEN, { body });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { eventId: string };

    const [row] = await db
      .select({ body: schema.event.body })
      .from(schema.event)
      .where(eq(schema.event.id, json.eventId));
    expect(row?.body).toBe(body);

    expect(sent.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(sent[0]), "utf8")).toBeLessThanOrEqual(4_096);
    expect(String(sent[0]?.body).endsWith("…")).toBe(true);
  });

  it("rejects a body over the UTF-8 byte cap with a validation error", async () => {
    const response = await post(TOKEN, { body: "気".repeat(6_000) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: "Invalid payload" });
  });
});
