import { createMiddleware } from "hono/factory";
import { env } from "../env";

/**
 * True when a state-changing browser request names this deployment as its
 * origin. Session cookies travel cross-site, so every cookie-authenticated
 * POST checks this to refuse forged submissions from another page. The public
 * origin comes from APP_URL because the proxy rewrites the request URL.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(env.APP_URL).origin;
}

/**
 * Same-origin check for cookie-authenticated routes the iPhone app also calls.
 * Browsers always send `Origin` on a cross-site POST (or `null`), so a foreign
 * or null origin is refused; the native client sends no `Origin` at all and is
 * allowed through on its session cookie.
 */
export function isSameOriginOrNative(request: Request): boolean {
  return request.headers.get("origin") === null || isSameOrigin(request);
}

/** Refuses state-changing requests that fail {@link isSameOriginOrNative}. */
export const requireSameOriginOrNative = createMiddleware(async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && !isSameOriginOrNative(c.req.raw)) {
    return c.json({ error: "Invalid request origin" }, 403);
  }
  await next();
});
