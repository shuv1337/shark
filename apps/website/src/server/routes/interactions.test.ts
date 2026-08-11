import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const authState = vi.hoisted(() => ({ userId: "user_1" as string | null }));
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const tracked = vi.hoisted(() => [] as string[]);
const liveActivityPushes = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const webPushState = vi.hoisted(() => ({
  stale: false,
  calls: [] as Array<{ ids: string[]; payload: Record<string, unknown> }>,
}));
const billingState = vi.hoisted(() => ({
  pro: true,
  servicePerMinute: 10_000,
  accountPerMinute: 10_000,
  allowance: true,
  acceptPush: true,
}));

vi.mock("../lib/billing", () => ({
  getBilling: async () => ({
    configured: true,
    plan: billingState.pro ? "pro" : "free",
    priceMonthly: 8,
    features: { deviceRouting: billingState.pro },
    limits: {
      devices: billingState.pro ? null : 1,
      notificationsPerMonth: billingState.pro ? 100_000 : 10_000,
      servicePerMinute: billingState.servicePerMinute,
      accountPerMinute: billingState.accountPerMinute,
    },
    usage: { notificationsRemaining: billingState.allowance ? 100 : 0 },
  }),
  checkNotificationAllowance: async () => billingState.allowance,
  trackNotification: async (_userId: string, eventId: string) => tracked.push(eventId),
  hasAutumn: () => false,
  clearBillingCache: () => undefined,
  createCheckout: async () => "https://example.com/checkout",
  createBillingPortal: async () => "https://example.com/portal",
}));

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () =>
        authState.userId
          ? {
              user: {
                id: authState.userId,
                name: "Test User",
                email: "test@example.com",
                image: null,
              },
            }
          : null,
    },
  },
}));

vi.mock("expo-server-sdk", () => {
  class Expo {
    chunkPushNotifications(messages: Array<Record<string, unknown>>) {
      return [messages];
    }
    async sendPushNotificationsAsync(messages: Array<Record<string, unknown>>) {
      sent.push(...messages);
      return messages.map(() =>
        billingState.acceptPush
          ? { status: "ok", id: "ticket" }
          : { status: "error", message: "rejected" },
      );
    }
  }
  return { Expo, default: Expo };
});

vi.mock("../lib/apns", () => ({
  isInvalidApnsTokenReason: () => false,
  sendLiveActivityPush: async (
    token: string,
    environment: string,
    input: Record<string, unknown>,
  ) => {
    liveActivityPushes.push({ token, environment, input });
    return { status: 200, apnsId: "apns-id", reason: null, accepted: true };
  },
}));

vi.mock("../lib/web-push", () => ({
  sendWebPushNotifications: async (
    rows: Array<{ id: string }>,
    payload: Record<string, unknown>,
  ) => {
    webPushState.calls.push({ ids: rows.map((row) => row.id), payload });
    return {
      accepted: webPushState.stale ? 0 : rows.length,
      errors: webPushState.stale ? ["subscription expired"] : [],
      staleSubscriptionIds: webPushState.stale ? rows.map((row) => row.id) : [],
    };
  },
}));

afterEach(() => {
  authState.userId = "user_1";
  billingState.pro = true;
  billingState.servicePerMinute = 10_000;
  billingState.accountPerMinute = 10_000;
  billingState.allowance = true;
  billingState.acceptPush = true;
  tracked.length = 0;
  liveActivityPushes.length = 0;
  webPushState.stale = false;
  webPushState.calls.length = 0;
});

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let hashApiToken: typeof import("../lib/token")["hashApiToken"];
let encryptLiveActivityToken: typeof import("../lib/token")["encryptLiveActivityToken"];
let createLiveActivityInteractionCredential: typeof import("../lib/live-activity-interaction")["createLiveActivityInteractionCredential"];

