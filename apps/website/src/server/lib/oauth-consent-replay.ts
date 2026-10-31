import type { Context, Next } from "hono";

const MAX_CONSENT_SIGNATURES = 10_000;
const DEFAULT_HOLD_MS = 10 * 60 * 1000;

/**
 * Same matcher Better Auth's body parser uses (`better-call` `getBody`):
 * case-insensitive, and `+json` suffixes count. A case-sensitive
 * `includes("application/json")` lets `Application/JSON` skip this guard
 * while Better Auth still reads the body and mints a code.
 */
const JSON_CONTENT_TYPE = /^application\/([a-z0-9.+-]*\+)?json/i;

export async function readConsentOAuthQuery(request: Request): Promise<unknown> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (JSON_CONTENT_TYPE.test(contentType)) {
    const body = (await request.json()) as { oauth_query?: unknown } | null;
    return body?.oauth_query;
  }
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    return (await request.formData()).get("oauth_query");
  }
  return undefined;
}

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

/** Reserves the signed consent query before Better Auth handles the request. */
export async function guardOAuthConsentReplay(
  c: Context,
  next: Next,
  used: Map<string, number>,
): Promise<Response | undefined> {
  let oauthQuery: unknown;
  try {
    oauthQuery = await readConsentOAuthQuery(c.req.raw.clone());
  } catch {
    oauthQuery = undefined;
  }
  const decision = reserveConsentSignature(used, oauthQuery);
  if (decision.status === "replay") {
    return c.json(
      { error: "invalid_request", error_description: "This request was already decided" },
      400,
    );
  }
  await next();
  if (decision.status === "reserved" && !c.res.ok) {
    releaseConsentSignature(used, decision.signature);
  }
  return undefined;
}
