import type {
  AppDto,
  AppLaunchInput,
  AppPassResponse,
  AppSharingInput,
  DeviceRegisterInput,
  DeviceUnregisterInput,
  EventDto,
  InboxDetailDto,
  InboxFilter,
  InboxPageDto,
  InteractionCredentialResponseInput,
  InteractionDto,
  InteractionResponseInput,
  LiveActivityPushToStartTokenInput,
  LiveActivityUpdateTokenInput,
} from "@hark/contracts";
import { API_URL, getCookie } from "./auth";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Machine-readable `code` from the error body, when the server sends one. */
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const cookie = getCookie();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string; code?: string })
    | null;
  if (!response.ok || body === null) {
    throw new ApiError(
      body?.error ?? `Request failed (${response.status})`,
      response.status,
      typeof body?.code === "string" ? body.code : undefined,
    );
  }
  return body;
}

export const api = {
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
  respondToInteraction: (id: string, input: InteractionResponseInput) =>
    request<{ interaction: InteractionDto }>(`/api/interactions/${id}/respond`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  respondToInteractionWithToken: (id: string, input: InteractionCredentialResponseInput) =>
    request<{ ok: true; status: string }>(`/api/interaction-responses/${id}/respond`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
