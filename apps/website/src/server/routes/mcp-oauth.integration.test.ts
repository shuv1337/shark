import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const ORIGIN = "http://localhost:5173";
const USER = { id: "user_e2e", email: "e2e-operator@example.com" };

const FIXTURE_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: ":memory:",
  APP_URL: ORIGIN,
  BETTER_AUTH_SECRET: "synthetic-e2e-auth-secret-not-real-0123456789",
  ALLOWED_EMAILS: USER.email,
} as const;
const inheritedEnv = Object.fromEntries(
  Object.keys(FIXTURE_ENV).map((key) => [key, process.env[key]]),
);
Object.assign(process.env, FIXTURE_ENV);

/**
 * The MCP authorization flow through the real Better Auth handler and
 * oauth-provider plugin, against an in-memory database. Only Sign in with
 * Apple is skipped: the user's browser session is opened server-side.
 * Every authorization names its scopes, so nothing depends on the consent
 * page's defaults.
 */

const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT_URI = "http://127.0.0.1:33418/callback";
const REQUESTED = "teams:read teams:write offline_access";
const GRANTED = "teams:read offline_access";

let app: typeof import("../app")["app"];
let auth: typeof import("../auth")["auth"];
let env: typeof import("../env")["env"];
let sessionCookie: string;
let allowedEmails: string[];

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ auth } = await import("../auth"));
  ({ env } = await import("../env"));
  expect(env).toMatchObject({ APP_URL: ORIGIN, ALLOWED_EMAILS: [USER.email] });
  allowedEmails = [...env.ALLOWED_EMAILS];
  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();

  const now = new Date();
  await db.insert(schema.user).values({
    id: USER.id,
    name: "E2E Operator",
    email: USER.email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  const { headers } = await auth.api.createWebViewSession({
    body: { userId: USER.id },
    returnHeaders: true,
  });
  sessionCookie = headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  expect(sessionCookie).toContain("session_token=");
});

afterEach(async () => {
  env.ALLOWED_EMAILS.splice(0, env.ALLOWED_EMAILS.length, ...allowedEmails);
  (await auth.$context).rateLimit.enabled = false;
});

afterAll(() => {
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function signedIn(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { ...(init.headers as Record<string, string>), cookie: sessionCookie, origin: ORIGIN },
  };
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function registration(clientName: string, headers: Record<string, string> = {}) {
  return app.request("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
}

async function register(clientName: string): Promise<string> {
  const response = await registration(clientName);
  const body = (await response.json()) as Record<string, unknown>;
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body).toMatchObject({ public: true, token_endpoint_auth_method: "none" });
  expect(body.client_secret).toBeUndefined();
  return String(body.client_id);
}

/** Starts an authorization as the signed-in user; returns the consent page's signed query. */
async function authorize(clientId: string, challenge: string, scope = REQUESTED): Promise<string> {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope,
    state: "synthetic-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
  });
  const response = await app.request(`/api/auth/oauth2/authorize?${query}`, signedIn());
  expect(response.status).toBe(302);
  const consent = new URL(response.headers.get("location") ?? "", ORIGIN);
  expect(consent.pathname).toBe("/oauth/consent");
  expect(consent.searchParams.get("client_id")).toBe(clientId);
  expect(consent.searchParams.get("scope")).toBe(scope);
  expect(consent.searchParams.get("sig")).toBeTruthy();
  return consent.search.slice(1);
}

/** The consent page's decision, posted where the page posts it. Returns the client redirect. */
async function decide(oauthQuery: string, accept: boolean, scope?: string): Promise<URL> {
  const response = await app.request(
    "/api/auth/oauth2/consent",
    signedIn({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept, ...(scope ? { scope } : {}), oauth_query: oauthQuery }),
    }),
  );
  const body = (await response.json()) as { url?: string; redirect_uri?: string };
  expect(response.status, JSON.stringify(body)).toBe(200);
  const redirect = new URL(body.url ?? body.redirect_uri ?? "");
  expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT_URI);
  expect(redirect.searchParams.get("state")).toBe("synthetic-state");
  return redirect;
}