const SECRET = `hark_${"a".repeat(43)}`;
const READ_SECRET = `hark_${"b".repeat(43)}`;
const OTHER_SECRET = `hark_${"c".repeat(43)}`;
const EXPIRED_SECRET = `hark_${"d".repeat(43)}`;
const WATCH_SECRET = `hark_${"w".repeat(43)}`;

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ hashApiToken, encryptLiveActivityToken } = await import("../lib/token"));
  ({ createLiveActivityInteractionCredential } = await import("../lib/live-activity-interaction"));
  const { runMigrations } = await import("../db/migrate");
  runMigrations();

  const now = new Date();
  await db.insert(schema.user).values([
    {
      id: "user_1",
      name: "Test User",
      email: "test@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "user_2",
      name: "Other User",
      email: "other@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.device).values([
    {
      id: "dev_1",
      userId: "user_1",
      expoPushToken: "ExponentPushToken[a]",
      platform: "ios",
      active: true,
      liveActivityPushToStartTokenCiphertext: encryptLiveActivityToken("ab".repeat(32)),
      liveActivityTokenEnvironment: "sandbox",
      liveActivitySchemaVersion: 1,
      liveActivityInteractionVersion: 1,
      createdAt: now,
      lastSeenAt: now,
    },
    {
      id: "dev_2",
      userId: "user_1",
      expoPushToken: "ExponentPushToken[b]",
      platform: "ios",
      active: true,
      liveActivityPushToStartTokenCiphertext: encryptLiveActivityToken("cd".repeat(32)),
      liveActivityTokenEnvironment: "sandbox",
      liveActivitySchemaVersion: 1,
      liveActivityInteractionVersion: 1,
      createdAt: now,
      lastSeenAt: now,
    },
    {
      id: "dev_foreign",
      userId: "user_2",
      expoPushToken: "ExponentPushToken[foreign]",
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    },
  ]);
  await db.insert(schema.apiToken).values([
    {
      id: "tok_full",
      userId: "user_1",
      name: "Full",
      tokenHash: hashApiToken(SECRET),
      prefix: SECRET.slice(0, 13),
      scopes: [
        "notifications:send",
        "interactions:create",
        "interactions:read",
        "services:read",
        "services:write",
      ],
      createdAt: now,
    },
    {
      id: "tok_read",
      userId: "user_1",
      name: "Read",
      tokenHash: hashApiToken(READ_SECRET),
      prefix: READ_SECRET.slice(0, 13),
      scopes: ["interactions:read"],
      createdAt: now,
    },
    {
      id: "tok_other",
      userId: "user_1",
      name: "Other",
      tokenHash: hashApiToken(OTHER_SECRET),
      prefix: OTHER_SECRET.slice(0, 13),
      scopes: ["interactions:read"],
      createdAt: now,
    },
    {
      id: "tok_expired",
      userId: "user_1",
      name: "Expired",
      tokenHash: hashApiToken(EXPIRED_SECRET),
      prefix: EXPIRED_SECRET.slice(0, 13),
      scopes: ["interactions:read"],
      expiresAt: new Date(now.getTime() - 1000),
      createdAt: now,
    },
    {
      id: "tok_watch",
      userId: "user_1",
      name: "Apple Watch",
      tokenHash: hashApiToken(WATCH_SECRET),
      prefix: WATCH_SECRET.slice(0, 13),
      scopes: ["watch:read", "watch:respond"],
      createdAt: now,
    },
  ]);
});

