import { createHash, randomBytes } from "node:crypto";
import { OAUTH_DEFAULT_SCOPES } from "@hark/contracts";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

// Codes here come from the real oauth-provider plugin, so a change to how
// Better Auth stores them fails this file instead of silently surviving
// offboarding.

let auth: typeof import("../auth")["auth"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let env: typeof import("../env")["env"];
let offboardPersistedAccess: typeof import("./offboarding")["offboardPersistedAccess"];
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
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ env } = await import("../env"));
  ({ offboardPersistedAccess } = await import("./offboarding"));
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
});

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

async function exchange({ code, verifier }: { code: string; verifier: string }) {
  const response = await auth.handler(
    new Request(`${ORIGIN}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
        resource,
      }),
    }),
  );
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Server errors may not carry a JSON body.
  }
  return { status: response.status, body };
}

async function pendingCodes() {
  return (await db.select().from(schema.verification)).filter((row) =>
    row.value.includes('"authorization_code"'),
  ).length;
}

describe("offboarding real OAuth authorization codes", () => {
  it("leaves a code exchangeable when nobody is offboarded", async () => {
    const pending = await authorize();
    expect(await pendingCodes()).toBe(1);

    const granted = await exchange(pending);
    expect(granted.status).toBe(200);
    expect(typeof granted.body.access_token).toBe("string");
  });

  it("invalidates a code issued before offboarding, even after re-admission", async () => {
    const pending = await authorize();
    expect(await pendingCodes()).toBe(1);

    env.ALLOWED_EMAILS.splice(0, env.ALLOWED_EMAILS.length, "somebody-else@example.com");
    expect(offboardPersistedAccess(USER_ID)).toMatchObject({ authorizationCodes: 1 });
    expect(await pendingCodes()).toBe(0);
    // Re-admission: the operator puts the address back on the allowlist.
    env.ALLOWED_EMAILS.splice(0, env.ALLOWED_EMAILS.length);

    const rejected = await exchange(pending);
    expect(rejected.status).not.toBe(200);
    expect(rejected.body).toMatchObject({ error: "invalid_grant" });
    expect(rejected.body).not.toHaveProperty("access_token");
    expect(await db.select().from(schema.oauthAccessToken)).toEqual([]);
    expect(await db.select().from(schema.oauthRefreshToken)).toEqual([]);
  });
});
