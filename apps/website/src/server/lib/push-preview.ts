import type { ExpoPushMessage } from "expo-server-sdk";

export const APNS_PAYLOAD_BYTE_LIMIT = 4_096;

// Expo adds an APNs envelope after accepting this JSON. This is conservative
// headroom, not a guarantee about Expo's final provider payload encoding.
export const EXPO_MESSAGE_BYTE_BUDGET = 3_328;

// RFC 8291: 4,096 encrypted bytes minus the aes128gcm header, delimiter and tag.
export const WEB_PUSH_PAYLOAD_BYTE_LIMIT = 3_993;

const segmenter = new Intl.Segmenter();
const ELLIPSIS = "…";

export function pushJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** JSON-escaped bytes within a string, excluding its enclosing quotes. */
function textBytes(value: string): number {
  return pushJsonBytes(value) - 2;
}

/** Keep whole graphemes and account for JSON escaping as well as UTF-8 bytes. */
export function truncatePushText(value: string, budget: number): string {
  if (budget <= 0) return "";
  if (textBytes(value) <= budget) return value;
  const suffixBytes = textBytes(ELLIPSIS);
  let prefix = "";
  let bytes = 0;
  for (const { segment } of segmenter.segment(value)) {
    const nextBytes = textBytes(segment);
    if (bytes + nextBytes + suffixBytes > budget) break;
    prefix += segment;
    bytes += nextBytes;
  }
  return prefix ? prefix + ELLIPSIS : "";
}

export class PushPreviewTooLargeError extends Error {
  constructor(budget: number) {
    // Never include notification content, recipient identities or credentials.
    super(`Push payload metadata exceeds the ${budget}-byte budget`);
    this.name = "PushPreviewTooLargeError";
  }
}

/**
 * Fit only the visible body and explicitly optional display fields. All other
 * metadata survives unchanged, or the provider send fails locally. `measure`
 * must include the transport envelope with body encoded as a JSON string.
 */
export function fitPushPreview<T extends { body?: string }>(
  payload: T,
  budget: number,
  dropOptional: ReadonlyArray<(payload: T) => T>,
  measure: (payload: T) => number = pushJsonBytes,
): T {
  if (measure(payload) <= budget) return payload;
  let candidate = payload;
  for (let level = 0; level <= dropOptional.length; level++) {
    const drop = level > 0 ? dropOptional[level - 1] : undefined;
    if (drop) candidate = drop(candidate);
    if (typeof candidate.body === "string") {
      const overhead = measure({ ...candidate, body: "" });
      if (overhead > budget) continue;
      const fitted = { ...candidate, body: truncatePushText(candidate.body, budget - overhead) };
      if (measure(fitted) <= budget) return fitted;
    } else if (measure(candidate) <= budget) {
      return candidate;
    }
  }
  throw new PushPreviewTooLargeError(budget);
}

/** Remove optional metadata by copying; builders share data between recipients. */
function withoutDataField<T extends ExpoPushMessage>(message: T, field: "avatarUrl" | "url"): T {
  const data = { ...message.data };
  delete data[field];
  return { ...message, data };
}

export function fitPushMessage<T extends ExpoPushMessage>(message: T): T {
  return fitPushPreview(message, EXPO_MESSAGE_BYTE_BUDGET, [
    (candidate) => {
      const next = { ...candidate };
      delete next.richContent;
      return next;
    },
    (candidate) => withoutDataField(candidate, "avatarUrl"),
    (candidate) => withoutDataField(candidate, "url"),
  ]);
}
