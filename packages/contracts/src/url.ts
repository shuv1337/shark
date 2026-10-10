import { z } from "zod";
import { isIpv4Literal, isPublicAddress } from "./ip";

/** Special-use names that only ever resolve on the local host or network. */
const LOCAL_NAME_SUFFIXES = ["localhost", "local", "internal", "home.arpa"];

export function isPublicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  // WHATWG URL already rewrites decimal, octal, and hex IPv4 spellings to dotted decimal
  // and compresses IPv6. Trailing dots are the absolute form of the same DNS name.
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (hostname.startsWith("[")) return isPublicAddress(hostname.slice(1, -1));
  if (isIpv4Literal(hostname)) return isPublicAddress(hostname);
  // A single-label name resolves through local search domains, never the public DNS.
  if (!hostname.includes(".")) return false;
  return !LOCAL_NAME_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}

/**
 * The normalized href of a public HTTPS URL without credentials, else null. Use it before
 * rendering a URL someone else supplied, so a loose spelling never reaches the page as-is.
 */
export function publicHttpsHref(value: string | null | undefined): string | null {
  if (!value || !isPublicHttpsUrl(value)) return null;
  const url = new URL(value);
  return url.username || url.password ? null : url.href;
}

/**
 * Push services that production browsers hand out subscription endpoints on:
 * FCM (Chrome, Opera, Samsung Internet), Mozilla autopush (Firefox), WNS
 * (Edge), and Apple's web push service (Safari). A leading `*.` matches any
 * subdomain but not the bare suffix.
 */
export const WEB_PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "*.notify.windows.com",
  "*.push.apple.com",
] as const;

export function isKnownWebPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  // WHATWG URL already normalizes an explicit :443 on https to "".
  if (url.port !== "") return false;
  // One trailing dot is the absolute form of the same name; `..` is not a hostname.
  const hostname = url.hostname.toLowerCase().replace(/(?<!\.)\.$/, "");
  return WEB_PUSH_SERVICE_HOSTS.some((pattern) => {
    if (!pattern.startsWith("*.")) return hostname === pattern;
    const suffix = pattern.slice(1);
    if (!hostname.endsWith(suffix)) return false;
    const labels = hostname.slice(0, -suffix.length).split(".");
    return (
      labels.every((label) => DNS_LABEL.test(label)) &&
      !(labels.length === 4 && labels.every((label) => /^\d+$/.test(label)))
    );
  });
}

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const publicHttpsUrlSchema = z
  .url()
  .max(2048)
  .refine(isPublicHttpsUrl, "Must be a public HTTPS URL");
