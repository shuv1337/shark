import {
  type DeviceDto,
  deviceRegisterSchema,
  deviceUnregisterSchema,
  LIVE_ACTIVITY_SCHEMA_VERSION,
  liveActivityPushToStartTokenSchema,
  liveActivityUpdateTokenSchema,
} from "@hark/contracts";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import {
  device,
  liveActivity,
  liveActivityDelivery,
  user as userTable,
  webPushSubscription,
} from "../db/schema";
import { env } from "../env";
import { track } from "../lib/analytics";
import { getBilling } from "../lib/billing";
import { newId } from "../lib/id";
import { buildWelcomePushMessages, sendPushMessages } from "../lib/push";
import { encryptLiveActivityToken } from "../lib/token";
import { type AuthedEnv, requireAuth } from "../middleware";
import { replayLateTerminalDelivery } from "./activities";

function toDto(row: typeof device.$inferSelect): DeviceDto {
  return {
    id: row.id,
    platform: "ios",
    deviceName: row.deviceName,
    active: row.active,
    liveActivitiesCapable: Boolean(row.liveActivityPushToStartTokenCiphertext),
    liveActivityTokenEnvironment:
      row.liveActivityTokenEnvironment === "sandbox" ||
      row.liveActivityTokenEnvironment === "production"
        ? row.liveActivityTokenEnvironment
        : null,
    liveActivityTokenUpdatedAt: row.liveActivityTokenUpdatedAt?.toISOString() ?? null,
    interactiveLiveActivitiesCapable: row.liveActivityInteractionVersion === 1,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

function webToDto(row: typeof webPushSubscription.$inferSelect): DeviceDto {
  return {
    id: row.id,
    platform: "web",
    deviceName: row.deviceName,
    active: row.active,
    liveActivitiesCapable: false,
    liveActivityTokenEnvironment: null,
    liveActivityTokenUpdatedAt: null,
    interactiveLiveActivitiesCapable: false,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(env.APP_URL).origin;
}

export const devicesRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const user = c.get("user");
    const [rows, webRows] = await Promise.all([
      db.select().from(device).where(eq(device.userId, user.id)).orderBy(desc(device.lastSeenAt)),
      db
        .select()
        .from(webPushSubscription)
        .where(eq(webPushSubscription.userId, user.id))
        .orderBy(desc(webPushSubscription.lastSeenAt)),
    ]);
    return c.json({
      devices: [...rows.map(toDto), ...webRows.map(webToDto)].sort(
        (a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt),
      ),
    });
  })
  .post("/live-activity/push-to-start", async (c) => {
    const parsed = liveActivityPushToStartTokenSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json(
        { error: "Invalid push-to-start token registration", issues: parsed.error.issues },
        400,
      );
    }
    const now = new Date();
    const [registered] = await db
      .update(device)
      .set({
        liveActivityPushToStartTokenCiphertext: encryptLiveActivityToken(
          parsed.data.pushToStartToken.toLowerCase(),
        ),
        liveActivityTokenEnvironment: parsed.data.environment,
        liveActivitySchemaVersion: parsed.data.schemaVersion,
        liveActivityTokenUpdatedAt: now,
        lastSeenAt: now,
      })
      .where(
        and(
          eq(device.id, parsed.data.deviceId),
          eq(device.userId, c.get("user").id),
          eq(device.active, true),
        ),
      )
      .returning({ id: device.id, updatedAt: device.liveActivityTokenUpdatedAt });
    if (!registered) return c.json({ error: "Device not found" }, 404);
    return c.json({ deviceId: registered.id, updatedAt: registered.updatedAt?.toISOString() });
  })
  .post("/live-activity/update-token", async (c) => {
    const parsed = liveActivityUpdateTokenSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { error: "Invalid Live Activity token registration", issues: parsed.error.issues },
        400,
      );
    }
    const userId = c.get("user").id;
    const result = db.transaction((tx) => {
      const registeredDevice = tx
        .select({ id: device.id })
        .from(device)
        .where(
          and(
            eq(device.id, parsed.data.deviceId),
            eq(device.userId, userId),
            eq(device.active, true),
          ),
        )
        .get();
      if (!registeredDevice) return { kind: "device-not-found" } as const;

      const activeCandidate = inArray(liveActivity.status, ["starting", "active", "partial"]);
      const lateTerminalCandidate = and(
        eq(liveActivity.status, "ended"),
        eq(liveActivityDelivery.status, "ended"),
        eq(liveActivityDelivery.lastEvent, "end"),
        eq(liveActivityDelivery.lastApnsReason, "MissingUpdateToken"),
        isNull(liveActivityDelivery.updateTokenCiphertext),
      );
      const candidateWhere = [
        eq(liveActivityDelivery.deviceId, registeredDevice.id),
        eq(liveActivity.userId, userId),
        eq(liveActivity.schemaVersion, parsed.data.schemaVersion),
        eq(liveActivityDelivery.schemaVersion, parsed.data.schemaVersion),
        or(activeCandidate, lateTerminalCandidate),
      ];
      if (parsed.data.activityId) candidateWhere.push(eq(liveActivity.id, parsed.data.activityId));
      let candidates: Array<{ id: string; activityId: string; activityStatus: string }> = [];
      if (parsed.data.nativeActivityId) {
        const exact = tx
          .select({
            id: liveActivityDelivery.id,
            activityId: liveActivityDelivery.activityId,
            activityStatus: liveActivity.status,
          })
          .from(liveActivityDelivery)
          .innerJoin(liveActivity, eq(liveActivity.id, liveActivityDelivery.activityId))
          .where(
            and(
              ...candidateWhere,
              eq(liveActivityDelivery.nativeActivityId, parsed.data.nativeActivityId),
            ),
          )
          .get();
        if (exact) candidates = [exact];
      }
      if (candidates.length === 0) {
        candidates = tx
          .select({
            id: liveActivityDelivery.id,
            activityId: liveActivityDelivery.activityId,
            activityStatus: liveActivity.status,
          })
          .from(liveActivityDelivery)
          .innerJoin(liveActivity, eq(liveActivity.id, liveActivityDelivery.activityId))
          .where(
            and(
              ...candidateWhere,
              parsed.data.nativeActivityId
                ? isNull(liveActivityDelivery.nativeActivityId)
                : isNull(liveActivityDelivery.updateTokenCiphertext),
            ),
          )
          .limit(2)
          .all();
      }
      if (candidates.length === 0) return { kind: "delivery-not-found" } as const;
      if (candidates.length > 1) return { kind: "ambiguous" } as const;
      const candidate = candidates[0];
      if (!candidate) return { kind: "delivery-not-found" } as const;
      const now = new Date();
      tx.update(liveActivityDelivery)
        .set({
          nativeActivityId: parsed.data.nativeActivityId ?? null,
          updateTokenCiphertext: encryptLiveActivityToken(parsed.data.updateToken.toLowerCase()),
          updateTokenUpdatedAt: now,
          environment: parsed.data.environment,
          schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
          status: candidate.activityStatus === "ended" ? "ended" : "active",
          updatedAt: now,
        })
        .where(eq(liveActivityDelivery.id, candidate.id))
        .run();
      return {
        kind: "registered",
        activityId: candidate.activityId,
        deviceId: registeredDevice.id,
        deliveryId: candidate.id,
        replayTerminal: candidate.activityStatus === "ended",
      } as const;
    });
    if (result.kind === "device-not-found") return c.json({ error: "Device not found" }, 404);
    if (result.kind === "delivery-not-found") {
      return c.json({ error: "Live Activity delivery not found" }, 404);
    }
    if (result.kind === "ambiguous") {
      return c.json(
        {
          error:
            "Activity token association is ambiguous; reopen SHark after other pending starts resolve.",
        },
        409,
      );
    }
    const replay = result.replayTerminal
      ? await replayLateTerminalDelivery(result.activityId, result.deliveryId)
      : null;
    return c.json({
      activityId: result.activityId,
      deviceId: result.deviceId,
      ...(result.replayTerminal ? { replayedTerminal: replay !== null } : {}),
    });
  })
  .post("/", async (c) => {
    const user = c.get("user");
    const parsed = deviceRegisterSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid device registration", issues: parsed.error.issues }, 400);
    }
    const [existing, activeDevices, activeWebDevices, billing] = await Promise.all([
      db
        .select({ id: device.id, userId: device.userId, active: device.active })
        .from(device)
        .where(eq(device.expoPushToken, parsed.data.expoPushToken))
        .limit(1),
      db
        .select({ id: device.id })
        .from(device)
        .where(and(eq(device.userId, user.id), eq(device.active, true))),
      db
        .select({ id: webPushSubscription.id })
        .from(webPushSubscription)
        .where(and(eq(webPushSubscription.userId, user.id), eq(webPushSubscription.active, true))),
      getBilling(user),
    ]);
    const isAlreadyActiveForUser = existing[0]?.userId === user.id && existing[0].active;
    if (
      !isAlreadyActiveForUser &&
      billing.limits.devices !== null &&
      activeDevices.length + activeWebDevices.length >= billing.limits.devices
    ) {
      return c.json({ error: "This account has reached its active device limit." }, 402);
    }
    const now = new Date();
    const registration = db.transaction((tx) => {
      const previous = tx
        .select({ id: device.id, userId: device.userId })
        .from(device)
        .where(eq(device.expoPushToken, parsed.data.expoPushToken))
        .get();
      const ownerChanged = Boolean(previous && previous.userId !== user.id);
      const registered = tx
        .insert(device)
        .values({
          id: newId("dev"),
          userId: user.id,
          expoPushToken: parsed.data.expoPushToken,
          apnsToken: parsed.data.apnsToken ?? null,
          platform: "ios",
          deviceName: parsed.data.deviceName ?? null,
          interactionSchemaVersion: parsed.data.interactionSchemaVersion ?? null,
          liveActivityInteractionVersion: parsed.data.liveActivityInteractionVersion ?? null,
          active: true,
          createdAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: device.expoPushToken,
          set: {
            userId: user.id,
            apnsToken: parsed.data.apnsToken ?? null,
            deviceName: parsed.data.deviceName ?? null,
            interactionSchemaVersion: parsed.data.interactionSchemaVersion ?? null,
            liveActivityInteractionVersion: parsed.data.liveActivityInteractionVersion ?? null,
            active: true,
            lastSeenAt: now,
            ...(ownerChanged
              ? {
                  liveActivityPushToStartTokenCiphertext: null,
                  liveActivityTokenEnvironment: null,
                  liveActivitySchemaVersion: null,
                  liveActivityTokenUpdatedAt: null,
                }
              : {}),
          },
        })
        .returning()
        .get();
      if (ownerChanged && previous) {
        tx.update(liveActivityDelivery)
          .set({
            status: "failed",
            updateTokenCiphertext: null,
            updateTokenUpdatedAt: null,
            lastApnsReason: "OwnerChanged",
            updatedAt: now,
          })
          .where(
            and(
              eq(liveActivityDelivery.deviceId, previous.id),
              inArray(liveActivityDelivery.status, ["pending", "accepted", "active"]),
            ),
          )
          .run();
      }
      const welcomeClaim = tx
        .update(userTable)
        .set({ welcomeNotificationSentAt: now })
        .where(and(eq(userTable.id, user.id), isNull(userTable.welcomeNotificationSentAt)))
        .returning({ id: userTable.id })
        .get();
      return { row: registered, shouldSendWelcome: Boolean(welcomeClaim) };
    });
    const { row, shouldSendWelcome } = registration;
    if (!row) {
      return c.json({ error: "Failed to register device" }, 500);
    }
    track({
      name: "device_registered",
      userId: user.id,
      deviceId: row.id,
      plan: billing.plan,
      outcome: existing[0] ? "reregistered" : "created",
    });
    let responseRow = row;
    if (shouldSendWelcome) {
      const messages = buildWelcomePushMessages(parsed.data.expoPushToken);
      let sentWelcome = 0;
      for (const [index, message] of messages.entries()) {
        if (index > 0) await wait(2_000);
        const result = await sendPushMessages([message]);
        if (result.staleTokens.length > 0) {
          await db
            .update(device)
            .set({ active: false, lastSeenAt: now })
            .where(eq(device.id, row.id));
          responseRow = { ...row, active: false };
          track({
            name: "device_deactivated_stale",
            userId: user.id,
            deviceId: row.id,
            plan: billing.plan,
            outcome: "onboarding",
            value: 1,
          });
          break;
        }
        sentWelcome += result.accepted;
      }
      track({
        name: "onboarding_welcome_sent",
        userId: user.id,
        deviceId: row.id,
        plan: billing.plan,
        outcome: sentWelcome === messages.length ? "complete" : "partial",
        value: sentWelcome,
      });
    }
    return c.json({ device: toDto(responseRow) }, 201);
  })
  .delete("/:id", async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: "Invalid request origin" }, 403);
    const user = c.get("user");
    const [removed, removedWeb] = await Promise.all([
      db
        .delete(device)
        .where(and(eq(device.userId, user.id), eq(device.id, c.req.param("id"))))
        .returning({ id: device.id }),
      db
        .delete(webPushSubscription)
        .where(
          and(
            eq(webPushSubscription.userId, user.id),
            eq(webPushSubscription.id, c.req.param("id")),
          ),
        )
        .returning({ id: webPushSubscription.id }),
    ]);
    if (removed.length > 0 || removedWeb.length > 0) {
      track({
        name: "device_unregistered",
        userId: user.id,
        deviceId: removed[0]?.id ?? removedWeb[0]?.id ?? null,
        outcome: "by_id",
        value: removed.length + removedWeb.length,
      });
    }
    return c.json({ ok: true });
  })
  .delete("/", async (c) => {
    const user = c.get("user");
    const parsed = deviceUnregisterSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid request", issues: parsed.error.issues }, 400);
    }
    const removed = await db
      .delete(device)
      .where(and(eq(device.userId, user.id), eq(device.expoPushToken, parsed.data.expoPushToken)))
      .returning({ id: device.id });
    if (removed.length > 0) {
      track({
        name: "device_unregistered",
        userId: user.id,
        deviceId: removed[0]?.id ?? null,
        outcome: "by_token",
        value: removed.length,
      });
    }
    return c.json({ ok: true });
  });
