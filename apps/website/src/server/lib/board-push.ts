import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  agentNotification,
  type apiToken,
  app,
  type boardAsk,
  device,
  macosDevice,
  user,
  webPushSubscription,
} from "../db/schema";
import { env } from "../env";
import { enforceAgentRateLimit } from "../routes/activities";
import { track } from "./analytics";
import { checkNotificationAllowance, getBilling } from "./billing";
import { newId } from "./id";
import { buildPushMessages, sendPushFanout } from "./push";
import { agentWindowLimit } from "./rate-windows";

type TokenRow = typeof apiToken.$inferSelect;

type AskRow = typeof boardAsk.$inferSelect;

export function boardAskUrl(askId: string): string {
  return `${new URL(env.APP_URL).origin}/board/ask/${encodeURIComponent(askId)}`;
}

/** Whether a registered app URL is this deployment's board page, not merely prefixed like it. */
export function isBoardAppUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === new URL(env.APP_URL).origin &&
      (url.pathname === "/board" || url.pathname.startsWith("/board/"))
    );
  } catch {
    return false;
  }
}

/** The registered web app whose launch URL is this deployment's board, if any. */
export async function boardAppId(userId: string): Promise<string | null> {
  const rows = await db
    .select({ id: app.id, url: app.url })
    .from(app)
    .where(and(eq(app.userId, userId), eq(app.origin, new URL(env.APP_URL).origin)))
    .orderBy(desc(app.lastOpenedAt), desc(app.createdAt));
  return rows.find((row) => isBoardAppUrl(row.url))?.id ?? null;
}

export class BoardPushLimited extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardPushLimited";
  }
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
  token: TokenRow,
): Promise<BoardPushResult | null> {
  const userId = ask.userId;
  const requesterTokenId = token.id;
  const idempotencyKey = `bask:${ask.id}:r${ask.revision}`;
  const [previous] = await db
    .select({ id: agentNotification.id, status: agentNotification.status })
    .from(agentNotification)
    .where(
      and(
        eq(agentNotification.requesterTokenId, requesterTokenId),
        eq(agentNotification.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (previous && (previous.status === "accepted" || previous.status === "partial")) {
    return { notificationId: previous.id, accepted: 1 };
  }

  // Board pushes count against the same per-minute and monthly limits as any
  // other agent notification; a revision loop is not a free push channel.
  const [owner] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  if (!owner) return null;
  const limited = await enforceAgentRateLimit(token, owner);
  if (limited) throw new BoardPushLimited(limited.error);
  if (!(await checkNotificationAllowance(userId))) {
    throw new BoardPushLimited("Monthly notification limit reached");
  }

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
  const notificationId = previous?.id ?? newId("anot");
  if (previous) {
    await db
      .update(agentNotification)
      .set({ title, body, url, appId, status: "processing", error: null })
      .where(eq(agentNotification.id, previous.id));
  } else {
    const { limits } = await getBilling(owner, true);
    // Synchronous, so concurrent revisions cannot all pass the agent windows.
    const refused = db.transaction((tx) => {
      const error = agentWindowLimit(tx, token, limits);
      if (error) return error;
      tx.insert(agentNotification)
        .values({
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
          idempotencyKey,
          requestHash: null,
          appId,
          createdAt: new Date(),
        })
        .run();
      return null;
    });
    if (refused) throw new BoardPushLimited(refused);
  }

  try {
    return await fanOut();
  } catch (error) {
    await db
      .update(agentNotification)
      .set({
        status: "failed",
        error: (error instanceof Error ? error.message : "Push failed").slice(0, 1000),
      })
      .where(eq(agentNotification.id, notificationId));
    throw error;
  }

  async function fanOut(): Promise<BoardPushResult> {
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
}
