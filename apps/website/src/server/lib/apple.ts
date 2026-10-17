import { HttpStatusError, withRetry, withTimeout } from "@hark/contracts/retry";
import { symmetricDecrypt } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "jose";
import { db } from "../db";
import { account, appleNativeGrant } from "../db/schema";
import { env } from "../env";
import { decryptAppleRefreshToken } from "./token";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_TOKEN_ENDPOINT = `${APPLE_ISSUER}/auth/token`;
const APPLE_REVOKE_ENDPOINT = `${APPLE_ISSUER}/auth/revoke`;
export const APPLE_TIMEOUT_MS = 10_000;
const APPLE_CLIENT_SECRET_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const appleJwks = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

export interface AppleAuthConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
}

export class AppleOAuthError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function normalizeApplePrivateKey(value: string): string {
  const normalized = value.replace(/\\n/g, "\n").trim();
  if (normalized.includes("BEGIN PRIVATE KEY")) return normalized;
  const decoded = Buffer.from(normalized, "base64").toString("utf8").trim();
  if (!decoded.includes("BEGIN PRIVATE KEY")) {
    throw new Error("APPLE_SIGN_IN_PRIVATE_KEY must be a PEM key or base64-encoded PEM key");
  }
  return decoded;
}

/** Generates a short-lived client assertion instead of persisting a six-month secret. */
export async function generateAppleClientSecret(
  clientId: string,
  config: AppleAuthConfig,
  now = Math.floor(Date.now() / 1000),
  lifetimeSeconds = 5 * 60,
): Promise<string> {
  if (lifetimeSeconds < 1 || lifetimeSeconds > APPLE_CLIENT_SECRET_MAX_AGE_SECONDS) {
    throw new Error("Apple client secret lifetime must be between 1 second and 180 days");
  }
  const key = await importPKCS8(normalizeApplePrivateKey(config.privateKey), "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.teamId)
    .setSubject(clientId)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetimeSeconds)
    .sign(key);
}

export async function verifyAppleIdentityToken(
  token: string,
  expectedAudience: string,
  expectedSubject?: string,
): Promise<string> {
  const { payload } = await jwtVerify(token, appleJwks, {
    algorithms: ["RS256"],
    issuer: APPLE_ISSUER,
    audience: expectedAudience,
    maxTokenAge: "1h",
  });
  if (payload.aud !== expectedAudience || typeof payload.sub !== "string" || !payload.sub) {
    throw new AppleOAuthError("Apple identity token has invalid claims");
  }
  if (expectedSubject !== undefined && payload.sub !== expectedSubject) {
    throw new AppleOAuthError("Apple identity token subject does not match the signed-in account");
  }
  return payload.sub;
}

interface AppleTokenResponse {
  refreshToken: string;
  identityToken: string;
}

export async function exchangeAppleAuthorizationCode(
  code: string,
  clientId: string,
  expectedSubject: string,
  config: AppleAuthConfig,
): Promise<AppleTokenResponse> {
  const clientSecret = await generateAppleClientSecret(clientId, config);
  // Deadline only, no retry: an authorization code is single-use, so a retry
  // after Apple consumed it would fail with invalid_grant. attempts stays 1.
  const tokens = await withTimeout(async (signal) => {
    const response = await fetch(APPLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
      }),
      signal,
    });
    let body: Record<string, unknown>;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      if (signal.aborted) throw error;
      body = {};
    }
    if (!response.ok) {
      const errorCode = typeof body.error === "string" ? body.error : undefined;
      throw new AppleOAuthError("Apple rejected the authorization code", errorCode);
    }
    if (typeof body.refresh_token !== "string" || typeof body.id_token !== "string") {
      throw new AppleOAuthError("Apple token response was incomplete");
    }
    return { refreshToken: body.refresh_token, identityToken: body.id_token };
  }, APPLE_TIMEOUT_MS);
  await verifyAppleIdentityToken(tokens.identityToken, clientId, expectedSubject);
  return tokens;
}

export async function revokeAppleToken(
  token: string,
  clientId: string,
  config: AppleAuthConfig,
): Promise<void> {
  const clientSecret = await generateAppleClientSecret(clientId, config);
  // Revocation is idempotent, so transient failures (timeouts, network, 5xx) are retried.
  try {
    await withRetry(
      async (signal) => {
        const response = await fetch(APPLE_REVOKE_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            token,
            token_type_hint: "refresh_token",
          }),
          signal,
        });
        try {
          if (!response.ok) throw new HttpStatusError(response.status);
        } finally {
          // The attempt deadline is disarmed when this callback settles, so
          // cancel the unread body instead of leaving the connection open.
          await response.body?.cancel().catch(() => undefined);
        }
      },
      { attempts: 3, timeoutMs: APPLE_TIMEOUT_MS },
    );
  } catch (error) {
    const detail = error instanceof HttpStatusError ? `status ${error.status}` : String(error);
    throw new AppleOAuthError(`Apple token revocation failed with ${detail}`);
  }
}

export function appleAuthConfig(): AppleAuthConfig {
  if (!env.APPLE_TEAM_ID || !env.APPLE_SIGN_IN_KEY_ID || !env.APPLE_SIGN_IN_PRIVATE_KEY) {
    throw new Error("Sign in with Apple server credentials are not configured");
  }
  return {
    teamId: env.APPLE_TEAM_ID,
    keyId: env.APPLE_SIGN_IN_KEY_ID,
    privateKey: env.APPLE_SIGN_IN_PRIVATE_KEY,
  };
}

export async function decryptBetterAuthOAuthToken(token: string): Promise<string> {
  const encrypted =
    token.startsWith("$ba$") || (token.length % 2 === 0 && /^[0-9a-f]+$/i.test(token));
  if (!encrypted) return token;
  return symmetricDecrypt({ key: env.BETTER_AUTH_SECRET, data: token });
}

/** Account deletion is blocked unless every revocable Apple grant is revoked. */
export async function revokeAppleGrantsForUser(userId: string): Promise<void> {
  const [accounts, nativeGrants] = await Promise.all([
    db
      .select({ accountId: account.accountId, refreshToken: account.refreshToken })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "apple"))),
    db.select().from(appleNativeGrant).where(eq(appleNativeGrant.userId, userId)),
  ]);
  if (accounts.length === 0 && nativeGrants.length === 0) return;

  const grants: Array<{ token: string; clientId: string }> = [];
  for (const { refreshToken } of accounts) {
    if (!refreshToken) continue;
    if (!env.APPLE_SIGN_IN_SERVICE_ID) {
      throw new Error(
        "Apple authorization cannot be revoked because the Services ID is not configured.",
      );
    }
    grants.push({
      token: await decryptBetterAuthOAuthToken(refreshToken),
      clientId: env.APPLE_SIGN_IN_SERVICE_ID,
    });
  }
  grants.push(
    ...nativeGrants.map((grant) => ({
      token: decryptAppleRefreshToken(grant.refreshTokenCiphertext),
      clientId: grant.clientId,
    })),
  );
  const nativeSubjects = new Set(nativeGrants.map((grant) => grant.appleSubject));
  const accountWithoutRevocableGrant = accounts.some(
    ({ accountId, refreshToken }) => !refreshToken && !nativeSubjects.has(accountId),
  );
  if (grants.length === 0 || accountWithoutRevocableGrant) {
    throw new Error(
      "Apple authorization cannot be revoked because its refresh token is unavailable. Sign in with Apple again before deleting the account.",
    );
  }

  const config = appleAuthConfig();
  for (const grant of grants) {
    await revokeAppleToken(grant.token, grant.clientId, config);
  }
}
