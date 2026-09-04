import type { macosDevice } from "../db/schema";
import {
  isInvalidApnsTokenReason,
  type NotificationPayloadInput,
  type SilentNotificationPayloadInput,
  sendNotificationPush,
  sendSilentNotificationPush,
} from "./apns";
import { decryptMacosApnsToken } from "./token";

export interface MacosPushResult {
  accepted: number;
  errors: string[];
  staleMacosDeviceIds: string[];
}

type MacosDeviceRow = typeof macosDevice.$inferSelect;

async function sendToMacosDevices(
  devices: MacosDeviceRow[],
  send: (device: MacosDeviceRow) => Promise<{ accepted: boolean; reason: string | null }>,
): Promise<MacosPushResult> {
  const result: MacosPushResult = { accepted: 0, errors: [], staleMacosDeviceIds: [] };
  await Promise.all(
    devices.map(async (device) => {
      if (device.environment !== "sandbox" && device.environment !== "production") {
        result.errors.push("Invalid macOS APNs environment");
        return;
      }
      try {
        const response = await send(device);
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

export async function sendMacosPushNotifications(
  devices: MacosDeviceRow[],
  payload: NotificationPayloadInput,
): Promise<MacosPushResult> {
  return sendToMacosDevices(devices, async (device) => {
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
    return sendNotificationPush(
      decryptMacosApnsToken(device.apnsTokenCiphertext),
      device.environment,
      devicePayload,
    );
  });
}

/** Silent APNs only — never redacted into a visible banner. */
export async function sendMacosSilentPush(
  devices: MacosDeviceRow[],
  payload: SilentNotificationPayloadInput,
): Promise<MacosPushResult> {
  return sendToMacosDevices(devices, (device) =>
    sendSilentNotificationPush(
      decryptMacosApnsToken(device.apnsTokenCiphertext),
      device.environment,
      payload,
    ),
  );
}
