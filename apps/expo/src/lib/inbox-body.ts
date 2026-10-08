import { tapDestinationUrlSchema } from "@hark/contracts";
import { Alert, Linking } from "react-native";

/**
 * Plaintext body rendering for notification detail. The body is split into
 * text and link segments; nothing is ever interpreted as HTML and links are
 * revalidated at tap time, so stored content can never smuggle an executable
 * or local-content scheme past ingestion-time validation.
 */

export interface BodySegment {
  text: string;
  /** Present when the segment is a tappable link. */
  url?: string;
}

// Conservative URL matcher: an explicit scheme followed by `://`. Trailing
// punctuation that commonly ends a sentence is not treated as part of the URL.
const URL_PATTERN = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>]+$/;

/** Splits a plaintext body into text and validated link segments. */
export function linkifyBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const trimmed = raw.replace(TRAILING_PUNCTUATION, "");
    // Only linkify destinations that pass the shared tap-destination rules.
    if (!tapDestinationUrlSchema.safeParse(trimmed).success) continue;
    if (index > lastIndex) segments.push({ text: body.slice(lastIndex, index) });
    segments.push({ text: trimmed, url: trimmed });
    lastIndex = index + trimmed.length;
  }
  if (lastIndex < body.length) segments.push({ text: body.slice(lastIndex) });
  return segments.length > 0 ? segments : [{ text: body }];
}

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export interface OpenBodyLinkRuntime {
  openUrl: (url: string) => Promise<unknown>;
  confirm: (url: string) => Promise<boolean>;
}

async function confirmWithAlert(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert("Open in another app?", url, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Open", onPress: () => resolve(true) },
    ]);
  });
}

const defaultRuntime: OpenBodyLinkRuntime = {
  openUrl: (url) => Linking.openURL(url),
  confirm: confirmWithAlert,
};

/**
 * Opens a link found inside body text. The URL is revalidated at tap time;
 * dangerous schemes stay blocked, http(s) opens directly, and any other
 * scheme (custom app links) requires an explicit user confirmation.
 */
export async function openBodyLink(
  url: string,
  runtime: OpenBodyLinkRuntime = defaultRuntime,
): Promise<boolean> {
  const validated = tapDestinationUrlSchema.safeParse(url);
  if (!validated.success) return false;
  if (!isHttpUrl(validated.data)) {
    const approved = await runtime.confirm(validated.data);
    if (!approved) return false;
  }
  await runtime.openUrl(validated.data).catch(() => {});
  return true;
}

/**
 * Opens the notification's own top-level destination. It went through
 * ingestion validation, is revalidated here, and opens on explicit tap with
 * the same rules as a push tap (custom schemes included, no confirmation).
 */
export async function openTopLevelDestination(
  url: string,
  runtime: Pick<OpenBodyLinkRuntime, "openUrl"> = defaultRuntime,
): Promise<boolean> {
  const validated = tapDestinationUrlSchema.safeParse(url);
  if (!validated.success) return false;
  await runtime.openUrl(validated.data).catch(() => {});
  return true;
}

/**
 * Maps a push `eventId` to the composite detail-route ID. Agent notification
 * IDs are prefixed `anot`; everything else originated as a webhook event.
 */
export function compositeIdForPushEvent(eventId: string): string {
  return eventId.startsWith("anot") ? `notification:${eventId}` : `event:${eventId}`;
}
