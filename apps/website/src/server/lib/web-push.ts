import { Agent } from "node:https";
import type { LookupFunction } from "node:net";
import { isKnownWebPushEndpoint, type WebPushSubscriptionInput } from "@hark/contracts";
import webpush from "web-push";
import type { webPushSubscription } from "../db/schema";
import { env } from "../env";
import {
  abortable,
  BlockedDestinationError,
  outbound,
  pinAddresses,
  type ResolvedAddress,
} from "./outbound";
import {
  fitPushPreview,
  PushPreviewTooLargeError,
  WEB_PUSH_PAYLOAD_BYTE_LIMIT,
} from "./push-preview";
import { decryptWebPushSubscription } from "./token";

export interface WebPushPayload {
  title?: string;
  body?: string;
  url?: string;
  imageUrl?: string;
  tag?: string;
  eventId?: string;
  command?: string;
  v?: number;
}

export interface WebPushSendResult {
  /** Requests accepted by the browser push service, not proof of display. */
  accepted: number;
  errors: string[];
  staleSubscriptionIds: string[];
}

type SubscriptionRow = typeof webPushSubscription.$inferSelect;

let configuredKey: string | undefined;

function configureVapid(): boolean {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return false;
  if (configuredKey !== env.VAPID_PUBLIC_KEY) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    configuredKey = env.VAPID_PUBLIC_KEY;
  }
  return true;
}

export async function sendWebPushNotifications(
  subscriptions: SubscriptionRow[],
  payload: WebPushPayload,
): Promise<WebPushSendResult> {
  const result: WebPushSendResult = { accepted: 0, errors: [], staleSubscriptionIds: [] };
  if (subscriptions.length === 0) return result;
  let serialized: string;
  try {
    const preview = fitPushPreview(payload, WEB_PUSH_PAYLOAD_BYTE_LIMIT, [
      (candidate) => {
        const next = { ...candidate };
        delete next.imageUrl;
        return next;
      },
      (candidate) => {
        const next = { ...candidate };
        delete next.url;
        return next;
      },
    ]);
    serialized = JSON.stringify(preview);
  } catch (error) {
    result.errors.push(
      error instanceof PushPreviewTooLargeError ? error.message : "Invalid browser push payload",
    );
    return result;
  }
  if (!configureVapid()) {
    result.errors.push("Browser push is not configured");
    return result;
  }

  const lookups = new Map<string, Promise<ResolvedAddress[]>>();
  await Promise.all(
    subscriptions.map(async (row) => {
      let subscription: WebPushSubscriptionInput;
      try {
        subscription = JSON.parse(
          decryptWebPushSubscription(row.subscriptionCiphertext),
        ) as WebPushSubscriptionInput;
      } catch {
        result.errors.push(`Invalid encrypted browser subscription ${row.id}`);
        return;
      }
      if (!isKnownWebPushEndpoint(subscription.endpoint)) {
        // Registration rejects these now; rows stored before that are never sent and get pruned.
        result.staleSubscriptionIds.push(row.id);
        result.errors.push(`Browser subscription ${row.id} uses an unrecognized push service`);
        return;
      }
      // web-push re-parses with legacy `url.parse`; the canonical form parses the same way there.
      const parsedEndpoint = new URL(subscription.endpoint);
      // Never send an absolute-form name as the TLS server name.
      parsedEndpoint.hostname = parsedEndpoint.hostname.replace(/\.$/, "");
      const endpoint = parsedEndpoint.href;
      // One deadline covers resolution and the request; web-push's own timeout only starts once
      // its socket exists, so it can't bound a stalled resolver.
      const deadline = Date.now() + WEB_PUSH_TIMEOUT_MS;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEB_PUSH_TIMEOUT_MS);
      let agent: Agent | undefined;
      try {
        try {
          agent = await abortable(pinnedAgent(endpoint, lookups), controller.signal);
        } catch (error) {
          result.errors.push(`Browser subscription ${row.id} ${resolveFailure(error, controller)}`);
          return;
        }
        try {
          await abortable(
            webpush.sendNotification({ ...subscription, endpoint }, serialized, {
              TTL: 300,
              urgency: "high",
              agent,
              timeout: Math.max(1, deadline - Date.now()),
            }),
            controller.signal,
          );
          result.accepted += 1;
        } catch (error) {
          if (controller.signal.aborted) {
            result.errors.push(`Browser subscription ${row.id} timed out`);
            return;
          }
          const statusCode =
            typeof error === "object" && error && "statusCode" in error
              ? Number(error.statusCode)
              : undefined;
          if (statusCode === 404 || statusCode === 410) {
            result.staleSubscriptionIds.push(row.id);
          }
          result.errors.push(
            error instanceof Error ? error.message : "Browser push request failed",
          );
        }
      } finally {
        clearTimeout(timer);
        agent?.destroy();
      }
    }),
  );
  return result;
}

/** End-to-end budget for one subscription: DNS resolution plus the push request. */
export const WEB_PUSH_TIMEOUT_MS = 10_000;

/** Neither case deactivates the row: the push service may be reachable again on the next send. */
function resolveFailure(error: unknown, controller: AbortController): string {
  if (controller.signal.aborted) return "timed out resolving its push service";
  if (error instanceof BlockedDestinationError) return "resolved to a blocked destination";
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && /^[A-Z_]+$/.test(code)
    ? `could not resolve its push service (${code})`
    : "could not resolve its push service";
}

/**
 * An agent that only connects to the addresses validated here, so a push
 * service name that resolves somewhere private (or rebinds between check and
 * connect) is never reached. TLS SNI and certificate checks keep the hostname.
 * `lookups` shares one resolution per hostname across a fan-out.
 */
async function pinnedAgent(
  endpoint: string,
  lookups: Map<string, Promise<ResolvedAddress[]>>,
): Promise<Agent> {
  const hostname = new URL(endpoint).hostname;
  let pending = lookups.get(hostname);
  if (!pending) {
    pending = pinAddresses(hostname, outbound.resolve, outbound.isAllowedAddress);
    lookups.set(hostname, pending);
  }
  const records = await pending;
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, records);
      return;
    }
    const record = records[0] as ResolvedAddress;
    callback(null, record.address, record.family);
  };
  return new Agent({ keepAlive: false, lookup });
}
