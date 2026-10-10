import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "../db";
import { interaction } from "../db/schema";
import { attemptCallback, callbackProgress } from "./callback-delivery";

let running: Promise<void> | null = null;

/** Never rejects, so fire-and-forget callers can't cause an unhandled rejection. */
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
      // Re-validated and re-pinned on every attempt, not only when the webhook
      // was accepted.
      const outcome = await attemptCallback({
        ...row,
        payload: () => ({
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
      await db
        .update(interaction)
        .set(callbackProgress(row.callbackAttempts + 1, outcome))
        .where(eq(interaction.id, row.id));
    }
  })()
    .catch((error) => {
      console.error("[callbacks] Interaction callback batch failed", error);
    })
    .finally(() => {
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
