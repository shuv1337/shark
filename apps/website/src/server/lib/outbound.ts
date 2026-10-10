import { lookup } from "node:dns/promises";
import type { ClientRequest, IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { isPublicHttpsUrl } from "@hark/contracts";

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

class BlockedDestinationError extends Error {}
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
      controller,
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

function abortable<T>(promise: Promise<T>, controller: AbortController): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(controller.signal.reason);
    if (controller.signal.aborted) return onAbort();
    controller.signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      controller.signal.removeEventListener("abort", onAbort);
    });
  });
}

type Prefix = readonly [Uint8Array, number];

const BLOCKED_IPV4: ReadonlyArray<Prefix> = (
  [
    ["0.0.0.0", 8], // "this network", includes unspecified
    ["10.0.0.0", 8],
    ["100.64.0.0", 10], // CGNAT
    ["127.0.0.0", 8],
    ["169.254.0.0", 16], // link-local, cloud metadata
    ["172.16.0.0", 12],
    ["192.0.0.0", 24], // IETF protocol assignments
    ["192.0.2.0", 24], // TEST-NET-1
    ["192.88.99.0", 24], // 6to4 relay anycast
    ["192.168.0.0", 16],
    ["198.18.0.0", 15], // benchmarking
    ["198.51.100.0", 24], // TEST-NET-2
    ["203.0.113.0", 24], // TEST-NET-3
    ["224.0.0.0", 4], // multicast
    ["240.0.0.0", 4], // reserved, includes broadcast
  ] as const
).map(([prefix, bits]) => [ipv4Bytes(prefix), bits] as const);

// Ranges inside global unicast 2000::/3 that still aren't public. Ranges
// outside it (local-use NAT64 64:ff9b:1::/48, discard 100::/64, SRv6 SIDs
// 5f00::/16, and the rest) are already refused by the 2000::/3 check.
const BLOCKED_IPV6: ReadonlyArray<Prefix> = (
  [
    ["2001::", 23], // IETF protocol assignments: Teredo, benchmarking, ORCHID
    ["2001:db8::", 32], // documentation
    ["3fff::", 20], // documentation
  ] as const
).map(([prefix, bits]) => [ipv6Bytes(prefix) as Uint8Array, bits] as const);

const NAT64 = ipv6Bytes("64:ff9b::") as Uint8Array;
const SIX_TO_FOUR = ipv6Bytes("2002::") as Uint8Array;

/** True only for globally routable unicast addresses. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(ipv4Bytes(address));
  if (version !== 6) return false;
  const bytes = ipv6Bytes(address);
  if (!bytes) return false;
  // NAT64 well-known prefix and 6to4 embed an IPv4 address; judge that instead.
  if (matches(bytes, NAT64, 96)) return isPublicIpv4(bytes.subarray(12, 16));
  if (matches(bytes, SIX_TO_FOUR, 16)) return isPublicIpv4(bytes.subarray(2, 6));
  // Only global unicast 2000::/3 is public. Everything else, including ::,
  // ::1, IPv4-mapped/compatible ::/8, fc00::/7, fe80::/10, and ff00::/8, is not.
  if ((bytes[0] as number) >> 5 !== 0b001) return false;
  return !BLOCKED_IPV6.some(([prefix, bits]) => matches(bytes, prefix, bits));
}

function isPublicIpv4(bytes: Uint8Array): boolean {
  return !BLOCKED_IPV4.some(([prefix, bits]) => matches(bytes, prefix, bits));
}

function matches(bytes: Uint8Array, prefix: Uint8Array, bits: number): boolean {
  for (let i = 0; i < bits; i++) {
    const mask = 0x80 >> (i % 8);
    const index = Math.floor(i / 8);
    if (((bytes[index] as number) & mask) !== ((prefix[index] as number) & mask)) return false;
  }
  return true;
}

function ipv4Bytes(address: string): Uint8Array {
  return Uint8Array.from(address.split(".").map(Number));
}

function ipv6Bytes(input: string): Uint8Array | null {
  // A zone index means a scoped (link-local) address; never public.
  if (input.includes("%")) return null;
  let address = input.toLowerCase();
  const dotted = address.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted?.[1] && dotted[2]) {
    const [a = 0, b = 0, c = 0, d = 0] = ipv4Bytes(dotted[2]);
    address = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (part = "") =>
    part ? part.split(":").map((group) => Number.parseInt(group, 16)) : [];
  const left = parse(halves[0]);
  const right = halves.length === 2 ? parse(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0) return null;
  const groups = [...left, ...Array<number>(fill).fill(0), ...right];
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group))) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, i) => {
    bytes[i * 2] = group >> 8;
    bytes[i * 2 + 1] = group & 0xff;
  });
  return bytes;
}
