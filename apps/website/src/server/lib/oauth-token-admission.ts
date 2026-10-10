import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { oauthAccessToken, oauthRefreshToken, session, verification } from "../db/schema";
import { isUserAllowed } from "./admission";
import { hashOAuthToken, OAUTH_ACCESS_TOKEN_PREFIX, OAUTH_REFRESH_TOKEN_PREFIX } from "./oauth";

const TOKEN_PATH = "/oauth2/token";
const DENIED = "the grant's owner is no longer authorized";

function invalidGrant(): APIError {
  return new APIError("BAD_REQUEST", { error: "invalid_grant", error_description: DENIED });
}

/** After hooks answer with a raw Response: a returned APIError keeps the grant's 200 status. */
function errorResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 400,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      pragma: "no-cache",
    },
  });
}

function storedRefreshToken(presented: unknown): string | undefined {
  if (typeof presented !== "string" || !presented.startsWith(OAUTH_REFRESH_TOKEN_PREFIX)) {
    return undefined;
  }
  return hashOAuthToken(presented.slice(OAUTH_REFRESH_TOKEN_PREFIX.length));
}

function parseCode(value: string): { userId?: string; sessionId?: string } {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return {};
    const { userId, sessionId } = parsed as Record<string, unknown>;
    return {
      userId: typeof userId === "string" ? userId : undefined,
      sessionId: typeof sessionId === "string" ? sessionId : undefined,
    };
  } catch {
    // The provider rejects malformed codes itself.
    return {};
  }
}

/** What an admitted grant depends on; offboarding deletes the session or refresh token. */
interface GrantOwner {
  userId: string;
  sessionId?: string;
  refreshToken?: string;
}

const grantOwners = new WeakMap<Request, GrantOwner>();

async function revokedDuringGrant(owner: GrantOwner): Promise<boolean> {
  if (!(await isUserAllowed(owner.userId))) return true;
  if (owner.sessionId) {
    const [row] = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.id, owner.sessionId))
      .limit(1);
    if (!row) return true;
  }
  if (owner.refreshToken) {
    // Rotation only marks the presented token revoked; offboarding deletes it.
    const [row] = await db
      .select({ id: oauthRefreshToken.id })
      .from(oauthRefreshToken)
      .where(eq(oauthRefreshToken.token, owner.refreshToken))
      .limit(1);
    if (!row) return true;
  }
  return false;
}

/**
 * A grant that throws a non-API error (for example a foreign-key failure when
 * offboarding deletes the session mid-exchange) skips the after hook. If its
 * owner was offboarded, answer invalid_grant; other server errors pass through.
 */
export async function guardTokenResponse(request: Request, response: Response) {
  if (response.status < 500) return response;
  const owner = grantOwners.get(request);
  if (!owner || !(await revokedDuringGrant(owner))) return response;
  console.warn("[auth] grant=token outcome=revoked_mid_grant");
  return errorResponse(invalidGrant().body);
}

/**
 * Refresh and code exchange re-check the allowlist, so neither a surviving
 * refresh token nor a pending authorization code can mint tokens for someone
 * who was offboarded. Before the grant: reject owners who are no longer
 * admitted. After it: discard what was minted, and answer invalid_grant, if
 * offboarding landed mid-grant.
 */
export const oauthTokenAdmission = {
  id: "hark-oauth-token-admission",
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === TOKEN_PATH,
        handler: createAuthMiddleware(async (ctx) => {
          const grantType = ctx.body?.grant_type;
          if (grantType === "refresh_token") {
            const stored = storedRefreshToken(ctx.body?.refresh_token);
            if (!stored) return;
            const [row] = await db
              .select({ userId: oauthRefreshToken.userId })
              .from(oauthRefreshToken)
              .where(eq(oauthRefreshToken.token, stored))
              .limit(1);
            if (!row) return;
            if (!(await isUserAllowed(row.userId))) {
              console.warn("[auth] grant=refresh_token outcome=admission_denied");
              throw invalidGrant();
            }
            if (ctx.request) {
              grantOwners.set(ctx.request, { userId: row.userId, refreshToken: stored });
            }
            return;
          }
          if (grantType === "authorization_code") {
            const code = ctx.body?.code;
            if (typeof code !== "string" || !code) return;
            const [row] = await db
              .select({ id: verification.id, value: verification.value })
              .from(verification)
              .where(eq(verification.identifier, hashOAuthToken(code)))
              .limit(1);
            const { userId, sessionId } = row ? parseCode(row.value) : {};
            if (!row || !userId) return;
            if (!(await isUserAllowed(userId))) {
              // Codes are single-use; a denied one is spent.
              await db.delete(verification).where(eq(verification.id, row.id));
              console.warn("[auth] grant=authorization_code outcome=admission_denied");
              throw invalidGrant();
            }
            if (ctx.request) grantOwners.set(ctx.request, { userId, sessionId });
          }
        }),
      },
    ],
    after: [
      {
        matcher: (ctx) => ctx.path === TOKEN_PATH,
        handler: createAuthMiddleware(async (ctx) => {
          const returned = ctx.context.returned as
            | { access_token?: unknown; statusCode?: unknown; body?: { error?: unknown } }
            | undefined;
          const owner = ctx.request ? grantOwners.get(ctx.request) : undefined;
          if (returned?.body?.error) {
            if (owner && (await revokedDuringGrant(owner))) {
              console.warn("[auth] grant=token outcome=revoked_mid_grant");
              return errorResponse(invalidGrant().body);
            }
            // RFC 6749 §5.2: invalid_grant is a 400; the provider sends some as 401.
            if (returned.body.error === "invalid_grant" && returned.statusCode !== 400) {
              return errorResponse(returned.body);
            }
            return;
          }
          const accessToken = returned?.access_token;
          if (
            typeof accessToken !== "string" ||
            !accessToken.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)
          ) {
            return;
          }
          const [minted] = await db
            .select({
              id: oauthAccessToken.id,
              userId: oauthAccessToken.userId,
              refreshId: oauthAccessToken.refreshId,
            })
            .from(oauthAccessToken)
            .where(
              eq(
                oauthAccessToken.token,
                hashOAuthToken(accessToken.slice(OAUTH_ACCESS_TOKEN_PREFIX.length)),
              ),
            )
            .limit(1);
          if (!minted) {
            // Offboarding already deleted what this grant just minted.
            console.warn("[auth] grant=token outcome=revoked_mid_grant");
            return errorResponse(invalidGrant().body);
          }
          if (!minted.userId) return;
          const revoked = owner
            ? await revokedDuringGrant(owner)
            : !(await isUserAllowed(minted.userId));
          if (!revoked) return;

          db.transaction((tx) => {
            tx.delete(oauthAccessToken).where(eq(oauthAccessToken.id, minted.id)).run();
            if (minted.refreshId) {
              tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.id, minted.refreshId)).run();
            }
          });
          console.warn("[auth] grant=token outcome=revoked_mid_grant");
          return errorResponse(invalidGrant().body);
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin;
