import { type CallbackError, postCallback } from "./outbound";
import { decryptCallbackToken } from "./token";

/**
 * Shared attempt and retry bookkeeping for board ask and interaction
 * callbacks: once immediately, then after 30 seconds, 2 minutes, 10 minutes,
 * and 1 hour.
 */
const RETRY_DELAYS_MS = [0, 30_000, 120_000, 600_000, 3_600_000] as const;

export type CallbackAttemptOutcome =
  | { ok: true }
  | { ok: false; error: CallbackError | "internal_error" };

export type CallbackProgress = {
  callbackStatus: "delivered" | "retrying" | "failed";
  callbackAttempts: number;
  callbackLastError: string | null;
  callbackNextAttemptAt: Date | null;
  callbackDeliveredAt?: Date;
};

/**
 * Makes one delivery attempt for one row and never throws. A row that can't be
 * prepared, such as one with a missing URL or corrupt token ciphertext, reports
 * `internal_error` so it is retried and retired like any other failure
 * instead of aborting the batch.
 */
export async function attemptCallback(row: {
  callbackUrl: string | null;
  callbackTokenCiphertext: string | null;
  payload: () => unknown;
}): Promise<CallbackAttemptOutcome> {
  const { callbackUrl, callbackTokenCiphertext } = row;
  if (callbackUrl === null || callbackTokenCiphertext === null) {
    return { ok: false, error: "internal_error" };
  }
  try {
    return await postCallback(callbackUrl, {
      headers: {
        authorization: `Bearer ${decryptCallbackToken(callbackTokenCiphertext)}`,
        "content-type": "application/json",
        "user-agent": "Hark-Callbacks/1",
      },
      body: JSON.stringify(row.payload()),
    });
  } catch {
    return { ok: false, error: "internal_error" };
  }
}

export function callbackProgress(
  attempt: number,
  outcome: CallbackAttemptOutcome,
): CallbackProgress {
  if (outcome.ok) {
    return {
      callbackStatus: "delivered",
      callbackAttempts: attempt,
      callbackDeliveredAt: new Date(),
      callbackLastError: null,
      callbackNextAttemptAt: null,
    };
  }
  // A blocked destination stays blocked; retrying would only re-probe it.
  const delay = outcome.error === "blocked_destination" ? undefined : RETRY_DELAYS_MS[attempt];
  return {
    callbackStatus: delay === undefined ? "failed" : "retrying",
    callbackAttempts: attempt,
    callbackLastError: outcome.error,
    callbackNextAttemptAt: delay === undefined ? null : new Date(Date.now() + delay),
  };
}
