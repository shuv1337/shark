import { beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let oauth: typeof import("./oauth");

const DAY = 86_400_000;

beforeAll(async () => {
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  oauth = await import("./oauth");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
});

function client(clientId: string, createdAt: Date, userId: string | null = null) {
  return {
    id: `oc_${clientId}`,
    clientId,
    name: clientId,
    userId,
    redirectUris: JSON.stringify(["http://127.0.0.1:33418/callback"]),
    public: true,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("OAuth storage sweep", () => {
  it("deletes expired tokens and stale anonymous clients that were never connected", async () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const old = new Date(now.getTime() - 2 * DAY);
    const recent = new Date(now.getTime() - 60_000);
    await db.insert(schema.user).values({
      id: "user_sweep",
      name: "Sweep",
      email: "user_sweep@example.com",
      emailVerified: true,
      createdAt: old,
      updatedAt: old,
    });
    await db
      .insert(schema.oauthClient)
      .values([
        client("abandoned", old),
        client("fresh", recent),
        client("owned", old, "user_sweep"),
        client("consented", old),
        client("refreshing", old),
        client("granted", old),
      ]);
    await db.insert(schema.oauthConsent).values({
      id: "consent_sweep",
      clientId: "consented",
      userId: "user_sweep",
      scopes: "[]",
      createdAt: old,
      updatedAt: old,
    });
    await db.insert(schema.oauthRefreshToken).values([
      {
        id: "rt_live",
        token: "synthetic-live-refresh-hash",
        clientId: "refreshing",
        userId: "user_sweep",
        scopes: "[]",
        createdAt: old,
        expiresAt: new Date(now.getTime() + DAY),
      },
      {
        id: "rt_revoked_live",
        token: "synthetic-revoked-refresh-hash",
        clientId: "refreshing",
        userId: "user_sweep",
        scopes: "[]",
        createdAt: old,
        revoked: old,
        expiresAt: new Date(now.getTime() + DAY),
      },
      {
        id: "rt_expired",
        token: "synthetic-expired-refresh-hash",
        clientId: "consented",
        userId: "user_sweep",
        scopes: "[]",
        createdAt: old,
        expiresAt: new Date(now.getTime() - 1000),
      },
    ]);
    await db.insert(schema.oauthAccessToken).values([
      {
        id: "at_expired",
        token: "synthetic-expired-access-hash",
        clientId: "refreshing",
        userId: "user_sweep",
        scopes: "[]",
        createdAt: old,
        expiresAt: new Date(now.getTime() - 1000),
      },
      {
        id: "at_live",
        token: "synthetic-live-access-hash",
        clientId: "refreshing",
        userId: "user_sweep",
        scopes: "[]",
        createdAt: recent,
        expiresAt: new Date(now.getTime() + 3_600_000),
      },
    ]);
    await db.insert(schema.apiToken).values({
      id: "tok_granted",
      userId: "user_sweep",
      name: "granted",
      tokenHash: "oauth:synthetic-grant",
      prefix: "oauth",
      scopes: [],
      createdAt: old,
      revokedAt: old,
      oauthClientId: "granted",
    });

    expect(oauth.sweepOAuthStorage(now)).toEqual({
      accessTokens: 1,
      refreshTokens: 1,
      clients: 1,
    });
    const clients = (await db.select({ id: schema.oauthClient.clientId }).from(schema.oauthClient))
      .map((row) => row.id)
      .sort();
    expect(clients).toEqual(["consented", "fresh", "granted", "owned", "refreshing"]);
    expect(
      (await db.select({ id: schema.oauthAccessToken.id }).from(schema.oauthAccessToken)).map(
        (row) => row.id,
      ),
    ).toEqual(["at_live"]);
    expect(
      (await db.select({ id: schema.oauthRefreshToken.id }).from(schema.oauthRefreshToken))
        .map((row) => row.id)
        .sort(),
    ).toEqual(["rt_live", "rt_revoked_live"]);
    expect(oauth.sweepOAuthStorage(now)).toEqual({ accessTokens: 0, refreshTokens: 0, clients: 0 });
  });
});

describe("OAuth grant listing", () => {
  it("lists only clients with live grants, from live tokens' scopes", async () => {
    const now = new Date();
    const later = new Date(now.getTime() + DAY);
    const earlier = new Date(now.getTime() - 1000);
    await db.insert(schema.user).values({
      id: "user_list",
      name: "List",
      email: "user_list@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.oauthClient).values([client("live", now), client("stale", now)]);
    const refresh = (id: string, clientId: string, scopes: string[], extra: object) => ({
      id,
      token: `synthetic-${id}-hash`,
      clientId,
      userId: "user_list",
      scopes: JSON.stringify(scopes),
      createdAt: now,
      ...extra,
    });
    await db
      .insert(schema.oauthRefreshToken)
      .values([
        refresh("rt_list_live", "live", ["offline_access"], { expiresAt: later }),
        refresh("rt_list_revoked", "live", ["oncall:write"], { expiresAt: later, revoked: now }),
        refresh("rt_list_expired", "stale", ["teams:write"], { expiresAt: earlier }),
        refresh("rt_list_unbounded", "stale", ["teams:write"], {}),
      ]);
    await db.insert(schema.oauthAccessToken).values([
      {
        id: "at_list_live",
        token: "synthetic-at-list-live-hash",
        clientId: "live",
        userId: "user_list",
        scopes: JSON.stringify(["notifications:send"]),
        createdAt: now,
        expiresAt: later,
      },
      {
        id: "at_list_expired",
        token: "synthetic-at-list-expired-hash",
        clientId: "live",
        userId: "user_list",
        scopes: JSON.stringify(["devices:write"]),
        createdAt: now,
        expiresAt: earlier,
      },
      {
        id: "at_list_stale",
        token: "synthetic-at-list-stale-hash",
        clientId: "stale",
        userId: "user_list",
        scopes: JSON.stringify(["services:write"]),
        createdAt: now,
        expiresAt: earlier,
      },
    ]);

    expect(await oauth.listOAuthGrants("user_list")).toEqual([
      expect.objectContaining({
        clientId: "live",
        scopes: ["notifications:send"],
        offlineAccess: true,
        tokenId: null,
      }),
    ]);
  });
});

describe("client links", () => {
  it("shows only HTTPS logos and home pages from anonymous registration", () => {
    expect(oauth.httpsUrlOrNull("https://client.example/logo.png")).toBe(
      "https://client.example/logo.png",
    );
    expect(oauth.httpsUrlOrNull(" https:client.example/logo.png")).toBe(
      "https://client.example/logo.png",
    );
    for (const value of [
      "https://127.0.0.1/",
      "https://localhost/",
      "https://10.0.0.5/",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/",
      "https://user:secret@client.example/",
      "javascript:alert(1)",
      "data:image/svg+xml,<svg/>",
      "http://client.example/",
      "not a url",
      "",
      null,
      undefined,
    ]) {
      expect(oauth.httpsUrlOrNull(value), String(value)).toBeNull();
    }
  });
});
