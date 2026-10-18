import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ORIGIN = "http://localhost:5173";

const FIXTURE_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: ":memory:",
  APP_URL: ORIGIN,
  BETTER_AUTH_SECRET: "synthetic-node-server-auth-secret-not-real-0123456789",
  ALLOWED_EMAILS: "node-server-operator@example.com",
  TRUSTED_FORWARDED_FOR_HOPS: "1",
} as const;
const inheritedEnv = Object.fromEntries(
  Object.keys(FIXTURE_ENV).map((key) => [key, process.env[key]]),
);
Object.assign(process.env, FIXTURE_ENV);

/**
 * The token endpoint through the real Node server, not `app.request`.
 *
 * `serve` replaces the global `Response` with a lightweight class, and
 * better-call only honors a Better Auth hook's response when it is
 * `instanceof` that global. `app.request` never swaps the global, so the
 * in-process integration tests cannot see a hook whose refusal is dropped.
 */

const RESOURCE = `${ORIGIN}/mcp`;
const TOKEN_PATH = "/api/auth/oauth2/token";

let server: ReturnType<typeof serve>;
let base: string;

beforeAll(async () => {
  const { app } = await import("../app");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function token(form: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
  }
  const response = await fetch(`${base}${TOKEN_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

const CODE_EXCHANGE = {
  grant_type: "authorization_code",
  code: "not-a-real-code",
  client_id: "not-a-real-client",
  redirect_uri: "http://127.0.0.1:33418/callback",
  code_verifier: "not-a-real-verifier",
};

describe("resource binding through the Node server", () => {
  it("refuses a code exchange that does not name /mcp before the endpoint runs", async () => {
    const refused = await token(CODE_EXCHANGE);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: "invalid_target" });
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(refused.headers.get("pragma")).toBe("no-cache");
    expect(refused.headers.get("content-type")).toMatch(/^application\/json/);

    const foreign = await token({
      ...CODE_EXCHANGE,
      resource: [RESOURCE, "https://evil.example/mcp"],
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body).toMatchObject({ error: "invalid_target" });

    // Naming /mcp reaches the endpoint, which then rejects the fake code itself.
    const reached = await token({ ...CODE_EXCHANGE, resource: RESOURCE });
    expect(reached.status).toBe(400);
    expect(reached.body).toMatchObject({ error: "invalid_grant" });
    expect(reached.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a refresh that does not name /mcp", async () => {
    const refused = await token({
      grant_type: "refresh_token",
      refresh_token: "not-a-real-refresh-token",
      client_id: "not-a-real-client",
    });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: "invalid_target" });
    expect(refused.headers.get("pragma")).toBe("no-cache");
  });

  it("still answers JSON with 415 and challenges /mcp", async () => {
    const json = await fetch(`${base}${TOKEN_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(json.status).toBe(415);
    const mcp = await fetch(`${base}/mcp`, { headers: { authorization: "Bearer forged" } });
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get("www-authenticate")).toContain("resource_metadata=");
  });
});
