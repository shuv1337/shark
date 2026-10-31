import type { Context, Next } from "hono";

/**
 * Path prefixes whose next segment is a plaintext bearer credential: webhook
 * tokens, conversation references, team-invite join codes, and device-code
 * user codes.
 */
const CREDENTIAL_PREFIXES: ReadonlyArray<readonly [prefix: string, placeholder: string]> = [
  ["/hooks/", ":token"],
  ["/conversation/v1/", ":reference"],
  ["/join/", ":code"],
  ["/api/team-invites/", ":code"],
  ["/api/device-authorization/requests/", ":code"],
];

/** Non-canonical credential segments (`//hooks/…`, mixed case) and bearer-shaped tokens. */
const SECRET_SEGMENT =
  /\/(hooks|team-invites|join|device-authorization\/requests|conversation\/v1)\/[^/?#]+/gi;
const SECRET_TOKEN = /(?:whk|hark)_[^/?#]*/gi;

function redactOnce(path: string): string {
  for (const [prefix, placeholder] of CREDENTIAL_PREFIXES) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf("/");
    return `${prefix}${placeholder}${slash === -1 ? "" : rest.slice(slash)}`;
  }
  return path.replace(SECRET_SEGMENT, "/$1/:redacted").replace(SECRET_TOKEN, ":redacted");
}

/**
 * The request path with credential segments replaced, safe for a log sink.
 * Matching is by pattern rather than route so non-canonical paths that 404
 * (`//hooks/…`, `/HOOKS/…`, percent-encoded tokens) are covered too.
 */
export function redactedRequestPath(path: string): string {
  const redacted = redactOnce(path);
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return redacted;
  }
  if (decoded === path) return redacted;
  // A percent-encoded credential still has to disappear, even when the raw
  // patterns only caught part of it.
  return redactOnce(decoded) !== decoded ? ":redacted" : redacted;
}

/** Logs requests without query strings or credential path segments. */
export async function accessLog(c: Context, next: Next): Promise<void> {
  const startedAt = Date.now();
  await next();
  console.log(
    `${c.req.method} ${redactedRequestPath(c.req.path)} ${c.res.status} ${Date.now() - startedAt}ms`,
  );
}