interface TokenSet {
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope: string;
}

async function token(params: Record<string, string>) {
  const response = await app.request("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function exchange(clientId: string, code: string, verifier?: string) {
  return token({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    ...(verifier ? { code_verifier: verifier } : {}),
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
  });
}

function refresh(clientId: string, refreshToken: string) {
  return token({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
    resource: RESOURCE,
  });
}

async function codeFor(clientName: string) {
  const clientId = await register(clientName);
  const { verifier, challenge } = pkce();
  const redirect = await decide(await authorize(clientId, challenge), true, GRANTED);
  const code = redirect.searchParams.get("code");
  expect(code).toBeTruthy();
  return { clientId, verifier, code: code ?? "" };
}

/** Registration, authorization, narrowed consent, and code exchange. */
async function connectClient(clientName: string) {
  const { clientId, verifier, code } = await codeFor(clientName);
  const exchanged = await exchange(clientId, code, verifier);
  expect(exchanged.status, String(exchanged.body.error_description)).toBe(200);
  return { clientId, tokens: exchanged.body as unknown as TokenSet };
}

async function mcpStatus(accessToken: string): Promise<number> {
  const response = await app.request("/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: "{}",
  });
  if (response.status === 401) {
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  }
  return response.status;
}

async function mcpClient(accessToken: string): Promise<Client> {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(RESOURCE), {
      requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
      fetch: async (input, init) =>
        app.request(input instanceof Request ? input : input.toString(), init),
    }),
  );
  return client;
}

function json(result: unknown): Record<string, unknown> {
  const content = (result as CallToolResult).content;
  const last = content[content.length - 1];
  if (last?.type !== "text") throw new Error("Expected text content");
  return JSON.parse(last.text) as Record<string, unknown>;
}

