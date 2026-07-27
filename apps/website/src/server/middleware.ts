import type { ApiTokenScope } from "@hark/contracts";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { auth } from "./auth";
import { db } from "./db";
import { apiToken, user } from "./db/schema";
import { isEmailAllowed } from "./lib/admission";
import { trackUserActive } from "./lib/analytics";
import { hashApiToken } from "./lib/token";

export interface AuthedUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export type AuthedEnv = {
  Variables: {
    user: AuthedUser;
  };
};

export type AgentEnv = {
  Variables: {
    apiToken: typeof apiToken.$inferSelect;
  };
};

/** Derives the user from the Better Auth session cookie. Rejects anonymous requests. */
export const requireAuth = createMiddleware<AuthedEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    if (c.req.header("accept")?.includes("text/html")) {
      return c.redirect("/login");
    }
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (!isEmailAllowed(session.user.email)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("user", {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  });
  trackUserActive(session.user.id);
  await next();
});

/** Authenticates a scoped agent token without retaining or logging its plaintext value. */
export const requireApiToken = createMiddleware<AgentEnv>(async (c, next) => {
  const authorization = c.req.header("authorization");
  const match = authorization?.match(/^Bearer (hark_[A-Za-z0-9_-]{40,})$/i);
  if (!match?.[1]) return c.json({ error: "Unauthorized" }, 401);

  const now = new Date();
  const [matchRow] = await db
    .select({ token: apiToken, ownerEmail: user.email })
    .from(apiToken)
    .innerJoin(user, eq(apiToken.userId, user.id))
    .where(
      and(
        eq(apiToken.tokenHash, hashApiToken(match[1])),
        isNull(apiToken.revokedAt),
        // NULL expiry is handled after lookup because SQLite comparisons exclude it.
      ),
    )
    .limit(1);
  const token = matchRow?.token;
  if (!token || (token.expiresAt && token.expiresAt <= now)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (!isEmailAllowed(matchRow.ownerEmail)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("apiToken", token);
  trackUserActive(token.userId);
  if (!token.lastUsedAt || token.lastUsedAt.getTime() <= now.getTime() - 60_000) {
    await db
      .update(apiToken)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiToken.id, token.id),
          or(
            isNull(apiToken.lastUsedAt),
            lte(apiToken.lastUsedAt, new Date(now.getTime() - 60_000)),
          ),
        ),
      );
  }
  await next();
});

export function requireScopes(...required: ApiTokenScope[]) {
  return createMiddleware<AgentEnv>(async (c, next) => {
    const granted = new Set(c.get("apiToken").scopes);
    if (!required.every((scope) => granted.has(scope))) {
      return c.json({ error: "Insufficient scope", required }, 403);
    }
    await next();
  });
}
