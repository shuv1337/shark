import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.BETTER_AUTH_SECRET = "test-secret-at-least-sixteen-characters";
process.env.APPLE_TEAM_ID = "TEAM";
process.env.APPLE_SIGN_IN_KEY_ID = "KEY";
process.env.APPLE_SIGN_IN_PRIVATE_KEY =
  "-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----";

vi.mock("../lib/apple", async (importActual) => {
  const actual = await importActual<typeof import("../lib/apple")>();
  return {
    ...actual,
    appleAuthConfig: () => ({ teamId: "TEAM", keyId: "KEY", privateKey: "test" }),
    verifyAppleIdentityToken: async () => "apple_subject",
    exchangeAppleAuthorizationCode: async () => ({
      refreshToken: "apple-refresh",
      identityToken: "apple-identity",
    }),
  };
});

vi.mock("../lib/interaction-callbacks", () => ({
  deliverInteractionCallbacks: vi.fn(async () => undefined),
}));

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let watchToken = "";

const DIGEST = "a".repeat(64);

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();

  const now = new Date();
  await db.insert(schema.user).values({
    id: "watch_user",
    name: "Watch User",
    email: "watch@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.account).values({
    id: "watch_apple_account",
    accountId: "apple_subject",
    providerId: "apple",
    userId: "watch_user",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.apiToken).values({
    id: "watch_requester",
    userId: "watch_user",
    name: "Watch requester",
    tokenHash: "watch-requester-hash",
    prefix: "hark_watch",
    scopes: ["interactions:create", "activities:write"],
    createdAt: now,
  });

  const response = await app.request("/api/watch/auth/apple", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identityToken: "identity-token",
      authorizationCode: "authorization-code",
      deviceName: "Test Watch",
    }),
  });
  expect(response.status).toBe(200);
  watchToken = ((await response.json()) as { token: string }).token;
});

function watch(path: string, init?: RequestInit) {
  return app.request(`/api/watch${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${watchToken}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

async function insertApproval(id: string, kind: "approval" | "yes_no" = "approval") {
  const now = new Date();
  await db.insert(schema.interaction).values({
    id,
    userId: "watch_user",
    requesterTokenId: "watch_requester",
    title: "Deploy production",
    prompt: "Ship the reviewed build now?",
    kind,
    presentation: "notification",
    choices: kind === "approval" ? ["approve", "deny"] : ["yes", "no"],
    actionDigest: DIGEST,
    expiresAt: new Date(now.getTime() + 15 * 60_000),
    createdAt: now,
  });
}

describe("watchOS companion API", () => {
  it("returns bounded active work and privacy-redacted activity data", async () => {
    const now = new Date();
    await db.insert(schema.liveActivity).values({
      id: "la_watch_private",
      userId: "watch_user",
      requesterTokenId: "watch_requester",
      schemaVersion: 1,
      props: {
        schemaVersion: 1,
        activityId: "la_watch_private",
        title: "Secret deploy",
        status: "Running migration",
        detail: "Customer database",
        progress: 0.5,
        updatedAt: now.toISOString(),
        symbol: "build",
        privacyMode: "private",
      },
      status: "active",
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      staleAt: new Date(now.getTime() - 1_000),
      createdAt: now,
      updatedAt: now,
    });
    await insertApproval("int_watch_snapshot");

    const response = await watch("/snapshot");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      activities: Array<Record<string, unknown>>;
      approvals: Array<Record<string, unknown>>;
    };
    expect(body.activities).toContainEqual(
      expect.objectContaining({
        id: "la_watch_private",
        title: "Agent task",
        status: "In progress",
        detail: null,
        isPrivate: true,
        isStale: true,
      }),
    );
    expect(body.approvals).toContainEqual(
      expect.objectContaining({
        id: "int_watch_snapshot",
        primaryLabel: "Approve",
        secondaryLabel: "Deny",
      }),
    );
  });

  it("accepts one response and makes a retry explicitly idempotent", async () => {
    await insertApproval("int_watch_idempotent", "yes_no");
    const input = { action: "yes", actionDigest: DIGEST, requestId: "request-1" };

    const accepted = await watch("/interactions/int_watch_idempotent/respond", {
      method: "POST",
      body: JSON.stringify(input),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      ok: true,
      duplicate: false,
      status: "yes",
    });

    const replay = await watch("/interactions/int_watch_idempotent/respond", {
      method: "POST",
      body: JSON.stringify(input),
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, duplicate: true, status: "yes" });

    const [stored] = await db
      .select()
      .from(schema.interaction)
      .where(eq(schema.interaction.id, "int_watch_idempotent"));
    expect(stored?.status).toBe("yes");
    expect(stored?.response).toBe("yes");
  });

  it("reports a racing iPhone response as handled elsewhere", async () => {
    await insertApproval("int_watch_race");
    await db
      .update(schema.interaction)
      .set({
        status: "denied",
        response: "deny",
        respondedAt: new Date(),
      })
      .where(eq(schema.interaction.id, "int_watch_race"));

    const response = await watch("/interactions/int_watch_race/respond", {
      method: "POST",
      body: JSON.stringify({
        action: "approve",
        actionDigest: DIGEST,
        requestId: "request-race",
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      duplicate: false,
      status: "denied",
      error: "Interaction was already handled",
    });
  });
});
