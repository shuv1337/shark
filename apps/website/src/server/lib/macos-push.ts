import type { macosDevice } from "../db/schema";
import {
  isInvalidApnsTokenReason,
  type NotificationPayloadInput,
  sendNotificationPush,
} from "./apns";
import { decryptMacosApnsToken } from "./token";

export interface MacosPushResult {
  accepted: number;
  errors: string[];
  staleMacosDeviceIds: string[];
}

export async function sendMacosPushNotifications(
  devices: Array<typeof macosDevice.$inferSelect>,
  payload: NotificationPayloadInput,
): Promise<MacosPushResult> {
  const result: MacosPushResult = { accepted: 0, errors: [], staleMacosDeviceIds: [] };
  await Promise.all(
    devices.map(async (device) => {
      if (device.environment !== "sandbox" && device.environment !== "production") {
        result.errors.push("Invalid macOS APNs environment");
        return;
      }
      try {
        const devicePayload: NotificationPayloadInput =
          device.privacyMode === "private"
            ? {
                title: "SHark alert",
                body: "Open SHark to view details.",
                threadId: payload.threadId,
                badge: payload.badge,
                data: payload.data,
              }
            : payload;
        const response = await sendNotificationPush(
          decryptMacosApnsToken(device.apnsTokenCiphertext),
          device.environment,
          devicePayload,
        );
        if (response.accepted) {
          result.accepted += 1;
          return;
        }
        result.errors.push(response.reason ?? "APNs rejected notification");
        if (isInvalidApnsTokenReason(response.reason)) result.staleMacosDeviceIds.push(device.id);
      } catch {
        result.errors.push("Invalid encrypted macOS APNs token");
      }
    }),
  );
  return result;
}
