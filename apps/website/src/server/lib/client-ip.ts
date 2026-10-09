import { isIP } from "node:net";
import { env } from "../env";

/**
 * Request header Better Auth reads the client IP from. The app always replaces
 * it with {@link trustedClientIp} before Better Auth sees a request, so a value
 * sent by the client never reaches its rate limiter.
 */
export const CLIENT_IP_HEADER = "x-shark-client-ip";

type HeaderReader = (name: string) => string | null | undefined;

/**
 * The client IP as reported by the trusted edge, or null when the deployment
 * trusts no forwarded address. Headers a client can set itself are spoofable, so
 * only the configured header, or the entry the configured number of trusted
 * proxies appended to X-Forwarded-For, is used.
 */
export function trustedClientIp(
  header: HeaderReader,
  config: Pick<typeof env, "TRUSTED_CLIENT_IP_HEADER" | "TRUSTED_FORWARDED_FOR_HOPS"> = env,
): string | null {
  let candidate: string | undefined;
  if (config.TRUSTED_CLIENT_IP_HEADER) {
    candidate = header(config.TRUSTED_CLIENT_IP_HEADER)?.split(",", 1)[0];
  } else if (config.TRUSTED_FORWARDED_FOR_HOPS > 0) {
    const chain = (header("x-forwarded-for") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    candidate = chain[chain.length - config.TRUSTED_FORWARDED_FOR_HOPS];
  }
  const value = candidate?.trim();
  return value && isIP(value) ? value : null;
}

/** Copies `request` with {@link CLIENT_IP_HEADER} set to the trusted client IP (or removed). */
export function withTrustedClientIp(request: Request): Request {
  const headers = new Headers(request.headers);
  const ip = trustedClientIp((name) => request.headers.get(name));
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  else headers.delete(CLIENT_IP_HEADER);
  return new Request(request, { headers });
}
