import type {
  AppDto,
  AppLaunchInput,
  AppPassResponse,
  AppSharingInput,
  DeviceDto,
  DeviceRegisterInput,
  DeviceUnregisterInput,
  EventDto,
  InboxActivityKind,
  InboxActivityPageDto,
  InboxDetailDto,
  InboxFilter,
  InboxInteractionDto,
  InboxLiveActivityDto,
  InboxMarkAllReadInput,
  InboxNotificationDetailDto,
  InboxNotificationPageDto,
  InboxPageDto,
  InboxProjectsDto,
  InteractionCredentialResponseInput,
  InteractionDto,
  InteractionResponseInput,
  LiveActivityPushToStartTokenInput,
  LiveActivityUpdateTokenInput,
} from "@hark/contracts";
import { apiErrorFromBody } from "./api-error";
import { API_URL, getCookie } from "./auth";

export type { NotificationDetailFailure } from "./api-error";
export { ApiError, classifyNotificationDetailFailure } from "./api-error";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const cookie = getCookie();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    // Keep the native session separate from the web view cookie jar.
    credentials: "omit",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || body === null) {
    throw apiErrorFromBody(response.status, body);
  }
  return body;
}

export const api = {
  listDevices: () => request<{ devices: DeviceDto[] }>("/api/devices"),
  registerDevice: (input: DeviceRegisterInput) =>
    request<{ device: { id: string } }>("/api/devices", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  unregisterDevice: (input: DeviceUnregisterInput) =>
    request<{ ok: true }>("/api/devices", {
      method: "DELETE",
      body: JSON.stringify(input),
    }),
  registerLiveActivityPushToStartToken: (input: LiveActivityPushToStartTokenInput) =>
    request<{ deviceId: string; updatedAt?: string }>("/api/devices/live-activity/push-to-start", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  registerLiveActivityUpdateToken: (input: LiveActivityUpdateTokenInput) =>
    request<{ activityId: string; deviceId: string }>("/api/devices/live-activity/update-token", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listEvents: (limit = 20) => request<{ events: EventDto[] }>(`/api/events?limit=${limit}`),
  listPendingInteractions: () =>
    request<{ interactions: InboxInteractionDto[] }>("/api/interactions"),
  listActiveActivities: () => request<{ activities: InboxLiveActivityDto[] }>("/api/activities"),
  listActivityFeed: (filter: "all" | InboxActivityKind, page: number) =>
    request<InboxActivityPageDto>(`/api/activity-feed?filter=${filter}&page=${page}`),
  respondToInteraction: (id: string, input: InteractionResponseInput) =>
    request<{ interaction: InteractionDto }>(`/api/interactions/${id}/respond`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  dismissInteraction: (id: string) =>
    request<{ interaction: InteractionDto }>(
      `/api/interactions/${encodeURIComponent(id)}/dismiss`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  respondToInteractionWithToken: (id: string, input: InteractionCredentialResponseInput) =>
    request<{ ok: true; status: string }>(`/api/interaction-responses/${id}/respond`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  // Project inbox endpoints. Older or self-hosted servers 404 on these; the
  // app treats that as "no project inbox" and keeps the legacy behavior.
  listInboxProjects: () => request<InboxProjectsDto>("/api/inbox/projects"),
  listInboxNotifications: (params: {
    project?: string;
    unread?: boolean;
    cursor?: string;
    limit?: number;
  }) => {
    const query = new URLSearchParams();
    if (params.project) query.set("project", params.project);
    if (params.unread) query.set("unread", "1");
    if (params.cursor) query.set("cursor", params.cursor);
    query.set("limit", String(params.limit ?? 20));
    return request<InboxNotificationPageDto>(`/api/inbox/notifications?${query.toString()}`);
  },
  getInboxNotification: (id: string) =>
    request<{ notification: InboxNotificationDetailDto }>(
      `/api/inbox/notifications/${encodeURIComponent(id)}`,
    ),
  markNotificationRead: (id: string) =>
    request<{ ok: true; readAt: string }>(
      `/api/inbox/notifications/${encodeURIComponent(id)}/read`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  markNotificationUnread: (id: string) =>
    request<{ ok: true; readAt: null }>(
      `/api/inbox/notifications/${encodeURIComponent(id)}/unread`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  listInbox: (filter: InboxFilter, cursor?: string | null, limit = 30) => {
    const params = new URLSearchParams({ filter, limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return request<InboxPageDto>(`/api/inbox?${params}`);
  },
  getInboxItem: (id: string) => request<InboxDetailDto>(`/api/inbox/${encodeURIComponent(id)}`),
  markInboxItemRead: (id: string) =>
    request<{ ok: true }>(`/api/inbox/${encodeURIComponent(id)}/read`, { method: "POST" }),
  markAllInboxRead: () => request<{ ok: true }>("/api/inbox/read-all", { method: "POST" }),
  listApps: () => request<{ apps: AppDto[] }>("/api/apps"),
  getApp: (id: string) => request<{ app: AppDto }>(`/api/apps/${encodeURIComponent(id)}`),
  updateAppSharing: (id: string, input: AppSharingInput) =>
    request<{ app: AppDto }>(`/api/apps/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  /** Issues a short-lived signed pass. Fails with `consent_required` until approved. */
  getAppPass: (id: string, input: AppLaunchInput = {}) =>
    request<AppPassResponse>(`/api/apps/${encodeURIComponent(id)}/pass`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  revokeApp: (id: string) =>
    request<{ app: AppDto }>(`/api/apps/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  removeApp: (id: string) =>
    request<{ ok: true }>(`/api/apps/${encodeURIComponent(id)}`, { method: "DELETE" }),
  markAllNotificationsRead: (input: InboxMarkAllReadInput) =>
    request<{ ok: true; updated: number }>("/api/inbox/notifications/read-all", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
