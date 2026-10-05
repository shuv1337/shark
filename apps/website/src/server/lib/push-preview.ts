import type { ExpoPushMessage } from "expo-server-sdk";

/** Hard APNs limit for a regular remote-notification payload. */
export const APNS_PAYLOAD_BYTE_LIMIT = 4_096;

/**
 * Byte budget for the JSON-serialized Expo push message. Expo re-wraps the
 * message into the final APNs payload (an `aps` alert envelope, scope keys,
 * rich-content attachments), so a generous margin keeps the delivered payload
 * clearly below the 4,096-byte APNs cap even after that re-encoding.
 */
export const EXPO_MESSAGE_BYTE_BUDGET = 3_328;

const ELLIPSIS = "…";

const graphemeSegmenter: Intl.Segmenter | undefined =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter()
    : undefined;

/** Units the truncation may end on: grapheme clusters, or code points as a fallback. */
function textUnits(value: string): string[] {
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(value), (segment) => segment.segment);
  }
  return Array.from(value);
}

/** Bytes `value` occupies inside a JSON document, exclusive of the quotes. */
function jsonTextBytes(value: string): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8") - 2;
}

/** Serialized size of the whole Expo message as Expo receives it. */
function messageBytes(message: ExpoPushMessage): number {
  return Buffer.byteLength(JSON.stringify(message), "utf8");
}

/**
 * Longest prefix of `text` whose JSON-escaped form fits `maxJsonBytes`,
 * ending on a grapheme boundary and marked with an ellipsis when shortened.
 */
export function truncatePushText(text: string, maxJsonBytes: number): string {
  if (maxJsonBytes <= 0) return "";
  if (jsonTextBytes(text) <= maxJsonBytes) return text;
  const suffixBytes = jsonTextBytes(ELLIPSIS);
  let bytes = 0;
  let result = "";
  for (const unit of textUnits(text)) {
    const unitBytes = jsonTextBytes(unit);
    if (bytes + unitBytes + suffixBytes > maxJsonBytes) break;
    bytes += unitBytes;
    result += unit;
  }
  return result.length > 0 ? result + ELLIPSIS : "";
}

/**
 * Optional display metadata, in the exact order it is sacrificed when a
 * message cannot fit the byte budget even with an empty body:
 *
 *   1. `richContent` — the rich-attachment duplicate of the image URL. The
 *      communication-notification avatar still renders from `data.avatarUrl`,
 *      so dropping the duplication loses no information.
 *   2. `data.avatarUrl` — the push degrades to a plain notification without
 *      an avatar; the sender name, conversation grouping, and every
 *      compatibility key stay intact.
 *   3. `data.url` — the tap destination is removed only as the very last
 *      resort, when the message would otherwise exceed the budget with an
 *      empty body and no images (an undeliverable push would lose the whole
 *      notification, including the destination). Ordinary schema-valid
 *      notifications never reach this step; see the boundary tests.
 *
 * Compatibility-critical fields are never touched: `to`, `title`, `body`
 * presence, `priority`, `mutableContent`, top-level `categoryId`, and the
 * data keys `v`, `eventId`, `serviceId`, `sourceId`, `sourceName`,
 * `conversationId`, `projectId`, `appId`, `interactionId`, `interactionKind`,
 * `categoryId`, `actionDigest`, `responseToken`, and withdrawal `command`s.
 */
export const PUSH_FIELD_DROP_ORDER = ["richContent", "avatarUrl", "url"] as const;
type OptionalPushField = (typeof PUSH_FIELD_DROP_ORDER)[number];

/** Copy of `message` without the dropped optional fields, key order preserved. */
function dropOptionalFields<T extends ExpoPushMessage>(
  message: T,
  dropped: ReadonlySet<OptionalPushField>,
): T {
  if (dropped.size === 0) return message;
  const next = { ...message };
  if (dropped.has("richContent")) delete (next as { richContent?: unknown }).richContent;
  if (
    (dropped.has("avatarUrl") || dropped.has("url")) &&
    typeof message.data === "object" &&
    message.data !== null
  ) {
    const data = { ...(message.data as Record<string, unknown>) };
    if (dropped.has("avatarUrl")) delete data.avatarUrl;
    if (dropped.has("url")) delete data.url;
    next.data = data;
  }
  return next;
}

/**
 * Bounds the serialized Expo message under `budget` for every notification.
 *
 * The common case returns the message unchanged, by reference, so existing
 * short messages stay bit-for-bit identical. An oversized message degrades
 * deterministically: the body is truncated byte-safely first, and only when
 * the overhead alone (an empty body) still exceeds the budget are optional
 * display fields removed in {@link PUSH_FIELD_DROP_ORDER}. At every level the
 * body receives all remaining bytes, so fields are dropped only when keeping
 * them cannot fit at all.
 */
export function fitPushMessage<T extends ExpoPushMessage>(
  message: T,
  budget: number = EXPO_MESSAGE_BYTE_BUDGET,
): T {
  if (messageBytes(message) <= budget) return message;

  const dropped = new Set<OptionalPushField>();
  for (let level = 0; level <= PUSH_FIELD_DROP_ORDER.length; level += 1) {
    const field = level > 0 ? PUSH_FIELD_DROP_ORDER[level - 1] : undefined;
    if (field) dropped.add(field);
    const candidate = dropOptionalFields(message, dropped);
    if (typeof candidate.body !== "string") {
      // Data-only messages (e.g. withdrawals) carry no body to truncate.
      if (messageBytes(candidate) <= budget) return candidate;
      continue;
    }
    const overhead = messageBytes({ ...candidate, body: "" });
    if (overhead > budget) continue;
    return { ...candidate, body: truncatePushText(candidate.body, budget - overhead) };
  }

  // Unreachable for schema-valid inputs: even an empty body with every
  // optional field dropped exceeds the budget. Return the most degraded
  // form rather than growing the message back.
  const bare = dropOptionalFields(message, new Set(PUSH_FIELD_DROP_ORDER));
  return typeof bare.body === "string" ? { ...bare, body: "" } : bare;
}
