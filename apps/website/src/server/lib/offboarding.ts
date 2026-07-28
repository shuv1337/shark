import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  account,
  apiToken,
  appleNativeGrant,
  device,
  deviceAuthorizationRequest,
  interaction,
  liveActivity,
  liveActivityDelivery,
  service,
  session,
  user,
} from "../db/schema";
import { normalizeEmail } from "../env";
import { revokeAppleGrantsForUser } from "./apple";

export interface OffboardingResult {
  sessions: number;
  apiTokens: number;
  devices: number;
  services: number;
  interactions: number;
  liveActivities: number;
}

function revokedCredential(): string {
  return `offboarded_${randomBytes(32).toString("hex")}`;
}

/** Revokes persisted access while preserving the user's application data. */
export function offboardPersistedAccess(userId: string): OffboardingResult {
  return db.transaction((tx) => {
    const activityIds = tx
      .select({ id: liveActivity.id })
      .from(liveActivity)
      .where(eq(liveActivity.userId, userId))
      .all()
      .map((row) => row.id);
    const services = tx
      .select({ id: service.id })
      .from(service)
      .where(eq(service.userId, userId))
      .all();

    const deletedSessions = tx
      .delete(session)
      .where(eq(session.userId, userId))
      .returning({ id: session.id })
      .all();
    const revokedTokens = tx
      .update(apiToken)
      .set({ revokedAt: new Date() })
      .where(eq(apiToken.userId, userId))
      .returning({ id: apiToken.id })
      .all();
    const disabledDevices = tx
      .update(device)
      .set({
        active: false,
        expoPushToken: revokedCredential(),
        apnsToken: null,
        liveActivityPushToStartTokenCiphertext: null,
        liveActivityTokenEnvironment: null,
        liveActivitySchemaVersion: null,
        liveActivityTokenUpdatedAt: null,
        interactionSchemaVersion: null,
      })
      .where(eq(device.userId, userId))
      .returning({ id: device.id })
      .all();

    for (const ownedService of services) {
      tx.update(service)
        .set({
          tokenHash: revokedCredential(),
          tokenCiphertext: null,
          updatedAt: new Date(),
        })
        .where(eq(service.id, ownedService.id))
        .run();
    }

    const disabledInteractions = tx
      .update(interaction)
      .set({
        responseTokenHash: null,
        callbackTokenCiphertext: null,
        callbackStatus: null,
        callbackNextAttemptAt: null,
      })
      .where(eq(interaction.userId, userId))
      .returning({ id: interaction.id })
      .all();

    if (activityIds.length > 0) {
      tx.update(liveActivityDelivery)
        .set({
          status: "ended",
          updateTokenCiphertext: null,
          updateTokenUpdatedAt: null,
          endedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(inArray(liveActivityDelivery.activityId, activityIds))
        .run();
    }
    tx.update(liveActivity)
      .set({ status: "ended", endedAt: new Date(), updatedAt: new Date() })
      .where(eq(liveActivity.userId, userId))
      .run();

    tx.update(deviceAuthorizationRequest)
      .set({ status: "denied", approvedUserId: null, resolvedAt: new Date() })
      .where(eq(deviceAuthorizationRequest.approvedUserId, userId))
      .run();
    tx.update(account)
      .set({
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      })
      .where(eq(account.userId, userId))
      .run();
    tx.delete(appleNativeGrant).where(eq(appleNativeGrant.userId, userId)).run();

    return {
      sessions: deletedSessions.length,
      apiTokens: revokedTokens.length,
      devices: disabledDevices.length,
      services: services.length,
      interactions: disabledInteractions.length,
      liveActivities: activityIds.length,
    };
  });
}

/**
 * Revokes Apple grants before clearing local credentials. If Apple revocation
 * fails, local cleanup does not run and the current admission checks remain the
 * fail-closed boundary.
 */
export async function offboardUserByEmail(email: string): Promise<OffboardingResult> {
  const normalized = normalizeEmail(email);
  const users = await db.select({ id: user.id, email: user.email }).from(user);
  const match = users.find((candidate) => normalizeEmail(candidate.email) === normalized);
  if (!match) throw new Error("No account matches that exact normalized email.");
  await revokeAppleGrantsForUser(match.id);
  return offboardPersistedAccess(match.id);
}
