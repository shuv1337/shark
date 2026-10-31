import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () => ({
        user: {
          id: "welcome_user",
          name: "Welcome User",
          email: "welcome@example.com",
          image: null,
        },
      }),
    },
  },
}));

vi.mock("../lib/billing", () => ({
  getBilling: async () => ({
    configured: true,
    plan: "pro",
    priceMonthly: 8,
    features: { deviceRouting: true },
    limits: {
      devices: null,
      notificationsPerMonth: 100_000,
      servicePerMinute: 300,
      accountPerMinute: 1500,
    },
    usage: { notificationsRemaining: 100_000 },
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
      sent.push(...chunk);
      return chunk.map(() => ({ status: "ok", id: "ticket" }));
    }
  }
  return { Expo, default: Expo };
});

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values({
    id: "welcome_user",
    name: "Welcome User",
    email: "welcome@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
});

beforeEach(async () => {
  vi.useFakeTimers();
  sent.length = 0;
  await db.delete(schema.device);
  await db
    .update(schema.user)
    .set({ welcomeNotificationSentAt: null })
    .where(eq(schema.user.id, "welcome_user"));
});

afterEach(() => {
  vi.useRealTimers();
});

async function register(expoPushToken: string, extra: Record<string, unknown> = {}) {
  return app.request("/api/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expoPushToken, platform: "ios", deviceName: "iPhone", ...extra }),
  });
}

describe("POST /api/devices onboarding", () => {
  it("sends the welcome once for the account's first registered phone", async () => {
    const firstRequest = register("ExponentPushToken[welcome-a]");
    await vi.advanceTimersByTimeAsync(4_000);
    const first = await firstRequest;
    expect(first.status).toBe(201);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[welcome-a]",
      title: "SHark",
      body: "SHark is ready to receive your private webhooks.",
      data: {
        sourceName: "SHark",
        url: "https://shark.shuv.dev",
      },
    });

    const refresh = await register("ExponentPushToken[welcome-a]");
    const secondPhone = await register("ExponentPushToken[welcome-b]");
    expect(refresh.status).toBe(201);
    expect(secondPhone.status).toBe(201);
    expect(sent).toHaveLength(1);

    const [account] = await db.select().from(schema.user);
    expect(account?.welcomeNotificationSentAt).toBeInstanceOf(Date);
  });

  it("moves a phone to another account only with the stored APNs token", async () => {
    const now = new Date();
    await db.insert(schema.user).values({
      id: "other_user",
      name: "Other",
      email: "other@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.device).values({
      id: "dev_taken",
      userId: "other_user",
      expoPushToken: "ExponentPushToken[taken]",
      apnsToken: "apns-held",
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
    });

    const stale = await register("ExponentPushToken[taken]");
    expect(stale.status).toBe(409);
    const wrong = await register("ExponentPushToken[taken]", { apnsToken: "apns-other" });
    expect(wrong.status).toBe(409);
    const proved = await register("ExponentPushToken[taken]", { apnsToken: "apns-held" });
    expect(proved.status).toBe(201);
    const [row] = await db
      .select()
      .from(schema.device)
      .where(eq(schema.device.expoPushToken, "ExponentPushToken[taken]"));
    expect(row?.userId).toBe("welcome_user");
  });

  it("claims an APNs-less row only after Expo reports it unregistered", async () => {
    const now = new Date();
    await db
      .insert(schema.user)
      .values({
        id: "other_user",
        name: "Other",
        email: "other@example.com",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    await db.insert(schema.device).values({
      id: "dev_plain",
      userId: "other_user",
      expoPushToken: "ExponentPushToken[plain]",
      apnsToken: null,
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });
    expect((await register("ExponentPushToken[plain]")).status).toBe(409);
    await db.update(schema.device).set({ active: false }).where(eq(schema.device.id, "dev_plain"));
    expect((await register("ExponentPushToken[plain]")).status).toBe(201);
  });

  it("rejects a cross-site device registration", async () => {
    const response = await app.request("/api/devices", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({
        expoPushToken: "ExponentPushToken[csrf]",
        platform: "ios",
      }),
    });
    expect(response.status).toBe(403);
  });
});
