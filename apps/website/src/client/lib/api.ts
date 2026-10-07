import type {
  ApiError,
  ApiTokenCreatedResponse,
  ApiTokenCreateInput,
  ApiTokenDto,
  AppDto,
  AppSharingInput,
  BillingDto,
  BillingRedirectResponse,
  DeviceAuthorizationRequestDto,
  DeviceDto,
  EventDto,
  LiveActivityDto,
  PricingPlansDto,
  ServiceCreatedResponse,
  ServiceCreateInput,
  ServiceDto,
  ServiceUpdateInput,
} from "@hark/contracts";

export class ApiRequestError extends Error {
  status: number;
  issues?: unknown;

  constructor(status: number, body: ApiError) {
    super(body.error);
    this.status = status;
    this.issues = body.issues;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...init?.headers },
    ...init,
  });
  const body = (await response.json().catch(() => ({ error: "Request failed" }))) as T & ApiError;
  if (!response.ok) {
    throw new ApiRequestError(response.status, body);
  }
  return body;
}

export const api = {
  listApiTokens: () => request<{ tokens: ApiTokenDto[] }>("/api/api-tokens"),
  getDeviceAuthorization: (code: string) =>
    request<{ request: DeviceAuthorizationRequestDto }>(
      `/api/device-authorization/requests/${encodeURIComponent(code)}`,
    ),
  approveDeviceAuthorization: (code: string) =>
    request<{ request: DeviceAuthorizationRequestDto }>(
      `/api/device-authorization/requests/${encodeURIComponent(code)}/approve`,
      { method: "POST" },
    ),
  denyDeviceAuthorization: (code: string) =>
    request<{ request: DeviceAuthorizationRequestDto }>(
      `/api/device-authorization/requests/${encodeURIComponent(code)}/deny`,
      { method: "POST" },
    ),
  createApiToken: (input: ApiTokenCreateInput) =>
    request<ApiTokenCreatedResponse>("/api/api-tokens", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  revokeApiToken: (id: string) =>
    request<{ ok: true }>(`/api/api-tokens/${id}`, { method: "DELETE" }),
  listServices: () => request<{ services: ServiceDto[] }>("/api/services"),
  createService: (input: ServiceCreateInput) =>
    request<ServiceCreatedResponse>("/api/services", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  rotateServiceToken: (id: string) =>
    request<ServiceCreatedResponse>(`/api/services/${id}/rotate`, { method: "POST" }),
  updateService: (id: string, input: ServiceUpdateInput) =>
    request<{ service: ServiceDto }>(`/api/services/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteService: (id: string) => request<{ ok: true }>(`/api/services/${id}`, { method: "DELETE" }),
  listDevices: () => request<{ devices: DeviceDto[] }>("/api/devices"),
  removeDevice: (id: string) => request<{ ok: true }>(`/api/devices/${id}`, { method: "DELETE" }),
  getBilling: () => request<BillingDto>("/api/billing"),
  getPricingPlans: () => request<PricingPlansDto>("/api/billing/plans"),
  startCheckout: () =>
    request<BillingRedirectResponse>("/api/billing/checkout", { method: "POST" }),
  openBillingPortal: () =>
    request<BillingRedirectResponse>("/api/billing/portal", { method: "POST" }),
  listEvents: (limit = 50) => request<{ events: EventDto[] }>(`/api/events?limit=${limit}`),
  listLiveActivities: () => request<{ activities: LiveActivityDto[] }>("/api/activities"),
  listApps: () => request<{ apps: AppDto[] }>("/api/apps"),
  updateAppSharing: (id: string, input: AppSharingInput) =>
    request<{ app: AppDto }>(`/api/apps/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  revokeApp: (id: string) => request<{ app: AppDto }>(`/api/apps/${id}/revoke`, { method: "POST" }),
  deleteApp: (id: string) => request<{ ok: true }>(`/api/apps/${id}`, { method: "DELETE" }),
};
