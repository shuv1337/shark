const MAX_CONSENT_SIGNATURES = 10_000;
const DEFAULT_HOLD_MS = 10 * 60 * 1000;

export type ConsentReservation = "skip" | "replay" | "reserved";

/**
 * A signed OAuth consent request can be approved only once. The signature is
 * reserved while the decision is in flight and released if that attempt fails,
 * so a retry after an error still works and a replay after success does not.
 */
export function reserveConsentSignature(
  used: Map<string, number>,
  oauthQuery: unknown,
  now = Date.now(),
): { status: ConsentReservation; signature?: string } {
  if (typeof oauthQuery !== "string") return { status: "skip" };
  const params = new URLSearchParams(oauthQuery);
  const signature = params.get("sig");
  if (!signature) return { status: "skip" };
  if (used.has(signature)) return { status: "replay", signature };
  if (used.size >= MAX_CONSENT_SIGNATURES) {
    for (const [key, expiry] of used) {
      if (expiry <= now) used.delete(key);
    }
  }
  const expiresAt = Number(params.get("exp")) * 1000;
  used.set(signature, Number.isFinite(expiresAt) ? expiresAt : now + DEFAULT_HOLD_MS);
  return { status: "reserved", signature };
}

export function releaseConsentSignature(
  used: Map<string, number>,
  signature: string | undefined,
): void {
  if (signature) used.delete(signature);
}
