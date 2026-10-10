import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { oauthAccessToken, oauthRefreshToken, verification } from "../db/schema";
import { isUserAllowed } from "./admission";
import { hashOAuthToken, OAUTH_ACCESS_TOKEN_PREFIX, OAUTH_REFRESH_TOKEN_PREFIX } from "./oauth";

const TOKEN_PATH = "/oauth2/token";
const DENIED = "the grant's owner is no longer authorized";

function invalidGrant(): APIError {
  return new APIError("BAD_REQUEST", { error: "invalid_grant", error_description: DENIED });
}

function storedRefreshToken(presented: unknown): string | undefined {
  if (typeof presented !== "string" || !presented.startsWith(OAUTH_REFRESH_TOKEN_PREFIX)) {
    return undefined;
  }
  return hashOAuthToken(presented.slice(OAUTH_REFRESH_TOKEN_PREFIX.length));
}

function codeOwner(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && "userId" in parsed) {
      return typeof parsed.userId === "string" ? parsed.userId : undefined;
    }
  } catch {
    // The provider rejects malformed codes itself.
  }
  return undefined;
}

/**
 * Refresh and code exchange re-check the allowlist, so neither a surviving
 * refresh token nor a pending authorization code can mint tokens for someone
 * who was offboarded. Before the grant: reject owners who are no longer
 * admitted. After it: discard what was minted if offboarding landed mid-grant.
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
            if (row && !(await isUserAllowed(row.userId))) {
              console.warn("[auth] grant=refresh_token outcome=admission_denied");
              throw invalidGrant();
            }
            return;
          }
          if (grantType === "authorization_code") {
            const code = ctx.body?.code;
            if (typeof code !== "string" || !code) return;
            const identifier = hashOAuthToken(code);
            const [row] = await db
              .select({ id: verification.id, value: verification.value })
              .from(verification)
              .where(eq(verification.identifier, identifier))
              .limit(1);
            const owner = row ? codeOwner(row.value) : undefined;
            if (row && owner && !(await isUserAllowed(owner))) {
              // Codes are single-use; a denied one is spent.
              await db.delete(verification).where(eq(verification.id, row.id));
              console.warn("[auth] grant=authorization_code outcome=admission_denied");
              throw invalidGrant();
            }
          }
        }),
      },
    ],
    after: [
      {
        matcher: (ctx) => ctx.path === TOKEN_PATH,
        handler: createAuthMiddleware(async (ctx) => {
          const returned = ctx.context.returned as { access_token?: unknown } | undefined;
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
          if (!minted?.userId) return;

          let revoked = !(await isUserAllowed(minted.userId));
          if (!revoked && ctx.body?.grant_type === "refresh_token") {
            // Offboarding deletes the presented token; rotation only marks it revoked.
            const stored = storedRefreshToken(ctx.body?.refresh_token);
            const [presented] = stored
              ? await db
                  .select({ id: oauthRefreshToken.id })
                  .from(oauthRefreshToken)
                  .where(eq(oauthRefreshToken.token, stored))
                  .limit(1)
              : [];
            revoked = !presented;
          }
          if (!revoked) return;

          db.transaction((tx) => {
            tx.delete(oauthAccessToken).where(eq(oauthAccessToken.id, minted.id)).run();
            if (minted.refreshId) {
              tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.id, minted.refreshId)).run();
            }
          });
          console.warn("[auth] grant=token outcome=revoked_mid_grant");
          // An APIError thrown after the handler keeps the grant's 200 status.
          return new Response(JSON.stringify(invalidGrant().body), {
            status: 400,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
              pragma: "no-cache",
            },
          });
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin;
