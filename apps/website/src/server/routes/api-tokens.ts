import { type ApiTokenDto, type ApiTokenScope, apiTokenCreateSchema } from "@hark/contracts";
import { and, count, desc, eq, gt, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { apiToken } from "../db/schema";
import { track } from "../lib/analytics";
import { newId } from "../lib/id";
import { oauthClientNames, revokeOAuthGrant } from "../lib/oauth";
import {
  apiTokenPrefix,
  generateApiToken,
  hashApiToken,
  MAX_ACTIVE_API_TOKENS,
} from "../lib/token";
import {
  type AgentEnv,
  type AuthedEnv,
  requireApiToken,
  requireAuth,
  requireScopes,
} from "../middleware";

function toDto(
  row: typeof apiToken.$inferSelect,
  clientNames: Map<string, string> = new Map(),
): ApiTokenDto {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes as ApiTokenScope[],
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    kind: row.oauthClientId ? "oauth" : "token",
    oauthClient: row.oauthClientId
      ? {
          clientId: row.oauthClientId,
          name: clientNames.get(row.oauthClientId) ?? row.name,
        }
      : null,
  };
}

/**
 * Lists the account's tokens. Connected OAuth (MCP) clients appear as
 * `kind: "oauth"` rows for agents; the dashboard lists them separately.
 */
async function listTokens(
  userId: string,
  { includeOAuth }: { includeOAuth: boolean },
): Promise<ApiTokenDto[]> {
  const rows = await db
    .select()
    .from(apiToken)
    .where(
      includeOAuth
        ? eq(apiToken.userId, userId)
        : and(eq(apiToken.userId, userId), isNull(apiToken.oauthClientId)),
    )
    .orderBy(desc(apiToken.createdAt));
  const clientNames = await oauthClientNames([
    ...new Set(rows.flatMap((row) => (row.oauthClientId ? [row.oauthClientId] : []))),
  ]);
  return rows.map((row) => toDto(row, clientNames));
}

/**
 * Revokes a token. Revoking a connected OAuth client's grant also deletes
 * its access and refresh tokens, so it cannot silently reconnect.
 */
async function revokeToken(
  userId: string,
  tokenId: string,
  outcome: "dashboard" | "agent",
): Promise<boolean> {
  const rows = await db
    .update(apiToken)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiToken.id, tokenId), eq(apiToken.userId, userId), isNull(apiToken.revokedAt)))
    .returning({ id: apiToken.id, oauthClientId: apiToken.oauthClientId });
  const [row] = rows;
  if (!row) return false;
  if (row.oauthClientId) {
    revokeOAuthGrant(userId, row.oauthClientId, outcome);
    return true;
  }
  track({ name: "api_token_revoked", userId, outcome });
  return true;
}

export const apiTokensRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/", async (c) =>
    c.json({ tokens: await listTokens(c.get("user").id, { includeOAuth: false }) }),
  )
  .post("/", async (c) => {
    const parsed = apiTokenCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid API token", issues: parsed.error.issues }, 400);
    }
    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      return c.json({ error: "Expiry must be in the future" }, 400);
    }

    const secret = generateApiToken();
    const now = new Date();
    const row = db.transaction((tx) => {
      const active = tx
        .select({ value: count() })
        .from(apiToken)
        .where(
          and(
            eq(apiToken.userId, c.get("user").id),
            isNull(apiToken.revokedAt),
            // Connected OAuth clients do not count against the token limit.
            isNull(apiToken.oauthClientId),
            or(isNull(apiToken.expiresAt), gt(apiToken.expiresAt, now)),
          ),
        )
        .get();
      if ((active?.value ?? 0) >= MAX_ACTIVE_API_TOKENS) return null;
      return tx
        .insert(apiToken)
        .values({
          id: newId("tok"),
          userId: c.get("user").id,
          name: parsed.data.name,
          tokenHash: hashApiToken(secret),
          prefix: apiTokenPrefix(secret),
          scopes: [...new Set(parsed.data.scopes)].sort(),
          expiresAt,
          createdAt: now,
        })
        .returning()
        .get();
    });
    if (!row) {
      return c.json(
        { error: `This account is limited to ${MAX_ACTIVE_API_TOKENS} active API tokens.` },
        409,
      );
    }
    track({
      name: "api_token_created",
      userId: c.get("user").id,
      outcome: "dashboard",
      metadata: {
        scopeCount: (row.scopes as string[]).length,
        expires: row.expiresAt !== null,
      },
    });
    return c.json({ token: toDto(row), secret }, 201);
  })
  .delete("/:id", async (c) => {
    const revoked = await revokeToken(c.get("user").id, c.req.param("id"), "dashboard");
    if (!revoked) return c.json({ error: "API token not found" }, 404);
    return c.json({ ok: true });
  });

/**
 * Agent-token management, mounted at `/api/agent/tokens`. Listing never
 * returns secrets (only the stored hash exists), and there is deliberately no
 * create route: a token that could mint tokens could grant itself any scope
 * and survive its own revocation, so new tokens always need a signed-in human.
 */
export const apiTokensAgentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/", requireScopes("tokens:manage"), async (c) =>
    c.json({ tokens: await listTokens(c.get("apiToken").userId, { includeOAuth: true }) }),
  )
  .delete("/:id", requireScopes("tokens:manage"), async (c) => {
    const revoked = await revokeToken(c.get("apiToken").userId, c.req.param("id"), "agent");
    if (!revoked) return c.json({ error: "API token not found" }, 404);
    return c.json({ ok: true });
  });
