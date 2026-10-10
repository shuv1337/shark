import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "../db";
import { boardAsk } from "../db/schema";
import { appendAskEvent, resolvedEventFor } from "./board";
import { postCallback } from "./outbound";
import { decryptCallbackToken } from "./token";

/**
 * Delivers board ask resolutions to the asking agent's callback. Same retry
 * schedule, timeout, and user agent as interaction callbacks, but every
 * terminal status is delivered: answered, expired, and cancelled.
 */
const RETRY_DELAYS_MS = [0, 30_000, 120_000, 600_000, 3_600_000] as const;
let running: Promise<void> | null = null;

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
      const attempt = row.callbackAttempts + 1;
      // Every attempt re-resolves and re-pins in postCallback, so a row
      // written before a rule change, or a name that later points at a private
      // address, never makes this process connect to a private host.
      const outcome = await postCallback(row.callbackUrl as string, {
        headers: {
          authorization: `Bearer ${decryptCallbackToken(row.callbackTokenCiphertext as string)}`,
          "content-type": "application/json",
          "user-agent": "Hark-Callbacks/1",
        },
        body: JSON.stringify(resolvedEventFor(row)),
      });
      if (outcome.ok) {
        await db
          .update(boardAsk)
          .set({
            callbackStatus: "delivered",
            callbackAttempts: attempt,
            callbackDeliveredAt: new Date(),
            callbackLastError: null,
            callbackNextAttemptAt: null,
          })
          .where(eq(boardAsk.id, row.id));
        await appendAskEvent(row.id, {
          dedupeKey: `callback_delivered:r${row.revision}:${row.status}`,
          kind: "callback_delivered",
          actorType: "system",
          revision: row.revision,
        });
        continue;
      }
      // A blocked destination stays blocked; retrying would only re-probe it.
      const delay = outcome.error === "blocked_destination" ? undefined : RETRY_DELAYS_MS[attempt];
      await db
        .update(boardAsk)
        .set({
          callbackStatus: delay === undefined ? "failed" : "retrying",
          callbackAttempts: attempt,
          callbackLastError: outcome.error,
          callbackNextAttemptAt: delay === undefined ? null : new Date(Date.now() + delay),
        })
        .where(eq(boardAsk.id, row.id));
      if (delay === undefined) {
        await appendAskEvent(row.id, {
          dedupeKey: `callback_failed:r${row.revision}:${row.status}`,
          kind: "callback_failed",
          actorType: "system",
          revision: row.revision,
          detail: outcome.error,
        });
      }
    }
  })().finally(() => {
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
