import { APP_PASS_ALGORITHM, APP_PASS_JWT_TYPE } from "@hark/contracts";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, eq, isNull } from "drizzle-orm";
import { importJWK, type JWK, jwtVerify } from "jose";
import * as z from "zod";
import { db } from "../db";
import { app, appSigningKey } from "../db/schema";
import { appPassIssuer, pairwiseSubject } from "./app-pass";

/**
 * The iPhone web view has no SHark cookie of its own. For an app on SHark's
 * own origin (the board), the native side posts a fresh pass to
 * `POST /apps/enter`, which trades it for a browser-session cookie scoped to
 * that web view. Passes for any other origin never reach a SHark session.
 */

// Each pass enters once. Entries live only until the pass would have expired.
const usedPasses = new Map<string, number>();

function claimPass(jti: string, exp: number): boolean {
  const now = Date.now() / 1000;
  for (const [key, expiry] of usedPasses) {
    if (expiry <= now) usedPasses.delete(key);
  }
  if (usedPasses.has(jti)) return false;
  usedPasses.set(jti, exp);
  return true;
}

/** Test hook: forget which passes were used. */
export function resetUsedPasses(): void {
  usedPasses.clear();
}

/**
 * Returns the owner of a valid, unused pass minted for SHark's own origin by a
 * consented app, or null.
 */
export async function verifyFirstPartyPass(token: string): Promise<string | null> {
  const origin = appPassIssuer();
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(
      token,
      async (header) => {
        if (!header.kid) throw new Error("missing kid");
        const [row] = await db
          .select({ publicJwk: appSigningKey.publicJwk })
          .from(appSigningKey)
          .where(and(eq(appSigningKey.id, header.kid), isNull(appSigningKey.retiredAt)))
          .limit(1);
        if (!row) throw new Error("unknown kid");
        return importJWK(JSON.parse(row.publicJwk) as JWK, APP_PASS_ALGORITHM);
      },
      {
        algorithms: [APP_PASS_ALGORITHM],
        typ: APP_PASS_JWT_TYPE,
        issuer: origin,
        audience: origin,
        requiredClaims: ["sub", "jti", "exp", "app_id"],
      },
    );
    payload = verified.payload;
  } catch {
    return null;
  }

  const { app_id: appId, sub, jti, exp } = payload;
  if (typeof appId !== "string" || typeof jti !== "string" || typeof exp !== "number") return null;
  const [owner] = await db
    .select({ userId: app.userId, origin: app.origin, consentedAt: app.consentedAt })
    .from(app)
    .where(eq(app.id, appId))
    .limit(1);
  if (!owner || owner.origin !== origin || !owner.consentedAt) return null;
  if (sub !== pairwiseSubject(owner.userId, origin)) return null;
  if (!claimPass(jti, exp)) return null;
  return owner.userId;
}

/**
 * Server-only Better Auth endpoint that opens a browser session for a user
 * already proven by a pass. It has no URL, so it is never reachable over HTTP.
 * The session is not remembered: the cookie ends with the web view.
 */
export const webViewSessionPlugin = () =>
  ({
    id: "hark-web-view-session",
    endpoints: {
      createWebViewSession: createAuthEndpoint.serverOnly(
        { method: "POST", body: z.object({ userId: z.string().min(1) }) },
        async (ctx) => {
          const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
          if (!user)
            throw APIError.from("UNAUTHORIZED", { code: "UNKNOWN_USER", message: "Unknown user" });
          const session = await ctx.context.internalAdapter.createSession(user.id, true);
          if (!session)
            throw APIError.from("UNAUTHORIZED", {
              code: "SESSION_NOT_CREATED",
              message: "No session",
            });
          await setSessionCookie(ctx, { session, user }, true);
          return ctx.json({ ok: true });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
