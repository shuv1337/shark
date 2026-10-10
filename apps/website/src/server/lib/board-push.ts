import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "../db";
import {
  agentNotification,
  agentNotificationRetry,
  type apiToken,
  app,
  type boardAsk,
  device,
  macosDevice,
  user,
  webPushSubscription,
} from "../db/schema";
import { env } from "../env";
import { agentRateLimit } from "../routes/activities";
import { track } from "./analytics";
import { checkNotificationAllowance, getBilling } from "./billing";
import { newId } from "./id";
import { buildPushMessages, sendPushFanout } from "./push";
import { agentWindowLimit, RATE_LIMIT_ERRORS } from "./rate-windows";

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

const DELIVERED = new Set(["accepted", "partial"]);
/**
 * A `processing` attempt claimed longer ago than this, and not running in
 * this process (for example after a restart), is abandoned and may be retried.
 */
const ABANDONED_MS = 2 * 60_000;
/** Notifications with an attempt running in this process; SHark runs one process. */
const activeAttempts = new Set<string>();

/** Retry rows only count in 60-second windows; older ones are swept. */
export const RETRY_RETENTION_MS = 60 * 60_000;
const RETRY_SWEEP_BATCH = 1000;

/** Deletes up to one batch of board push retry rows past retention. */
export function sweepBoardPushRetries(now = new Date()): number {
  const cutoff = new Date(now.getTime() - RETRY_RETENTION_MS);
  return db
    .delete(agentNotificationRetry)
    .where(
      inArray(
        agentNotificationRetry.id,
        db
          .select({ id: agentNotificationRetry.id })
          .from(agentNotificationRetry)
          .where(lt(agentNotificationRetry.createdAt, cutoff))
          .limit(RETRY_SWEEP_BATCH),
      ),
    )
    .run().changes;
}

export interface BoardPushResult {
  notificationId: string;
  accepted: number;
  /** Another attempt for this revision is still running; nothing was sent. */
  inFlight?: true;
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
  const sameRevision = and(
    eq(agentNotification.requesterTokenId, requesterTokenId),
    eq(agentNotification.idempotencyKey, idempotencyKey),
  );
  const [previous] = await db
    .select({ id: agentNotification.id, status: agentNotification.status })
    .from(agentNotification)
    .where(sameRevision)
    .limit(1);
  if (previous && DELIVERED.has(previous.status)) {
    return { notificationId: previous.id, accepted: 1 };
  }

  // Board pushes count against the same per-minute and monthly limits as any
  // other agent notification; a revision loop is not a free push channel.
  const [owner] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  if (!owner) return null;
  const { limits } = await getBilling(owner, true);
  const limited = agentRateLimit(token, limits);
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
  // Synchronous: the revision's row is read, admitted against the agent
  // windows, and claimed in one transaction, so only one caller can claim a
  // given attempt. A retry of a failed (or abandoned) attempt records its own
  // counted retry row; the notification's `createdAt` keeps counting the
  // first attempt. Each attempt carries a fresh claim id that fences its
  // outcome write, so a superseded attempt cannot overwrite a newer one.
  const now = new Date();
  const claimId = newId("bpc");
  const claim = db.transaction((tx) => {
    const row = tx
      .select({
        id: agentNotification.id,
        status: agentNotification.status,
        claimedAt: agentNotification.claimedAt,
        createdAt: agentNotification.createdAt,
      })
      .from(agentNotification)
      .where(sameRevision)
      .get();
    if (row && DELIVERED.has(row.status)) return { kind: "delivered" as const, id: row.id };
    if (
      row?.status === "processing" &&
      (activeAttempts.has(row.id) ||
        (row.claimedAt ?? row.createdAt).getTime() > now.getTime() - ABANDONED_MS)
    ) {
      return { kind: "in_flight" as const, id: row.id };
    }
    const refused = agentWindowLimit(tx, token, limits, now.getTime());
    if (refused) return { kind: "limited" as const, error: RATE_LIMIT_ERRORS[refused] };
    if (row) {
      tx.insert(agentNotificationRetry)
        .values({ id: claimId, notificationId: row.id, userId, requesterTokenId, createdAt: now })
        .run();
      tx.update(agentNotification)
        .set({
          title,
          body,
          url,
          appId,
          status: "processing",
          error: null,
          claimId,
          claimedAt: now,
        })
        .where(eq(agentNotification.id, row.id))
        .run();
      return { kind: "claimed" as const, id: row.id };
    }
    const id = newId("anot");
    tx.insert(agentNotification)
      .values({
        id,
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
        claimId,
        claimedAt: now,
        createdAt: now,
      })
      .run();
    return { kind: "claimed" as const, id };
  });
  if (claim.kind === "delivered") return { notificationId: claim.id, accepted: 1 };
  if (claim.kind === "in_flight") return { notificationId: claim.id, accepted: 0, inFlight: true };
  if (claim.kind === "limited") throw new BoardPushLimited(claim.error);
  const notificationId = claim.id;
  const ownAttempt = and(
    eq(agentNotification.id, notificationId),
    eq(agentNotification.claimId, claimId),
  );

  try {
    // Marked only after COMMIT, so a failed commit cannot strand the id.
    activeAttempts.add(notificationId);
    return await fanOut();
  } catch (error) {
    await db
      .update(agentNotification)
      .set({
        status: "failed",
        error: (error instanceof Error ? error.message : "Push failed").slice(0, 1000),
      })
      .where(ownAttempt);
    throw error;
  } finally {
    activeAttempts.delete(notificationId);
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
      .where(ownAttempt);
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
