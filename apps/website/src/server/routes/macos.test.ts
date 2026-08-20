import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.BETTER_AUTH_SECRET = "m".repeat(32);
process.env.ALLOWED_EMAILS = "mac@example.com,other@example.com";

vi.mock("../auth", () => ({
  auth: { handler: () => new Response("not used"), api: { getSession: async () => null } },
}));

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let hashApiToken: typeof import("../lib/token")["hashApiToken"];
const accessToken = `hark_${"a".repeat(43)}`;

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ hashApiToken } = await import("../lib/token"));
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
});

beforeEach(async () => {
  await db.delete(schema.inboxItem);
  await db.delete(schema.interaction);
  await db.delete(schema.macosDevice);
  await db.delete(schema.apiToken);
  await db.delete(schema.user);
  const now = new Date();
  await db.insert(schema.user).values([
    {
      id: "mac_user",
      name: "Mac User",
      email: "mac@example.com",
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
  await db.insert(schema.apiToken).values({
    id: "tok_mac",
    userId: "mac_user",
    name: "SHark for Mac",
    tokenHash: hashApiToken(accessToken),
    prefix: accessToken.slice(0, 13),
    scopes: ["macos:read", "macos:respond", "macos:register"],
    createdAt: now,
  });
});

function request(path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

describe("macOS companion", () => {
  it("registers an encrypted APNs device idempotently", async () => {
    const body = {
      apnsToken: "ab".repeat(32),
      environment: "sandbox",
      deviceName: "Shuvbot",
      privacyMode: "standard",
    };
    const created = await request("/api/macos/devices", {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      device: { platform: "macos", deviceName: "Shuvbot", active: true },
    });

    const replay = await request("/api/macos/devices", {
      method: "POST",
      body: JSON.stringify({ ...body, deviceName: "Studio" }),
    });
    expect(replay.status).toBe(200);
    const rows = await db.select().from(schema.macosDevice);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deviceName).toBe("Studio");
    expect(rows[0]?.apnsTokenCiphertext).not.toContain(body.apnsToken);
  });

  it("returns the durable inbox and resolves an action once", async () => {
    const now = new Date();
    await db.insert(schema.interaction).values({
      id: "int_mac",
      userId: "mac_user",
      requesterTokenId: "tok_mac",
      title: "Deploy",
      prompt: "Ship it?",
      kind: "approval",
      status: "pending",
      choices: ["approve", "deny"],
      actionDigest: "c".repeat(64),
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
    });

    const snapshot = await request("/api/macos/snapshot");
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({
      unresolvedCount: 1,
      items: [
        {
          title: "Deploy",
          needsAction: true,
          action: { interactionId: "int_mac", kind: "approval" },
        },
      ],
    });

    const respond = () =>
      request("/api/macos/interactions/int_mac/respond", {
        method: "POST",
        body: JSON.stringify({ action: "approve", actionDigest: "c".repeat(64) }),
      });
    expect((await respond()).status).toBe(200);
    const duplicate = await respond();
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: "Interaction is already terminal" });
  });
});
