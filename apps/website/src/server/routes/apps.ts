import {
  API_ERROR_CODE_CONSENT_REQUIRED,
  APP_PASS_JWKS_PATH,
  type AppCreateResponse,
  type AppPassResponse,
  appCreateSchema,
  appLaunchSchema,
  appOrigin,
  appSharingSchema,
  MAX_APPS_PER_ACCOUNT,
} from "@hark/contracts";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { app } from "../db/schema";
import { issueAppPass, publicJwks } from "../lib/app-pass";
import { ownedAppDto, selectAppsWithJoins, toAppDto } from "../lib/apps";
import { newId } from "../lib/id";
import {
  type AgentEnv,
  type AuthedEnv,
  requireApiToken,
  requireAuth,
  requireScopes,
} from "../middleware";

const NOT_FOUND = { error: "App not found" } as const;
const APP_LIMIT_ERROR = `App limit reached (${MAX_APPS_PER_ACCOUNT} per account). Remove an app before adding another.`;

// Passes are cheap to sign but each one is a bearer credential; bound how many
// a single session can mint.
const PASS_RATE_WINDOW_MS = 60_000;
const PASS_RATE_LIMIT = 30;
const passRates = new Map<string, { startedAt: number; count: number }>();

function passRateLimited(userId: string): boolean {
  const now = Date.now();
  const current = passRates.get(userId);
  if (!current || now - current.startedAt >= PASS_RATE_WINDOW_MS) {
    if (passRates.size > 10_000) passRates.clear();
    passRates.set(userId, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > PASS_RATE_LIMIT;
}

/** Accepts an empty body as `{}` so the simple launch call needs no payload. */
async function optionalJson(request: { text(): Promise<string> }): Promise<unknown> {
  const text = await request.text().catch(() => null);
  if (text === null) return null;
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function deleteOwnedApp(userId: string, appId: string): Promise<boolean> {
  const deleted = await db
    .delete(app)
    .where(and(eq(app.id, appId), eq(app.userId, userId)))
    .returning({ id: app.id });
  return deleted.length > 0;
}

export const appsAgentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/", requireScopes("apps:read"), async (c) => {
    const rows = await selectAppsWithJoins()
      .where(eq(app.userId, c.get("apiToken").userId))
      .orderBy(desc(app.createdAt), desc(app.id));
    return c.json({ apps: rows.map(toAppDto) });
  })
  .post("/", requireScopes("apps:write"), async (c) => {
    const token = c.get("apiToken");
    const parsed = appCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid app", issues: parsed.error.issues }, 400);
    }
    const input = parsed.data;
    const now = new Date();

    // Synchronous transaction: the existence check, cap check, and write
    // cannot interleave with another request on the single SQLite connection.
    const outcome = db.transaction((tx) => {
      const existing = tx
        .select({ id: app.id })
        .from(app)
        .where(and(eq(app.userId, token.userId), eq(app.url, input.url)))
        .get();
      if (existing) {
        tx.update(app)
          .set({
            name: input.name,
            ...(input.iconUrl !== undefined ? { iconUrl: input.iconUrl } : {}),
            updatedAt: now,
          })
          .where(eq(app.id, existing.id))
          .run();
        return { kind: "updated" as const, id: existing.id };
      }
      const total = tx
        .select({ value: count() })
        .from(app)
        .where(eq(app.userId, token.userId))
        .get();
      if ((total?.value ?? 0) >= MAX_APPS_PER_ACCOUNT) return { kind: "limit" as const };
      const id = newId("app");
      tx.insert(app)
        .values({
          id,
          userId: token.userId,
          name: input.name,
          url: input.url,
          origin: appOrigin(input.url),
          iconUrl: input.iconUrl ?? null,
          createdByTokenId: token.id,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return { kind: "created" as const, id };
    });

    if (outcome.kind === "limit") return c.json({ error: APP_LIMIT_ERROR }, 409);
    const dto = await ownedAppDto(token.userId, outcome.id);
    if (!dto) return c.json(NOT_FOUND, 404);
    const body: AppCreateResponse = {
      app: dto,
      created: outcome.kind === "created",
    };
    return c.json(body, outcome.kind === "created" ? 201 : 200);
  })
  .delete("/:id", requireScopes("apps:write"), async (c) => {
    const removed = await deleteOwnedApp(c.get("apiToken").userId, c.req.param("id"));
    if (!removed) return c.json(NOT_FOUND, 404);
    return c.json({ ok: true });
  });

export const appsSessionRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const rows = await selectAppsWithJoins()
      .where(eq(app.userId, c.get("user").id))
      .orderBy(
        sql`${app.lastOpenedAt} is null`,
        desc(app.lastOpenedAt),
        desc(app.createdAt),
        desc(app.id),
      );
    return c.json({ apps: rows.map(toAppDto) });
  })
  .get("/:id", async (c) => {
    const dto = await ownedAppDto(c.get("user").id, c.req.param("id"));
    if (!dto) return c.json(NOT_FOUND, 404);
    return c.json({ app: dto });
  })
  .patch("/:id", async (c) => {
    const userId = c.get("user").id;
    const parsed = appSharingSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid sharing settings", issues: parsed.error.issues }, 400);
    }
    const updated = await db
      .update(app)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(app.id, c.req.param("id")), eq(app.userId, userId)))
      .returning({ id: app.id });
    if (updated.length === 0) return c.json(NOT_FOUND, 404);
    return c.json({ app: await ownedAppDto(userId, c.req.param("id")) });
  })
  .post("/:id/pass", async (c) => {
    const user = c.get("user");
    const appId = c.req.param("id");
    const parsed = appLaunchSchema.safeParse(await optionalJson(c.req));
    if (!parsed.success) {
      return c.json({ error: "Invalid launch request", issues: parsed.error.issues }, 400);
    }
    const [current] = await db
      .select()
      .from(app)
      .where(and(eq(app.id, appId), eq(app.userId, user.id)))
      .limit(1);
    if (!current) return c.json(NOT_FOUND, 404);

    const { consent, ...sharing } = parsed.data;
    const now = new Date();
    if (sharing.shareName !== undefined || sharing.shareEmail !== undefined) {
      await db
        .update(app)
        .set({ ...sharing, updatedAt: now })
        .where(eq(app.id, current.id));
    }
    if (!current.consentedAt && consent !== true) {
      return c.json(
        {
          error: "Approve sign-in before opening this app",
          code: API_ERROR_CODE_CONSENT_REQUIRED,
          app: await ownedAppDto(user.id, current.id),
        },
        409,
      );
    }
    if (passRateLimited(user.id)) {
      c.header("Retry-After", "60");
      return c.json({ error: "Too many sign-in passes; try again shortly" }, 429);
    }

    const [launched] = await db
      .update(app)
      .set({
        ...(consent === true ? { consentedAt: now } : {}),
        lastOpenedAt: now,
      })
      .where(eq(app.id, current.id))
      .returning();
    if (!launched) return c.json(NOT_FOUND, 404);
    const pass = await issueAppPass({ user, app: launched });
    const dto = await ownedAppDto(user.id, launched.id);
    if (!dto) return c.json(NOT_FOUND, 404);
    return c.json<AppPassResponse>({
      token: pass.token,
      expiresAt: pass.expiresAt.toISOString(),
      app: dto,
    });
  })
  .post("/:id/revoke", async (c) => {
    const userId = c.get("user").id;
    const updated = await db
      .update(app)
      .set({ consentedAt: null, updatedAt: new Date() })
      .where(and(eq(app.id, c.req.param("id")), eq(app.userId, userId)))
      .returning({ id: app.id });
    if (updated.length === 0) return c.json(NOT_FOUND, 404);
    return c.json({ app: await ownedAppDto(userId, c.req.param("id")) });
  })
  .delete("/:id", async (c) => {
    const removed = await deleteOwnedApp(c.get("user").id, c.req.param("id"));
    if (!removed) return c.json(NOT_FOUND, 404);
    return c.json({ ok: true });
  });

/** Public keys that verify SHark passes. Mounted at the site root. */
export const appPassJwksRoute = new Hono().get(APP_PASS_JWKS_PATH, async (c) => {
  const jwks = await publicJwks();
  c.header("Cache-Control", "public, max-age=300");
  c.header("Access-Control-Allow-Origin", "*");
  return c.json(jwks);
});
