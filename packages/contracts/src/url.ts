import { z } from "zod";

export function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local")
    ) {
      return false;
    }

    const ipv4 = hostname.split(".").map(Number);
    if (
      ipv4.length === 4 &&
      ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ) {
      const [a, b] = ipv4;
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        // Carrier-grade NAT and IETF protocol assignments reach internal hosts too.
        (a === 100 && b !== undefined && b >= 64 && b <= 127) ||
        (a === 192 && b === 0) ||
        (a === 198 && b !== undefined && (b === 18 || b === 19)) ||
        a === 224 ||
        a === 255
      ) {
        return false;
      }
    }

    if (
      hostname === "::1" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("fe80:") ||
      // IPv4-mapped IPv6 (::ffff:127.0.0.1) otherwise bypasses the checks above.
      hostname.startsWith("::ffff:")
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export const publicHttpsUrlSchema = z
  .url()
  .max(2048)
  .refine(isPublicHttpsUrl, "Must be a public HTTPS URL");
