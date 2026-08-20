import {
  type WebPushSubscriptionDto,
  webPushSubscriptionEndpointSchema,
  webPushSubscriptionRegisterSchema,
} from "@hark/contracts";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { device, macosDevice, webPushSubscription } from "../db/schema";
import { env } from "../env";
import { getBilling } from "../lib/billing";
import { newId } from "../lib/id";
import { encryptWebPushSubscription, hashWebPushEndpoint } from "../lib/token";
import { sendWebPushNotifications } from "../lib/web-push";
import { type AuthedEnv, requireAuth } from "../middleware";

function toDto(row: typeof webPushSubscription.$inferSelect): WebPushSubscriptionDto {
  return {
    id: row.id,
    deviceName: row.deviceName,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(env.APP_URL).origin;
}

export const webPushRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/vapid-public-key", (c) => {
    if (!env.VAPID_PUBLIC_KEY) return c.json({ error: "Browser push is not configured" }, 503);
    return c.json({ publicKey: env.VAPID_PUBLIC_KEY });
  })
  .post("/subscriptions", async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: "Invalid request origin" }, 403);
    const parsed = webPushSubscriptionRegisterSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json(
        { error: "Invalid browser push subscription", issues: parsed.error.issues },
        400,
      );
    }
    const user = c.get("user");
    const endpointHash = hashWebPushEndpoint(parsed.data.subscription.endpoint);
    const [existing, iosDevices, webDevices, macosDevices, billing] = await Promise.all([
      db
        .select()
        .from(webPushSubscription)
        .where(eq(webPushSubscription.endpointHash, endpointHash))
        .limit(1),
      db
        .select({ id: device.id })
        .from(device)
        .where(and(eq(device.userId, user.id), eq(device.active, true))),
      db
        .select({ id: webPushSubscription.id })
        .from(webPushSubscription)
        .where(and(eq(webPushSubscription.userId, user.id), eq(webPushSubscription.active, true))),
      db
        .select({ id: macosDevice.id })
        .from(macosDevice)
        .where(and(eq(macosDevice.userId, user.id), eq(macosDevice.active, true))),
      getBilling(user),
    ]);
    if (existing[0] && existing[0].userId !== user.id) {
      return c.json({ error: "Browser subscription is already registered" }, 409);
    }
    const isAlreadyActiveForUser = existing[0]?.userId === user.id && existing[0].active;
    if (
      !isAlreadyActiveForUser &&
      billing.limits.devices !== null &&
      iosDevices.length + webDevices.length + macosDevices.length >= billing.limits.devices
    ) {
      return c.json({ error: "This account has reached its active device limit." }, 402);
    }

    const now = new Date();
    const [registered] = await db
      .insert(webPushSubscription)
      .values({
        id: newId("web"),
        userId: user.id,
        endpointHash,
        subscriptionCiphertext: encryptWebPushSubscription(
          JSON.stringify(parsed.data.subscription),
        ),
        deviceName: parsed.data.deviceName ?? null,
        active: true,
        expirationAt:
          parsed.data.subscription.expirationTime === null ||
          parsed.data.subscription.expirationTime === undefined
            ? null
            : new Date(parsed.data.subscription.expirationTime),
        createdAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: webPushSubscription.endpointHash,
        set: {
          userId: user.id,
          subscriptionCiphertext: encryptWebPushSubscription(
            JSON.stringify(parsed.data.subscription),
          ),
          deviceName: parsed.data.deviceName ?? null,
          active: true,
          expirationAt:
            parsed.data.subscription.expirationTime === null ||
            parsed.data.subscription.expirationTime === undefined
              ? null
              : new Date(parsed.data.subscription.expirationTime),
          lastSeenAt: now,
        },
      })
      .returning();
    if (!registered) return c.json({ error: "Failed to register browser" }, 500);
    return c.json({ subscription: toDto(registered) }, 201);
  })
  .delete("/subscriptions", async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: "Invalid request origin" }, 403);
    const parsed = webPushSubscriptionEndpointSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ error: "Invalid browser push endpoint" }, 400);
    await db
      .delete(webPushSubscription)
      .where(
        and(
          eq(webPushSubscription.userId, c.get("user").id),
          eq(webPushSubscription.endpointHash, hashWebPushEndpoint(parsed.data.endpoint)),
        ),
      );
    return c.json({ ok: true });
  })
  .post("/test", async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: "Invalid request origin" }, 403);
    const parsed = webPushSubscriptionEndpointSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ error: "Invalid browser push endpoint" }, 400);
    const [subscription] = await db
      .select()
      .from(webPushSubscription)
      .where(
        and(
          eq(webPushSubscription.userId, c.get("user").id),
          eq(webPushSubscription.endpointHash, hashWebPushEndpoint(parsed.data.endpoint)),
          eq(webPushSubscription.active, true),
        ),
      )
      .limit(1);
    if (!subscription) return c.json({ error: "Browser subscription not found" }, 404);
    const result = await sendWebPushNotifications([subscription], {
      title: "SHark",
      body: "Browser notifications are working.",
      url: "/dashboard",
      tag: "shark-browser-test",
    });
    if (result.staleSubscriptionIds.length > 0) {
      await db
        .update(webPushSubscription)
        .set({ active: false })
        .where(eq(webPushSubscription.id, subscription.id));
    }
    if (result.accepted === 0) return c.json({ error: "Test notification failed" }, 502);
    return c.json({ ok: true, accepted: result.accepted });
  });
