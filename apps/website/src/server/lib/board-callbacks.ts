import { isPublicHttpsUrl } from "@hark/contracts";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "../db";
import { boardAsk } from "../db/schema";
import { appendAskEvent, resolvedEventFor } from "./board";
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
      // Re-checked at delivery so a row written before this rule, or by any
      // other path, still never makes this process connect to a private host.
      if (!isPublicHttpsUrl(row.callbackUrl as string)) {
        await db
          .update(boardAsk)
          .set({
            callbackStatus: "failed",
            callbackAttempts: attempt,
            callbackLastError: "Callback URL is not a public HTTPS URL",
            callbackNextAttemptAt: null,
          })
          .where(eq(boardAsk.id, row.id));
        await appendAskEvent(row.id, {
          dedupeKey: `callback_failed:r${row.revision}:${row.status}`,
          kind: "callback_failed",
          actorType: "system",
          revision: row.revision,
          detail: "Callback URL is not a public HTTPS URL",
        });
        continue;
      }
      try {
        const response = await fetch(row.callbackUrl as string, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
          headers: {
            authorization: `Bearer ${decryptCallbackToken(row.callbackTokenCiphertext as string)}`,
            "content-type": "application/json",
            "user-agent": "Hark-Callbacks/1",
          },
          body: JSON.stringify(resolvedEventFor(row)),
        });
        if (response.ok) {
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
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        const delay = RETRY_DELAYS_MS[attempt];
        const message = error instanceof Error ? error.message.slice(0, 200) : "Failed";
        await db
          .update(boardAsk)
          .set({
            callbackStatus: delay === undefined ? "failed" : "retrying",
            callbackAttempts: attempt,
            callbackLastError: message,
            callbackNextAttemptAt: delay === undefined ? null : new Date(Date.now() + delay),
          })
          .where(eq(boardAsk.id, row.id));
        if (delay === undefined) {
          await appendAskEvent(row.id, {
            dedupeKey: `callback_failed:r${row.revision}:${row.status}`,
            kind: "callback_failed",
            actorType: "system",
            revision: row.revision,
            detail: message,
          });
        }
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
