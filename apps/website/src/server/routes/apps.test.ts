import { eq } from "drizzle-orm";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.APP_URL = "https://shark.example";

const authState = vi.hoisted(() => ({ userId: "user_1" as string | null }));
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../lib/billing", () => ({
  getBilling: async () => ({
    configured: true,
    plan: "pro",
    priceMonthly: 8,
    features: { deviceRouting: true },
    limits: {
      devices: null,
      notificationsPerMonth: 100_000,
      servicePerMinute: 10_000,
      accountPerMinute: 10_000,
    },
    usage: { notificationsRemaining: 100 },
  }),
  checkNotificationAllowance: async () => true,
  trackNotification: async () => undefined,
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
                name: authState.userId === "user_1" ? "Cap" : "Other",
                email: authState.userId === "user_1" ? "test@example.com" : "other@example.com",
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
      return messages.map(() => ({ status: "ok", id: "ticket" }));
    }
  }
  return { Expo, default: Expo };
});

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");

const SECRET = `hark_${"a".repeat(43)}`;
const READ_SECRET = `hark_${"r".repeat(43)}`;
const OTHER_SECRET = `hark_${"o".repeat(43)}`;
const WEBHOOK_TOKEN = `whk_${"h".repeat(40)}`;

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  const { hashApiToken, hashWebhookToken } = await import("../lib/token");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();

  const now = new Date();
  await db.insert(schema.user).values([
    {
      id: "user_1",
      name: "Cap",
      email: "test@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "user_2",
      name: "Other",
      email: "other@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.device).values({
    id: "dev_1",
    userId: "user_1",
    expoPushToken: "ExponentPushToken[a]",
    platform: "ios",
    active: true,
    createdAt: now,
    lastSeenAt: now,
  });
  await db.insert(schema.apiToken).values([
    {
      id: "tok_apps",
      userId: "user_1",
      name: "Firstmate (box)",
      tokenHash: hashApiToken(SECRET),
      prefix: SECRET.slice(0, 13),
      scopes: ["apps:read", "apps:write", "notifications:send"],
      createdAt: now,
    },
    {
      id: "tok_read",
      userId: "user_1",
      name: "Reader",
      tokenHash: hashApiToken(READ_SECRET),
      prefix: READ_SECRET.slice(0, 13),
      scopes: ["apps:read"],
      createdAt: now,
    },
    {
      id: "tok_other",
      userId: "user_2",
      name: "Other agent",
      tokenHash: hashApiToken(OTHER_SECRET),
      prefix: OTHER_SECRET.slice(0, 13),
      scopes: ["apps:read", "apps:write", "notifications:send"],
      createdAt: now,
    },
  ]);
  await db.insert(schema.service).values({
    id: "svc_1",
    userId: "user_1",
    title: "Deploys",
    tokenHash: hashWebhookToken(WEBHOOK_TOKEN),
    url: "https://elsewhere.example/default",
    createdAt: now,
    updatedAt: now,
  });
});

