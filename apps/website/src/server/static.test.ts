import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const clientDir = mkdtempSync(join(tmpdir(), "shark-static-"));
for (const route of [
  "",
  "docs",
  "privacy",
  "terms",
  "dashboard",
  "board",
  "inbox",
  "teams",
  "settings",
  "404",
  "cli/authorize",
]) {
  const directory = join(clientDir, route);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "index.html"), "<!doctype html><title>private</title>");
}
mkdirSync(join(clientDir, "assets"), { recursive: true });
writeFileSync(join(clientDir, "assets", "app.js"), "private");
for (const asset of ["favicon.png", "ogimage.png", "app-store-icon.png"]) {
  writeFileSync(join(clientDir, asset), "private");
}
writeFileSync(join(clientDir, "sw.js"), 'self.addEventListener("push", () => {});');

let app: typeof import("./app")["app"];
let auth: typeof import("./auth")["auth"];
let cookie: string;

/** A real session for the synthetic operator, as the sign-in flow mints one. */
async function sessionCookie(): Promise<string> {
  if (cookie) return cookie;
  const { headers } = await auth.api.createWebViewSession({
    body: { userId: "usr_static_synthetic" },
    returnHeaders: true,
  });
  cookie = headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return cookie;
}

beforeAll(async () => {
  ({ app } = await import("./app"));
  ({ auth } = await import("./auth"));
  const { runMigrations } = await import("./db/migrate");
  runMigrations();
  const { db } = await import("./db");
  const schema = await import("./db/schema");
  const now = new Date();
  await db.insert(schema.user).values({
    id: "usr_static_synthetic",
    name: "Operator",
    email: "operator@example.test",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  const { mountPrivateStaticRoutes } = await import("./static");
  mountPrivateStaticRoutes(app, clientDir, clientDir);
});

afterAll(() => rmSync(clientDir, { recursive: true, force: true }));

describe("private content boundary", () => {
  it("keeps only readiness anonymously readable", async () => {
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    for (const path of [
      "/",
      "/docs",
      "/privacy",
      "/terms",
      "/dashboard",
      "/dashboard/teams/team_1",
      "/board",
      "/board/ask/bask_1",
      "/inbox",
      "/inbox/ibox%3Aevent%3A1",
      "/teams",
      "/teams/team_1",
      "/settings",
      "/cli/authorize",
      "/assets/app.js",
      "/ogimage.png",
      "/docs.md",
      "/llms.txt",
      "/oss",
    ]) {
      expect((await app.request(path)).status, path).toBe(401);
    }
  });

  it("publishes only the root files required for browser notifications", async () => {
    const worker = await app.request("/sw.js");
    expect(worker.status).toBe(200);
    expect(worker.headers.get("content-type")).toMatch(/javascript/);
    expect(await worker.text()).toContain('self.addEventListener("push"');

    expect((await app.request("/favicon.png")).status).toBe(200);
    expect((await app.request("/app-store-icon.png")).status).toBe(200);
    expect((await app.request("/ogimage.png")).status).toBe(401);
  });

  it("redirects signed-out document requests to the content-free Apple bootstrap", async () => {
    const response = await app.request("/", { headers: { Accept: "text/html" } });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
    expect(await response.text()).toBe("");
  });

  it("does not publish removed discovery surfaces", async () => {
    expect((await app.request("/robots.txt")).status).toBe(404);
    expect((await app.request("/sitemap.xml")).status).toBe(404);
    // `/pricing` is an unknown page address, so it answers like every other
    // one: nothing at all until you are signed in. It has no page behind it.
    expect((await app.request("/pricing")).status).toBe(401);
    const signedIn = await app.request("/pricing", { headers: { Cookie: await sessionCookie() } });
    expect(signedIn.status).toBe(200);
    expect(await signedIn.text()).toContain("<title>private</title>");
  });
});

/**
 * Typed URLs and stale deep links: the client needs its own 404 page, which
 * means the server has to hand it the application shell. The boundary must not
 * leak: an unknown page is 401 while signed out, and an API, hook or asset miss
 * stays a real 404 whatever the session says.
 */
describe("unknown address shell", () => {
  it("keeps unknown page addresses behind the session", async () => {
    expect((await app.request("/definitely-not-a-route")).status).toBe(401);

    const html = await app.request("/definitely-not-a-route", {
      headers: { Accept: "text/html" },
    });
    expect(html.status).toBe(302);
    expect(html.headers.get("location")).toBe("/login?next=%2Fdefinitely-not-a-route");
  });

  it("serves the 404 shell to a signed-in reader", async () => {
    const cookie = await sessionCookie();
    for (const path of ["/definitely-not-a-route", "/inbox/deep/link/nobody/wrote"]) {
      const response = await app.request(path, { headers: { Cookie: cookie } });
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toMatch(/html/);
    }
  });

  it("never answers an API, hook or asset miss with a shell", async () => {
    const cookie = await sessionCookie();
    for (const [path, body] of [
      ["/api/nope", '{"error":"Not found"}'],
      ["/hooks/nope", '{"error":"Not found"}'],
      ["/mcp/anything", "Not found"],
      ["/.well-known/anything", "Not found"],
      ["/assets/missing.js", "Not found"],
      ["/missing.png", "Not found"],
      // An extension anywhere in the last segment is an asset, however deep.
      ["/foo/bar.json", "Not found"],
      ["/inbox/item.json", "Not found"],
    ] as const) {
      const response = await app.request(path, { headers: { Cookie: cookie } });
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).toBe(body);
    }
    // Without a session an asset miss is still refused, never answered with HTML.
    expect((await app.request("/assets/missing.js")).status).toBe(401);
    expect((await app.request("/missing.png")).status).toBe(404);
  });
});
