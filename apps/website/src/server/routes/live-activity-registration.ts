import { liveActivityBackgroundTokenSchema } from "@hark/contracts";
import { and, eq, gt, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { liveActivity, liveActivityDelivery, user } from "../db/schema";
import { isEmailAllowed } from "../lib/admission";
import { verifyLiveActivityRegistrationToken } from "../lib/live-activity-registration";
import { encryptLiveActivityToken } from "../lib/token";

export const liveActivityRegistrationRoute = new Hono().post("/update-token", async (c) => {
  const parsed = liveActivityBackgroundTokenSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid Live Activity token registration" }, 400);
  }

  const now = new Date();
  const registered = db.transaction((tx) => {
    const candidate = tx
      .select({
        deliveryId: liveActivityDelivery.id,
        activityId: liveActivity.id,
        expiresAt: liveActivity.expiresAt,
        ownerEmail: user.email,
      })
      .from(liveActivityDelivery)
      .innerJoin(liveActivity, eq(liveActivity.id, liveActivityDelivery.activityId))
      .innerJoin(user, eq(liveActivity.userId, user.id))
      .where(
        and(
          eq(liveActivityDelivery.id, parsed.data.deliveryId),
          inArray(liveActivityDelivery.status, ["pending", "accepted", "active"]),
          inArray(liveActivity.status, ["starting", "active", "partial"]),
          gt(liveActivity.expiresAt, now),
        ),
      )
      .get();
    if (
      !candidate ||
      !isEmailAllowed(candidate.ownerEmail) ||
      !verifyLiveActivityRegistrationToken(
        parsed.data.registrationToken,
        candidate.deliveryId,
        candidate.activityId,
        candidate.expiresAt,
      )
    ) {
      return false;
    }

    tx.update(liveActivityDelivery)
      .set({
        nativeActivityId: parsed.data.nativeActivityId,
        updateTokenCiphertext: encryptLiveActivityToken(parsed.data.updateToken.toLowerCase()),
        updateTokenUpdatedAt: now,
        status: "active",
        updatedAt: now,
      })
      .where(eq(liveActivityDelivery.id, candidate.deliveryId))
      .run();
    return true;
  });
  if (!registered) return c.json({ error: "Live Activity delivery not found" }, 404);

  return c.json({ ok: true });
});
