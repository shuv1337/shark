import { createHash } from "node:crypto";
import {
  type WebhookResponse,
  type WithdrawEventResponse,
  webhookRequestSchema,
} from "@hark/contracts";
import { and, count, desc, eq, gt, gte, inArray, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import {
  device,
  event,
  inboxItem,
  interaction,
  liveActivity,
  liveActivityOperation,
  macosDevice,
  service as serviceTable,
  user as userTable,
  webPushSubscription,
} from "../db/schema";
import { isEmailAllowed } from "../lib/admission";
import { failureBucket, track } from "../lib/analytics";
import { checkNotificationAllowance, getBilling, trackNotification } from "../lib/billing";
import { newId } from "../lib/id";
import { syncInboxForUser } from "../lib/inbox";
import { notificationEventTag } from "../lib/notification-withdrawal";
import {
  buildInteractionPushMessages,
  buildPushMessages,
  resolveNotification,
  sendPushFanout,
  sendWithdrawalFanout,
} from "../lib/push";
import {
  encryptCallbackToken,
  generateInteractionResponseToken,
  hashInteractionResponseToken,
  hashWebhookToken,
} from "../lib/token";

type EventRow = typeof event.$inferSelect;

function hashRequest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function replayResponse(row: EventRow): {
  body: WebhookResponse;
  status: 200 | 202 | 502;
} {
  if (row.status === "processing") {
    return {
      body: {
        ok: true,
        eventId: row.id,
        delivered: row.deliveredCount,
        idempotent: true,
        message: "The original request is still processing.",
      },
      status: 202,
    };
  }
  if (row.status === "failed") {
    return {
      body: {
        ok: false,
        error: row.error ?? "Push delivery failed",
      },
      status: 502,
    };
  }
  return {
    body: {
      ok: true,
      eventId: row.id,
      delivered: row.deliveredCount,
      idempotent: true,
      ...(row.status === "no_devices"
        ? { message: "No active notification targets are registered for this account." }
        : {}),
    },
    status: 200,
  };
}

export const hooksRoute = new Hono()
  .post("/:token", async (c) => {
    const token = c.req.param("token");
    const [match] = await db
      .select({ service: serviceTable, owner: userTable })
      .from(serviceTable)
      .innerJoin(userTable, eq(serviceTable.userId, userTable.id))
      .where(eq(serviceTable.tokenHash, hashWebhookToken(token)))
      .limit(1);
    if (!match || !isEmailAllowed(match.owner.email)) {
      return c.json<WebhookResponse>({ ok: false, error: "Unknown webhook" }, 404);
    }
    const svc = match.service;
    const owner = match.owner;

    const json = await c.req.json().catch(() => null);
    const parsed = webhookRequestSchema.safeParse(json);
    if (!parsed.success) {
      return c.json<WebhookResponse>(
        { ok: false, error: "Invalid payload", issues: parsed.error.issues },
        400,
      );
    }

    const rawIdempotencyKey = c.req.header("Idempotency-Key");
    const idempotencyKey = rawIdempotencyKey?.trim() || undefined;
    if (rawIdempotencyKey !== undefined && (!idempotencyKey || idempotencyKey.length > 200)) {
      return c.json<WebhookResponse>(
        { ok: false, error: "Idempotency-Key must contain between 1 and 200 characters" },
        400,
      );
    }

    const requestHash = hashRequest(parsed.data);
    if (idempotencyKey) {
      const [existing] = await db
        .select()
        .from(event)
        .where(and(eq(event.serviceId, svc.id), eq(event.idempotencyKey, idempotencyKey)))
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          return c.json<WebhookResponse>(
            { ok: false, error: "Idempotency-Key was already used with a different payload" },
            409,
          );
        }
        const replay = replayResponse(existing);
        return c.json(replay.body, replay.status);
      }
    }

    const billing = await getBilling(owner, true);
    track({
      name: "webhook_received",
      userId: svc.userId,
      serviceId: svc.id,
      plan: billing.plan,
    });
    if (parsed.data.deviceIds && !billing.features.deviceRouting) {
      return c.json<WebhookResponse>({ ok: false, error: "Device routing is unavailable" }, 402);
    }
    if (parsed.data.response && billing.plan !== "pro") {
      return c.json<WebhookResponse>(
        { ok: false, error: "Interactive responses are unavailable" },
        402,
      );
    }

    let targetedDevices: (typeof device.$inferSelect)[] | undefined;
    let targetedWebSubscriptions: (typeof webPushSubscription.$inferSelect)[] | undefined;
    let targetedMacosDevices: (typeof macosDevice.$inferSelect)[] | undefined;
    if (parsed.data.deviceIds) {
      const [selected, selectedWeb, selectedMacos] = await Promise.all([
        db
          .select()
          .from(device)
          .where(and(eq(device.userId, svc.userId), inArray(device.id, parsed.data.deviceIds))),
        db
          .select()
          .from(webPushSubscription)
          .where(
            and(
              eq(webPushSubscription.userId, svc.userId),
              inArray(webPushSubscription.id, parsed.data.deviceIds),
            ),
          ),
        db
          .select()
          .from(macosDevice)
          .where(
            and(eq(macosDevice.userId, svc.userId), inArray(macosDevice.id, parsed.data.deviceIds)),
          ),
      ]);
      if (
        selected.length + selectedWeb.length + selectedMacos.length !==
        parsed.data.deviceIds.length
      ) {
        return c.json<WebhookResponse>({ ok: false, error: "Invalid device selection" }, 400);
      }
      targetedDevices = selected.filter(
        (registeredDevice) => registeredDevice.active && registeredDevice.platform === "ios",
      );
      targetedWebSubscriptions = selectedWeb.filter((subscription) => subscription.active);
      targetedMacosDevices = selectedMacos.filter((registeredDevice) => registeredDevice.active);
    }

    const since = new Date(Date.now() - 60_000);
    const [[serviceUsage], [accountEventUsage], [accountInteractionUsage], [accountActivityUsage]] =
      await Promise.all([
        db
          .select({ value: count() })
          .from(event)
          .where(and(eq(event.serviceId, svc.id), gte(event.createdAt, since))),
        db
          .select({ value: count() })
          .from(event)
          .innerJoin(serviceTable, eq(event.serviceId, serviceTable.id))
          .where(and(eq(serviceTable.userId, svc.userId), gte(event.createdAt, since))),
        db
          .select({ value: count() })
          .from(interaction)
          .where(and(eq(interaction.userId, svc.userId), gte(interaction.createdAt, since))),
        db
          .select({ value: count() })
          .from(liveActivityOperation)
          .innerJoin(liveActivity, eq(liveActivity.id, liveActivityOperation.activityId))
          .where(
            and(eq(liveActivity.userId, svc.userId), gte(liveActivityOperation.createdAt, since)),
          ),
      ]);

    if ((serviceUsage?.value ?? 0) >= billing.limits.servicePerMinute) {
      c.header("Retry-After", "60");
      track({
        name: "webhook_rate_limited",
        userId: svc.userId,
        serviceId: svc.id,
        plan: billing.plan,
        outcome: "service",
      });
      return c.json<WebhookResponse>(
        { ok: false, error: "Service rate limit exceeded", retryAfterSeconds: 60 },
        429,
      );
    }
    if (
      (accountEventUsage?.value ?? 0) +
        (accountInteractionUsage?.value ?? 0) +
        (accountActivityUsage?.value ?? 0) >=
      billing.limits.accountPerMinute
    ) {
      c.header("Retry-After", "60");
      track({
        name: "webhook_rate_limited",
        userId: svc.userId,
        serviceId: svc.id,
        plan: billing.plan,
        outcome: "account",
      });
      return c.json<WebhookResponse>(
        { ok: false, error: "Account rate limit exceeded", retryAfterSeconds: 60 },
        429,
      );
    }

    if (!(await checkNotificationAllowance(svc.userId))) {
      track({
        name: "webhook_quota_exceeded",
        userId: svc.userId,
        serviceId: svc.id,
        plan: billing.plan,
      });
      return c.json<WebhookResponse>(
        { ok: false, error: "Monthly notification limit reached" },
        429,
      );
    }

    const resolved = resolveNotification(svc, parsed.data);
    const eventId = newId("evt");
    const eventValues: typeof event.$inferInsert = {
      id: eventId,
      serviceId: svc.id,
      title: resolved.title,
      body: resolved.body,
      imageUrl: resolved.imageUrl ?? null,
      url: resolved.url ?? null,
      status: "processing",
      deliveredCount: 0,
      error: null,
      idempotencyKey: idempotencyKey ?? null,
      requestHash: idempotencyKey ? requestHash : null,
      createdAt: new Date(),
    };

    try {
      await db.insert(event).values(eventValues);
    } catch (error) {
      if (idempotencyKey) {
        const [existing] = await db
          .select()
          .from(event)
          .where(and(eq(event.serviceId, svc.id), eq(event.idempotencyKey, idempotencyKey)))
          .limit(1);
        if (existing?.requestHash === requestHash) {
          const replay = replayResponse(existing);
          return c.json(replay.body, replay.status);
        }
      }
      throw error;
    }

    let devices: (typeof device.$inferSelect)[];
    let webSubscriptions: (typeof webPushSubscription.$inferSelect)[];
    let macosDevices: (typeof macosDevice.$inferSelect)[];
    if (targetedDevices) {
      devices = targetedDevices;
      webSubscriptions = targetedWebSubscriptions ?? [];
      macosDevices = targetedMacosDevices ?? [];
    } else {
      const [activeDevices, activeWebSubscriptions, activeMacosDevices] = await Promise.all([
        db
          .select()
          .from(device)
          .where(
            and(eq(device.userId, svc.userId), eq(device.active, true), eq(device.platform, "ios")),
          )
          .orderBy(desc(device.lastSeenAt)),
        db
          .select()
          .from(webPushSubscription)
          .where(
            and(eq(webPushSubscription.userId, svc.userId), eq(webPushSubscription.active, true)),
          )
          .orderBy(desc(webPushSubscription.lastSeenAt)),
        db
          .select()
          .from(macosDevice)
          .where(and(eq(macosDevice.userId, svc.userId), eq(macosDevice.active, true)))
          .orderBy(desc(macosDevice.lastSeenAt)),
      ]);
      const allTargets = [
        ...activeDevices.map((row) => ({ kind: "ios" as const, row, seen: row.lastSeenAt })),
        ...activeWebSubscriptions.map((row) => ({
          kind: "web" as const,
          row,
          seen: row.lastSeenAt,
        })),
        ...activeMacosDevices.map((row) => ({
          kind: "macos" as const,
          row,
          seen: row.lastSeenAt,
        })),
      ]
        .sort((a, b) => b.seen.getTime() - a.seen.getTime())
        .slice(0, billing.limits.devices ?? undefined);
      devices = allTargets.filter((target) => target.kind === "ios").map((target) => target.row);
      webSubscriptions = allTargets
        .filter((target) => target.kind === "web")
        .map((target) => target.row);
      macosDevices = allTargets
        .filter((target) => target.kind === "macos")
        .map((target) => target.row);
    }

    let interactionId: string | undefined;
    let responseToken: string | undefined;
    let interactionActionDigest: string | undefined;
    let interactionExpiresAt: Date | undefined;
    if (parsed.data.response) {
      devices = devices.filter(
        (registeredDevice) => registeredDevice.interactionSchemaVersion === 1,
      );
      const response = parsed.data.response;
      interactionId = newId("int");
      responseToken = generateInteractionResponseToken();
      interactionExpiresAt = new Date(Date.now() + response.expiresInSeconds * 1000);
      const kind = response.type === "text" ? "reply" : response.type;
      const choices =
        kind === "approval" ? ["approve", "deny"] : kind === "yes_no" ? ["yes", "no"] : ["reply"];
      interactionActionDigest = hashRequest({
        interactionId,
        title: resolved.title,
        prompt: resolved.body,
        kind,
        choices,
        url: resolved.url ?? null,
      });
      await db.insert(interaction).values({
        id: interactionId,
        userId: svc.userId,
        requesterServiceId: svc.id,
        eventId,
        title: resolved.title,
        prompt: resolved.body,
        kind,
        status: "pending",
        choices,
        url: resolved.url ?? null,
        imageUrl: resolved.imageUrl ?? null,
        correlationId: response.correlationId ?? null,
        actionDigest: interactionActionDigest,
        responseTokenHash: hashInteractionResponseToken(responseToken),
        callbackUrl: response.callback?.url ?? null,
        callbackTokenCiphertext: response.callback
          ? encryptCallbackToken(response.callback.token)
          : null,
        callbackStatus: response.callback ? "pending" : null,
        callbackNextAttemptAt: response.callback ? new Date() : null,
        expiresAt: interactionExpiresAt,
        createdAt: new Date(),
      });
    }

    if (devices.length + webSubscriptions.length + macosDevices.length === 0) {
      await db.update(event).set({ status: "no_devices" }).where(eq(event.id, eventId));
      track({
        name: "webhook_delivered",
        userId: svc.userId,
        serviceId: svc.id,
        plan: billing.plan,
        outcome: "no_devices",
      });
      return c.json<WebhookResponse>({
        ok: true,
        eventId,
        delivered: 0,
        ...(parsed.data.response
          ? {
              response: {
                status: "pending",
                expiresAt: (interactionExpiresAt as Date).toISOString(),
              },
            }
          : {}),
        message: "No active notification targets are registered for this account.",
      });
    }

    const [pendingActions] = parsed.data.response
      ? await db
          .select({ value: count() })
          .from(interaction)
          .where(
            and(
              eq(interaction.userId, svc.userId),
              eq(interaction.status, "pending"),
              gt(interaction.expiresAt, new Date()),
            ),
          )
      : [{ value: 0 }];
    const messages = parsed.data.response
      ? buildInteractionPushMessages({
          to: devices.map((registeredDevice) => registeredDevice.expoPushToken),
          interactionId: interactionId as string,
          eventId,
          kind: parsed.data.response.type === "text" ? "reply" : parsed.data.response.type,
          title: resolved.title,
          prompt: resolved.body,
          actionDigest: interactionActionDigest as string,
          responseToken,
          imageUrl: resolved.imageUrl,
          url: resolved.url,
          badge: pendingActions?.value ?? 0,
        })
      : buildPushMessages({
          to: devices.map((registeredDevice) => registeredDevice.expoPushToken),
          eventId,
          serviceId: svc.id,
          resolved,
        });
    const result = await sendPushFanout({
      expoMessages: messages,
      webSubscriptions,
      webPayload: {
        title: resolved.title,
        body: resolved.body,
        url: resolved.url ?? "/dashboard",
        eventId,
        ...(resolved.imageUrl ? { imageUrl: resolved.imageUrl } : {}),
        tag: parsed.data.response ? `interaction-${interactionId}` : notificationEventTag(eventId),
      },
      macosDevices,
      macosPayload: {
        title: resolved.title,
        body: resolved.body,
        ...(parsed.data.response
          ? {
              category:
                parsed.data.response.type === "approval"
                  ? "HARK_APPROVAL_V1"
                  : parsed.data.response.type === "yes_no"
                    ? "HARK_YES_NO_V1"
                    : "HARK_REPLY_V1",
              data: {
                eventId,
                interactionId: interactionId as string,
                kind: parsed.data.response.type === "text" ? "reply" : parsed.data.response.type,
                actionDigest: interactionActionDigest as string,
                ...(resolved.url ? { url: resolved.url } : {}),
              },
            }
          : {
              data: { eventId, ...(resolved.url ? { url: resolved.url } : {}) },
            }),
        threadId: parsed.data.response ? `interaction-${interactionId}` : `service-${svc.id}`,
        badge: parsed.data.response ? (pendingActions?.value ?? 0) : undefined,
      },
    });

    if (result.staleTokens.length > 0) {
      await db
        .update(device)
        .set({ active: false })
        .where(inArray(device.expoPushToken, result.staleTokens));
      track({
        name: "device_deactivated_stale",
        userId: svc.userId,
        plan: billing.plan,
        outcome: "webhook",
        value: result.staleTokens.length,
      });
    }
    if (result.staleSubscriptionIds.length > 0) {
      await db
        .update(webPushSubscription)
        .set({ active: false })
        .where(inArray(webPushSubscription.id, result.staleSubscriptionIds));
    }
    if (result.staleMacosDeviceIds.length > 0) {
      await db
        .update(macosDevice)
        .set({ active: false })
        .where(inArray(macosDevice.id, result.staleMacosDeviceIds));
    }

    const targetCount = messages.length + webSubscriptions.length + macosDevices.length;
    const status =
      result.accepted === targetCount ? "accepted" : result.accepted > 0 ? "partial" : "failed";
    const pushError = result.errors.length > 0 ? result.errors.join("; ").slice(0, 1000) : null;

    await db
      .update(event)
      .set({ status, deliveredCount: result.accepted, error: pushError })
      .where(eq(event.id, eventId));
    if (interactionId) {
      await db
        .update(interaction)
        .set({ acceptedCount: result.accepted })
        .where(eq(interaction.id, interactionId));
    }

    if (result.accepted === 0) {
      track({
        name: "webhook_failed",
        userId: svc.userId,
        serviceId: svc.id,
        plan: billing.plan,
        outcome: failureBucket(result.errors[0]),
        metadata: { targets: targetCount },
      });
      // Provider errors can embed the recipient push token, so they stay in the
      // owner-only event log rather than the webhook caller's response.
      return c.json<WebhookResponse>({ ok: false, error: "Push delivery failed" }, 502);
    }

    track({
      name: "webhook_delivered",
      userId: svc.userId,
      serviceId: svc.id,
      plan: billing.plan,
      outcome: status,
      value: result.accepted,
      metadata: { targets: targetCount },
    });
    track({
      name: "notification_sent",
      userId: svc.userId,
      serviceId: svc.id,
      plan: billing.plan,
      outcome: "webhook",
      value: result.accepted,
    });

    await trackNotification(svc.userId, eventId);

    return c.json<WebhookResponse>({
      ok: true,
      eventId,
      delivered: result.accepted,
      ...(parsed.data.response
        ? {
            response: {
              status: "pending",
              expiresAt: (interactionExpiresAt as Date).toISOString(),
            },
          }
        : {}),
    });
  })
  .get("/:token/events/:eventId", async (c) => {
    const [row] = await db
      .select({ interaction })
      .from(interaction)
      .innerJoin(serviceTable, eq(interaction.requesterServiceId, serviceTable.id))
      .where(
        and(
          eq(serviceTable.tokenHash, hashWebhookToken(c.req.param("token"))),
          eq(interaction.eventId, c.req.param("eventId")),
        ),
      )
      .limit(1);
    if (!row) return c.json({ ok: false, error: "Event response not found" }, 404);
    const item = await expireIfNeededForWebhook(row.interaction);
    return c.json({
      ok: true,
      event: {
        id: c.req.param("eventId"),
        response: {
          status: item.status,
          action: item.kind === "reply" ? (item.response ? "reply" : null) : item.response,
          text: item.kind === "reply" ? item.response : null,
          correlationId: item.correlationId,
          respondedAt: item.respondedAt?.toISOString() ?? null,
          expiresAt: item.expiresAt.toISOString(),
        },
      },
    });
  })
  .post("/:token/events/:eventId/cancel", async (c) => {
    const [row] = await db
      .update(interaction)
      .set({ status: "canceled", canceledAt: new Date() })
      .where(
        and(
          eq(interaction.eventId, c.req.param("eventId")),
          eq(interaction.status, "pending"),
          inArray(
            interaction.requesterServiceId,
            db
              .select({ id: serviceTable.id })
              .from(serviceTable)
              .where(eq(serviceTable.tokenHash, hashWebhookToken(c.req.param("token")))),
          ),
        ),
      )
      .returning();
    if (!row) return c.json({ ok: false, error: "Pending event response not found" }, 404);
    return c.json({ ok: true, eventId: c.req.param("eventId"), status: "canceled" });
  })
  .post("/:token/events/:eventId/withdraw", async (c) => {
    const eventId = c.req.param("eventId");
    const [match] = await db
      .select({ event, service: serviceTable, owner: userTable })
      .from(event)
      .innerJoin(serviceTable, eq(event.serviceId, serviceTable.id))
      .innerJoin(userTable, eq(serviceTable.userId, userTable.id))
      .where(
        and(
          eq(event.id, eventId),
          eq(serviceTable.tokenHash, hashWebhookToken(c.req.param("token"))),
        ),
      )
      .limit(1);
    if (!match || !isEmailAllowed(match.owner.email)) {
      return c.json<WithdrawEventResponse>({ ok: false, error: "Event not found" }, 404);
    }

    if (match.event.status === "processing" || match.event.status === "withdraw_processing") {
      return c.json<WithdrawEventResponse>({ ok: false, error: "Event is still processing" }, 409);
    }
    if (match.event.status === "withdrawn" || match.event.status === "withdraw_partial") {
      return c.json<WithdrawEventResponse>({
        ok: true,
        eventId,
        status: match.event.status,
        accepted: 0,
        idempotent: true,
      });
    }
    if (!isWithdrawableEventStatus(match.event.status)) {
      return c.json<WithdrawEventResponse>({ ok: false, error: "Event is still processing" }, 409);
    }

    const [claimed] = await db
      .update(event)
      .set({ status: "withdraw_processing" })
      .where(and(eq(event.id, eventId), eq(event.status, match.event.status)))
      .returning({ id: event.id });
    if (!claimed) {
      return c.json<WithdrawEventResponse>(
        { ok: false, error: "Withdrawal already in progress" },
        409,
      );
    }

    const priorStatus = match.event.status;
    const userId = match.service.userId;
    try {
      const [devices, webSubscriptions, macosDevices] = await Promise.all([
        db
          .select()
          .from(device)
          .where(
            and(eq(device.userId, userId), eq(device.active, true), eq(device.platform, "ios")),
          ),
        db
          .select()
          .from(webPushSubscription)
          .where(and(eq(webPushSubscription.userId, userId), eq(webPushSubscription.active, true))),
        db
          .select()
          .from(macosDevice)
          .where(and(eq(macosDevice.userId, userId), eq(macosDevice.active, true))),
      ]);
      const targetCount = devices.length + webSubscriptions.length + macosDevices.length;
      if (targetCount === 0) {
        await markEventWithdrawn(eventId, userId, "withdrawn");
        return c.json<WithdrawEventResponse>({
          ok: true,
          eventId,
          status: "withdrawn",
          accepted: 0,
        });
      }

      const result = await sendWithdrawalFanout({
        expoTokens: devices.map((registeredDevice) => registeredDevice.expoPushToken),
        webSubscriptions,
        macosDevices,
        eventId,
      });
      await deactivateStaleWithdrawalTargets(result);

      if (result.accepted === 0) {
        await restoreEventAfterFailedWithdrawal(eventId, priorStatus);
        return c.json<WithdrawEventResponse>(
          { ok: false, error: "Withdrawal delivery failed" },
          502,
        );
      }

      const status = result.accepted === targetCount ? "withdrawn" : "withdraw_partial";
      await markEventWithdrawn(eventId, userId, status);
      return c.json<WithdrawEventResponse>({
        ok: true,
        eventId,
        status,
        accepted: result.accepted,
      });
    } catch (error) {
      await restoreEventAfterFailedWithdrawal(eventId, priorStatus);
      throw error;
    }
  });

