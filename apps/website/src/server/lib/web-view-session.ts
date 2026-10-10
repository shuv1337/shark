import { APP_PASS_ALGORITHM, APP_PASS_JWT_TYPE } from "@hark/contracts";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { importJWK, type JWK, jwtVerify } from "jose";
import * as z from "zod";
import { db } from "../db";
import { app, appMemberState, appPassUse, appSigningKey, teamMember } from "../db/schema";
import { appPassIssuer, pairwiseSubject } from "./app-pass";

/**
 * The iPhone web view has no SHark cookie of its own. For an app on SHark's
 * own origin (the board), the native side posts a fresh pass to
 * `POST /apps/enter`, which trades it for a browser-session cookie scoped to
 * that web view. Passes for any other origin never reach a SHark session.
 */

/**
 * Records a pass as spent. The primary key makes this atomic across processes
 * and restarts: a second insert of the same `jti` fails, which means reuse.
 */
async function claimPass(jti: string, exp: number): Promise<boolean> {
  const now = new Date();
  await db.delete(appPassUse).where(lte(appPassUse.expiresAt, now));
  try {
    await db.insert(appPassUse).values({ jti, expiresAt: new Date(exp * 1000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Why a request to `POST /apps/enter` is not from the SHark web view, or null
 * when it is. HTML forms cannot set the custom header, which is the guard; a
 * foreign `Origin` or a cross-site `Sec-Fetch-Site` is refused as well. iOS
 * sends `Origin: null` for a navigation the app itself starts, so that passes.
 */
export function webViewEntryRefusal(request: Request): string | null {
  if (request.headers.get("x-shark-entry") !== "1") return "missing_header";
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== "null" && origin !== appPassIssuer()) return "foreign_origin";
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "none" && site !== "same-origin") return "cross_site";
  return null;
}

/**
 * Returns the viewer of a valid, unused pass minted for SHark's own origin by a
 * consented app, or null. For a personal app that is its owner; for a team app
 * it is the consented current member the pass was issued to.
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
  if (typeof sub !== "string") return null;
  const [row] = await db
    .select({
      userId: app.userId,
      origin: app.origin,
      consentedAt: app.consentedAt,
      teamId: app.teamId,
    })
    .from(app)
    .where(eq(app.id, appId))
    .limit(1);
  if (!row || row.origin !== origin) return null;
  // Spent even when the viewer no longer qualifies, so a pass refused after a removal cannot
  // open a session if the person rejoins before it expires.
  if (!(await claimPass(jti, exp))) return null;
  return row.teamId
    ? await consentedTeamViewer(appId, row.teamId, origin, sub)
    : row.consentedAt && sub === pairwiseSubject(row.userId, origin)
      ? row.userId
      : null;
}

/**
 * The current team member whose pairwise subject is `sub` and who approved
 * sign-in to this team app, or null. Team passes carry the viewer's own
 * subject, and each member's consent lives in `app_member_state`.
 */
async function consentedTeamViewer(
  appId: string,
  teamId: string,
  origin: string,
  sub: string,
): Promise<string | null> {
  const candidates = await db
    .select({ userId: appMemberState.userId })
    .from(appMemberState)
    .innerJoin(
      teamMember,
      and(eq(teamMember.teamId, teamId), eq(teamMember.userId, appMemberState.userId)),
    )
    .where(and(eq(appMemberState.appId, appId), isNotNull(appMemberState.consentedAt)));
  return (
    candidates.find((candidate) => pairwiseSubject(candidate.userId, origin) === sub)?.userId ??
    null
  );
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
