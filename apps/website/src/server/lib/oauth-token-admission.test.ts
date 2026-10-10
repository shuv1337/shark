import { createHash, randomBytes } from "node:crypto";
import { OAUTH_DEFAULT_SCOPES } from "@hark/contracts";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

let auth: typeof import("../auth")["auth"];
let db: typeof import("../db")["db"];
let sqlite: typeof import("../db")["sqlite"];
let schema: typeof import("../db/schema");
let env: typeof import("../env")["env"];
let offboardPersistedAccess: typeof import("./offboarding")["offboardPersistedAccess"];
let guardTokenResponse: typeof import("./oauth-token-admission")["guardTokenResponse"];
let resource: string;

const ORIGIN = "http://localhost:5173";
const REDIRECT_URI = "http://127.0.0.1:33418/callback";
const USER_ID = "user_leaver";
const EMAIL = "leaver@example.com";
const SCOPE = [...OAUTH_DEFAULT_SCOPES, "offline_access"].join(" ");

let clientId: string;
let cookie: string;

beforeAll(async () => {
  ({ auth } = await import("../auth"));
  ({ db, sqlite } = await import("../db"));
  schema = await import("../db/schema");
  ({ env } = await import("../env"));
  ({ offboardPersistedAccess } = await import("./offboarding"));
  ({ guardTokenResponse } = await import("./oauth-token-admission"));
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
  resource = (await import("./oauth")).mcpResourceUrl();

  const registered = await auth.handler(
    new Request(`${ORIGIN}/api/auth/oauth2/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Synthetic MCP client",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: SCOPE,
      }),
    }),
  );
  expect(registered.status).toBe(200);
  clientId = ((await registered.json()) as { client_id: string }).client_id;
});

beforeEach(async () => {
  const now = new Date();
  await db.delete(schema.user);
  await db.delete(schema.verification);
  await db.insert(schema.user).values({
    id: USER_ID,
    name: "Leaver",
    email: EMAIL,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.oauthConsent).values({
    id: "consent_leaver",
    clientId,
    userId: USER_ID,
    scopes: JSON.stringify(SCOPE.split(" ")),
    createdAt: now,
    updatedAt: now,
  });
  const { headers } = await auth.api.createWebViewSession({
    body: { userId: USER_ID },
    returnHeaders: true,
  });
  cookie = headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
});

afterEach(() => {
  env.ALLOWED_EMAILS.splice(0, env.ALLOWED_EMAILS.length);
  sqlite.exec("DROP TRIGGER IF EXISTS offboard_mid_grant");
});

function removeFromAllowlist() {
  env.ALLOWED_EMAILS.splice(0, env.ALLOWED_EMAILS.length, "somebody-else@example.com");
}

async function authorize(): Promise<{ code: string; verifier: string }> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state: "synthetic-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
  });
  const response = await auth.handler(
    new Request(`${ORIGIN}/api/auth/oauth2/authorize?${query}`, { headers: { cookie } }),
  );
  const location =
    response.headers.get("location") ??
    ((await response.json()) as { url?: string; redirect_uri?: string }).url;
  const code = location ? new URL(location).searchParams.get("code") : null;
  if (!code) throw new Error(`authorize did not issue a code (status ${response.status})`);
  return { code, verifier };
}

async function token(body: Record<string, string>) {
  const request = new Request(`${ORIGIN}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, ...body }),
  });
  // Mirrors the /api/auth/* route in app.ts.
  const response = await guardTokenResponse(request, await auth.handler(request));
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Server errors may not carry a JSON body.
  }
  return { status: response.status, body: parsed };
}

function exchange({ code, verifier }: { code: string; verifier: string }) {
  return token({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
    resource,
  });
}

function refresh(refreshToken: string) {
  return token({ grant_type: "refresh_token", refresh_token: refreshToken, resource });
}

async function issuedTokens() {
  const { eq } = await import("drizzle-orm");
  const access = await db
    .select()
    .from(schema.oauthAccessToken)
    .where(eq(schema.oauthAccessToken.userId, USER_ID));
  const live = (
    await db
      .select()
      .from(schema.oauthRefreshToken)
      .where(eq(schema.oauthRefreshToken.userId, USER_ID))
  ).filter((row) => !row.revoked);
  return { access: access.length, refresh: live.length };
}

async function pendingCodes() {
  return (await db.select().from(schema.verification)).filter((row) =>
    row.value.includes('"authorization_code"'),
  ).length;
}

async function connected(): Promise<string> {
  const granted = await exchange(await authorize());
  expect(granted.status).toBe(200);
  expect(typeof granted.body.refresh_token).toBe("string");
  return granted.body.refresh_token as string;
}

