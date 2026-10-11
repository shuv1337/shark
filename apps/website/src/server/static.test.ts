import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const clientDir = mkdtempSync(join(tmpdir(), "shark-static-"));
for (const route of ["", "docs", "privacy", "terms", "dashboard", "board", "cli/authorize"]) {
  const directory = join(clientDir, route);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "index.html"), "<!doctype html><title>private</title>");
}
mkdirSync(join(clientDir, "assets"), { recursive: true });
mkdirSync(join(clientDir, "icons"), { recursive: true });
writeFileSync(join(clientDir, "assets", "app.js"), "private");
for (const asset of ["favicon.png", "ogimage.png", "app-store-icon.png", "apple-touch-icon.png"]) {
  writeFileSync(join(clientDir, asset), "private");
}
for (const asset of [
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "anything-else.png",
]) {
  writeFileSync(join(clientDir, "icons", asset), "private");
}
writeFileSync(
  join(clientDir, "manifest.webmanifest"),
  JSON.stringify({ name: "SHark", start_url: "/board" }),
);
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
      "/board",
      "/board/ask/bask_1",
      "/cli/authorize",
      "/assets/app.js",
      "/icons/anything-else.png",
      "/ogimage.png",
      "/docs.md",
      "/llms.txt",
      "/oss",
    ]) {
      expect((await app.request(path)).status, path).toBe(401);
    }
  });

  it("publishes exactly the explicit app assets with the right content types", async () => {
    const expected = new Map([
      ["/sw.js", /javascript/],
      ["/favicon.png", /image\/png/],
      ["/app-store-icon.png", /image\/png/],
      ["/manifest.webmanifest", /^application\/manifest\+json/],
      ["/apple-touch-icon.png", /image\/png/],
      ["/icons/icon-192.png", /image\/png/],
      ["/icons/icon-512.png", /image\/png/],
      ["/icons/icon-maskable-512.png", /image\/png/],
    ]);
    const { PUBLIC_APP_ASSETS } = await import("./static");
    expect([...PUBLIC_APP_ASSETS]).toEqual([...expected.keys()]);
    for (const [path, contentType] of expected) {
      const response = await app.request(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toMatch(contentType);
    }

    const worker = await app.request("/sw.js");
    expect(await worker.text()).toContain('self.addEventListener("push"');
    const manifestText = await (await app.request("/manifest.webmanifest")).text();
    expect(JSON.parse(manifestText)).toMatchObject({ name: "SHark", start_url: "/board" });
    expect(manifestText).not.toContain("@");
    expect(manifestText).not.toMatch(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
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