const WITHDRAWABLE_EVENT_STATUSES = [
  "accepted",
  "delivered",
  "partial",
  "failed",
  "no_devices",
] as const;

function isWithdrawableEventStatus(
  status: string,
): status is (typeof WITHDRAWABLE_EVENT_STATUSES)[number] {
  return (WITHDRAWABLE_EVENT_STATUSES as readonly string[]).includes(status);
}

async function deactivateStaleWithdrawalTargets(result: {
  staleTokens: string[];
  staleSubscriptionIds: string[];
  staleMacosDeviceIds: string[];
}): Promise<void> {
  if (result.staleTokens.length > 0) {
    await db
      .update(device)
      .set({ active: false })
      .where(inArray(device.expoPushToken, result.staleTokens));
  }
  if (result.staleSubscriptionIds.length > 0) {
    await db
      .update(webPushSubscription)
      .set({ active: false })
      .where(inArray(webPushSubscription.id, result.staleSubscriptionIds));
  }
  if (result.staleMacosDeviceIds.length > 0) {
    await db
      .update(macosDevice)
      .set({ active: false })
      .where(inArray(macosDevice.id, result.staleMacosDeviceIds));
  }
}

async function markEventWithdrawn(
  eventId: string,
  userId: string,
  status: "withdrawn" | "withdraw_partial",
): Promise<void> {
  await Promise.all([
    db.update(event).set({ status }).where(eq(event.id, eventId)),
    db
      .update(interaction)
      .set({ status: "canceled", canceledAt: new Date() })
      .where(and(eq(interaction.eventId, eventId), eq(interaction.status, "pending"))),
  ]);
  await syncInboxForUser(userId);
  await db
    .update(inboxItem)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(inboxItem.userId, userId),
        isNull(inboxItem.readAt),
        or(
          and(eq(inboxItem.entityType, "event"), eq(inboxItem.entityId, eventId)),
          and(
            eq(inboxItem.entityType, "interaction"),
            inArray(
              inboxItem.entityId,
              db
                .select({ id: interaction.id })
                .from(interaction)
                .where(eq(interaction.eventId, eventId)),
            ),
          ),
        ),
      ),
    );
}

async function restoreEventAfterFailedWithdrawal(eventId: string, status: string): Promise<void> {
  await db
    .update(event)
    .set({ status })
    .where(and(eq(event.id, eventId), eq(event.status, "withdraw_processing")));
}

async function expireIfNeededForWebhook(row: typeof interaction.$inferSelect) {
  if (row.status !== "pending" || row.expiresAt > new Date()) return row;
  const [expired] = await db
    .update(interaction)
    .set({ status: "expired" })
    .where(and(eq(interaction.id, row.id), eq(interaction.status, "pending")))
    .returning();
  return expired ?? row;
}
