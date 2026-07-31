import {
  liveActivityPropsSchema,
  watchAppleAuthSchema,
  watchInteractionResponseSchema,
} from "@hark/contracts";
import { and, desc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { db } from "../db";
import {
  account,
  appleNativeGrant,
  interaction,
  liveActivity,
  user,
  watchAction,
  watchDevice,
} from "../db/schema";
import { env } from "../env";
import { isEmailAllowed } from "../lib/admission";
import { track, trackUserActive } from "../lib/analytics";
import {
  AppleOAuthError,
  appleAuthConfig,
  exchangeAppleAuthorizationCode,
  verifyAppleIdentityToken,
} from "../lib/apple";
import { newId } from "../lib/id";
import { deliverInteractionCallbacks } from "../lib/interaction-callbacks";
import { generateWatchToken, hashAppleAuthorizationCode, hashWatchToken } from "../lib/token";
import { expireLiveActivity, resolveInteractionLiveActivity } from "./activities";

const WATCH_TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1_000;

type WatchEnv = {
  Variables: {
    watchDevice: typeof watchDevice.$inferSelect;
  };
};

const requireWatchAuth = createMiddleware<WatchEnv>(async (c, next) => {
  const match = c.req.header("authorization")?.match(/^Bearer (shw_[A-Za-z0-9_-]{43})$/);
  if (!match?.[1]) return c.json({ error: "Unauthorized" }, 401);

  const now = new Date();
  const [authenticated] = await db
    .select({ watch: watchDevice, ownerEmail: user.email })
    .from(watchDevice)
    .innerJoin(user, eq(watchDevice.userId, user.id))
    .where(
      and(
        eq(watchDevice.tokenHash, hashWatchToken(match[1])),
        eq(watchDevice.active, true),
        gt(watchDevice.expiresAt, now),
      ),
    )
    .limit(1);
  if (!authenticated || !isEmailAllowed(authenticated.ownerEmail)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("watchDevice", authenticated.watch);
  trackUserActive(authenticated.watch.userId);
  if (authenticated.watch.lastSeenAt <= new Date(now.getTime() - 60_000)) {
    await db
      .update(watchDevice)
      .set({ lastSeenAt: now })
      .where(eq(watchDevice.id, authenticated.watch.id));
  }
  await next();
});

export const watchAuthRoute = new Hono().post("/apple", async (c) => {
  const parsed = watchAppleAuthSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid Watch authentication request" }, 400);

  const authorizationCodeHash = hashAppleAuthorizationCode(parsed.data.authorizationCode);
  try {
    const subject = await verifyAppleIdentityToken(
      parsed.data.identityToken,
      env.APPLE_SIGN_IN_WATCH_BUNDLE_ID,
    );
    const [owner] = await db
      .select({ id: user.id, email: user.email })
      .from(account)
      .innerJoin(user, eq(account.userId, user.id))
      .where(and(eq(account.providerId, "apple"), eq(account.accountId, subject)))
      .limit(1);
    if (!owner || !isEmailAllowed(owner.email)) {
      return c.json({ error: "Apple identity is not linked to an admitted SHark account" }, 403);
    }

    const [replay] = await db
      .select({ id: appleNativeGrant.id })
      .from(appleNativeGrant)
      .where(eq(appleNativeGrant.authorizationCodeHash, authorizationCodeHash))
      .limit(1);
    if (replay) return c.json({ error: "Apple authorization code was already used" }, 409);

    const tokens = await exchangeAppleAuthorizationCode(
      parsed.data.authorizationCode,
      env.APPLE_SIGN_IN_WATCH_BUNDLE_ID,
      subject,
      appleAuthConfig(),
    );
    const { encryptAppleRefreshToken } = await import("../lib/token");
    const now = new Date();
    const plaintextToken = generateWatchToken();
    const expiresAt = new Date(now.getTime() + WATCH_TOKEN_LIFETIME_MS);

    const registered = db.transaction((tx) => {
      tx.insert(appleNativeGrant)
        .values({
          id: newId("apg"),
          userId: owner.id,
          appleSubject: subject,
          clientId: env.APPLE_SIGN_IN_WATCH_BUNDLE_ID,
          refreshTokenCiphertext: encryptAppleRefreshToken(tokens.refreshToken),
          authorizationCodeHash,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: appleNativeGrant.userId,
          set: {
            appleSubject: subject,
            clientId: env.APPLE_SIGN_IN_WATCH_BUNDLE_ID,
            refreshTokenCiphertext: encryptAppleRefreshToken(tokens.refreshToken),
            authorizationCodeHash,
            updatedAt: now,
          },
        })
        .run();

      return tx
        .insert(watchDevice)
        .values({
          id: newId("wdev"),
          userId: owner.id,
          appleSubject: subject,
          tokenHash: hashWatchToken(plaintextToken),
          deviceName: parsed.data.deviceName ?? null,
          active: true,
          expiresAt,
          createdAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: [watchDevice.userId, watchDevice.appleSubject],
          set: {
            tokenHash: hashWatchToken(plaintextToken),
            deviceName: parsed.data.deviceName ?? null,
            active: true,
            expiresAt,
            lastSeenAt: now,
          },
        })
        .returning({ id: watchDevice.id })
        .get();
    });
    if (!registered) throw new Error("Watch registration did not return a device");

    track({
      name: "user_active",
      userId: owner.id,
      deviceId: registered.id,
      outcome: "watch_authenticated",
    });
    return c.json({
      token: plaintextToken,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof AppleOAuthError && error.code === "invalid_grant") {
      return c.json({ error: "Apple authorization code is expired or already used" }, 409);
    }
    console.error("[watch] Apple authentication failed", error);
    return c.json({ error: "Could not authenticate Apple Watch" }, 401);
  }
});

export const watchRoute = new Hono<WatchEnv>()
  .use("*", requireWatchAuth)
  .get("/snapshot", async (c) => {
    const registeredWatch = c.get("watchDevice");
    const now = new Date();

    await db
      .update(interaction)
      .set({ status: "expired" })
      .where(
        and(
          eq(interaction.userId, registeredWatch.userId),
          eq(interaction.status, "pending"),
          lte(interaction.expiresAt, now),
        ),
      );

    const [activityRows, interactionRows] = await Promise.all([
      db
        .select()
        .from(liveActivity)
        .where(
          and(
            eq(liveActivity.userId, registeredWatch.userId),
            inArray(liveActivity.status, ["starting", "active", "partial"]),
            isNull(liveActivity.interactionId),
          ),
        )
        .orderBy(desc(liveActivity.updatedAt))
        .limit(3),
      db
        .select()
        .from(interaction)
        .where(
          and(
            eq(interaction.userId, registeredWatch.userId),
            eq(interaction.status, "pending"),
            gt(interaction.expiresAt, now),
            inArray(interaction.kind, ["approval", "yes_no"]),
          ),
        )
        .orderBy(interaction.expiresAt)
        .limit(3),
    ]);
    const currentActivities = await Promise.all(activityRows.map(expireLiveActivity));

    return c.json({
      generatedAt: now.toISOString(),
      activities: currentActivities
        .filter((row) => ["starting", "active", "partial"].includes(row.status))
        .map((row) => {
          const props = liveActivityPropsSchema.parse(row.props);
          const isPrivate = props.privacyMode === "private";
          return {
            id: row.id,
            title: isPrivate ? "Agent task" : props.title,
            status: isPrivate ? "In progress" : props.status,
            detail: isPrivate ? null : (props.detail ?? null),
            progress: props.progress ?? null,
            symbol: props.symbol,
            isPrivate,
            isStale: Boolean(row.staleAt && row.staleAt <= now),
            updatedAt: row.updatedAt.toISOString(),
          };
        }),
      approvals: interactionRows.map((row) => ({
        id: row.id,
        title: row.title,
        prompt: row.prompt,
        kind: row.kind,
        actionDigest: row.actionDigest,
        primaryLabel: row.primaryLabel ?? (row.kind === "approval" ? "Approve" : "Yes"),
        secondaryLabel: row.secondaryLabel ?? (row.kind === "approval" ? "Deny" : "No"),
        expiresAt: row.expiresAt.toISOString(),
      })),
    });
  })
  .post("/interactions/:id/respond", async (c) => {
    const parsed = watchInteractionResponseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid Watch interaction response" }, 400);

    const registeredWatch = c.get("watchDevice");
    const interactionId = c.req.param("id");
    const now = new Date();
    const result = db.transaction((tx) => {
      const replay = tx
        .select()
        .from(watchAction)
        .where(
          and(
            eq(watchAction.watchDeviceId, registeredWatch.id),
            eq(watchAction.requestId, parsed.data.requestId),
          ),
        )
        .get();
      if (replay) {
        const sameRequest =
          replay.interactionId === interactionId &&
          replay.action === parsed.data.action &&
          replay.actionDigest === parsed.data.actionDigest;
        return sameRequest
          ? {
              kind: "replay" as const,
              accepted: replay.accepted,
              status: replay.terminalStatus,
            }
          : { kind: "idempotency-conflict" as const };
      }

      const current = tx
        .select()
        .from(interaction)
        .where(
          and(eq(interaction.id, interactionId), eq(interaction.userId, registeredWatch.userId)),
        )
        .get();
      if (!current) return { kind: "not-found" as const };
      if (current.actionDigest !== parsed.data.actionDigest) {
        return { kind: "digest-mismatch" as const };
      }
      const actionMatches =
        (current.kind === "approval" && ["approve", "deny"].includes(parsed.data.action)) ||
        (current.kind === "yes_no" && ["yes", "no"].includes(parsed.data.action));
      if (!actionMatches) return { kind: "invalid-action" as const };

      const terminalStatus =
        parsed.data.action === "approve"
          ? "approved"
          : parsed.data.action === "deny"
            ? "denied"
            : parsed.data.action;
      const updated =
        current.status === "pending" && current.expiresAt > now
          ? tx
              .update(interaction)
              .set({
                status: terminalStatus,
                response: parsed.data.action,
                respondedAt: now,
                callbackNextAttemptAt: now,
              })
              .where(
                and(
                  eq(interaction.id, current.id),
                  eq(interaction.status, "pending"),
                  gt(interaction.expiresAt, now),
                ),
              )
              .returning()
              .get()
          : undefined;
      const latestStatus =
        updated?.status ?? (current.expiresAt <= now ? "expired" : current.status);
      if (!updated && current.status === "pending" && current.expiresAt <= now) {
        tx.update(interaction)
          .set({ status: "expired" })
          .where(and(eq(interaction.id, current.id), eq(interaction.status, "pending")))
          .run();
      }
      tx.insert(watchAction)
        .values({
          id: newId("wact"),
          watchDeviceId: registeredWatch.id,
          interactionId: current.id,
          requestId: parsed.data.requestId,
          action: parsed.data.action,
          actionDigest: parsed.data.actionDigest,
          accepted: Boolean(updated),
          terminalStatus: latestStatus,
          createdAt: now,
        })
        .run();
      return updated
        ? { kind: "accepted" as const, interaction: updated }
        : { kind: "terminal" as const, status: latestStatus };
    });

    if (result.kind === "not-found") return c.json({ error: "Interaction not found" }, 404);
    if (result.kind === "digest-mismatch") {
      return c.json({ error: "Interaction action digest mismatch" }, 409);
    }
    if (result.kind === "invalid-action") {
      return c.json({ error: "Response does not match this interaction" }, 400);
    }
    if (result.kind === "idempotency-conflict") {
      return c.json({ error: "Watch request identifier was already used" }, 409);
    }
    if (result.kind === "replay") {
      return c.json(
        {
          ok: result.accepted,
          duplicate: true,
          status: result.status,
          ...(result.accepted ? {} : { error: "Interaction was already handled" }),
        },
        result.accepted ? 200 : 409,
      );
    }
    if (result.kind === "terminal") {
      return c.json(
        { error: "Interaction was already handled", duplicate: false, status: result.status },
        409,
      );
    }

    track({
      name: "interaction_responded",
      userId: registeredWatch.userId,
      deviceId: registeredWatch.id,
      outcome: parsed.data.action,
      metadata: { kind: result.interaction.kind, surface: "watch" },
    });
    void deliverInteractionCallbacks();
    void resolveInteractionLiveActivity(result.interaction);
    return c.json({ ok: true, duplicate: false, status: result.interaction.status });
  });
