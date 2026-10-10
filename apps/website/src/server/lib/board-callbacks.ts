import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "../db";
import { boardAsk } from "../db/schema";
import { appendAskEvent, resolvedEventFor } from "./board";
import { attemptCallback, callbackProgress } from "./callback-delivery";

/**
 * Delivers board ask resolutions to the asking agent's callback. Same retry
 * schedule, timeout, and user agent as interaction callbacks, but every
 * terminal status is delivered: answered, expired, and cancelled.
 */
let running: Promise<void> | null = null;

/** Never rejects, so fire-and-forget callers can't cause an unhandled rejection. */
export function deliverBoardCallbacks(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const now = new Date();
    const rows = await db
      .select()
      .from(boardAsk)
      .where(
        and(
          inArray(boardAsk.status, ["answered", "expired", "cancelled"]),
          inArray(boardAsk.callbackStatus, ["pending", "retrying"]),
          isNotNull(boardAsk.callbackUrl),
          isNotNull(boardAsk.callbackTokenCiphertext),
          lte(boardAsk.callbackNextAttemptAt, now),
        ),
      )
      .limit(20);

    for (const row of rows) {
      // Every attempt re-resolves and re-pins in postCallback, so a row
      // written before a rule change, or a name that later points at a private
      // address, never makes this process connect to a private host.
      const outcome = await attemptCallback({ ...row, payload: () => resolvedEventFor(row) });
      const progress = callbackProgress(row.callbackAttempts + 1, outcome);
      await db.update(boardAsk).set(progress).where(eq(boardAsk.id, row.id));
      if (progress.callbackStatus === "delivered") {
        await appendAskEvent(row.id, {
          dedupeKey: `callback_delivered:r${row.revision}:${row.status}`,
          kind: "callback_delivered",
          actorType: "system",
          revision: row.revision,
        });
      } else if (progress.callbackStatus === "failed") {
        await appendAskEvent(row.id, {
          dedupeKey: `callback_failed:r${row.revision}:${row.status}`,
          kind: "callback_failed",
          actorType: "system",
          revision: row.revision,
          detail: progress.callbackLastError,
        });
      }
    }
  })()
    .catch((error) => {
      console.error("[callbacks] Board callback batch failed", error);
    })
    .finally(() => {
      running = null;
    });
  return running;
}

export function startBoardCallbackWorker(): () => void {
  void deliverBoardCallbacks();
  const timer = setInterval(() => void deliverBoardCallbacks(), 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