afterEach(async () => {
  authState.userId = "user_1";
  sent.length = 0;
  await db.delete(schema.inboxItem);
  await db.delete(schema.agentNotification);
  await db.delete(schema.event);
  await db.delete(schema.app);
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

function session(path: string, init?: RequestInit) {
  return app.request(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

async function createApp(url = "https://board.example/board", name = "Sharkboard") {
  const response = await agent("/apps", SECRET, {
    method: "POST",
    body: JSON.stringify({ name, url }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { app: { id: string; origin: string } };
}

describe("agent app registration", () => {
  it("creates, upserts by URL, lists, and removes the caller's apps", async () => {
    const created = await createApp();
    expect(created.app.origin).toBe("https://board.example");

    const updated = await agent("/apps", SECRET, {
      method: "POST",
      body: JSON.stringify({ name: "Board v2", url: "https://board.example/board" }),
    });
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as {
      app: { id: string; name: string };
      created: boolean;
    };
    expect(updatedBody.created).toBe(false);
    expect(updatedBody.app.id).toBe(created.app.id);
    expect(updatedBody.app.name).toBe("Board v2");

    const list = await agent("/apps");
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { apps: Array<{ id: string; createdBy: string }> };
    expect(listBody.apps.map((item) => item.id)).toEqual([created.app.id]);
    expect(listBody.apps[0]?.createdBy).toBe("Firstmate (box)");

    const otherList = await agent("/apps", OTHER_SECRET);
    expect(((await otherList.json()) as { apps: unknown[] }).apps).toEqual([]);

    const forbidden = await agent("/apps", READ_SECRET, {
      method: "POST",
      body: JSON.stringify({ name: "Nope", url: "https://board.example/x" }),
    });
    expect(forbidden.status).toBe(403);

    const removedByOther = await agent(`/apps/${created.app.id}`, OTHER_SECRET, {
      method: "DELETE",
    });
    expect(removedByOther.status).toBe(404);
    const removed = await agent(`/apps/${created.app.id}`, SECRET, { method: "DELETE" });
    expect(removed.status).toBe(200);
  });

  it("rejects non-HTTPS launch URLs", async () => {
    const response = await agent("/apps", SECRET, {
      method: "POST",
      body: JSON.stringify({ name: "Plain", url: "http://board.example/" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("session passes", () => {
  it("requires consent, then issues a verifiable pass with a pairwise subject", async () => {
    const { app: created } = await createApp();

    const refused = await session(`/api/apps/${created.id}/pass`, { method: "POST" });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { code: string }).code).toBe("consent_required");

    const issued = await session(`/api/apps/${created.id}/pass`, {
      method: "POST",
      body: JSON.stringify({ consent: true, shareName: true, shareEmail: false }),
    });
    expect(issued.status).toBe(200);
    const pass = (await issued.json()) as {
      token: string;
      expiresAt: string;
      app: { consentedAt: string | null };
    };
    expect(pass.app.consentedAt).not.toBeNull();

    const jwksResponse = await app.request("/.well-known/jwks.json");
    expect(jwksResponse.status).toBe(200);
    expect(jwksResponse.headers.get("access-control-allow-origin")).toBe("*");
    const jwks = (await jwksResponse.json()) as { keys: Array<{ kid: string }> };
    expect(jwks.keys).toHaveLength(1);

    const header = decodeProtectedHeader(pass.token);
    expect(header.typ).toBe("hark-pass+jwt");
    expect(header.kid).toBe(jwks.keys[0]?.kid);
    const verified = await jwtVerify(pass.token, createLocalJWKSet(jwks as never), {
      issuer: "https://shark.example",
      audience: "https://board.example",
      typ: "hark-pass+jwt",
    });
    expect(verified.payload.app_id).toBe(created.id);
    expect(verified.payload.name).toBe("Cap");
    expect(verified.payload.email).toBeUndefined();
    const subject = verified.payload.sub as string;
    expect(subject.startsWith("hk_")).toBe(true);
    expect(Number(verified.payload.exp) - Number(verified.payload.iat)).toBe(120);

    // A second app on a different origin gets a different pairwise subject.
    const { app: second } = await createApp("https://other.example/", "Other");
    const secondPass = await session(`/api/apps/${second.id}/pass`, {
      method: "POST",
      body: JSON.stringify({ consent: true }),
    });
    const secondToken = ((await secondPass.json()) as { token: string }).token;
    const secondVerified = await jwtVerify(secondToken, createLocalJWKSet(jwks as never), {
      audience: "https://other.example",
    });
    expect(secondVerified.payload.sub).not.toBe(subject);

    // Revoke clears consent; the next pass needs it again.
    const revoked = await session(`/api/apps/${created.id}/revoke`, { method: "POST" });
    expect(revoked.status).toBe(200);
    const again = await session(`/api/apps/${created.id}/pass`, { method: "POST" });
    expect(again.status).toBe(409);
  });

  it("scopes session reads and sharing updates to the owner", async () => {
    const { app: created } = await createApp();
    const mine = await session(`/api/apps/${created.id}`);
    expect(mine.status).toBe(200);

    const patched = await session(`/api/apps/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ shareEmail: true }),
    });
    expect(((await patched.json()) as { app: { shareEmail: boolean } }).app.shareEmail).toBe(true);

    authState.userId = "user_2";
    const theirs = await session(`/api/apps/${created.id}`);
    expect(theirs.status).toBe(404);
    const theirPass = await session(`/api/apps/${created.id}/pass`, {
      method: "POST",
      body: JSON.stringify({ consent: true }),
    });
    expect(theirPass.status).toBe(404);

    authState.userId = null;
    const anonymous = await session("/api/apps");
    expect(anonymous.status).toBe(401);
  });
});

describe("app notifications", () => {
  it("accepts an agent notification for the caller's app and carries appId in push data", async () => {
    const { app: created } = await createApp();
    const response = await agent("/notifications", SECRET, {
      method: "POST",
      body: JSON.stringify({
        body: "Two asks waiting",
        title: "Board",
        appId: created.id,
        url: "https://board.example/board/ask/1",
      }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { notification: { appId?: string } };
    expect(body.notification.appId).toBe(created.id);
    expect(sent[0]?.data).toMatchObject({
      appId: created.id,
      url: "https://board.example/board/ask/1",
    });

    const [row] = await db
      .select({ appId: schema.agentNotification.appId })
      .from(schema.agentNotification);
    expect(row?.appId).toBe(created.id);

    const inbox = await session("/api/inbox?filter=all");
    const page = (await inbox.json()) as { items: Array<{ app: { id: string } | null }> };
    expect(page.items[0]?.app?.id).toBe(created.id);
  });

  it("rejects another account's app and off-origin URLs", async () => {
    const { app: created } = await createApp();
    const foreign = await agent("/notifications", OTHER_SECRET, {
      method: "POST",
      body: JSON.stringify({ body: "x", appId: created.id }),
    });
    expect(foreign.status).toBe(400);
    const offOrigin = await agent("/notifications", SECRET, {
      method: "POST",
      body: JSON.stringify({ body: "x", appId: created.id, url: "https://evil.example/" }),
    });
    expect(offOrigin.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("opens the app from a webhook without applying the service default URL", async () => {
    const { app: created } = await createApp();
    const response = await app.request(`/hooks/${WEBHOOK_TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Build finished", appId: created.id }),
    });
    expect(response.status).toBe(200);
    const pushData = sent[0]?.data as { appId?: string; url?: string } | undefined;
    expect(pushData?.appId).toBe(created.id);
    expect(pushData?.url).toBeUndefined();
    const [row] = await db
      .select({ appId: schema.event.appId, url: schema.event.url })
      .from(schema.event);
    expect(row).toEqual({ appId: created.id, url: null });

    const combined = await app.request(`/hooks/${WEBHOOK_TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Approve?", appId: created.id, response: { type: "approval" } }),
    });
    expect(combined.status).toBe(400);
  });

  it("keeps notifications when the app is deleted", async () => {
    const { app: created } = await createApp();
    await agent("/notifications", SECRET, {
      method: "POST",
      body: JSON.stringify({ body: "x", appId: created.id }),
    });
    const removed = await agent(`/apps/${created.id}`, SECRET, { method: "DELETE" });
    expect(removed.status).toBe(200);
    const [row] = await db
      .select({ appId: schema.agentNotification.appId })
      .from(schema.agentNotification)
      .where(eq(schema.agentNotification.userId, "user_1"));
    expect(row?.appId).toBeNull();
  });
});
