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
