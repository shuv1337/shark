import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.APP_URL = "https://shark.example.com";
process.env.VAPID_PUBLIC_KEY = "public-key";
process.env.VAPID_PRIVATE_KEY = "private-key";
process.env.VAPID_SUBJECT = "mailto:operator@example.com";

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () => ({
        user: { id: "web_user", name: "Web User", email: "web@example.com", image: null },
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

const sendState = vi.hoisted(() => ({ stale: false }));
vi.mock("../lib/web-push", () => ({
  sendWebPushNotifications: async (rows: Array<{ id: string }>) => ({
    accepted: sendState.stale ? 0 : rows.length,
    errors: sendState.stale ? ["gone"] : [],
    staleSubscriptionIds: sendState.stale ? rows.map((row) => row.id) : [],
  }),
}));

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let decryptWebPushSubscription: typeof import("../lib/token")["decryptWebPushSubscription"];

const subscription = {
  endpoint: "https://push.example.com/send/secret-endpoint",
  expirationTime: null,
  keys: { p256dh: "public-browser-key", auth: "browser-auth-secret" },
};

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ decryptWebPushSubscription } = await import("../lib/token"));
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values([
    {
      id: "web_user",
      name: "Web User",
      email: "web@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "other_user",
      name: "Other User",
      email: "other@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
});

beforeEach(async () => {
  sendState.stale = false;
  await db.delete(schema.webPushSubscription);
});

function request(path: string, method: "POST" | "DELETE", body: unknown, origin?: string) {
  return app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("browser push subscriptions", () => {
  it("requires the configured same origin for subscription mutations", async () => {
    for (const origin of [undefined, "https://attacker.example.com"]) {
      const response = await request(
        "/api/web-push/subscriptions",
        "POST",
        { subscription },
        origin,
      );
      expect(response.status).toBe(403);
    }
  });

  it("registers encrypted subscription material and exposes a unified web device", async () => {
    const response = await request(
      "/api/web-push/subscriptions",
      "POST",
      { subscription, deviceName: "Linux Firefox" },
      "https://shark.example.com",
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { subscription: { id: string } };
    expect(body.subscription.id).toMatch(/^web_/);

    const [stored] = await db.select().from(schema.webPushSubscription);
    expect(stored?.subscriptionCiphertext).not.toContain("secret-endpoint");
    expect(stored?.subscriptionCiphertext).not.toContain("browser-auth-secret");
    expect(JSON.parse(decryptWebPushSubscription(stored?.subscriptionCiphertext ?? ""))).toEqual(
      subscription,
    );

    const devices = await app.request("/api/devices");
    expect(await devices.json()).toMatchObject({
      devices: [
        {
          id: body.subscription.id,
          platform: "web",
          deviceName: "Linux Firefox",
          active: true,
          liveActivitiesCapable: false,
        },
      ],
    });
  });

  it("does not transfer a subscription endpoint owned by another account", async () => {
    const now = new Date();
    const { encryptWebPushSubscription, hashWebPushEndpoint } = await import("../lib/token");
    await db.insert(schema.webPushSubscription).values({
      id: "web_other",
      userId: "other_user",
      endpointHash: hashWebPushEndpoint(subscription.endpoint),
      subscriptionCiphertext: encryptWebPushSubscription(JSON.stringify(subscription)),
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });
    const response = await request(
      "/api/web-push/subscriptions",
      "POST",
      { subscription },
      "https://shark.example.com",
    );
    expect(response.status).toBe(409);
    const [stored] = await db
      .select()
      .from(schema.webPushSubscription)
      .where(eq(schema.webPushSubscription.id, "web_other"));
    expect(stored?.userId).toBe("other_user");
  });

  it("marks a subscription inactive when its push service reports it stale", async () => {
    await request(
      "/api/web-push/subscriptions",
      "POST",
      { subscription },
      "https://shark.example.com",
    );
    sendState.stale = true;
    const response = await request(
      "/api/web-push/test",
      "POST",
      { endpoint: subscription.endpoint },
      "https://shark.example.com",
    );
    expect(response.status).toBe(502);
    const [stored] = await db.select().from(schema.webPushSubscription);
    expect(stored?.active).toBe(false);
  });
});
