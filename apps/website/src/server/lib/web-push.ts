import type { WebPushSubscriptionInput } from "@hark/contracts";
import webpush from "web-push";
import type { webPushSubscription } from "../db/schema";
import { env } from "../env";
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
  if (!configureVapid()) {
    result.errors.push("Browser push is not configured");
    return result;
  }

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
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload), {
          TTL: 300,
          urgency: "high",
        });
        result.accepted += 1;
      } catch (error) {
        const statusCode =
          typeof error === "object" && error && "statusCode" in error
            ? Number(error.statusCode)
            : undefined;
        if (statusCode === 404 || statusCode === 410) {
          result.staleSubscriptionIds.push(row.id);
        }
        result.errors.push(error instanceof Error ? error.message : "Browser push request failed");
      }
    }),
  );
  return result;
}
