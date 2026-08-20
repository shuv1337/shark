import {
  type DeviceDto,
  type InboxActionDto,
  type InboxItemDto,
  macosDeviceRegisterSchema,
  macosInteractionResponseSchema,
} from "@hark/contracts";
import { and, count, desc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import {
  device,
  inboxItem,
  interaction,
  macosDevice,
  user as userTable,
  webPushSubscription,
} from "../db/schema";
import { track } from "../lib/analytics";
import { getBilling } from "../lib/billing";
import { newId } from "../lib/id";
import { syncInboxForUser } from "../lib/inbox";
import { deliverInteractionCallbacks } from "../lib/interaction-callbacks";
import { encryptMacosApnsToken, hashMacosApnsToken } from "../lib/token";
import { type AgentEnv, requireApiToken, requireScopes } from "../middleware";
import { resolveInteractionLiveActivity } from "./activities";

function toDeviceDto(row: typeof macosDevice.$inferSelect): DeviceDto {
  return {
    id: row.id,
    platform: "macos",
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

type SnapshotRow = typeof inboxItem.$inferSelect & {
  interactionKind: string | null;
  choices: string[] | null;
  actionDigest: string | null;
  primaryLabel: string | null;
  secondaryLabel: string | null;
  expiresAt: Date | null;
};

function toInboxItem(row: SnapshotRow): InboxItemDto {
  const action: InboxActionDto | null =
    row.needsAction &&
    row.entityType === "interaction" &&
    row.interactionKind &&
    row.choices &&
    row.actionDigest &&
    row.expiresAt
      ? {
          interactionId: row.entityId,
          kind: row.interactionKind as InboxActionDto["kind"],
          choices: row.choices,
          actionDigest: row.actionDigest,
          primaryLabel: row.primaryLabel,
          secondaryLabel: row.secondaryLabel,
          expiresAt: row.expiresAt.toISOString(),
        }
      : null;
  return {
    id: row.id,
    kind: row.kind as InboxItemDto["kind"],
    sourceName: row.sourceName,
    sourceImageUrl: row.sourceImageUrl,
    title: row.title,
    body: row.body,
    imageUrl: row.imageUrl,
    url: row.url,
    status: row.status,
    result: row.result,
    accepted: row.acceptedCount,
    failed: row.failedCount,
    needsAction: row.needsAction,
    readAt: row.readAt?.toISOString() ?? null,
    occurredAt: row.occurredAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    action,
  };
}

async function snapshotFor(userId: string) {
  await syncInboxForUser(userId);
  const rows = await db
    .select({
      id: inboxItem.id,
      userId: inboxItem.userId,
      entityType: inboxItem.entityType,
      entityId: inboxItem.entityId,
      kind: inboxItem.kind,
      sourceName: inboxItem.sourceName,
      sourceImageUrl: inboxItem.sourceImageUrl,
      title: inboxItem.title,
      body: inboxItem.body,
      imageUrl: inboxItem.imageUrl,
      url: inboxItem.url,
      status: inboxItem.status,
      result: inboxItem.result,
      acceptedCount: inboxItem.acceptedCount,
      failedCount: inboxItem.failedCount,
      needsAction: inboxItem.needsAction,
      readAt: inboxItem.readAt,
      occurredAt: inboxItem.occurredAt,
      updatedAt: inboxItem.updatedAt,
      interactionKind: interaction.kind,
      choices: interaction.choices,
      actionDigest: interaction.actionDigest,
      primaryLabel: interaction.primaryLabel,
      secondaryLabel: interaction.secondaryLabel,
      expiresAt: interaction.expiresAt,
    })
    .from(inboxItem)
    .leftJoin(
      interaction,
      and(eq(inboxItem.entityType, "interaction"), eq(interaction.id, inboxItem.entityId)),
    )
    .where(eq(inboxItem.userId, userId))
    .orderBy(desc(inboxItem.occurredAt), desc(inboxItem.id))
    .limit(50);
  const [unresolved] = await db
    .select({ value: count() })
    .from(inboxItem)
    .where(and(eq(inboxItem.userId, userId), eq(inboxItem.needsAction, true)));
  return {
    generatedAt: new Date().toISOString(),
    items: rows.map((row) => toInboxItem(row as SnapshotRow)),
    unresolvedCount: unresolved?.value ?? 0,
  };
}

export const macosRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .post("/devices", requireScopes("macos:register"), async (c) => {
    const parsed = macosDeviceRegisterSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { error: "Invalid macOS device registration", issues: parsed.error.issues },
        400,
      );
    }
    const token = c.get("apiToken");
    const tokenHash = hashMacosApnsToken(parsed.data.apnsToken);
    const [existing] = await db
      .select()
      .from(macosDevice)
      .where(eq(macosDevice.apnsTokenHash, tokenHash))
      .limit(1);
    if (existing && existing.userId !== token.userId) {
      return c.json({ error: "macOS device is already registered" }, 409);
    }
    if (!existing?.active) {
      const [owner, iosCount, webCount, macCount] = await Promise.all([
        db.select().from(userTable).where(eq(userTable.id, token.userId)).limit(1),
        db
          .select({ value: count() })
          .from(device)
          .where(and(eq(device.userId, token.userId), eq(device.active, true))),
        db
          .select({ value: count() })
          .from(webPushSubscription)
          .where(
            and(eq(webPushSubscription.userId, token.userId), eq(webPushSubscription.active, true)),
          ),
        db
          .select({ value: count() })
          .from(macosDevice)
          .where(and(eq(macosDevice.userId, token.userId), eq(macosDevice.active, true))),
      ]);
      if (!owner[0]) return c.json({ error: "Account not found" }, 404);
      const billing = await getBilling(owner[0]);
      if (
        billing.limits.devices !== null &&
        (iosCount[0]?.value ?? 0) + (webCount[0]?.value ?? 0) + (macCount[0]?.value ?? 0) >=
          billing.limits.devices
      ) {
        return c.json({ error: "This account has reached its active device limit." }, 402);
      }
    }
    const now = new Date();
    const [registered] = await db
      .insert(macosDevice)
      .values({
        id: newId("mac"),
        userId: token.userId,
        apnsTokenHash: tokenHash,
        apnsTokenCiphertext: encryptMacosApnsToken(parsed.data.apnsToken),
        environment: parsed.data.environment,
        deviceName: parsed.data.deviceName ?? null,
        privacyMode: parsed.data.privacyMode,
        active: true,
        createdAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: macosDevice.apnsTokenHash,
        set: {
          apnsTokenCiphertext: encryptMacosApnsToken(parsed.data.apnsToken),
          environment: parsed.data.environment,
          deviceName: parsed.data.deviceName ?? null,
          privacyMode: parsed.data.privacyMode,
          active: true,
          lastSeenAt: now,
        },
      })
      .returning();
    if (!registered) return c.json({ error: "Failed to register macOS device" }, 500);
    track({
      name: "device_registered",
      userId: token.userId,
      deviceId: registered.id,
      outcome: existing ? "reregistered" : "created",
    });
    return c.json({ device: toDeviceDto(registered) }, existing ? 200 : 201);
  })
  .delete("/devices/:id", requireScopes("macos:register"), async (c) => {
    await db
      .delete(macosDevice)
      .where(
        and(
          eq(macosDevice.id, c.req.param("id")),
          eq(macosDevice.userId, c.get("apiToken").userId),
        ),
      );
    return c.json({ ok: true });
  })
  .get("/snapshot", requireScopes("macos:read"), async (c) =>
    c.json(await snapshotFor(c.get("apiToken").userId)),
  )
  .post("/inbox/:id/read", requireScopes("macos:read"), async (c) => {
    const [updated] = await db
      .update(inboxItem)
      .set({ readAt: new Date() })
      .where(
        and(eq(inboxItem.id, c.req.param("id")), eq(inboxItem.userId, c.get("apiToken").userId)),
      )
      .returning({ id: inboxItem.id });
    if (!updated) return c.json({ error: "Inbox item not found" }, 404);
    return c.json({ ok: true });
  })
  .post("/interactions/:id/respond", requireScopes("macos:respond"), async (c) => {
    const parsed = macosInteractionResponseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid interaction response" }, 400);
    const token = c.get("apiToken");
    const [current] = await db
      .select()
      .from(interaction)
      .where(and(eq(interaction.id, c.req.param("id")), eq(interaction.userId, token.userId)))
      .limit(1);
    if (!current) return c.json({ error: "Interaction not found" }, 404);
    if (current.actionDigest !== parsed.data.actionDigest) {
      return c.json({ error: "Interaction action digest mismatch" }, 409);
    }
    if (
      (current.kind === "approval" && !inArrayValue(parsed.data.action, ["approve", "deny"])) ||
      (current.kind === "yes_no" && !inArrayValue(parsed.data.action, ["yes", "no"])) ||
      (current.kind === "reply" && parsed.data.action !== "reply")
    ) {
      return c.json({ error: `This interaction requires a ${current.kind} response` }, 400);
    }
    const now = new Date();
    const status =
      parsed.data.action === "approve"
        ? "approved"
        : parsed.data.action === "deny"
          ? "denied"
          : parsed.data.action === "reply"
            ? "replied"
            : parsed.data.action;
    const response = parsed.data.action === "reply" ? parsed.data.response : parsed.data.action;
    const [resolved] = await db
      .update(interaction)
      .set({ status, response, respondedAt: now, callbackNextAttemptAt: now })
      .where(
        and(
          eq(interaction.id, current.id),
          eq(interaction.userId, token.userId),
          eq(interaction.status, "pending"),
          gt(interaction.expiresAt, now),
        ),
      )
      .returning();
    if (!resolved) {
      return c.json(
        { error: "Interaction is already terminal", snapshot: await snapshotFor(token.userId) },
        409,
      );
    }
    track({
      name: "interaction_responded",
      userId: token.userId,
      outcome: parsed.data.action,
      metadata: { kind: current.kind, surface: "macos" },
    });
    void deliverInteractionCallbacks();
    void resolveInteractionLiveActivity(resolved);
    return c.json({ ok: true, status: resolved.status, snapshot: await snapshotFor(token.userId) });
  });

function inArrayValue(value: string, allowed: readonly string[]): boolean {
  return allowed.includes(value);
}
