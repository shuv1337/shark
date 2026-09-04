import {
  HARK_APPROVAL_CATEGORY_ID,
  HARK_REPLY_CATEGORY_ID,
  HARK_YES_NO_CATEGORY_ID,
  type InteractionKind,
  type InteractionPushData,
  PUSH_SCHEMA_VERSION,
  type PushData,
  type WebhookRequest,
} from "@hark/contracts";
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import type { macosDevice, webPushSubscription } from "../db/schema";
import { env } from "../env";
import type { NotificationPayloadInput } from "./apns";
import { sendMacosPushNotifications } from "./macos-push";
import { buildNotificationWithdrawalPushMessages } from "./notification-withdrawal";
import { sendWebPushNotifications, type WebPushPayload } from "./web-push";

export { buildNotificationWithdrawalPushMessages };

export interface ServiceDefaults {
  title: string;
  imageUrl: string | null;
  url: string | null;
}

export interface ResolvedNotification {
  title: string;
  body: string;
  imageUrl?: string;
  url?: string;
}

/** Webhook overrides win; otherwise fall back to the service defaults. */
export function resolveNotification(
  service: ServiceDefaults,
  request: WebhookRequest,
): ResolvedNotification {
  return {
    title: request.title ?? service.title,
    body: request.body,
    imageUrl: request.imageUrl ?? service.imageUrl ?? undefined,
    url: request.url ?? service.url ?? undefined,
  };
}

export interface BuildPushInput {
  to: string[];
  eventId: string;
  serviceId: string;
  /** Overrides the thread grouping; defaults to the service so each service is one conversation. */
  conversationKey?: string;
  resolved: ResolvedNotification;
}

const WELCOME_MESSAGES = [
  {
    body: "SHark is ready to receive your private webhooks.",
    url: "https://shark.shuv.dev",
  },
] as const;

export function buildWelcomePushMessages(to: string): ExpoPushMessage[] {
  return WELCOME_MESSAGES.map((message, index) => {
    const data: PushData = {
      v: PUSH_SCHEMA_VERSION,
      eventId: `hark-welcome-${index + 1}`,
      serviceId: "hark-welcome",
      sourceId: "shark",
      sourceName: "SHark",
      url: message.url,
      conversationId: "hark-welcome",
    };
    return {
      to,
      title: "SHark",
      body: message.body,
      priority: "high",
      mutableContent: true,
      data,
    };
  });
}

export function buildPushMessages(input: BuildPushInput): ExpoPushMessage[] {
  const { to, eventId, serviceId, conversationKey, resolved } = input;
  const data: PushData = {
    v: PUSH_SCHEMA_VERSION,
    eventId,
    serviceId,
    sourceId: serviceId,
    sourceName: resolved.title,
    ...(resolved.imageUrl ? { avatarUrl: resolved.imageUrl } : {}),
    ...(resolved.url ? { url: resolved.url } : {}),
    conversationId: `hark-${conversationKey ?? serviceId}`,
  };

  return to.map((token) => ({
    to: token,
    title: resolved.title,
    body: resolved.body,
    priority: "high",
    mutableContent: true,
    ...(resolved.imageUrl ? { richContent: { image: resolved.imageUrl } } : {}),
    data,
  }));
}

export interface BuildInteractionPushInput {
  to: string[];
  interactionId: string;
  kind: InteractionKind;
  title: string;
  prompt: string;
  actionDigest: string;
  responseToken?: string;
  eventId?: string;
  imageUrl?: string;
  url?: string;
  /** Account-wide unresolved action count for the iOS app icon. */
  badge?: number;
}

export function buildInteractionPushMessages(input: BuildInteractionPushInput): ExpoPushMessage[] {
  const categoryId =
    input.kind === "approval"
      ? HARK_APPROVAL_CATEGORY_ID
      : input.kind === "yes_no"
        ? HARK_YES_NO_CATEGORY_ID
        : HARK_REPLY_CATEGORY_ID;
  const data: InteractionPushData = {
    v: PUSH_SCHEMA_VERSION,
    interactionId: input.interactionId,
    ...(input.eventId ? { eventId: input.eventId } : {}),
    interactionKind: input.kind,
    sourceName: input.title,
    conversationId: `hark-interaction-${input.interactionId}`,
    categoryId,
    actionDigest: input.actionDigest,
    ...(input.responseToken ? { responseToken: input.responseToken } : {}),
    ...(input.imageUrl ? { avatarUrl: input.imageUrl } : {}),
    ...(input.url ? { url: input.url } : {}),
  };
  return input.to.map((to) => ({
    to,
    title: input.title,
    body: input.prompt,
    categoryId,
    priority: "high",
    mutableContent: true,
    ...(input.badge !== undefined ? { badge: input.badge } : {}),
    ...(input.imageUrl ? { richContent: { image: input.imageUrl } } : {}),
    data,
  }));
}

let expoClient: Expo | undefined;
function getExpo(): Expo {
  if (!expoClient) {
    expoClient = new Expo(env.EXPO_ACCESS_TOKEN ? { accessToken: env.EXPO_ACCESS_TOKEN } : {});
  }
  return expoClient;
}

export interface SendResult {
  /** Requests accepted by Expo. This is not a device-delivery receipt. */
  accepted: number;
  errors: string[];
  /** Expo push tokens that Expo reported as no longer registered. */
  staleTokens: string[];
  /** Browser subscriptions rejected as expired or no longer registered. */
  staleSubscriptionIds: string[];
  /** Native macOS devices whose APNs capability token is no longer valid. */
  staleMacosDeviceIds: string[];
}

export async function sendPushMessages(messages: ExpoPushMessage[]): Promise<SendResult> {
  const expo = getExpo();
  const result: SendResult = {
    accepted: 0,
    errors: [],
    staleTokens: [],
    staleSubscriptionIds: [],
    staleMacosDeviceIds: [],
  };

  for (const chunk of expo.chunkPushNotifications(messages)) {
    let tickets: ExpoPushTicket[];
    try {
      tickets = await expo.sendPushNotificationsAsync(chunk);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "Expo push request failed");
      continue;
    }
    tickets.forEach((ticket, index) => {
      if (ticket.status === "ok") {
        result.accepted += 1;
        return;
      }
      result.errors.push(ticket.message ?? "Unknown push error");
      const to = chunk[index]?.to;
      if (ticket.details?.error === "DeviceNotRegistered" && typeof to === "string") {
        result.staleTokens.push(to);
      }
    });
  }

  return result;
}

export async function sendPushFanout(input: {
  expoMessages: ExpoPushMessage[];
  webSubscriptions: Array<typeof webPushSubscription.$inferSelect>;
  webPayload: WebPushPayload;
  macosDevices?: Array<typeof macosDevice.$inferSelect>;
  macosPayload?: NotificationPayloadInput;
}): Promise<SendResult> {
  const [expoResult, webResult, macosResult] = await Promise.all([
    sendPushMessages(input.expoMessages),
    sendWebPushNotifications(input.webSubscriptions, input.webPayload),
    input.macosPayload
      ? sendMacosPushNotifications(input.macosDevices ?? [], input.macosPayload)
      : Promise.resolve({ accepted: 0, errors: [], staleMacosDeviceIds: [] }),
  ]);
  return {
    accepted: expoResult.accepted + webResult.accepted + macosResult.accepted,
    errors: [...expoResult.errors, ...webResult.errors, ...macosResult.errors],
    staleTokens: expoResult.staleTokens,
    staleSubscriptionIds: webResult.staleSubscriptionIds,
    staleMacosDeviceIds: macosResult.staleMacosDeviceIds,
  };
}
