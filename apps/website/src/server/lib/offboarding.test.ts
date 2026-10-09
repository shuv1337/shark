import { beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let offboardPersistedAccess: typeof import("./offboarding")["offboardPersistedAccess"];

beforeAll(async () => {
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ offboardPersistedAccess } = await import("./offboarding"));
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
});

beforeEach(async () => {
  await db.delete(schema.user);
});

describe("operator offboarding", () => {
  it("revokes every stored credential class without deleting account data", async () => {
    const now = new Date();
    await db.insert(schema.user).values({
      id: "usr_offboard",
      name: "Operator",
      email: "operator@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.session).values({
      id: "session_offboard",
      token: "session-secret",
      userId: "usr_offboard",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.account).values({
      id: "account_offboard",
      accountId: "apple-subject",
      providerId: "apple",
      userId: "usr_offboard",
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      idToken: "id-secret",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.apiToken).values({
      id: "token_offboard",
      userId: "usr_offboard",
      name: "CLI",
      tokenHash: "token-hash",
      prefix: "hark_off",
      scopes: ["notifications:send"],
      createdAt: now,
    });
    await db.insert(schema.deviceAuthorizationRequest).values({
      id: "device_auth_offboard",
      deviceCodeHash: "device-code-hash",
      userCode: "SHARK123",
      clientName: "CLI",
      requestedScopes: ["notifications:send"],
      status: "approved",
      approvedUserId: "usr_offboard",
      expiresAt: new Date(now.getTime() + 60_000),
      tokenExpiresAt: new Date(now.getTime() + 120_000),
      pollIntervalSeconds: 5,
      createdAt: now,
    });
    await db.insert(schema.service).values({
      id: "service_offboard",
      userId: "usr_offboard",
      title: "Deploy",
      tokenHash: "webhook-hash",
      tokenCiphertext: "webhook-ciphertext",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.device).values({
      id: "device_offboard",
      userId: "usr_offboard",
      expoPushToken: "ExponentPushToken[offboard]",
      apnsToken: "apns-token",
      active: true,
      liveActivityPushToStartTokenCiphertext: "live-token",
      createdAt: now,
      lastSeenAt: now,
    });
    await db
      .insert(schema.team)
      .values({ id: "team_offboard", name: "Ops", createdAt: now, updatedAt: now });
    await db.insert(schema.oncallGroup).values({
      id: "ocg_offboard",
      teamId: "team_offboard",
      name: "Primary",
      memberIds: ["usr_offboard"],
      period: "daily",
      handoffAt: "09:00",
      timezone: "UTC",
      startsAt: now,
      escalation: [],
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.oncallPage).values({
      id: "page_offboard",
      groupId: "ocg_offboard",
      teamId: "team_offboard",
      title: "Synthetic page",
      status: "triggered",
      sourceName: "Test",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.oncallPageRecipient).values({
      pageId: "page_offboard",
      userId: "usr_offboard",
      step: 0,
      responseTokenHash: "page-credential-hash",
      notifiedAt: now,
    });

    expect(offboardPersistedAccess("usr_offboard")).toMatchObject({
      sessions: 1,
      apiTokens: 1,
      devices: 1,
      services: 1,
      pageCredentials: 1,
    });
    const [recipient] = await db.select().from(schema.oncallPageRecipient);
    expect(recipient?.responseTokenHash).not.toBe("page-credential-hash");
    expect(recipient?.responseTokenHash).toMatch(/^offboarded_/);

    expect(await db.select().from(schema.user)).toHaveLength(1);
    expect(await db.select().from(schema.session)).toHaveLength(0);
    expect(await db.select().from(schema.deviceAuthorizationRequest)).toEqual([
      expect.objectContaining({
        status: "denied",
        approvedUserId: null,
      }),
    ]);
    expect((await db.select().from(schema.apiToken))[0]?.revokedAt).toBeInstanceOf(Date);
    expect(await db.select().from(schema.device)).toEqual([
      expect.objectContaining({
        active: false,
        apnsToken: null,
        liveActivityPushToStartTokenCiphertext: null,
      }),
    ]);
    expect((await db.select().from(schema.device))[0]?.expoPushToken).not.toContain(
      "ExponentPushToken",
    );
    expect(await db.select().from(schema.service)).toEqual([
      expect.objectContaining({ tokenCiphertext: null }),
    ]);
    expect((await db.select().from(schema.service))[0]?.tokenHash).not.toBe("webhook-hash");
    expect(await db.select().from(schema.account)).toEqual([
      expect.objectContaining({
        accessToken: null,
        refreshToken: null,
        idToken: null,
      }),
    ]);
  });
});
