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

/** RFC 6749 §5.1–5.2: token endpoint responses, errors included, are never cached. */
export const TOKEN_RESPONSE_HEADERS = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

/**
 * Every token is bound to the MCP server. Better Auth 1.6.25 checks `resource`
 * against `validAudiences` only when the client sends it (RFC 8707) and stores
 * no audience on opaque access tokens, so a token request without `resource`
 * would mint a token for no resource in particular. MCP (2025-06-18) requires
 * clients to send it, so require it to name `/mcp` exactly and refuse anything
 * else with RFC 8707's `invalid_target`. Rejected here, before the endpoint
 * runs, the authorization code or refresh token stays unspent for a retry.
 * Only the grant types SHark issues are checked, so a request without a
 * usable `grant_type` still gets Better Auth's own answer.
 *
 * This reads the raw form rather than the parsed body: RFC 8707 lets a client
 * repeat `resource`, and every value must be valid, but better-call's form
 * parser keeps only the last one.
 */
const BOUND_GRANT_TYPES = new Set(["authorization_code", "refresh_token"]);

/** An RFC 6749 §5.2 token error response. */
export function tokenErrorResponse(status: number, error: string, description: string): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: TOKEN_RESPONSE_HEADERS },
  );
}

function invalidTarget(description: string): Response {
  return tokenErrorResponse(400, "invalid_target", description);
}

const oauthResourceBinding = {
  id: "hark-oauth-resource-binding",
  onRequest: async (request) => {
    if (request.method !== "POST") return;
    if (!new URL(request.url).pathname.endsWith("/oauth2/token")) return;
    const contentType = request.headers.get("content-type") ?? "";
    // Anything else is refused by the endpoint's media-type check (415).
    if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) return;
    let form: URLSearchParams;
    try {
      form = new URLSearchParams(await request.clone().text());
    } catch {
      // A body that cannot be read cannot be checked, so it never reaches the endpoint.
      return {
        response: tokenErrorResponse(400, "invalid_request", "the request body could not be read"),
      };
    }
    if (!BOUND_GRANT_TYPES.has(form.get("grant_type") ?? "")) return;
    const expected = mcpResourceUrl();
    const resources = form.getAll("resource");
    if (resources.length === 0) {
      return { response: invalidTarget(`resource is required and must be ${expected}`) };
    }
    if (resources.some((resource) => resource !== expected)) {
      return {
        response: invalidTarget(
          `requested resource invalid; tokens are issued only for ${expected}`,
        ),
      };
    }
  },
} satisfies BetterAuthPlugin;

const PRELOGIN_PATH = "/oauth2/public-client-prelogin";
const PUBLIC_CLIENT_PATHS = new Set([PRELOGIN_PATH, "/oauth2/public-client"]);

/**
 * Better Auth 1.6.25 checks the prelogin's signed `oauth_query` but then
 * returns whichever `client_id` the body names. Bind the two so a signed query
 * only reveals its own client, and drop the registered `contacts` (which can
 * hold email addresses) since the consent page never shows them.
 */
const oauthPublicClientHardening = {
  id: "hark-oauth-public-client-hardening",
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === PRELOGIN_PATH && typeof ctx.body?.client_id === "string",
        handler: createAuthMiddleware(async (ctx) => {
          const query = ctx.body?.oauth_query;
          const signed =
            typeof query === "string" ? new URLSearchParams(query).getAll("client_id") : [];
          if (signed.length !== 1 || signed[0] !== ctx.body?.client_id) {
            throw new APIError("BAD_REQUEST", {
              error: "invalid_request",
              error_description: "client_id does not match the signed authorization request",
            });
          }
        }),
      },
    ],
    after: [
      {
        matcher: (ctx) => PUBLIC_CLIENT_PATHS.has(ctx.path ?? ""),
        handler: createAuthMiddleware(async (ctx) => {
          const returned = ctx.context.returned;
          if (!returned || typeof returned !== "object" || !("client_id" in returned)) return;
          const { contacts: _contacts, ...client } = returned as Record<string, unknown>;
          return ctx.json(client);
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
      // Tokens are only ever issued for the MCP server; oauthResourceBinding
      // makes every token request say so.
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
    oauthResourceBinding,
    oauthPublicClientHardening,
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
