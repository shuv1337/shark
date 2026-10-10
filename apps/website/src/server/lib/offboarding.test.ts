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

  it("deletes the user's unexchanged OAuth authorization codes and nothing else", async () => {
    const now = new Date();
    for (const id of ["usr_offboard", "usr_other"]) {
      await db.insert(schema.user).values({
        id,
        name: id,
        email: `${id}@example.com`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    // Shaped like @better-auth/oauth-provider's redirectWithAuthorizationCode rows.
    const code = (id: string, userId: string, expiresAt: Date) => ({
      id,
      identifier: `synthetic-code-hash-${id}`,
      value: JSON.stringify({
        type: "authorization_code",
        query: {
          client_id: "synthetic-client",
          redirect_uri: "http://127.0.0.1:33418/callback",
          scope: "notifications:send offline_access",
        },
        userId,
        sessionId: `session_${userId}`,
      }),
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.verification).values([
      code("ver_pending", "usr_offboard", new Date(now.getTime() + 600_000)),
      code("ver_expired", "usr_offboard", new Date(now.getTime() - 1000)),
      code("ver_other_user", "usr_other", new Date(now.getTime() + 600_000)),
      {
        id: "ver_not_json",
        identifier: "synthetic-state",
        value: "opaque-state-value",
        expiresAt: new Date(now.getTime() + 600_000),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "ver_other_kind",
        identifier: "synthetic-other",
        value: JSON.stringify({ type: "something_else", userId: "usr_offboard" }),
        expiresAt: new Date(now.getTime() + 600_000),
        createdAt: now,
        updatedAt: now,
      },
    ]);

    expect(offboardPersistedAccess("usr_offboard")).toMatchObject({ authorizationCodes: 2 });
    const remaining = (await db.select({ id: schema.verification.id }).from(schema.verification))
      .map((row) => row.id)
      .sort();
    expect(remaining).toEqual(["ver_not_json", "ver_other_kind", "ver_other_user"]);
    await db.delete(schema.verification);
  });
});
