import {
  type NotificationWithdrawalPushData,
  PUSH_SCHEMA_VERSION,
} from "@hark/contracts";
import type { ExpoPushMessage } from "expo-server-sdk";
import type { SilentNotificationPayloadInput } from "./apns";
import type { WebPushPayload } from "./web-push";

/** Event-specific web/macOS identifier used to close one delivered notification. */
export function notificationEventTag(eventId: string): string {
  return `event-${eventId}`;
}

export function notificationWithdrawalCommand(eventId: string): NotificationWithdrawalPushData {
  return {
    v: PUSH_SCHEMA_VERSION,
    command: "notification.withdraw",
    eventId,
  };
}

export function buildNotificationWithdrawalPushMessages(
  to: string[],
  eventId: string,
): ExpoPushMessage[] {
  const data = notificationWithdrawalCommand(eventId);
  return to.map((token) => ({
    to: token,
    data,
    _contentAvailable: true,
  }));
}

export function buildWebWithdrawalPayload(eventId: string): WebPushPayload {
  const command = notificationWithdrawalCommand(eventId);
  return {
    v: command.v,
    command: command.command,
    eventId: command.eventId,
    tag: notificationEventTag(eventId),
  };
}

export function buildMacosWithdrawalPayload(eventId: string): SilentNotificationPayloadInput {
  const command = notificationWithdrawalCommand(eventId);
  return {
    data: {
      v: command.v,
      command: command.command,
      eventId: command.eventId,
    },
  };
}
