import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import { requireAuth } from "./middleware";

export const PRIVATE_DOCUMENT_ROUTES = [
  "/",
  "/docs",
  "/privacy",
  "/terms",
  "/dashboard",
  "/board",
] as const;
export const PRIVATE_ROOT_ASSETS = ["/ogimage.png"] as const;
export const PUBLIC_PUSH_ASSETS = ["/sw.js", "/favicon.png", "/app-store-icon.png"] as const;

export function mountPrivateStaticRoutes(
  app: Hono,
  clientDir: string,
  staticRoot = "./dist/client",
): void {
  if (!existsSync(clientDir)) return;

  for (const path of PRIVATE_DOCUMENT_ROUTES) {
    const file = path === "/" ? "index.html" : `${path.slice(1)}/index.html`;
    if (existsSync(resolve(clientDir, file))) {
      app.get(path, requireAuth, serveStatic({ path: `${staticRoot}/${file}` }));
    }
  }

  // Ask deep links from pushes render the same board shell.
  const boardFile = "board/index.html";
  if (existsSync(resolve(clientDir, boardFile))) {
    app.get("/board/ask/:id", requireAuth, serveStatic({ path: `${staticRoot}/${boardFile}` }));
  }

  // Client-routed team pages, invite links, and OAuth consent render the dashboard shell.
  const dashboardFile = "dashboard/index.html";
  if (existsSync(resolve(clientDir, dashboardFile))) {
    for (const path of ["/dashboard/teams/:teamId", "/join/:code", "/oauth/consent"]) {
      app.get(path, requireAuth, serveStatic({ path: `${staticRoot}/${dashboardFile}` }));
    }
  }

  const cliFile = "cli/authorize/index.html";
  if (existsSync(resolve(clientDir, cliFile))) {
    app.get("/cli/authorize", requireAuth, serveStatic({ path: `${staticRoot}/${cliFile}` }));
  }
  for (const path of PRIVATE_ROOT_ASSETS) {
    const file = path.slice(1);
    if (existsSync(resolve(clientDir, file))) {
      app.get(path, requireAuth, serveStatic({ path: `${staticRoot}/${file}` }));
    }
  }
  for (const path of PUBLIC_PUSH_ASSETS) {
    const file = path.slice(1);
    if (existsSync(resolve(clientDir, file))) {
      app.get(path, serveStatic({ path: `${staticRoot}/${file}` }));
    }
  }
  app.use("/assets/*", requireAuth, serveStatic({ root: staticRoot }));
}
