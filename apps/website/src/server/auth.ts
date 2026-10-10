import { expo } from "@better-auth/expo";
import { oauthProvider } from "@better-auth/oauth-provider";
import { OAUTH_SCOPES } from "@hark/contracts";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { db } from "./db";
import * as schema from "./db/schema";
import { env } from "./env";
import { ADMISSION_DENIED_MESSAGE, isEmailAllowed } from "./lib/admission";
import { appleAuthConfig, generateAppleClientSecret, revokeAppleGrantsForUser } from "./lib/apple";
import { CLIENT_IP_HEADER } from "./lib/client-ip";
import {
  clientDefaultScopes,
  hashOAuthToken,
  mcpResourceUrl,
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_CONSENT_PAGE,
  OAUTH_REFRESH_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
} from "./lib/oauth";
import { oauthTokenAdmission } from "./lib/oauth-token-admission";
import { webViewSessionPlugin } from "./lib/web-view-session";

/**
 * A client that asks for no scope gets every scope except `tokens:manage`
 * (narrowed to what it registered for) instead of everything it may request.
 */
const oauthDefaultScopes = {
  id: "hark-oauth-default-scopes",
  hooks: {
    before: [
      {
        matcher: (ctx) =>
          ctx.path === "/oauth2/authorize" &&
          typeof ctx.query?.client_id === "string" &&
          !(typeof ctx.query.scope === "string" && ctx.query.scope.trim()),
        handler: createAuthMiddleware(async (ctx) => {
          const scope = (await clientDefaultScopes(String(ctx.query?.client_id))).join(" ");
          return scope ? { context: { query: { ...ctx.query, scope } } } : undefined;
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin;

export const auth = betterAuth({
  appName: "SHark",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
  }),
  account: {
    encryptOAuthTokens: true,
  },
  user: {
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => revokeAppleGrantsForUser(user.id),
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!isEmailAllowed(user.email)) {
            console.warn("[auth] provider=apple outcome=admission_denied");
            throw APIError.from("FORBIDDEN", {
              message: ADMISSION_DENIED_MESSAGE,
              code: "ACCOUNT_NOT_AUTHORIZED",
            });
          }
          return { data: user };
        },
      },
      update: {
        before: async (user) => {
          if (user.email && !isEmailAllowed(user.email)) {
            console.warn("[auth] provider=apple outcome=admission_denied");
            throw APIError.from("FORBIDDEN", {
              message: ADMISSION_DENIED_MESSAGE,
              code: "ACCOUNT_NOT_AUTHORIZED",
            });
          }
          return { data: user };
        },
      },
    },
    session: {
      create: {
        before: async (session, context) => {
          const user = await context?.context.internalAdapter.findUserById(session.userId);
          if (!user || !isEmailAllowed(user.email)) {
            console.warn("[auth] provider=apple outcome=session_denied");
            throw APIError.from("FORBIDDEN", {
              message: ADMISSION_DENIED_MESSAGE,
              code: "ACCOUNT_NOT_AUTHORIZED",
            });
          }
        },
      },
    },
  },
  socialProviders: {
    apple: async () => {
      const clientId = env.APPLE_SIGN_IN_SERVICE_ID ?? "";
      const configured =
        clientId && env.APPLE_TEAM_ID && env.APPLE_SIGN_IN_KEY_ID && env.APPLE_SIGN_IN_PRIVATE_KEY;
      return {
        clientId,
        clientSecret: configured
          ? await generateAppleClientSecret(
              clientId,
              appleAuthConfig(),
              undefined,
              180 * 24 * 60 * 60,
            )
          : "",
        appBundleIdentifier: env.APPLE_SIGN_IN_BUNDLE_ID,
        // Better Auth 1.6.25's appBundleIdentifier alone replaces the web audience;
        // audience explicitly accepts both the Services ID and native App ID.
        audience: [clientId, env.APPLE_SIGN_IN_BUNDLE_ID],
      };
    },
  },
  plugins: [
    expo(),
    // OAuth 2.1 authorization server for the remote MCP server at /mcp.
    oauthProvider({
      loginPage: OAUTH_CONSENT_PAGE,
      consentPage: OAUTH_CONSENT_PAGE,
      scopes: [...OAUTH_SCOPES],
      // Tokens are only ever issued for the MCP server.
      validAudiences: [mcpResourceUrl()],
      grantTypes: ["authorization_code", "refresh_token"],
      // MCP clients (Claude, OpenCode, Cursor, …) register themselves as public
      // PKCE clients; registration never grants anything without consent.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      allowPublicClientPrelogin: true,
      // Opaque, hashed, database-backed tokens so revocation is immediate.
      disableJwtPlugin: true,
      storeTokens: { hash: async (token) => hashOAuthToken(token) },
      prefix: {
        opaqueAccessToken: OAUTH_ACCESS_TOKEN_PREFIX,
        refreshToken: OAUTH_REFRESH_TOKEN_PREFIX,
      },
      accessTokenExpiresIn: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenExpiresIn: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
      // Served at the origin root by routes/oauth.ts.
      silenceWarnings: { oauthAuthServerConfig: true },
    }),
    oauthDefaultScopes,
    oauthTokenAdmission,
    webViewSessionPlugin(),
  ],
  trustedOrigins: [env.APP_URL, "https://appleid.apple.com", "shark://", "shark://*"],
  advanced: {
    // Rate limits (e.g. OAuth client registration) key on the client IP. When the
    // edge is configured, app.ts resolves it once and passes it in CLIENT_IP_HEADER;
    // otherwise Better Auth only trusts a single-entry X-Forwarded-For.
    ...(env.TRUSTED_CLIENT_IP_HEADER || env.TRUSTED_FORWARDED_FOR_HOPS > 0
      ? { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } }
      : {}),
    ...(env.APP_URL.startsWith("https://")
      ? {
          // Apple returns OAuth callbacks with a cross-site form POST. Better Auth
          // 1.6.25 still requires its signed state cookie on that request.
          cookies: {
            state: { attributes: { sameSite: "none" as const, secure: true } },
          },
        }
      : {}),
  },
});

export type Session = typeof auth.$Infer.Session;
