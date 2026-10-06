import { and, desc, eq, inArray, like } from "drizzle-orm";
import { db } from "../db";
import {
  agentNotification,
  app,
  type boardAsk,
  device,
  macosDevice,
  webPushSubscription,
} from "../db/schema";
import { env } from "../env";
import { track } from "./analytics";
import { newId } from "./id";
import { buildPushMessages, sendPushFanout } from "./push";

type AskRow = typeof boardAsk.$inferSelect;

export function boardAskUrl(askId: string): string {
  return `${new URL(env.APP_URL).origin}/board/ask/${encodeURIComponent(askId)}`;
}

/** The registered web app whose launch URL is this deployment's board, if any. */
export async function boardAppId(userId: string): Promise<string | null> {
  const prefix = `${new URL(env.APP_URL).origin}/board`;
  const [row] = await db
    .select({ id: app.id })
    .from(app)
    .where(and(eq(app.userId, userId), like(app.url, `${prefix}%`)))
    .orderBy(desc(app.lastOpenedAt), desc(app.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export interface BoardPushResult {
  notificationId: string;
  accepted: number;
}

/**
 * Sends the one push for an ask revision as an ordinary agent notification:
 * the agent label as sender, the ask title as body, and a deep link into the
 * board. The ask body never enters a push; it is fetched over an authenticated
 * session when the card opens. Returns null when the account has no targets.
 */
export async function sendBoardAskPush(
  ask: AskRow,
  requesterTokenId: string,
): Promise<BoardPushResult | null> {
  const userId = ask.userId;
  const [devices, webSubscriptions, macosDevices] = await Promise.all([
    db
      .select()
      .from(device)
      .where(and(eq(device.userId, userId), eq(device.active, true), eq(device.platform, "ios")))
      .orderBy(desc(device.lastSeenAt)),
    db
      .select()
      .from(webPushSubscription)
      .where(and(eq(webPushSubscription.userId, userId), eq(webPushSubscription.active, true)))
      .orderBy(desc(webPushSubscription.lastSeenAt)),
    db
      .select()
      .from(macosDevice)
      .where(and(eq(macosDevice.userId, userId), eq(macosDevice.active, true)))
      .orderBy(desc(macosDevice.lastSeenAt)),
  ]);
  const targetCount = devices.length + webSubscriptions.length + macosDevices.length;
  if (targetCount === 0) return null;

  const appId = await boardAppId(userId);
  const url = boardAskUrl(ask.id);
  const title = ask.agentDisplay ? `${ask.agentLabel} · ${ask.agentDisplay}` : ask.agentLabel;
  const body = ask.title;
  const notificationId = newId("anot");
  await db.insert(agentNotification).values({
    id: notificationId,
    userId,
    requesterTokenId,
    title,
    body,
    imageUrl: null,
    url,
    status: "processing",
    acceptedCount: 0,
    failedCount: 0,
    error: null,
    idempotencyKey: `bask:${ask.id}:r${ask.revision}`,
    requestHash: null,
    appId,
    createdAt: new Date(),
  });

  const messages = buildPushMessages({
    to: devices.map((row) => row.expoPushToken),
    eventId: notificationId,
    serviceId: requesterTokenId,
    conversationKey: `board-${requesterTokenId}`,
    ...(appId ? { appId } : {}),
    resolved: { title, body, url },
  });
  const result = await sendPushFanout({
    expoMessages: messages,
    webSubscriptions,
    webPayload: { title, body, url, tag: `board-${ask.id}` },
    macosDevices,
    macosPayload: {
      title,
      body,
      threadId: `board-${requesterTokenId}`,
      data: { notificationId, url },
    },
  });
  if (result.staleTokens.length > 0) {
    await db
      .update(device)
      .set({ active: false })
      .where(inArray(device.expoPushToken, result.staleTokens));
  }
  if (result.staleSubscriptionIds.length > 0) {
    await db
      .update(webPushSubscription)
      .set({ active: false })
      .where(inArray(webPushSubscription.id, result.staleSubscriptionIds));
  }
  if (result.staleMacosDeviceIds.length > 0) {
    await db
      .update(macosDevice)
      .set({ active: false })
      .where(inArray(macosDevice.id, result.staleMacosDeviceIds));
  }
  await db
    .update(agentNotification)
    .set({
      status:
        result.accepted === targetCount ? "accepted" : result.accepted > 0 ? "partial" : "failed",
      acceptedCount: result.accepted,
      failedCount: targetCount - result.accepted,
      error: result.errors.length > 0 ? result.errors.join("; ").slice(0, 1000) : null,
    })
    .where(eq(agentNotification.id, notificationId));
  track({
    name: "agent_notification_created",
    userId,
    outcome: result.accepted > 0 ? "accepted" : "board_push_failed",
    value: result.accepted,
    metadata: { targets: targetCount, board: 1 },
  });
  return { notificationId, accepted: result.accepted };
}
