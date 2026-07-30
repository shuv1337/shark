import type * as Notifications from "expo-notifications";

export interface NotificationDetail {
  eventId: string | null;
  title: string;
  body: string;
  sourceName: string | null;
  avatarUrl: string | null;
  receivedAt: string;
}

let currentDetail: NotificationDetail | null = null;

export function detailFromNotification(
  notification: Notifications.Notification,
): NotificationDetail | null {
  const { content } = notification.request;
  const title = content.title?.trim() ?? "";
  const body = content.body?.trim() ?? "";
  if (!title && !body) return null;
  const data = content.data as
    | { eventId?: unknown; sourceName?: unknown; avatarUrl?: unknown }
    | undefined;
  return {
    eventId: typeof data?.eventId === "string" ? data.eventId : null,
    title: title || (typeof data?.sourceName === "string" ? data.sourceName : "SHark"),
    body,
    sourceName: typeof data?.sourceName === "string" ? data.sourceName : null,
    avatarUrl: typeof data?.avatarUrl === "string" ? data.avatarUrl : null,
    receivedAt: new Date(notification.date).toISOString(),
  };
}

export function setNotificationDetail(detail: NotificationDetail): void {
  currentDetail = detail;
}

export function getNotificationDetail(): NotificationDetail | null {
  return currentDetail;
}

export function clearNotificationDetail(): void {
  currentDetail = null;
}