describe("MCP OAuth end to end", () => {
  it("advertises the anonymous endpoints the flow uses", async () => {
    const response = await app.request("/.well-known/oauth-authorization-server/api/auth");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issuer: `${ORIGIN}/api/auth`,
      registration_endpoint: `${ORIGIN}/api/auth/oauth2/register`,
      authorization_endpoint: `${ORIGIN}/api/auth/oauth2/authorize`,
      token_endpoint: `${ORIGIN}/api/auth/oauth2/token`,
      revocation_endpoint: `${ORIGIN}/api/auth/oauth2/revoke`,
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("rate-limits anonymous client registration per client IP", async () => {
    (await auth.$context).rateLimit.enabled = true;
    const from = (ip: string) => registration("Flood", { "x-forwarded-for": ip });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await from("198.51.100.7")).status).toBe(200);
    }
    expect((await from("198.51.100.7")).status).toBe(429);
    expect((await from("198.51.100.8")).status).toBe(200);
  });

  it("requires the PKCE verifier and spends a code on its first use", async () => {
    const { clientId, verifier, code } = await codeFor("PKCE Client");

    const missing = await exchange(clientId, code);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("invalid_request");

    // Better Auth answers a wrong verifier with 401 invalid_request and burns the code.
    const wrong = await exchange(clientId, code, pkce().verifier);
    expect(wrong.status).toBe(401);
    expect(wrong.body).toMatchObject({
      error: "invalid_request",
      error_description: "code verification failed",
    });
    const afterWrong = await exchange(clientId, code, verifier);
    expect(afterWrong.body.error).toBe("invalid_grant");

    const second = await codeFor("Reuse Client");
    const first = await exchange(second.clientId, second.code, second.verifier);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ token_type: "Bearer", scope: GRANTED });
    expect(String(first.body.access_token)).toMatch(/^hark_mat_/);
    expect(String(first.body.refresh_token)).toMatch(/^hark_mrt_/);
    const reused = await exchange(second.clientId, second.code, second.verifier);
    expect(reused.body.error).toBe("invalid_grant");
  });

  it("denying consent sends access_denied and no code", async () => {
    const clientId = await register("Denied Client");
    const redirect = await decide(await authorize(clientId, pkce().challenge), false);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.has("code")).toBe(false);
  });

  it("serves /mcp with only the scopes the person granted", async () => {
    const { tokens } = await connectClient("Scoped Client");
    const client = await mcpClient(tokens.access_token);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["auth_status", "teams_list", "teams_create"]),
    );
    const status = json(await client.callTool({ name: "auth_status", arguments: {} }));
    expect(status).toMatchObject({
      authenticated: true,
      token: { name: "Scoped Client", prefix: "oauth", scopes: ["teams:read"] },
    });
    const listed = await client.callTool({ name: "teams_list", arguments: {} });
    expect(listed.isError).toBeFalsy();
    expect(json(listed)).toEqual({ teams: [] });

    // Requested at authorization but unticked on the consent page.
    const denied = await client.callTool({ name: "teams_create", arguments: { name: "Nope" } });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied.content)).toContain("SHark API error 403");
    await client.close();
  });

  it("rotates refresh tokens and revokes the family when an old one is replayed", async () => {
    const { clientId, tokens } = await connectClient("Refresh Client");

    const rotated = await refresh(clientId, tokens.refresh_token);
    expect(rotated.status).toBe(200);
    const next = rotated.body as unknown as TokenSet;
    expect(next.scope).toBe(GRANTED);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(next.access_token).not.toBe(tokens.access_token);
    // A normal refresh leaves the old access token valid until it expires or is revoked.
    const oldClient = await mcpClient(tokens.access_token);
    expect((await oldClient.callTool({ name: "teams_list", arguments: {} })).isError).toBeFalsy();
    await oldClient.close();
    const client = await mcpClient(next.access_token);
    expect((await client.callTool({ name: "teams_list", arguments: {} })).isError).toBeFalsy();
    await client.close();

    const replayed = await refresh(clientId, tokens.refresh_token);
    expect(replayed.status).toBe(400);
    expect(replayed.body.error).toBe("invalid_grant");
    // Reuse detection deletes every refresh and access token of the grant.
    expect(await mcpStatus(tokens.access_token)).toBe(401);
    expect(await mcpStatus(next.access_token)).toBe(401);
    expect((await refresh(clientId, next.refresh_token)).body.error).toBe("invalid_grant");
  });

  it("returns 401 from /mcp once the access token is revoked", async () => {
    const { clientId, tokens } = await connectClient("Revoked Client");
    expect(await mcpStatus(tokens.access_token)).not.toBe(401);

    const revoke = (value: string, hint: string) =>
      app.request("/api/auth/oauth2/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: value,
          token_type_hint: hint,
          client_id: clientId,
        }).toString(),
      });
    expect((await revoke(tokens.access_token, "access_token")).status).toBe(200);
    expect(await mcpStatus(tokens.access_token)).toBe(401);

    expect((await revoke(tokens.refresh_token, "refresh_token")).status).toBe(200);
    expect((await refresh(clientId, tokens.refresh_token)).body.error).toBe("invalid_grant");
  });

  it("returns 401 from /mcp once the dashboard disconnects the client", async () => {
    const { clientId, tokens } = await connectClient("Dashboard Client");
    expect(await mcpStatus(tokens.access_token)).not.toBe(401);

    const listed = await app.request("/api/oauth/clients", signedIn());
    expect(((await listed.json()) as { clients: unknown[] }).clients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientId, scopes: ["teams:read"], offlineAccess: true }),
      ]),
    );
    const removed = await app.request(
      `/api/oauth/clients/${clientId}`,
      signedIn({ method: "DELETE" }),
    );
    expect(removed.status).toBe(200);
    expect(await mcpStatus(tokens.access_token)).toBe(401);
    expect((await refresh(clientId, tokens.refresh_token)).body.error).toBe("invalid_grant");
  });

  it("stops a connected client as soon as its owner leaves the allowlist", async () => {
    const { tokens } = await connectClient("Allowlist Client");
    expect(await mcpStatus(tokens.access_token)).not.toBe(401);

    env.ALLOWED_EMAILS.splice(0, env.ALLOWED_EMAILS.length, "someone-else@example.com");
    expect(await mcpStatus(tokens.access_token)).toBe(401);
  });
});
