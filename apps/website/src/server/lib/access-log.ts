import type { Context, Next } from "hono";

/**
 * Path prefixes whose next segment is a plaintext bearer credential: webhook
 * tokens, conversation references, and team-invite join codes.
 */
const CREDENTIAL_PREFIXES: ReadonlyArray<readonly [prefix: string, placeholder: string]> = [
  ["/hooks/", ":token"],
  ["/conversation/v1/", ":reference"],
  ["/join/", ":code"],
  ["/api/team-invites/", ":code"],
];

/** The request path with credential segments replaced, safe for a log sink. */
export function redactedRequestPath(path: string): string {
  for (const [prefix, placeholder] of CREDENTIAL_PREFIXES) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf("/");
    return `${prefix}${placeholder}${slash === -1 ? "" : rest.slice(slash)}`;
  }
  return path;
}

/** Logs requests without query strings or credential path segments. */
export async function accessLog(c: Context, next: Next): Promise<void> {
  const startedAt = Date.now();
  await next();
  console.log(
    `${c.req.method} ${redactedRequestPath(c.req.path)} ${c.res.status} ${Date.now() - startedAt}ms`,
  );
}
