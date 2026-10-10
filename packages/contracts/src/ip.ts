/**
 * Public-address classification shared by the server (outbound callback pinning) and the
 * browser (rendering client-supplied URLs). Pure parsing, so it runs without `node:net`.
 */

type Prefix = readonly [Uint8Array, number];

const IPV4_OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);
const IPV6_GROUP = /^[0-9a-f]{1,4}$/;

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

/** True for a strict dotted-decimal IPv4 literal (no octal, hex, or shortened forms). */
export function isIpv4Literal(value: string): boolean {
  return IPV4.test(value);
}

/** True only for globally routable unicast addresses. Anything unparseable is not public. */
export function isPublicAddress(address: string): boolean {
  if (isIpv4Literal(address)) return isPublicIpv4(ipv4Bytes(address));
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
  const dotted = address.match(/^(.*:)([^:]*\.[^:]*)$/);
  if (dotted?.[1] && dotted[2]) {
    if (!isIpv4Literal(dotted[2])) return null;
    const [a = 0, b = 0, c = 0, d = 0] = ipv4Bytes(dotted[2]);
    address = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (part = "") => (part ? part.split(":") : []);
  const left = parse(halves[0]);
  const right = halves.length === 2 ? parse(halves[1]) : [];
  if (![...left, ...right].every((group) => IPV6_GROUP.test(group))) return null;
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < (halves.length === 2 ? 1 : 0)) return null;
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right].map((group) =>
    Number.parseInt(group, 16),
  );
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, i) => {
    bytes[i * 2] = group >> 8;
    bytes[i * 2 + 1] = group & 0xff;
  });
  return bytes;
}
