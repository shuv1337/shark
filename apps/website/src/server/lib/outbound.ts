import { lookup } from "node:dns/promises";
import type { ClientRequest, IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { isPublicAddress, isPublicHttpsUrl } from "@hark/contracts";

export { isPublicAddress };

/**
 * Outbound POSTs to user-chosen URLs (board ask and interaction callbacks).
 *
 * The hostname is resolved once per attempt, every A/AAAA record must be a
 * public address, and the socket connects to one of those validated IPs. TLS
 * SNI, certificate verification, and the Host header keep the original
 * hostname, so DNS rebinding can't swap the address between the check and the
 * connect. Redirects are never followed; the response body is discarded and the
 * connection is closed as soon as the status arrives.
 */

export type ResolvedAddress = { address: string; family: number };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;
export type RequestFn = (
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest;

export type CallbackError = "blocked_destination" | "timeout" | "network_error" | `HTTP ${number}`;
export type CallbackOutcome = { ok: true } | { ok: false; error: CallbackError };

/** Swappable so tests never touch real DNS or sockets, or relax the address policy. */
export const outbound: {
  resolve: Resolver;
  request: RequestFn;
  isAllowedAddress: (address: string) => boolean;
} = {
  resolve: (hostname) => lookup(hostname, { all: true, order: "verbatim" }),
  request: httpsRequest,
  isAllowedAddress: (address) => isPublicAddress(address),
};

export type PostOptions = {
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
};

export class BlockedDestinationError extends Error {}
class TimeoutError extends Error {}

/**
 * Errors only raised while connecting, so the request never reached the
 * receiver and the next validated address is safe to try. ETIMEDOUT is left
 * out because it can also come from an established socket; the overall
 * deadline bounds slow connects instead.
 */
const CONNECT_ERRORS = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EADDRNOTAVAIL"]);

export async function postCallback(url: string, options: PostOptions): Promise<CallbackOutcome> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError()), timeoutMs);
  try {
    if (!isPublicHttpsUrl(url)) return { ok: false, error: "blocked_destination" };
    const target = new URL(url);
    const hostname = target.hostname.replace(/^\[|\]$/g, "");
    const records = await abortable(
      pinAddresses(hostname, outbound.resolve, outbound.isAllowedAddress),
      controller.signal,
    );
    let status: number | undefined;
    for (const [index, pinned] of records.entries()) {
      try {
        status = await send(target, hostname, pinned, options, controller.signal);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const last = index === records.length - 1;
        if (last || controller.signal.aborted || !code || !CONNECT_ERRORS.has(code)) throw error;
      }
    }
    if (status !== undefined && status >= 200 && status < 300) return { ok: true };
    return { ok: false, error: `HTTP ${status ?? 0}` };
  } catch (error) {
    if (error instanceof BlockedDestinationError)
      return { ok: false, error: "blocked_destination" };
    if (controller.signal.aborted) return { ok: false, error: "timeout" };
    return { ok: false, error: "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolves `hostname` and returns the addresses to connect to, in resolver
 * order. Rejects if any record is disallowed, so a mixed public/private answer
 * can't be used.
 */
export async function pinAddresses(
  hostname: string,
  resolve: Resolver,
  isAllowed: (address: string) => boolean = isPublicAddress,
): Promise<ResolvedAddress[]> {
  const literal = isIP(hostname);
  const records = literal ? [{ address: hostname, family: literal }] : await resolve(hostname);
  if (records.length === 0 || records.some((record) => !isAllowed(record.address))) {
    throw new BlockedDestinationError("blocked_destination");
  }
  return records;
}

function send(
  target: URL,
  hostname: string,
  pinned: ResolvedAddress,
  options: PostOptions,
  signal: AbortSignal,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(options.body);
    const req = outbound.request(
      {
        method: "POST",
        host: pinned.address,
        family: pinned.family,
        port: target.port ? Number(target.port) : 443,
        path: `${target.pathname}${target.search}`,
        servername: isIP(hostname) ? undefined : hostname,
        headers: { ...options.headers, host: target.host, "content-length": String(body.length) },
        agent: false,
        signal,
      },
      (response) => {
        resolve(response.statusCode ?? 0);
        // Only the status matters; a receiver that never ends its body must not hold the socket.
        response.on("error", () => undefined);
        req.destroy();
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

/** Settles with `promise`, or rejects with the abort reason as soon as `signal` fires. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}
