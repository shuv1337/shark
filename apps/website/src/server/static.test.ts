import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const clientDir = mkdtempSync(join(tmpdir(), "shark-static-"));
for (const route of ["", "docs", "privacy", "terms", "dashboard", "cli/authorize"]) {
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

beforeAll(async () => {
  ({ app } = await import("./app"));
  const { runMigrations } = await import("./db/migrate");
  runMigrations();
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
    expect((await app.request("/pricing")).status).toBe(404);
  });
});