describe("OAuth token endpoint admission", () => {
  it("refreshes while the owner is admitted", async () => {
    const refreshed = await refresh(await connected());
    expect(refreshed.status).toBe(200);
    expect(typeof refreshed.body.access_token).toBe("string");
  });

  it("rejects a refresh once the owner leaves the allowlist, without minting tokens", async () => {
    const refreshToken = await connected();
    const before = await issuedTokens();

    removeFromAllowlist();
    const rejected = await refresh(refreshToken);
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({ error: "invalid_grant" });
    expect(rejected.body).not.toHaveProperty("access_token");
    expect(await issuedTokens()).toEqual(before);
  });

  it("rejects exchanging a pending code once the owner leaves the allowlist and spends it", async () => {
    const pending = await authorize();
    expect(await pendingCodes()).toBe(1);

    removeFromAllowlist();
    const rejected = await exchange(pending);
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({ error: "invalid_grant" });
    expect(await issuedTokens()).toEqual({ access: 0, refresh: 0 });
    expect(await pendingCodes()).toBe(0);
  });

  it("offboarding between code issue and exchange invalidates the code, even after re-admission", async () => {
    const pending = await authorize();

    removeFromAllowlist();
    expect(offboardPersistedAccess(USER_ID)).toMatchObject({ authorizationCodes: 1 });
    expect(await pendingCodes()).toBe(0);
    // Re-admission: the operator puts the address back on the allowlist.
    env.ALLOWED_EMAILS.splice(0, env.ALLOWED_EMAILS.length);

    const rejected = await exchange(pending);
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({ error: "invalid_grant" });
    expect(rejected.body).not.toHaveProperty("access_token");
    expect(await issuedTokens()).toEqual({ access: 0, refresh: 0 });
  });

  it("rejects a code exchange when offboarding commits right after the code is consumed", async () => {
    const pending = await authorize();
    sqlite.exec(`
      CREATE TEMP TRIGGER offboard_mid_grant
      AFTER DELETE ON verification
      WHEN json_extract(OLD.value, '$.userId') = '${USER_ID}'
      BEGIN
        DELETE FROM session WHERE user_id = '${USER_ID}';
      END;
    `);

    const rejected = await exchange(pending);
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({ error: "invalid_grant" });
    expect(await issuedTokens()).toEqual({ access: 0, refresh: 0 });
  });

  it("rejects a code exchange when offboarding commits between the session check and the insert", async () => {
    const pending = await authorize();
    // The insert then references a deleted session and fails its foreign key.
    const { adapter } = await auth.$context;
    const findOne = adapter.findOne;
    adapter.findOne = (async (args: Parameters<typeof findOne>[0]) => {
      const found = await findOne(args);
      if (args.model === "session") sqlite.exec(`DELETE FROM session WHERE user_id = '${USER_ID}'`);
      return found;
    }) as typeof findOne;
    let rejected: Awaited<ReturnType<typeof exchange>>;
    try {
      rejected = await exchange(pending);
    } finally {
      adapter.findOne = findOne;
    }
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({ error: "invalid_grant" });
    expect(await issuedTokens()).toEqual({ access: 0, refresh: 0 });
  });

  it("still reports a server error for an admitted owner", async () => {
    const pending = await authorize();
    sqlite.exec(`
      CREATE TEMP TRIGGER offboard_mid_grant
      BEFORE INSERT ON oauth_refresh_token
      BEGIN
        SELECT RAISE(ABORT, 'synthetic storage failure');
      END;
    `);

    const failed = await exchange(pending);
    expect(failed.status).toBe(500);
    expect(failed.body).not.toMatchObject({ error: "invalid_grant" });
  });

  it("rejects a code exchange when offboarding deletes the tokens it just minted", async () => {
    const pending = await authorize();
    // Offboarding commits right after the grant stores its access token.
    sqlite.exec(`
      CREATE TEMP TRIGGER offboard_mid_grant
      AFTER INSERT ON oauth_access_token
      WHEN NEW.user_id = '${USER_ID}'
      BEGIN
        DELETE FROM oauth_access_token WHERE user_id = NEW.user_id;
        DELETE FROM oauth_refresh_token WHERE user_id = NEW.user_id;
        DELETE FROM session WHERE user_id = NEW.user_id;
      END;
    `);

    const rejected = await exchange(pending);
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({ error: "invalid_grant" });
    expect(rejected.body).not.toHaveProperty("access_token");
    expect(await issuedTokens()).toEqual({ access: 0, refresh: 0 });
  });

  it("offboarding leaves other users' pending codes alone", async () => {
    const now = new Date();
    await db.insert(schema.verification).values({
      id: "ver_other",
      identifier: "synthetic-code-hash",
      value: JSON.stringify({ type: "authorization_code", userId: "user_other", query: {} }),
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
    await authorize();

    expect(offboardPersistedAccess(USER_ID)).toMatchObject({ authorizationCodes: 1 });
    expect((await db.select().from(schema.verification)).map((row) => row.id)).toEqual([
      "ver_other",
    ]);
  });

  it("discards tokens a refresh mints when offboarding lands mid-grant", async () => {
    const refreshToken = await connected();
    // Offboarding commits after rotation revoked the presented token but
    // before the replacement is stored.
    sqlite.exec(`
      CREATE TEMP TRIGGER offboard_mid_grant
      BEFORE INSERT ON oauth_refresh_token
      WHEN NEW.user_id = '${USER_ID}'
      BEGIN
        DELETE FROM oauth_access_token WHERE user_id = NEW.user_id;
        DELETE FROM oauth_refresh_token WHERE user_id = NEW.user_id;
      END;
    `);

    const rejected = await refresh(refreshToken);
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({ error: "invalid_grant" });
    expect(rejected.body).not.toHaveProperty("access_token");
    expect(await issuedTokens()).toEqual({ access: 0, refresh: 0 });
  });
});
