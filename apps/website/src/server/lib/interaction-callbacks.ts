import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "../db";
import { interaction } from "../db/schema";
import { postCallback } from "./outbound";
import { decryptCallbackToken } from "./token";

const RETRY_DELAYS_MS = [0, 30_000, 120_000, 600_000, 3_600_000] as const;
let running: Promise<void> | null = null;

export function deliverInteractionCallbacks(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const now = new Date();
    const rows = await db
      .select()
      .from(interaction)
      .where(
        and(
          inArray(interaction.status, ["approved", "denied", "yes", "no", "replied"]),
          inArray(interaction.callbackStatus, ["pending", "retrying"]),
          isNotNull(interaction.callbackUrl),
          isNotNull(interaction.callbackTokenCiphertext),
          lte(interaction.callbackNextAttemptAt, now),
        ),
      )
      .limit(20);

    for (const row of rows) {
      const attempt = row.callbackAttempts + 1;
      // Re-validated and re-pinned on every attempt, not only when the webhook
      // was accepted.
      const outcome = await postCallback(row.callbackUrl as string, {
        headers: {
          authorization: `Bearer ${decryptCallbackToken(row.callbackTokenCiphertext as string)}`,
          "content-type": "application/json",
          "user-agent": "Hark-Callbacks/1",
        },
        body: JSON.stringify({
          type: "notification.response",
          eventId: row.eventId,
          correlationId: row.correlationId,
          kind: row.kind,
          status: row.status,
          action: row.kind === "reply" ? "reply" : row.response,
          text: row.kind === "reply" ? row.response : null,
          respondedAt: row.respondedAt?.toISOString() ?? null,
        }),
      });
      if (outcome.ok) {
        await db
          .update(interaction)
          .set({
            callbackStatus: "delivered",
            callbackAttempts: attempt,
            callbackDeliveredAt: new Date(),
            callbackLastError: null,
            callbackNextAttemptAt: null,
          })
          .where(eq(interaction.id, row.id));
        continue;
      }
      const delay = outcome.error === "blocked_destination" ? undefined : RETRY_DELAYS_MS[attempt];
      await db
        .update(interaction)
        .set({
          callbackStatus: delay === undefined ? "failed" : "retrying",
          callbackAttempts: attempt,
          callbackLastError: outcome.error,
          callbackNextAttemptAt: delay === undefined ? null : new Date(Date.now() + delay),
        })
        .where(eq(interaction.id, row.id));
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

export function startInteractionCallbackWorker(): () => void {
  void deliverInteractionCallbacks();
  const timer = setInterval(() => void deliverInteractionCallbacks(), 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
