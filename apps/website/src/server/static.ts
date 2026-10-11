import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono, MiddlewareHandler } from "hono";
import { requireAuth } from "./middleware";

export const PRIVATE_DOCUMENT_ROUTES = [
  "/",
  "/docs",
  "/privacy",
  "/terms",
  "/dashboard",
  "/board",
  "/inbox",
  "/teams",
  "/settings",
] as const;
export const PRIVATE_ROOT_ASSETS = ["/ogimage.png"] as const;
export const PUBLIC_PUSH_ASSETS = ["/sw.js", "/favicon.png", "/app-store-icon.png"] as const;

/**
 * Paths that never render an application shell. Everything under them keeps
 * its own 404: an API or hook miss is a client error, not a page, and an
 * `/assets/*` miss must not answer with HTML.
 */
const NON_SHELL_PREFIXES = ["/api", "/hooks", "/mcp", "/.well-known", "/assets"] as const;

/**
 * A shell is a page address. Anything with a file extension is an asset, at
 * any depth: `/inbox/item.json` is a mistyped fetch, not a notification, and
 * answering it with HTML would only hide the mistake.
 */
export function servesAppShell(path: string): boolean {
  if (NON_SHELL_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return false;
  }
  return !/\.[^/]+$/.test(path);
}

export function mountPrivateStaticRoutes(
  app: Hono,
  clientDir: string,
  staticRoot = "./dist/client",
): void {
  if (!existsSync(clientDir)) return;

  /** Routes with a parameter accept any segment, so they check it is a page. */
  const pageAddress: MiddlewareHandler = async (c, next) =>
    servesAppShell(c.req.path) ? next() : c.notFound();

  for (const path of PRIVATE_DOCUMENT_ROUTES) {
    const file = path === "/" ? "index.html" : `${path.slice(1)}/index.html`;
    if (existsSync(resolve(clientDir, file))) {
      app.get(path, requireAuth, serveStatic({ path: `${staticRoot}/${file}` }));
    }
  }

  // Ask deep links from pushes render the same board shell.
  const boardFile = "board/index.html";
  if (existsSync(resolve(clientDir, boardFile))) {
    app.get(
      "/board/ask/:id",
      pageAddress,
      requireAuth,
      serveStatic({ path: `${staticRoot}/${boardFile}` }),
    );
  }

  // One inbox item, deep-linked from a push, renders the inbox shell.
  const inboxFile = "inbox/index.html";
  if (existsSync(resolve(clientDir, inboxFile))) {
    app.get(
      "/inbox/:id",
      pageAddress,
      requireAuth,
      serveStatic({ path: `${staticRoot}/${inboxFile}` }),
    );
  }

  const teamsFile = "teams/index.html";
  if (existsSync(resolve(clientDir, teamsFile))) {
    app.get(
      "/teams/:teamId",
      pageAddress,
      requireAuth,
      serveStatic({ path: `${staticRoot}/${teamsFile}` }),
    );
  }

  // Invite links and OAuth consent render the dashboard shell, as do the
  // `/dashboard/*` addresses the client now redirects.
  const dashboardFile = "dashboard/index.html";
  if (existsSync(resolve(clientDir, dashboardFile))) {
    for (const path of ["/dashboard/teams/:teamId", "/join/:code", "/oauth/consent"]) {
      app.get(
        path,
        pageAddress,
        requireAuth,
        serveStatic({ path: `${staticRoot}/${dashboardFile}` }),
      );
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

  /*
   * Any other page address: a typed URL, a stale deep link, a route this build
   * does not have yet. It answers with the authenticated 404 shell so the
   * client renders its own not-found page inside the app, with the navigation
   * still there. It stays behind `requireAuth`, so it tells an anonymous
   * visitor nothing about which paths exist.
   */
  const notFoundFile = "404/index.html";
  if (existsSync(resolve(clientDir, notFoundFile))) {
    app.get("*", pageAddress, requireAuth, serveStatic({ path: `${staticRoot}/${notFoundFile}` }));
  }
}
