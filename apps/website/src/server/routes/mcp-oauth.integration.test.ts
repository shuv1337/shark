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
  TRUSTED_FORWARDED_FOR_HOPS: "1",
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
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as Record<string, unknown>,
  };
}

/** Posts a form body verbatim, for parameters `URLSearchParams` from a record cannot repeat. */
async function rawToken(pairs: Array<[string, string]>) {
  const response = await app.request("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&"),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as Record<string, unknown>,
  };
}

/** RFC 6749 §5.1–5.2: every token endpoint response, errors included, is uncacheable. */
function expectUncacheable(headers: Headers, label: string) {
  expect(headers.get("cache-control"), label).toBe("no-store");
  expect(headers.get("pragma"), label).toBe("no-cache");
}

/** `resource: null` omits RFC 8707's resource indicator from the request. */
function exchange(
  clientId: string,
  code: string,
  verifier?: string,
  resource: string | null = RESOURCE,
) {
  return token({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    ...(verifier ? { code_verifier: verifier } : {}),
    redirect_uri: REDIRECT_URI,
    ...(resource === null ? {} : { resource }),
  });
}

function refresh(clientId: string, refreshToken: string, resource: string | null = RESOURCE) {
  return token({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
    ...(resource === null ? {} : { resource }),
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

/** A bearer that authenticates reaches the MCP transport, which refuses this bare request with 406. */
const MCP_REACHED = 406;

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

  it("rate-limits anonymous client registration per trusted client IP", async () => {
    (await auth.$context).rateLimit.enabled = true;
    // As in production, the edge appends the real address after whatever the client sent, and
    // only that last hop is trusted, so a forged leftmost entry never gets its own bucket.
    let forged = 0;
    const from = (ip: string) => {
      forged += 1;
      return registration("Flood", { "x-forwarded-for": `203.0.113.${forged}, ${ip}` });
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await from("198.51.100.7")).status).toBe(200);
    }
    expect((await from("198.51.100.7")).status).toBe(429);
    expect((await from("198.51.100.8")).status).toBe(200);
  });

  it("only shows a signed query's own client on the consent page, without contacts", async () => {
    const response = await app.request("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Prelogin B",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        contacts: ["synthetic-owner@example.com"],
      }),
    });
    const registered = (await response.json()) as { client_id: string; contacts?: string[] };
    expect(response.status).toBe(200);
    expect(registered.contacts).toEqual(["synthetic-owner@example.com"]);
    const clientA = await register("Prelogin A");
    const clientB = registered.client_id;
    const queryA = await authorize(clientA, pkce().challenge);
    const queryB = await authorize(clientB, pkce().challenge);

    const prelogin = (body: Record<string, unknown>) =>
      app.request("/api/auth/oauth2/public-client-prelogin", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify(body),
      });

    const bindingError = "client_id does not match the signed authorization request";
    const crossed = await prelogin({ client_id: clientB, oauth_query: queryA });
    expect(crossed.status).toBe(400);
    const crossedBody = JSON.stringify(await crossed.json());
    expect(crossedBody).not.toContain("Prelogin B");
    expect(crossedBody).toContain(bindingError);
    expect((await prelogin({ client_id: clientB })).status).toBe(400);

    // Re-sign the way Better Auth does, so a second client_id passes the signature check and only
    // the binding check can refuse it.
    const { makeSignature } = await import("better-auth/crypto");
    const resign = async (query: string) => {
      const params = new URLSearchParams(query);
      params.delete("sig");
      const canonical = new URLSearchParams(
        [...params.entries()].sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : 1)),
      );
      params.set("sig", await makeSignature(canonical.toString(), FIXTURE_ENV.BETTER_AUTH_SECRET));
      return params.toString();
    };
    expect((await prelogin({ client_id: clientA, oauth_query: await resign(queryA) })).status).toBe(
      200,
    );
    const doubled = await prelogin({
      client_id: clientB,
      oauth_query: await resign(`client_id=${encodeURIComponent(clientB)}&${queryA}`),
    });
    expect(doubled.status).toBe(400);
    const doubledBody = JSON.stringify(await doubled.json());
    expect(doubledBody).toContain(bindingError);
    expect(doubledBody).not.toContain("Prelogin B");

    const own = await prelogin({ client_id: clientB, oauth_query: queryB });
    expect(own.status).toBe(200);
    const shown = (await own.json()) as Record<string, unknown>;
    expect(shown).toMatchObject({ client_id: clientB, client_name: "Prelogin B" });
    expect(shown).not.toHaveProperty("contacts");
    expect(JSON.stringify(shown)).not.toContain("synthetic-owner@example.com");

    const sessionView = await app.request(
      `/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientB)}`,
      signedIn(),
    );
    expect(sessionView.status).toBe(200);
    const sessionShown = (await sessionView.json()) as Record<string, unknown>;
    expect(sessionShown).toMatchObject({ client_id: clientB, client_name: "Prelogin B" });
    expect(sessionShown).not.toHaveProperty("contacts");
    expect(JSON.stringify(sessionShown)).not.toContain("synthetic-owner@example.com");
  });

  it("rejects malformed or unsigned prelogin requests without revealing the client", async () => {
    const clientId = await register("Prelogin Malformed");
    const query = await authorize(clientId, pkce().challenge);
    const tampered = new URLSearchParams(query);
    tampered.set("sig", `${tampered.get("sig")?.slice(0, -2)}AA`);
    const scopeChanged = new URLSearchParams(query);
    scopeChanged.set("scope", "teams:read teams:write");

    for (const body of [
      "{not json",
      JSON.stringify({ client_id: 42, oauth_query: query }),
      JSON.stringify({ client_id: clientId, oauth_query: 42 }),
      JSON.stringify({ client_id: clientId, oauth_query: tampered.toString() }),
      JSON.stringify({ client_id: clientId, oauth_query: scopeChanged.toString() }),
    ]) {
      const response = await app.request("/api/auth/oauth2/public-client-prelogin", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body,
      });
      expect(response.status, body).toBeGreaterThanOrEqual(400);
      expect(response.status, body).toBeLessThan(500);
      expect(await response.text(), body).not.toContain("Prelogin Malformed");
    }
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

  it("issues tokens only to requests that name /mcp as their resource", async () => {
    const { clientId, verifier, code } = await codeFor("Resource Client");

    // A request without a resource indicator, or for another resource, gets RFC 8707's
    // invalid_target before the endpoint runs, so the code is not spent.
    const missing = await exchange(clientId, code, verifier, null);
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ error: "invalid_target" });
    expect(String(missing.body.error_description)).toContain(RESOURCE);
    expectUncacheable(missing.headers, "missing resource");

    for (const foreign of [
      `${ORIGIN}/`,
      `${ORIGIN}/mcp/`,
      `${ORIGIN}/api/auth`,
      "https://attacker.example/mcp",
    ]) {
      const refused = await exchange(clientId, code, verifier, foreign);
      expect(refused.status, foreign).toBe(400);
      expect(refused.body.error, foreign).toBe("invalid_target");
      expectUncacheable(refused.headers, foreign);
    }

    const exchanged = await exchange(clientId, code, verifier);
    expect(exchanged.status, String(exchanged.body.error_description)).toBe(200);
    expectUncacheable(exchanged.headers, "exchange");
    const tokens = exchanged.body as unknown as TokenSet;
    expect(await mcpStatus(tokens.access_token)).toBe(MCP_REACHED);

    // Refreshing binds the new token the same way, and a refused refresh is not a reuse.
    const unbound = await refresh(clientId, tokens.refresh_token, null);
    expect(unbound.status).toBe(400);
    expect(unbound.body.error).toBe("invalid_target");
    const elsewhere = await refresh(clientId, tokens.refresh_token, "https://attacker.example/mcp");
    expect(elsewhere.body.error).toBe("invalid_target");
    const rotated = await refresh(clientId, tokens.refresh_token);
    expect(rotated.status, String(rotated.body.error_description)).toBe(200);
    expectUncacheable(rotated.headers, "refresh");
    expect(await mcpStatus(String(rotated.body.access_token))).toBe(MCP_REACHED);

    // Better Auth's own errors are uncacheable too, and the resource check only applies to
    // the grant types SHark issues, so the documented answers for other bodies are unchanged.
    const replayed = await exchange(clientId, code, verifier);
    expect(replayed.status).toBe(401);
    expect(replayed.body.error).toBe("invalid_grant");
    expectUncacheable(replayed.headers, "replayed code");
    const empty = await token({});
    expect(empty.status).toBe(400);
    expect(empty.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(empty.body.error).toBeUndefined();
    expectUncacheable(empty.headers, "empty form");
    const unsupported = await token({ grant_type: "client_credentials", client_id: clientId });
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error).toBe("unsupported_grant_type");
    expectUncacheable(unsupported.headers, "unsupported grant");
    const asJson = await app.request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", resource: RESOURCE }),
    });
    expect(asJson.status).toBe(415);
  });

  it("requires every repeated resource value to name /mcp", async () => {
    const { clientId, verifier, code } = await codeFor("Repeated Resource Client");
    const base: Array<[string, string]> = [
      ["grant_type", "authorization_code"],
      ["client_id", clientId],
      ["code", code],
      ["code_verifier", verifier],
      ["redirect_uri", REDIRECT_URI],
    ];
    const foreign = "https://attacker.example/mcp";

    // RFC 8707 allows repeating resource and requires every value to be acceptable; the
    // parsed body keeps only the last one, so both orders must be refused without spending
    // the code.
    for (const order of [
      [foreign, RESOURCE],
      [RESOURCE, foreign],
    ]) {
      const refused = await rawToken([
        ...base,
        ...order.map((r): [string, string] => ["resource", r]),
      ]);
      expect(refused.status, order.join(" ")).toBe(400);
      expect(refused.body.error, order.join(" ")).toBe("invalid_target");
      expectUncacheable(refused.headers, order.join(" "));
    }
    const twice = await rawToken([...base, ["resource", RESOURCE], ["resource", RESOURCE]]);
    expect(twice.status, String(twice.body.error_description)).toBe(200);
    const tokens = twice.body as unknown as TokenSet;
    expect(await mcpStatus(tokens.access_token)).toBe(MCP_REACHED);

    const refreshBase: Array<[string, string]> = [
      ["grant_type", "refresh_token"],
      ["client_id", clientId],
      ["refresh_token", tokens.refresh_token],
    ];
    for (const order of [
      [foreign, RESOURCE],
      [RESOURCE, foreign],
    ]) {
      const refused = await rawToken([
        ...refreshBase,
        ...order.map((r): [string, string] => ["resource", r]),
      ]);
      expect(refused.status, order.join(" ")).toBe(400);
      expect(refused.body.error, order.join(" ")).toBe("invalid_target");
    }
    // The refusals neither rotated nor revoked the refresh token.
    const rotated = await rawToken([
      ...refreshBase,
      ["resource", RESOURCE],
      ["resource", RESOURCE],
    ]);
    expect(rotated.status, String(rotated.body.error_description)).toBe(200);
    expect(await mcpStatus(String(rotated.body.access_token))).toBe(MCP_REACHED);
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
    expect(await mcpStatus(tokens.access_token)).toBe(MCP_REACHED);

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
    expect(await mcpStatus(tokens.access_token)).toBe(MCP_REACHED);

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
    expect(await mcpStatus(tokens.access_token)).toBe(MCP_REACHED);

    env.ALLOWED_EMAILS.splice(0, env.ALLOWED_EMAILS.length, "someone-else@example.com");
    expect(await mcpStatus(tokens.access_token)).toBe(401);
  });
});