function agent(path: string, token = SECRET, init?: RequestInit) {
  return app.request(`/api/agent${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

function watch(path: string, init?: RequestInit) {
  return app.request(`/api/watch${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${WATCH_SECRET}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

async function createInteraction(body: Record<string, unknown>, key?: string) {
  return agent("/interactions", SECRET, {
    method: "POST",
    headers: key ? { "Idempotency-Key": key } : undefined,
    body: JSON.stringify(body),
  });
}

async function insertWebSubscription(id: string) {
  const now = new Date();
  await db.insert(schema.webPushSubscription).values({
    id,
    userId: "user_1",
    endpointHash: `${id}-endpoint-hash`,
    subscriptionCiphertext: "encrypted-at-adapter-boundary",
    deviceName: "Linux browser",
    active: true,
    createdAt: now,
    lastSeenAt: now,
  });
}

describe("agent token authentication", () => {
  it("rejects missing, expired, and insufficiently scoped tokens", async () => {
    expect((await app.request("/api/agent/auth/status")).status).toBe(401);
    expect((await agent("/auth/status", EXPIRED_SECRET)).status).toBe(401);
    const scoped = await agent("/interactions", READ_SECRET, {
      method: "POST",
      body: JSON.stringify({ title: "T", prompt: "P", kind: "approval" }),
    });
    expect(scoped.status).toBe(403);
    expect(await scoped.json()).toMatchObject({ error: "Insufficient scope" });
  });

  it("accepts a case-insensitive Bearer scheme while keeping the token exact", async () => {
    const lowerScheme = await app.request("/api/agent/auth/status", {
      headers: { authorization: `bearer ${SECRET}` },
    });
    expect(lowerScheme.status).toBe(200);
    const changedToken = await app.request("/api/agent/auth/status", {
      headers: { authorization: `Bearer ${SECRET.toUpperCase()}` },
    });
    expect(changedToken.status).toBe(401);
  });

  it("creates session-managed secrets once and persists only the hash", async () => {
    const created = await app.request("/api/api-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dashboard", scopes: ["devices:read"] }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { secret: string; token: { id: string } };
    expect(body.secret).toMatch(/^hark_/);

    const { eq } = await import("drizzle-orm");
    const [stored] = await db
      .select()
      .from(schema.apiToken)
      .where(eq(schema.apiToken.id, body.token.id));
    expect(stored?.tokenHash).toBe(hashApiToken(body.secret));
    expect(JSON.stringify(stored)).not.toContain(body.secret);

    const listed = await app.request("/api/api-tokens");
    expect(JSON.stringify(await listed.json())).not.toContain(body.secret);
  });

  it("caps active API tokens at 25 per user", async () => {
    const now = new Date();
    await db.insert(schema.apiToken).values(
      Array.from({ length: 25 }, (_, index) => ({
        id: `tok_cap_${index}`,
        userId: "user_2",
        name: `Cap ${index}`,
        tokenHash: `cap_hash_${index}`,
        prefix: `hark_cap_${index}`,
        scopes: ["devices:read"],
        createdAt: now,
      })),
    );
    authState.userId = "user_2";
    const response = await app.request("/api/api-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "One too many", scopes: ["devices:read"] }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("25") });
  });

  it("lists token metadata needed by the dashboard agent connections section", async () => {
    const listed = await app.request("/api/api-tokens");
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { tokens: Array<Record<string, unknown>> };
    const token = body.tokens.find((candidate) => candidate.id === "tok_full");
    expect(token).toMatchObject({
      name: "Full",
      prefix: SECRET.slice(0, 13),
      scopes: [
        "notifications:send",
        "interactions:create",
        "interactions:read",
        "services:read",
        "services:write",
      ],
      revokedAt: null,
    });
    expect(typeof token?.createdAt).toBe("string");
    expect(token).toHaveProperty("lastUsedAt");
    expect(token).toHaveProperty("expiresAt");
  });

  it("returns token metadata from auth status for sharkctl", async () => {
    const response = await agent("/auth/status");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      token: Record<string, unknown>;
    };
    expect(body).toMatchObject({
      authenticated: true,
      token: {
        id: "tok_full",
        name: "Full",
        prefix: SECRET.slice(0, 13),
        scopes: [
          "notifications:send",
          "interactions:create",
          "interactions:read",
          "services:read",
          "services:write",
        ],
        expiresAt: null,
      },
    });
    expect(typeof body.token.createdAt).toBe("string");
    expect(body.token).toHaveProperty("lastUsedAt");
  });

  it("updates token last-used timestamps at most once per minute", async () => {
    const recent = new Date(Date.now() - 10_000);
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.apiToken)
      .set({ lastUsedAt: recent })
      .where(eq(schema.apiToken.id, "tok_full"));
    expect((await agent("/auth/status")).status).toBe(200);
    const [token] = await db
      .select({ lastUsedAt: schema.apiToken.lastUsedAt })
      .from(schema.apiToken)
      .where(eq(schema.apiToken.id, "tok_full"));
    expect(token?.lastUsedAt?.getTime()).toBe(recent.getTime());
  });
});

describe("Apple Watch MVP surface", () => {
  it("returns a bounded snapshot and lets the first valid action win", async () => {
    const created = await createInteraction({
      title: "Deploy",
      prompt: "Ship now?",
      kind: "approval",
    });
    const interaction = (await created.json()) as {
      interaction: { id: string; actionDigest: string };
    };
    const snapshot = await watch("/snapshot");
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({
      pendingInteraction: { id: interaction.interaction.id, title: "Deploy", kind: "approval" },
    });

    const first = await watch(`/interactions/${interaction.interaction.id}/respond`, {
      method: "POST",
      body: JSON.stringify({
        action: "approve",
        actionDigest: interaction.interaction.actionDigest,
      }),
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      ok: true,
      status: "approved",
      snapshot: { pendingInteraction: null },
    });

    const duplicate = await watch(`/interactions/${interaction.interaction.id}/respond`, {
      method: "POST",
      body: JSON.stringify({
        action: "approve",
        actionDigest: interaction.interaction.actionDigest,
      }),
    });
    expect(duplicate.status).toBe(409);
  });

  it("redacts private active-work content before it reaches the Watch", async () => {
    const now = new Date();
    await db.insert(schema.liveActivity).values({
      id: "act_watch_private",
      userId: "user_1",
      requesterTokenId: "tok_full",
      key: "watch-private",
      schemaVersion: 1,
      props: {
        title: "Private deployment",
        status: "Leaking detail",
        detail: "Sensitive",
        privacyMode: "private",
      },
      status: "active",
      sequence: 1,
      acceptedCount: 1,
      failedCount: 0,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
    const response = await watch("/snapshot");
    const body = (await response.json()) as {
      activeWork: { title: string; status: string; detail: string | null };
    };
    expect(body.activeWork).toEqual(
      expect.objectContaining({ title: "Agent task", status: "In progress", detail: null }),
    );
    await db.delete(schema.liveActivity).where(eq(schema.liveActivity.id, "act_watch_private"));
  });
});

describe("agent services", () => {
  it("creates a service with webhook defaults and requires write scope", async () => {
    sent.length = 0;
    const forbidden = await agent("/services", READ_SECRET, {
      method: "POST",
      body: JSON.stringify({ title: "Release bot" }),
    });
    expect(forbidden.status).toBe(403);

    const response = await agent("/services", SECRET, {
      method: "POST",
      body: JSON.stringify({
        title: "Release bot",
        imageUrl: "https://example.com/bot.png",
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      service: {
        title: "Release bot",
        imageUrl: "https://example.com/bot.png",
      },
    });
    expect(body.webhookUrl).toMatch(/^https?:\/\/.*\/hooks\/whk_/);
    expect(body.service.webhookUrl).toBe(body.webhookUrl);

    const webhook = await app.request(new URL(body.webhookUrl).pathname, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Release shipped" }),
    });
    expect(webhook.status).toBe(200);
    expect(sent[0]).toMatchObject({
      title: "Release bot",
      body: "Release shipped",
      richContent: { image: "https://example.com/bot.png" },
      data: { avatarUrl: "https://example.com/bot.png" },
    });
  });
});

describe("interactions", () => {
  it("blocks browser, agent, and interaction credentials after allowlist removal", async () => {
    const { env } = await import("../env");
    const { hashInteractionResponseToken } = await import("../lib/token");
    const now = new Date();
    const responseToken = "r".repeat(43);
    await db.insert(schema.interaction).values({
      id: "int_admission_boundary",
      userId: "user_1",
      requesterTokenId: "tok_full",
      title: "Admission",
      prompt: "Still admitted?",
      kind: "approval",
      choices: ["approve", "deny"],
      actionDigest: "a".repeat(64),
      responseTokenHash: hashInteractionResponseToken(responseToken),
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
    });

    const previous = [...env.ALLOWED_EMAILS];
    env.ALLOWED_EMAILS.splice(0, env.ALLOWED_EMAILS.length, "somebody-else@example.com");
    try {
      expect((await agent("/interactions")).status).toBe(401);
      expect(
        (
          await app.request("/api/interactions/int_admission_boundary/respond", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "approve",
              deviceId: "dev_1",
              actionDigest: "a".repeat(64),
            }),
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await app.request("/api/interaction-responses/int_admission_boundary/respond", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "approve",
              deviceId: "dev_1",
              responseToken,
            }),
          })
        ).status,
      ).toBe(404);
    } finally {
      env.ALLOWED_EMAILS.splice(0, env.ALLOWED_EMAILS.length, ...previous);
    }
  });

  it("cascades interactions if an account and its token rows are deleted", async () => {
    const now = new Date();
    await db.insert(schema.user).values({
      id: "user_delete_regression",
      name: "Delete Me",
      email: "delete-regression@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.apiToken).values({
      id: "tok_delete_regression",
      userId: "user_delete_regression",
      name: "Delete Me",
      tokenHash: "delete_regression_hash",
      prefix: "hark_delete_",
      scopes: ["interactions:create"],
      createdAt: now,
    });
    await db.insert(schema.interaction).values({
      id: "int_delete_regression",
      userId: "user_delete_regression",
      requesterTokenId: "tok_delete_regression",
      title: "Delete Me",
      prompt: "Delete Me",
      kind: "approval",
      choices: ["approve", "deny"],
      actionDigest: "delete-regression",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
    });
    const { eq } = await import("drizzle-orm");
    await db.delete(schema.user).where(eq(schema.user.id, "user_delete_regression"));
    expect(
      await db
        .select()
        .from(schema.interaction)
        .where(eq(schema.interaction.id, "int_delete_regression")),
    ).toHaveLength(0);
  });

  it("creates an actionable notification with accepted-not-delivered semantics", async () => {
    sent.length = 0;
    const response = await createInteraction({
      title: "Release",
      prompt: "Deploy production?",
      kind: "approval",
      expiresInSeconds: 60,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      accepted: 2,
      interaction: { status: "pending" },
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      categoryId: "HARK_APPROVAL_V1",
      data: { actionDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(tracked).toHaveLength(1);
  });

  it("delivers notification interactions to browsers but keeps Live Activities iOS-only", async () => {
    sent.length = 0;
    await insertWebSubscription("web_interaction_target");
    try {
      const notification = await createInteraction({
        title: "Desktop approval",
        prompt: "Review the deploy in SHark",
        kind: "approval",
        deviceIds: ["web_interaction_target"],
        expiresInSeconds: 60,
      });
      expect(notification.status).toBe(201);
      expect(await notification.json()).toMatchObject({
        accepted: 1,
        interaction: { status: "pending", accepted: 1, presentation: "notification" },
      });
      expect(webPushState.calls).toEqual([
        {
          ids: ["web_interaction_target"],
          payload: {
            title: "Desktop approval",
            body: "Review the deploy in SHark",
            url: "/dashboard",
            tag: expect.stringMatching(/^interaction-int_/),
          },
        },
      ]);
      expect(sent).toHaveLength(0);

      webPushState.calls.length = 0;
      liveActivityPushes.length = 0;
      const liveActivity = await createInteraction({
        title: "Watch approval",
        prompt: "Review on an Apple device",
        kind: "approval",
        presentation: "live_activity",
        deviceIds: ["web_interaction_target"],
        expiresInSeconds: 900,
      });
      expect(liveActivity.status).toBe(201);
      expect(await liveActivity.json()).toMatchObject({
        accepted: 0,
        message: "No Live Activity-capable iOS devices are registered for this account.",
      });
      expect(webPushState.calls).toHaveLength(0);
      expect(liveActivityPushes).toHaveLength(0);
    } finally {
      await db
        .delete(schema.webPushSubscription)
        .where(eq(schema.webPushSubscription.id, "web_interaction_target"));
    }
  });

  it("creates and resolves a device-bound interactive Live Activity", async () => {
    sent.length = 0;
    liveActivityPushes.length = 0;
    const response = await createInteraction({
      title: "Approval needed",
      prompt: "Send the prepared release email?",
      kind: "approval",
      presentation: "live_activity",
      primaryLabel: "Send",
      secondaryLabel: "Deny",
      expiresInSeconds: 900,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      accepted: number;
      liveActivityId: string;
      interaction: { id: string; actionDigest: string; presentation: string };
    };
    expect(body).toMatchObject({
      accepted: 2,
      interaction: {
        presentation: "live_activity",
        primaryLabel: "Send",
        secondaryLabel: "Deny",
      },
    });
    expect(sent).toHaveLength(0);
    expect(liveActivityPushes).toHaveLength(2);

    const { eq } = await import("drizzle-orm");
    const [activity] = await db
      .select()
      .from(schema.liveActivity)
      .where(eq(schema.liveActivity.id, body.liveActivityId));
    expect(activity).toBeDefined();
    expect(JSON.stringify(activity?.props)).not.toContain("credential");
    const sessionActivities = (await (await app.request("/api/activities")).json()) as {
      activities: Array<{ id: string }>;
    };
    expect(sessionActivities.activities.some((item) => item.id === body.liveActivityId)).toBe(
      false,
    );
    const deliveries = await db
      .select()
      .from(schema.liveActivityDelivery)
      .where(eq(schema.liveActivityDelivery.activityId, body.liveActivityId));
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((delivery) => delivery.purpose === "interaction")).toBe(true);

    const firstDelivery = deliveries.find((delivery) => delivery.deviceId === "dev_1");
    expect(firstDelivery).toBeDefined();
    const attributes = (
      liveActivityPushes[0]?.input as { attributes?: Record<string, unknown> } | undefined
    )?.attributes;
    expect(attributes).toMatchObject({
      harkInteractionId: body.interaction.id,
      harkInteractionDeviceId: expect.any(String),
      harkInteractionCredential: expect.stringMatching(/^[a-zA-Z0-9_-]{43}$/),
    });
    expect(
      JSON.stringify((liveActivityPushes[0]?.input as { props?: unknown })?.props),
    ).not.toContain("credential");

    const [interactionRow] = await db
      .select()
      .from(schema.interaction)
      .where(eq(schema.interaction.id, body.interaction.id));
    const credential = createLiveActivityInteractionCredential({
      interactionId: body.interaction.id,
      deliveryId: firstDelivery?.id ?? "",
      deviceId: "dev_1",
      actionDigest: body.interaction.actionDigest,
      expiresAt: interactionRow?.expiresAt ?? new Date(0),
    });
    const wrongDevice = await app.request(
      `/api/live-activity-interactions/${body.interaction.id}/respond`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          credential,
          deliveryId: firstDelivery?.id,
          deviceId: "dev_2",
        }),
      },
    );
    expect(wrongDevice.status).toBe(404);

    const answer = () =>
      app.request(`/api/live-activity-interactions/${body.interaction.id}/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          credential,
          deliveryId: firstDelivery?.id,
          deviceId: "dev_1",
        }),
      });
    const answered = await answer();
    expect(answered.status).toBe(200);
    expect(await answered.json()).toMatchObject({ ok: true, status: "approved" });
    expect(await (await answer()).json()).toMatchObject({
      ok: true,
      status: "approved",
      idempotent: true,
    });
    await vi.waitFor(async () => {
      const [resolved] = await db
        .select()
        .from(schema.liveActivity)
        .where(eq(schema.liveActivity.id, body.liveActivityId));
      expect(resolved?.status).toBe("ended");
    });
  });

  it("is idempotent per requester token and rejects changed payloads", async () => {
    sent.length = 0;
    const payload = { title: "Release", prompt: "Ship?", kind: "approval" };
    const first = await createInteraction(payload, "release-1");
    const firstBody = (await first.json()) as { interaction: { id: string } };
    const replay = await createInteraction(payload, "release-1");
    expect(await replay.json()).toMatchObject({
      idempotent: true,
      interaction: { id: firstBody.interaction.id },
    });
    expect(sent).toHaveLength(2);
    const conflict = await createInteraction({ ...payload, prompt: "Do not ship?" }, "release-1");
    expect(conflict.status).toBe(409);
  });

  it("returns 409 for concurrent idempotency inserts with different payloads", async () => {
    const [first, second] = await Promise.all([
      createInteraction({ title: "Release", prompt: "Ship A?", kind: "approval" }, "race-1"),
      createInteraction({ title: "Release", prompt: "Ship B?", kind: "approval" }, "race-1"),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
  });

  it("applies free device limits and reserves targeted routing for Pro", async () => {
    billingState.pro = false;
    sent.length = 0;
    const free = await createInteraction({ title: "Free", prompt: "One device", kind: "reply" });
    expect(await free.json()).toMatchObject({ accepted: 1 });
    expect(sent).toHaveLength(1);

    const targetedFree = await createInteraction({
      title: "Free",
      prompt: "Target device",
      kind: "reply",
      deviceIds: ["dev_2"],
    });
    expect(targetedFree.status).toBe(402);

    billingState.pro = true;
    sent.length = 0;
    const targetedPro = await createInteraction({
      title: "Pro",
      prompt: "Target device",
      kind: "reply",
      deviceIds: ["dev_2"],
    });
    expect(await targetedPro.json()).toMatchObject({ accepted: 1 });
    expect(sent[0]).toMatchObject({ to: "ExponentPushToken[b]" });
  });

  it("enforces requester, combined account, and monthly limits before creation", async () => {
    billingState.servicePerMinute = 0;
    const requesterLimited = await createInteraction({
      title: "Limited",
      prompt: "Requester",
      kind: "approval",
    });
    expect(requesterLimited.status).toBe(429);
    expect(requesterLimited.headers.get("Retry-After")).toBe("60");
    expect(await requesterLimited.json()).toMatchObject({ error: "Requester rate limit exceeded" });

    billingState.servicePerMinute = 10_000;
    billingState.accountPerMinute = 0;
    const accountLimited = await createInteraction({
      title: "Limited",
      prompt: "Account",
      kind: "approval",
    });
    expect(accountLimited.status).toBe(429);
    expect(await accountLimited.json()).toMatchObject({ error: "Account rate limit exceeded" });

    billingState.accountPerMinute = 10_000;
    billingState.allowance = false;
    const monthlyLimited = await createInteraction({
      title: "Limited",
      prompt: "Monthly",
      kind: "approval",
    });
    expect(monthlyLimited.status).toBe(429);
    expect(await monthlyLimited.json()).toMatchObject({
      error: "Monthly notification limit reached",
    });
  });

  it("counts webhook events toward the interaction account rate limit", async () => {
    const now = new Date();
    await db.insert(schema.service).values({
      id: "svc_interaction_rate",
      userId: "user_1",
      title: "Rate source",
      tokenHash: "rate_source_hash",
      createdAt: now,
      updatedAt: now,
    });
    const { and, count, eq, gte } = await import("drizzle-orm");
    const [recentInteractions] = await db
      .select({ value: count() })
      .from(schema.interaction)
      .where(
        and(
          eq(schema.interaction.userId, "user_1"),
          gte(schema.interaction.createdAt, new Date(Date.now() - 60_000)),
        ),
      );
    await db.insert(schema.event).values({
      id: "evt_interaction_rate",
      serviceId: "svc_interaction_rate",
      title: "Rate",
      body: "Count me",
      status: "accepted",
      createdAt: now,
    });
    billingState.accountPerMinute = (recentInteractions?.value ?? 0) + 1;
    const response = await createInteraction({
      title: "Limited",
      prompt: "Combined usage",
      kind: "approval",
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "Account rate limit exceeded" });
  });

  it("tracks monthly usage once only when at least one push is accepted", async () => {
    const accepted = await createInteraction({ title: "Track", prompt: "Accepted", kind: "reply" });
    expect(accepted.status).toBe(201);
    expect(tracked).toHaveLength(1);

    tracked.length = 0;
    billingState.acceptPush = false;
    const rejected = await createInteraction({ title: "Track", prompt: "Rejected", kind: "reply" });
    expect(await rejected.json()).toMatchObject({ accepted: 0 });
    expect(tracked).toHaveLength(0);
  });

  it("does not expose interactions to a different token and rejects foreign devices", async () => {
    const created = await createInteraction({ title: "T", prompt: "P", kind: "reply" });
    const body = (await created.json()) as {
      interaction: { id: string; actionDigest: string };
    };
    expect((await agent(`/interactions/${body.interaction.id}`, OTHER_SECRET)).status).toBe(404);
    const foreign = await createInteraction({
      title: "T",
      prompt: "P",
      kind: "reply",
      deviceIds: ["dev_foreign"],
    });
    expect(foreign.status).toBe(400);
  });

  it("validates response kind and atomically accepts only the first device", async () => {
    const created = await createInteraction({
      title: "Release",
      prompt: "Ship?",
      kind: "approval",
    });
    const body = (await created.json()) as {
      interaction: { id: string; actionDigest: string };
    };
    const invalid = await app.request(`/api/interactions/${body.interaction.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "reply",
        response: "yes",
        deviceId: "dev_1",
        actionDigest: body.interaction.actionDigest,
      }),
    });
    expect(invalid.status).toBe(400);

    const responses = await Promise.all(
      ["dev_1", "dev_2"].map((deviceId, index) =>
        app.request(`/api/interactions/${body.interaction.id}/respond`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: index === 0 ? "approve" : "deny",
            deviceId,
            actionDigest: body.interaction.actionDigest,
          }),
        }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = responses.find((response) => response.status === 200);
    expect(await winner?.json()).toMatchObject({
      interaction: { status: "approved", respondingDeviceId: "dev_1" },
    });
  });

  it("requires the exact action digest and an active responding device", async () => {
    const created = await createInteraction({
      title: "Release",
      prompt: "Ship?",
      kind: "approval",
    });
    const body = (await created.json()) as {
      interaction: { id: string; actionDigest: string };
    };
    const mismatch = await app.request(`/api/interactions/${body.interaction.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        deviceId: "dev_1",
        actionDigest: "f".repeat(64),
      }),
    });
    expect(mismatch.status).toBe(409);

    const { eq } = await import("drizzle-orm");
    await db.update(schema.device).set({ active: false }).where(eq(schema.device.id, "dev_2"));
    const inactive = await app.request(`/api/interactions/${body.interaction.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        deviceId: "dev_2",
        actionDigest: body.interaction.actionDigest,
      }),
    });
    await db.update(schema.device).set({ active: true }).where(eq(schema.device.id, "dev_2"));
    expect(inactive.status).toBe(404);
  });

  it("enforces account ownership and expires pending records", async () => {
    const now = new Date();
    await db.insert(schema.interaction).values({
      id: "int_expired",
      userId: "user_1",
      requesterTokenId: "tok_full",
      title: "Old",
      prompt: "Old prompt",
      kind: "reply",
      status: "pending",
      choices: ["reply"],
      actionDigest: "digest",
      expiresAt: new Date(now.getTime() - 1000),
      createdAt: new Date(now.getTime() - 2000),
    });
    const expired = await agent("/interactions/int_expired");
    expect(await expired.json()).toMatchObject({ interaction: { status: "expired" } });

    authState.userId = "user_2";
    const denied = await app.request("/api/interactions/int_expired/respond", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "reply",
        response: "late",
        deviceId: "dev_foreign",
        actionDigest: "d".repeat(64),
      }),
    });
    authState.userId = "user_1";
    expect(denied.status).toBe(404);
  });

  it("supports text replies, bounded waits, and cancellation", async () => {
    const replyCreated = await createInteraction({
      title: "Release",
      prompt: "Release note?",
      kind: "reply",
    });
    const replyBody = (await replyCreated.json()) as {
      interaction: { id: string; actionDigest: string };
    };
    const replied = await app.request(`/api/interactions/${replyBody.interaction.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "reply",
        response: "Ship it",
        deviceId: "dev_1",
        actionDigest: replyBody.interaction.actionDigest,
      }),
    });
    expect(await replied.json()).toMatchObject({
      interaction: { status: "replied", response: "Ship it" },
    });
    const waited = await agent(`/interactions/${replyBody.interaction.id}/wait?timeout=0`);
    expect(await waited.json()).toMatchObject({
      timedOut: false,
      interaction: { status: "replied" },
    });

    const pendingCreated = await createInteraction({
      title: "Release",
      prompt: "Cancel me",
      kind: "approval",
    });
    const pendingBody = (await pendingCreated.json()) as { interaction: { id: string } };
    const pendingWait = await agent(`/interactions/${pendingBody.interaction.id}/wait?timeout=0`);
    expect(await pendingWait.json()).toMatchObject({ timedOut: true });
    const canceled = await agent(`/interactions/${pendingBody.interaction.id}/cancel`, SECRET, {
      method: "POST",
    });
    expect(await canceled.json()).toMatchObject({ interaction: { status: "canceled" } });
    expect(
      (
        await agent(`/interactions/${pendingBody.interaction.id}/cancel`, SECRET, {
          method: "POST",
        })
      ).status,
    ).toBe(409);
  });

  it("stops a long poll when the request is aborted", async () => {
    const created = await createInteraction({
      title: "Release",
      prompt: "Wait for me",
      kind: "approval",
    });
    const body = (await created.json()) as { interaction: { id: string } };
    const controller = new AbortController();
    const waiting = agent(`/interactions/${body.interaction.id}/wait?timeout=25`, SECRET, {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    expect((await waiting).status).toBe(499);
  });

  it("stores an interaction image and forwards it to the DTO and push payload", async () => {
    sent.length = 0;
    const created = await createInteraction({
      title: "Release",
      prompt: "Ship with art?",
      kind: "approval",
      imageUrl: "https://example.com/avatar.png",
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { interaction: { id: string; imageUrl: string } };
    expect(body.interaction.imageUrl).toBe("https://example.com/avatar.png");

    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ imageUrl: schema.interaction.imageUrl })
      .from(schema.interaction)
      .where(eq(schema.interaction.id, body.interaction.id));
    expect(row?.imageUrl).toBe("https://example.com/avatar.png");

    expect(sent[0]).toMatchObject({
      richContent: { image: "https://example.com/avatar.png" },
      data: { avatarUrl: "https://example.com/avatar.png" },
    });

    const fetched = await agent(`/interactions/${body.interaction.id}`);
    expect(await fetched.json()).toMatchObject({
      interaction: { imageUrl: "https://example.com/avatar.png" },
    });
  });

  it("rejects non-public interaction image URLs", async () => {
    const response = await createInteraction({
      title: "Release",
      prompt: "Ship?",
      kind: "approval",
      imageUrl: "https://192.168.0.10/avatar.png",
    });
    expect(response.status).toBe(400);
  });
});

describe("agent notifications", () => {
  async function createNotification(body: Record<string, unknown>, key?: string, token = SECRET) {
    return agent("/notifications", token, {
      method: "POST",
      headers: key ? { "Idempotency-Key": key } : undefined,
      body: JSON.stringify(body),
    });
  }

  it("sends a one-shot notification with the webhook-style push payload", async () => {
    sent.length = 0;
    const response = await createNotification({
      body: "Deploy finished",
      title: "Deploy bot",
      imageUrl: "https://example.com/bot.png",
      url: "https://example.com/runs/1",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      notification: Record<string, unknown>;
      accepted: number;
      message?: string;
    };
    expect(body).toMatchObject({
      accepted: 2,
      notification: {
        title: "Deploy bot",
        body: "Deploy finished",
        imageUrl: "https://example.com/bot.png",
        url: "https://example.com/runs/1",
      },
    });
    expect(body.message).toBeUndefined();
    expect(String(body.notification.id)).toMatch(/^anot_/);
    expect(typeof body.notification.createdAt).toBe("string");
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      title: "Deploy bot",
      body: "Deploy finished",
      richContent: { image: "https://example.com/bot.png" },
      data: {
        sourceName: "Deploy bot",
        avatarUrl: "https://example.com/bot.png",
        url: "https://example.com/runs/1",
      },
    });
    expect(tracked).toHaveLength(1);
  });

  it("routes agent notifications to browsers and deactivates stale subscriptions", async () => {
    sent.length = 0;
    await insertWebSubscription("web_notification_target");
    try {
      const delivered = await createNotification({
        body: "Deploy finished",
        title: "Desktop bot",
        deviceIds: ["web_notification_target"],
      });
      expect(delivered.status).toBe(201);
      const deliveredBody = (await delivered.json()) as {
        notification: { id: string };
        accepted: number;
      };
      expect(deliveredBody.accepted).toBe(1);
      expect(sent).toHaveLength(0);
      expect(webPushState.calls).toEqual([
        {
          ids: ["web_notification_target"],
          payload: {
            title: "Desktop bot",
            body: "Deploy finished",
            url: "/dashboard",
            tag: "agent-tok_full",
          },
        },
      ]);
      const [storedDelivery] = await db
        .select()
        .from(schema.agentNotification)
        .where(eq(schema.agentNotification.id, deliveredBody.notification.id));
      expect(storedDelivery).toMatchObject({
        status: "accepted",
        acceptedCount: 1,
        failedCount: 0,
      });

      webPushState.stale = true;
      const stale = await createNotification({
        body: "Subscription expired",
        deviceIds: ["web_notification_target"],
      });
      expect(stale.status).toBe(201);
      expect(await stale.json()).toMatchObject({
        accepted: 0,
        message: "No notification provider accepted the request.",
      });
      const [subscription] = await db
        .select()
        .from(schema.webPushSubscription)
        .where(eq(schema.webPushSubscription.id, "web_notification_target"));
      expect(subscription?.active).toBe(false);
    } finally {
      await db
        .delete(schema.webPushSubscription)
        .where(eq(schema.webPushSubscription.id, "web_notification_target"));
    }
  });

  it("defaults the title to SHark and requires the notifications:send scope", async () => {
    const defaulted = await createNotification({ body: "Ping" });
    expect(await defaulted.json()).toMatchObject({ notification: { title: "SHark" } });

    const scoped = await createNotification({ body: "Ping" }, undefined, READ_SECRET);
    expect(scoped.status).toBe(403);
    expect(await scoped.json()).toMatchObject({ error: "Insufficient scope" });
  });

  it("reserves device routing for Pro and caps free delivery at one device", async () => {
    billingState.pro = false;
    const targeted = await createNotification({ body: "Routed", deviceIds: ["dev_1"] });
    expect(targeted.status).toBe(402);

    sent.length = 0;
    const capped = await createNotification({ body: "Capped" });
    expect(await capped.json()).toMatchObject({ accepted: 1 });
    expect(sent).toHaveLength(1);

    billingState.pro = true;
    sent.length = 0;
    const routed = await createNotification({ body: "Routed", deviceIds: ["dev_2"] });
    expect(await routed.json()).toMatchObject({ accepted: 1 });
    expect(sent[0]).toMatchObject({ to: "ExponentPushToken[b]" });
  });

  it("returns 429 when the monthly notification allowance is exhausted", async () => {
    billingState.allowance = false;
    const response = await createNotification({ body: "Over quota" });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "Monthly notification limit reached" });
  });

  it("retains rejected direct-push failures distinctly from no-device attempts", async () => {
    billingState.acceptPush = false;
    const response = await createNotification({ body: "Rejected by Expo", title: "Release bot" });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { notification: { id: string }; accepted: number };
    expect(body.accepted).toBe(0);

    const [stored] = await db
      .select()
      .from(schema.agentNotification)
      .where(eq(schema.agentNotification.id, body.notification.id));
    expect(stored).toMatchObject({
      status: "failed",
      acceptedCount: 0,
      failedCount: 2,
    });
    expect(stored?.error).toContain("rejected");

    const detail = await app.request(
      `/api/inbox/${encodeURIComponent(`ibox:agent_notification:${body.notification.id}`)}`,
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      item: {
        status: "failed",
        accepted: 0,
        failed: 2,
      },
      events: expect.arrayContaining([
        expect.objectContaining({ kind: "delivery", result: expect.stringContaining("rejected") }),
      ]),
    });
  });

  it("threads notifications per sender name and enforces the shared per-minute budget", async () => {
    await db.delete(schema.agentNotification);
    await db.delete(schema.liveActivityDeliveryAttempt);
    await db.delete(schema.liveActivityDelivery);
    await db.delete(schema.liveActivityOperation);
    await db.delete(schema.liveActivity);
    await db.delete(schema.interaction);

    sent.length = 0;
    const first = await createNotification({ body: "One", title: "Deploy bot" });
    expect(first.status).toBe(201);
    const conversationId = String(
      (sent[0] as { data: { conversationId: string } }).data.conversationId,
    );
    expect(conversationId).toMatch(/^hark-agent-tok_/);

    sent.length = 0;
    const sameTitle = await createNotification({ body: "Two", title: "Deploy bot" });
    expect(sameTitle.status).toBe(201);
    expect((sent[0] as { data: { conversationId: string } }).data.conversationId).toBe(
      conversationId,
    );

    sent.length = 0;
    const otherTitle = await createNotification({ body: "Three", title: "Build bot" });
    expect(otherTitle.status).toBe(201);
    expect((sent[0] as { data: { conversationId: string } }).data.conversationId).not.toBe(
      conversationId,
    );

    billingState.servicePerMinute = 3;
    const limited = await createNotification({ body: "Four" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(await limited.json()).toMatchObject({
      error: "Requester rate limit exceeded",
      retryAfterSeconds: 60,
    });

    billingState.servicePerMinute = 10_000;
    billingState.accountPerMinute = 3;
    const accountLimited = await createInteraction({
      title: "Ship it",
      prompt: "Ship it?",
      kind: "approval",
    });
    expect(accountLimited.status).toBe(429);
    expect(await accountLimited.json()).toMatchObject({ error: "Account rate limit exceeded" });
  });

  it("creates yes/no prompts with the matching choices and push kind", async () => {
    sent.length = 0;
    const response = await createInteraction({
      title: "SHark",
      prompt: "Keep the current color?",
      kind: "yes_no",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { interaction: Record<string, unknown> };
    expect(body.interaction).toMatchObject({ kind: "yes_no", choices: ["yes", "no"] });
    expect(sent[0]).toMatchObject({ data: { interactionKind: "yes_no" } });
  });

  it("replays idempotent requests without a second push and rejects changed payloads", async () => {
    sent.length = 0;
    const payload = { body: "Deploy finished", title: "Deploy bot" };
    const first = await createNotification(payload, "notify-1");
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { notification: { id: string } };
    expect(sent).toHaveLength(2);

    const replay = await createNotification(payload, "notify-1");
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      idempotent: true,
      accepted: 2,
      notification: { id: firstBody.notification.id },
    });
    expect(sent).toHaveLength(2);

    const conflict = await createNotification({ ...payload, body: "Different" }, "notify-1");
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: "Idempotency-Key was already used with a different payload",
    });
  });

  it("reports accepted 0 with a message and skips usage tracking when providers reject", async () => {
    billingState.acceptPush = false;
    const response = await createNotification({ body: "Rejected" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      accepted: 0,
      message: "No notification provider accepted the request.",
    });
    expect(tracked).toHaveLength(0);
  });
});
