import { z } from "zod";

/** Version of the push `data` payload schema understood by the iOS extension. */
export const PUSH_SCHEMA_VERSION = 1 as const;

import { isPublicHttpsUrl, publicHttpsUrlSchema } from "./url";

export { isPublicHttpsUrl };

/**
 * Tap destinations are handed to the iOS app and opened with `Linking.openURL`,
 * so only web schemes are accepted: `javascript:`, `data:`, `file:` and custom
 * app schemes must never reach a device.
 */
const webUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "https:" || protocol === "http:";
    } catch {
      return false;
    }
  }, "Must be an http or https URL");

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Web app launch URLs are loaded only by the owner's own in-app web view and
 * are never fetched by the server, so private and tailnet hosts are allowed.
 * HTTPS is required because the signed sign-in pass is bound to the origin;
 * plain HTTP is accepted only for loopback development servers.
 */
export const appUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      if (url.username || url.password) return false;
      if (url.protocol === "https:") return true;
      return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
    } catch {
      return false;
    }
  }, "Must be an HTTPS URL (HTTP is allowed only for localhost)");

/** Canonical origin used as the sign-in pass audience, e.g. `https://app.example.com`. */
export function appOrigin(url: string): string {
  return new URL(url).origin;
}

export const appIdSchema = z
  .string()
  .trim()
  .regex(/^app_[A-Za-z0-9_-]{8,64}$/, "Must be a SHark app ID (app_…)");

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export const serviceCreateSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(80),
  imageUrl: publicHttpsUrlSchema.nullish(),
  url: webUrlSchema.nullish(),
});
export type ServiceCreateInput = z.infer<typeof serviceCreateSchema>;

export const serviceUpdateSchema = serviceCreateSchema
  .partial()
  .refine((input) => Object.keys(input).length > 0, "At least one field is required");
export type ServiceUpdateInput = z.infer<typeof serviceUpdateSchema>;

export interface ServiceDto {
  id: string;
  title: string;
  imageUrl: string | null;
  url: string | null;
  /** Available for tokens generated after encrypted token storage was enabled. */
  webhookUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Returned when a service is created or its token is rotated. */
export interface ServiceCreatedResponse {
  service: ServiceDto;
  /** Full webhook URL containing the plaintext token. */
  webhookUrl: string;
}

// ---------------------------------------------------------------------------
// Webhook ingestion
// ---------------------------------------------------------------------------

const webhookCallbackSchema = z.object({
  url: publicHttpsUrlSchema,
  token: z.string().min(16).max(512),
});

const webhookResponseRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("approval"),
    expiresInSeconds: z.number().int().min(30).max(86_400).default(900),
    correlationId: z.string().trim().min(1).max(100).optional(),
    callback: webhookCallbackSchema.optional(),
  }),
  z.object({
    type: z.literal("yes_no"),
    expiresInSeconds: z.number().int().min(30).max(86_400).default(900),
    correlationId: z.string().trim().min(1).max(100).optional(),
    callback: webhookCallbackSchema.optional(),
  }),
  z.object({
    type: z.literal("text"),
    expiresInSeconds: z.number().int().min(30).max(86_400).default(900),
    correlationId: z.string().trim().min(1).max(100).optional(),
    callback: webhookCallbackSchema.optional(),
  }),
]);

export const webhookRequestSchema = z.object({
  body: z.string().trim().min(1, "body is required").max(2000),
  title: z.string().trim().min(1).max(80).optional(),
  imageUrl: publicHttpsUrlSchema.optional(),
  url: webUrlSchema.optional(),
  deviceIds: z
    .array(z.string().trim().min(1).max(100))
    .min(1)
    .max(50)
    .transform((ids) => [...new Set(ids)].sort())
    .optional(),
  response: webhookResponseRequestSchema.optional(),
  /** Opens this SHark web app on tap; `url`, when present, must share its origin. */
  appId: appIdSchema.optional(),
});
export type WebhookRequest = z.infer<typeof webhookRequestSchema>;

export type WebhookResponse =
  | {
      ok: true;
      eventId: string;
      delivered: number;
      response?: { status: "pending"; expiresAt: string };
      idempotent?: boolean;
      message?: string;
    }
  | { ok: false; error: string; issues?: unknown; retryAfterSeconds?: number };

export type WithdrawEventStatus = "withdrawn" | "withdraw_partial";

export type WithdrawEventResponse =
  | {
      ok: true;
      eventId: string;
      status: WithdrawEventStatus;
      accepted: number;
      idempotent?: boolean;
    }
  | { ok: false; error: string };

export interface EventDto {
  id: string;
  serviceId: string;
  serviceTitle: string;
  title: string;
  body: string;
  imageUrl: string | null;
  url: string | null;
  status: string;
  deliveredCount: number;
  error: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Durable inbox
// ---------------------------------------------------------------------------

export const INBOX_FILTERS = ["all", "needs_action", "active", "failed", "notifications"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export type InboxItemKind = "notification" | "interaction" | "live_activity";

export interface InboxActionDto {
  interactionId: string;
  kind: InteractionKind;
  choices: string[];
  actionDigest: string;
  primaryLabel: string | null;
  secondaryLabel: string | null;
  expiresAt: string;
}

export interface InboxItemDto {
  id: string;
  kind: InboxItemKind;
  sourceName: string;
  sourceImageUrl: string | null;
  title: string;
  body: string;
  imageUrl: string | null;
  url: string | null;
  status: string;
  result: string | null;
  accepted: number;
  failed: number;
  needsAction: boolean;
  readAt: string | null;
  occurredAt: string;
  updatedAt: string;
  action: InboxActionDto | null;
  /** Web app opened by this notification; older servers omit it. */
  app?: AppSummaryDto | null;
}

/** A partial notification is terminal fanout; only Live Activities can remain active when partial. */
export function isInboxItemActive(item: Pick<InboxItemDto, "kind" | "status">): boolean {
  return item.kind === "live_activity" && ["starting", "active", "partial"].includes(item.status);
}

export function isInboxItemDeliveryFailure(item: Pick<InboxItemDto, "kind" | "status">): boolean {
  return (
    ["failed", "no_devices"].includes(item.status) ||
    (item.kind === "notification" && item.status === "partial")
  );
}

/** Withdrawn and partially withdrawn notifications are terminal history, not an active lifecycle. */
export function isInboxItemWithdrawn(item: Pick<InboxItemDto, "status">): boolean {
  return item.status === "withdrawn" || item.status === "withdraw_partial";
}

export interface InboxItemEventDto {
  id: string;
  kind: string;
  detail: string | null;
  result: string | null;
  accepted: number;
  failed: number;
  occurredAt: string;
}

export interface InboxPageDto {
  items: InboxItemDto[];
  nextCursor: string | null;
  unresolvedCount: number;
}

export interface InboxDetailDto {
  item: InboxItemDto;
  events: InboxItemEventDto[];
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export const deviceRegisterSchema = z.object({
  expoPushToken: z.string().min(1).max(400),
  apnsToken: z.string().min(1).max(400).optional(),
  platform: z.literal("ios"),
  deviceName: z.string().trim().max(80).optional(),
  interactionSchemaVersion: z.literal(1).optional(),
  liveActivityInteractionVersion: z.literal(1).optional(),
});
export type DeviceRegisterInput = z.infer<typeof deviceRegisterSchema>;

export const deviceUnregisterSchema = z.object({
  expoPushToken: z.string().min(1).max(400),
});
export type DeviceUnregisterInput = z.infer<typeof deviceUnregisterSchema>;

export const appleNativeTokenExchangeSchema = z.object({
  authorizationCode: z.string().min(1).max(4096),
  identityToken: z.string().min(1).max(8192),
});
export type AppleNativeTokenExchangeInput = z.infer<typeof appleNativeTokenExchangeSchema>;

export interface DeviceDto {
  id: string;
  platform: "ios" | "web" | "macos";
  deviceName: string | null;
  active: boolean;
  liveActivitiesCapable: boolean;
  liveActivityTokenEnvironment: "sandbox" | "production" | null;
  liveActivityTokenUpdatedAt: string | null;
  interactiveLiveActivitiesCapable: boolean;
  createdAt: string;
  lastSeenAt: string;
}

export const macosDeviceRegisterSchema = z.object({
  apnsToken: z
    .string()
    .trim()
    .min(2)
    .max(400)
    .regex(/^[a-f0-9]+$/i, "APNs token must be hexadecimal")
    .refine((token) => token.length % 2 === 0, "APNs token must contain whole bytes")
    .transform((token) => token.toLowerCase()),
  environment: z.enum(["sandbox", "production"]),
  deviceName: z.string().trim().min(1).max(80).optional(),
  privacyMode: z.enum(["standard", "private"]).default("standard"),
});
export type MacosDeviceRegisterInput = z.infer<typeof macosDeviceRegisterSchema>;

export const webPushSubscriptionSchema = z.object({
  endpoint: z
    .url()
    .max(2048)
    .refine((value) => new URL(value).protocol === "https:", "Push endpoint must use HTTPS"),
  expirationTime: z.number().int().nonnegative().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});
export type WebPushSubscriptionInput = z.infer<typeof webPushSubscriptionSchema>;

export const webPushSubscriptionRegisterSchema = z.object({
  subscription: webPushSubscriptionSchema,
  deviceName: z.string().trim().min(1).max(80).optional(),
});
export type WebPushSubscriptionRegisterInput = z.infer<typeof webPushSubscriptionRegisterSchema>;

export const webPushSubscriptionEndpointSchema = z.object({
  endpoint: z
    .url()
    .max(2048)
    .refine((value) => new URL(value).protocol === "https:", "Push endpoint must use HTTPS"),
});
export type WebPushSubscriptionEndpointInput = z.infer<typeof webPushSubscriptionEndpointSchema>;

export interface WebPushSubscriptionDto {
  id: string;
  deviceName: string | null;
  active: boolean;
  createdAt: string;
  lastSeenAt: string;
}

// ---------------------------------------------------------------------------
// Live Activities
// ---------------------------------------------------------------------------

export const LIVE_ACTIVITY_SCHEMA_VERSION = 1 as const;
export const LIVE_ACTIVITY_NAME = "HarkAgentActivity" as const;
export const LIVE_ACTIVITY_SYMBOLS = ["terminal", "code", "build", "success", "warning"] as const;
export const liveActivitySymbolSchema = z.enum(LIVE_ACTIVITY_SYMBOLS);
export type LiveActivitySymbol = z.infer<typeof liveActivitySymbolSchema>;
export const LIVE_ACTIVITY_PRIVACY_MODES = ["standard", "private"] as const;
export const liveActivityPrivacyModeSchema = z.enum(LIVE_ACTIVITY_PRIVACY_MODES);
export type LiveActivityPrivacyMode = z.infer<typeof liveActivityPrivacyModeSchema>;
/**
 * Widget layout variants. `style` stays optional in the props payload so
 * payloads written before the field existed keep validating, and app builds
 * that predate a value render their standard layout.
 */
export const LIVE_ACTIVITY_STYLES = [
  "standard",
  "ring",
  "hero",
  "terminal",
  "steps",
  "approval",
] as const;
export const liveActivityStyleSchema = z.enum(LIVE_ACTIVITY_STYLES);
export type LiveActivityStyle = z.infer<typeof liveActivityStyleSchema>;
export const LIVE_ACTIVITY_DEFAULT_ACCENT_COLOR = "#D35C46" as const;
export const LIVE_ACTIVITY_DEFAULT_EXPIRES_IN_SECONDS = 28_800 as const;
export const LIVE_ACTIVITY_DEFAULT_STALE_AFTER_SECONDS = 14_400 as const;
export const liveActivityAccentColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Accent color must use #RRGGBB format");

export const liveActivityInteractionSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    kind: z.enum(["approval", "yes_no"]),
    prompt: z.string().trim().min(1).max(2000),
    primaryLabel: z.string().trim().min(1).max(24),
    secondaryLabel: z.string().trim().min(1).max(24),
    primaryAction: z.enum(["approve", "yes"]),
    secondaryAction: z.enum(["deny", "no"]),
    state: z.enum(["pending", "approved", "denied", "yes", "no", "expired", "canceled"]),
  })
  .superRefine((value, context) => {
    const valid =
      (value.kind === "approval" &&
        value.primaryAction === "approve" &&
        value.secondaryAction === "deny") ||
      (value.kind === "yes_no" && value.primaryAction === "yes" && value.secondaryAction === "no");
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["primaryAction"],
        message: "Interaction actions must match the interaction kind",
      });
    }
  });
export type LiveActivityInteraction = z.infer<typeof liveActivityInteractionSchema>;

export const liveActivityPropsSchema = z
  .object({
    schemaVersion: z.literal(LIVE_ACTIVITY_SCHEMA_VERSION),
    activityId: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(80),
    status: z.string().trim().min(1).max(60),
    detail: z.string().trim().min(1).max(240).optional(),
    progress: z.number().min(0).max(1).optional(),
    updatedAt: z.iso.datetime(),
    symbol: liveActivitySymbolSchema,
    privacyMode: liveActivityPrivacyModeSchema,
    accentColor: liveActivityAccentColorSchema.optional(),
    style: liveActivityStyleSchema.optional(),
    interaction: liveActivityInteractionSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.style === "approval" && !value.interaction) {
      context.addIssue({
        code: "custom",
        path: ["interaction"],
        message: "Approval Live Activities require an interaction",
      });
    }
  });
export type LiveActivityProps = z.infer<typeof liveActivityPropsSchema>;

const deviceIdsSchema = z
  .array(z.string().trim().min(1).max(100))
  .min(1)
  .max(50)
  .transform((ids) => [...new Set(ids)].sort())
  .optional();

export const liveActivityStartSchema = z
  .object({
    key: z.string().trim().min(1).max(100).optional(),
    /** End any Live Activity currently occupying a target device before starting. */
    replace: z.boolean().default(false),
    title: z.string().trim().min(1, "Title is required").max(80),
    status: z.string().trim().min(1, "Status is required").max(60),
    detail: z.string().trim().min(1).max(240).optional(),
    progress: z.number().min(0).max(1).optional(),
    symbol: liveActivitySymbolSchema.default("terminal"),
    privacyMode: liveActivityPrivacyModeSchema.default("standard"),
    accentColor: liveActivityAccentColorSchema.default(LIVE_ACTIVITY_DEFAULT_ACCENT_COLOR),
    style: liveActivityStyleSchema.default("standard"),
    deviceIds: deviceIdsSchema,
    expiresInSeconds: z
      .number()
      .int()
      .min(60)
      .max(28_800)
      .default(LIVE_ACTIVITY_DEFAULT_EXPIRES_IN_SECONDS),
    staleAfterSeconds: z
      .number()
      .int()
      .min(0)
      .max(28_800)
      .default(LIVE_ACTIVITY_DEFAULT_STALE_AFTER_SECONDS),
  })
  .superRefine((value, context) => {
    if (value.style === "approval") {
      context.addIssue({
        code: "custom",
        path: ["style"],
        message: "Use an interaction with live_activity presentation for approval Live Activities",
      });
    }
  });
export type LiveActivityStartInput = z.infer<typeof liveActivityStartSchema>;

const liveActivityUpdateObject = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  status: z.string().trim().min(1).max(60).optional(),
  detail: z.string().trim().min(1).max(240).nullable().optional(),
  progress: z.number().min(0).max(1).nullable().optional(),
  symbol: liveActivitySymbolSchema.optional(),
  privacyMode: liveActivityPrivacyModeSchema.optional(),
  accentColor: liveActivityAccentColorSchema.optional(),
  style: liveActivityStyleSchema.optional(),
  staleAfterSeconds: z.number().int().min(0).max(28_800).optional(),
  ifSequence: z.number().int().nonnegative().optional(),
});

export const LIVE_ACTIVITY_UPDATE_FIELDS = Object.keys(liveActivityUpdateObject.shape);

export const liveActivityUpdateSchema = liveActivityUpdateObject
  .refine(
    (input) => Object.keys(input).some((key) => key !== "ifSequence"),
    "At least one of title, status, detail, progress, symbol, privacyMode, accentColor, style, or staleAfterSeconds is required",
  )
  .superRefine((value, context) => {
    if (value.style === "approval") {
      context.addIssue({
        code: "custom",
        path: ["style"],
        message: "Approval style is managed by interactive Live Activity requests",
      });
    }
  });
export type LiveActivityUpdateInput = z.infer<typeof liveActivityUpdateSchema>;

const liveActivityEndObject = z.object({
  status: z.string().trim().min(1).max(60).default("Complete"),
  detail: z.string().trim().min(1).max(240).nullable().optional(),
  progress: z.number().min(0).max(1).nullable().optional(),
  symbol: liveActivitySymbolSchema.default("success"),
  accentColor: liveActivityAccentColorSchema.optional(),
  dismissAfterSeconds: z.number().int().min(0).max(14_400).default(0),
  ifSequence: z.number().int().nonnegative().optional(),
});

export const LIVE_ACTIVITY_END_FIELDS = Object.keys(liveActivityEndObject.shape);
export const liveActivityEndSchema = liveActivityEndObject;
export type LiveActivityEndInput = z.infer<typeof liveActivityEndSchema>;

type LiveActivityIssue = { path?: ReadonlyArray<PropertyKey>; message?: string };

/** Names rejected fields, including unrecognized keys Zod would otherwise strip. */
export function liveActivityRequestDiagnostic(
  issues: readonly LiveActivityIssue[],
  value: unknown,
  allowedFields: readonly string[],
): string {
  const allowed = new Set(allowedFields);
  const unrecognized =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value)
          .filter((key) => !allowed.has(key))
          .slice(0, 20)
      : [];
  const parts = issues.slice(0, 20).map((issue) => {
    const field = (issue.path ?? [])
      .map(String)
      .filter((part) => part.length > 0)
      .join(".");
    const message = issue.message ?? "rejected";
    return field ? `rejected field ${field}: ${message}` : `rejected request: ${message}`;
  });
  for (const key of unrecognized) parts.push(`rejected field ${key}: unrecognized`);
  const diagnostic = parts.join("; ");
  return diagnostic.length > 500 ? `${diagnostic.slice(0, 497)}...` : diagnostic;
}

/** Names the lifecycle state that rejected an update or end. */
export function liveActivityStateDiagnostic(status: string): string {
  return `rejected state: ${status}`;
}

export const apnsEnvironmentSchema = z.enum(["sandbox", "production"]);
export type ApnsEnvironment = z.infer<typeof apnsEnvironmentSchema>;

export const liveActivityPushToStartTokenSchema = z.object({
  deviceId: z.string().trim().min(1).max(100),
  pushToStartToken: z.string().regex(/^[a-fA-F0-9]{32,512}$/),
  environment: apnsEnvironmentSchema,
  schemaVersion: z.literal(LIVE_ACTIVITY_SCHEMA_VERSION),
});
export type LiveActivityPushToStartTokenInput = z.infer<typeof liveActivityPushToStartTokenSchema>;

export const liveActivityUpdateTokenSchema = z.object({
  deviceId: z.string().trim().min(1).max(100),
  updateToken: z.string().regex(/^[a-fA-F0-9]{32,512}$/),
  nativeActivityId: z.string().trim().min(1).max(200).optional(),
  activityId: z.string().trim().min(1).max(100).optional(),
  environment: apnsEnvironmentSchema,
  schemaVersion: z.literal(LIVE_ACTIVITY_SCHEMA_VERSION),
});
export type LiveActivityUpdateTokenInput = z.infer<typeof liveActivityUpdateTokenSchema>;

export const liveActivityBackgroundTokenSchema = z.object({
  deliveryId: z.string().trim().min(1).max(100),
  registrationToken: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
  nativeActivityId: z.string().trim().min(1).max(200),
  updateToken: z.string().regex(/^[a-fA-F0-9]{32,512}$/),
});
export type LiveActivityBackgroundTokenInput = z.infer<typeof liveActivityBackgroundTokenSchema>;

export const LIVE_ACTIVITY_STATUSES = [
  "starting",
  "active",
  "partial",
  "failed",
  "ended",
  "expired",
] as const;
export type LiveActivityStatus = (typeof LIVE_ACTIVITY_STATUSES)[number];

export interface LiveActivityDto {
  id: string;
  key: string | null;
  props: LiveActivityProps;
  status: LiveActivityStatus;
  sequence: number;
  accepted: number;
  failed: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface LiveActivityMutationResponse {
  activity: LiveActivityDto;
  accepted: number;
  failed: number;
  /** Distinct blocking activities ended because the start requested `replace`. */
  replaced?: number;
  idempotent?: boolean;
  message?: string;
  /**
   * The update or end was stored, and every delivery is waiting for the device
   * to register its per-activity update token. `accepted` stays 0 until APNs
   * takes the push. A stored end is replayed when that token arrives.
   */
  updateTokenPending?: boolean;
}

export type LiveActivityWebhookResponse =
  | {
      ok: true;
      activityId: string;
      sequence: number;
      status: LiveActivityStatus;
      accepted: number;
      failed: number;
      state: LiveActivityProps;
      expiresAt: string;
      staleAt: string | null;
      endedAt: string | null;
      /** Distinct blocking activities ended because the start requested `replace`. */
      replaced?: number;
      idempotent?: boolean;
      message?: string;
      /**
       * The update or end was stored, and every delivery is waiting for the device
       * to register its per-activity update token. `accepted` stays 0 until APNs
       * takes the push. A stored end is replayed when that token arrives.
       */
      updateTokenPending?: boolean;
    }
  | {
      ok: false;
      error: string;
      code?: "ACTIVE_ACTIVITY_CONFLICT";
      activityId?: string;
      /** Lifecycle status when an update or end finds the activity already terminal. */
      status?: LiveActivityStatus;
      endedAt?: string | null;
      expiresAt?: string;
      issues?: unknown;
      /** Field or lifecycle state that caused the rejection. */
      diagnostic?: string;
      retryAfterSeconds?: number;
    };

// ---------------------------------------------------------------------------
// Agent access and interactions
// ---------------------------------------------------------------------------

export const API_TOKEN_SCOPES = [
  "notifications:send",
  "interactions:create",
  "interactions:read",
  "activities:read",
  "activities:write",
  "services:read",
  "services:write",
  "devices:read",
  "events:read",
  "watch:read",
  "watch:respond",
  "macos:read",
  "macos:respond",
  "macos:register",
  "apps:read",
  "apps:write",
  "board:read",
  "board:write",
] as const;
export const apiTokenScopeSchema = z.enum(API_TOKEN_SCOPES);
export type ApiTokenScope = z.infer<typeof apiTokenScopeSchema>;

export const apiTokenCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  scopes: z.array(apiTokenScopeSchema).min(1).max(API_TOKEN_SCOPES.length),
  expiresAt: z.iso.datetime().nullable().optional(),
});
export type ApiTokenCreateInput = z.infer<typeof apiTokenCreateSchema>;

export interface ApiTokenDto {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface ApiTokenCreatedResponse {
  token: ApiTokenDto;
  /** Plaintext secret. It is returned once and is never persisted by SHark. */
  secret: string;
}

export const deviceAuthorizationStartSchema = z.object({
  clientName: z.string().trim().min(1, "Client name is required").max(80),
  scopes: z
    .array(apiTokenScopeSchema)
    .min(1)
    .max(API_TOKEN_SCOPES.length)
    .transform((scopes) => [...new Set(scopes)].sort()),
  expiresInSeconds: z.number().int().min(3600).max(31_536_000).default(7_776_000),
});
export type DeviceAuthorizationStartInput = z.infer<typeof deviceAuthorizationStartSchema>;

export interface DeviceAuthorizationStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceAuthorizationRequestDto {
  clientName: string;
  scopes: ApiTokenScope[];
  status: "pending" | "approved" | "denied" | "expired" | "consumed";
  userCode: string;
  expiresAt: string;
  tokenExpiresAt: string;
}

export interface DeviceAuthorizationTokenResponse {
  accessToken: string;
  token: ApiTokenDto;
}

export const INTERACTION_KINDS = ["approval", "yes_no", "reply"] as const;
export const interactionKindSchema = z.enum(INTERACTION_KINDS);
export type InteractionKind = z.infer<typeof interactionKindSchema>;

export const INTERACTION_STATUSES = [
  "pending",
  "approved",
  "denied",
  "yes",
  "no",
  "replied",
  "canceled",
  "expired",
] as const;
export const interactionStatusSchema = z.enum(INTERACTION_STATUSES);
export type InteractionStatus = z.infer<typeof interactionStatusSchema>;
export const INTERACTION_PRESENTATIONS = ["notification", "live_activity"] as const;
export const interactionPresentationSchema = z.enum(INTERACTION_PRESENTATIONS);
export type InteractionPresentation = z.infer<typeof interactionPresentationSchema>;

export const HARK_APPROVAL_CATEGORY_ID = "HARK_APPROVAL_V1" as const;
export const HARK_REPLY_CATEGORY_ID = "HARK_REPLY_V1" as const;
export const HARK_YES_NO_CATEGORY_ID = "HARK_YES_NO_V1" as const;
export const HARK_APPROVE_ACTION_ID = "HARK_APPROVE" as const;
export const HARK_DENY_ACTION_ID = "HARK_DENY" as const;
export const HARK_REPLY_ACTION_ID = "HARK_REPLY" as const;
export const HARK_YES_ACTION_ID = "HARK_YES" as const;
export const HARK_NO_ACTION_ID = "HARK_NO" as const;

const interactionActionLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .refine(
    (value) =>
      Array.from(value).every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      }),
    "Action labels must be a single line",
  );

export const interactionCreateSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(80),
    prompt: z.string().trim().min(1, "Prompt is required").max(2000),
    kind: interactionKindSchema,
    imageUrl: publicHttpsUrlSchema.optional(),
    url: webUrlSchema.optional(),
    deviceIds: z
      .array(z.string().trim().min(1).max(100))
      .min(1)
      .max(50)
      .transform((ids) => [...new Set(ids)].sort())
      .optional(),
    expiresInSeconds: z.number().int().min(30).max(86_400).default(900),
    presentation: interactionPresentationSchema.optional(),
    primaryLabel: interactionActionLabelSchema.optional(),
    secondaryLabel: interactionActionLabelSchema.optional(),
  })
  .superRefine((value, context) => {
    const presentation = value.presentation ?? "notification";
    if (presentation === "live_activity" && value.kind === "reply") {
      context.addIssue({
        code: "custom",
        path: ["kind"],
        message: "Live Activity interactions support approval or yes_no responses",
      });
    }
    if (presentation === "live_activity" && value.expiresInSeconds > 28_800) {
      context.addIssue({
        code: "custom",
        path: ["expiresInSeconds"],
        message: "Live Activity interactions expire within 8 hours",
      });
    }
    if (presentation === "live_activity" && value.prompt.length > 240) {
      context.addIssue({
        code: "custom",
        path: ["prompt"],
        message: "Live Activity interaction prompts are limited to 240 characters",
      });
    }
    if (
      presentation === "live_activity" &&
      (value.imageUrl !== undefined || value.url !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: [value.imageUrl !== undefined ? "imageUrl" : "url"],
        message: "Live Activity interactions do not support imageUrl or url",
      });
    }
    if (
      presentation !== "live_activity" &&
      (value.primaryLabel !== undefined || value.secondaryLabel !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["presentation"],
        message: "Custom action labels require live_activity presentation",
      });
    }
  });
export type InteractionCreateInput = z.infer<typeof interactionCreateSchema>;

export const interactionResponseSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["approve", "deny"]),
    deviceId: z.string().trim().min(1).max(100),
    actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({
    action: z.enum(["yes", "no"]),
    deviceId: z.string().trim().min(1).max(100),
    actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({
    action: z.literal("reply"),
    response: z.string().trim().min(1, "Reply is required").max(4000),
    deviceId: z.string().trim().min(1).max(100),
    actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);
export type InteractionResponseInput = z.infer<typeof interactionResponseSchema>;

export const macosInteractionResponseSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["approve", "deny", "yes", "no"]),
    actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({
    action: z.literal("reply"),
    response: z.string().trim().min(1, "Reply is required").max(4000),
    actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);
export type MacosInteractionResponseInput = z.infer<typeof macosInteractionResponseSchema>;

/**
 * The deliberately small view consumed by the native watchOS companion. It is
 * a server-authored snapshot, not an offline inbox protocol.
 */
export interface WatchWorkItemDto {
  id: string;
  title: string;
  status: string;
  detail: string | null;
  progress: number | null;
  updatedAt: string;
  private: boolean;
}

export interface WatchInteractionDto {
  id: string;
  title: string;
  prompt: string;
  kind: "approval" | "yes_no";
  actionDigest: string;
  expiresAt: string;
  primaryLabel: string | null;
  secondaryLabel: string | null;
}

export interface WatchSnapshotDto {
  generatedAt: string;
  activeWork: WatchWorkItemDto | null;
  pendingInteraction: WatchInteractionDto | null;
}

export const watchInteractionResponseSchema = z.object({
  action: z.enum(["approve", "deny", "yes", "no"]),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type WatchInteractionResponseInput = z.infer<typeof watchInteractionResponseSchema>;

export const interactionCredentialResponseSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["approve", "deny", "yes", "no"]),
    deviceId: z.string().trim().min(1).max(100),
    responseToken: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
  }),
  z.object({
    action: z.literal("reply"),
    response: z.string().trim().min(1).max(4000),
    deviceId: z.string().trim().min(1).max(100),
    responseToken: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
  }),
]);
export type InteractionCredentialResponseInput = z.infer<
  typeof interactionCredentialResponseSchema
>;

export const liveActivityInteractionResponseSchema = z.object({
  action: z.enum(["approve", "deny", "yes", "no"]),
  deviceId: z.string().trim().min(1).max(100),
  deliveryId: z.string().trim().min(1).max(100),
  credential: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
});
export type LiveActivityInteractionResponseInput = z.infer<
  typeof liveActivityInteractionResponseSchema
>;

export interface InteractionDto {
  id: string;
  title: string;
  prompt: string;
  kind: InteractionKind;
  presentation: InteractionPresentation;
  status: InteractionStatus;
  choices: string[];
  response: string | null;
  imageUrl: string | null;
  url: string | null;
  actionDigest: string;
  primaryLabel: string | null;
  secondaryLabel: string | null;
  accepted: number;
  respondingDeviceId: string | null;
  expiresAt: string;
  createdAt: string;
  respondedAt: string | null;
  canceledAt: string | null;
}

export interface InteractionCreateResponse {
  interaction: InteractionDto;
  /** Requests accepted by Expo or APNs, depending on presentation; not proof of device display. */
  accepted: number;
  idempotent?: boolean;
  liveActivityId?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Agent notifications (one-shot pushes sent with an API token)
// ---------------------------------------------------------------------------

export const agentNotificationCreateSchema = z.object({
  body: z.string().trim().min(1, "body is required").max(2000),
  title: z.string().trim().min(1).max(80).default("SHark"),
  imageUrl: publicHttpsUrlSchema.optional(),
  url: webUrlSchema.optional(),
  deviceIds: z
    .array(z.string().trim().min(1).max(100))
    .min(1)
    .max(50)
    .transform((ids) => [...new Set(ids)].sort())
    .optional(),
  /** Opens this SHark web app on tap; `url`, when present, must share its origin. */
  appId: appIdSchema.optional(),
});
export type AgentNotificationCreateInput = z.infer<typeof agentNotificationCreateSchema>;

export interface AgentNotificationDto {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  url: string | null;
  createdAt: string;
  appId?: string | null;
}

export interface AgentNotificationCreateResponse {
  notification: AgentNotificationDto;
  /** Number of notification requests accepted by Expo, not proof of device delivery. */
  accepted: number;
  idempotent?: boolean;
  message?: string;
}

// ---------------------------------------------------------------------------
// Web apps (full-screen web views signed in with a SHark pass)
// ---------------------------------------------------------------------------

export const APP_NAME_MAX_CHARS = 40 as const;
export const MAX_APPS_PER_ACCOUNT = 100 as const;
/** Lifetime of a signed pass. Apps exchange it for their own session. */
export const APP_PASS_TTL_SECONDS = 120 as const;
/** JWT `typ` header of a pass, so it cannot be confused with other JWTs. Protocol identifier. */
export const APP_PASS_JWT_TYPE = "hark-pass+jwt" as const;
export const APP_PASS_ALGORITHM = "ES256" as const;
/** JWKS path served from the SHark origin (the pass `iss`). */
export const APP_PASS_JWKS_PATH = "/.well-known/jwks.json" as const;

export const appNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(APP_NAME_MAX_CHARS)
  .refine(
    (value) =>
      Array.from(value).every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      }),
    "App names must be a single line",
  );

export const appCreateSchema = z.object({
  name: appNameSchema,
  url: appUrlSchema,
  iconUrl: publicHttpsUrlSchema.optional(),
});
export type AppCreateInput = z.infer<typeof appCreateSchema>;

/** Owner-controlled sharing preferences; the pairwise SHark ID is always shared. */
export const appSharingSchema = z.object({
  shareName: z.boolean().optional(),
  shareEmail: z.boolean().optional(),
});
export type AppSharingInput = z.infer<typeof appSharingSchema>;

export const appLaunchSchema = appSharingSchema.extend({
  /** Required (true) before the first pass is issued, and again after revoke. */
  consent: z.boolean().optional(),
});
export type AppLaunchInput = z.infer<typeof appLaunchSchema>;

export interface AppSummaryDto {
  id: string;
  name: string;
  origin: string;
  iconUrl: string | null;
}

export interface AppDto extends AppSummaryDto {
  /** Launch URL opened in the SHark web view. */
  url: string;
  shareName: boolean;
  shareEmail: boolean;
  /** `null` until the owner approves sign-in; passes are refused until then. */
  consentedAt: string | null;
  lastOpenedAt: string | null;
  /** Name of the agent token that registered the app, when known. */
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppCreateResponse {
  app: AppDto;
  /** `false` when an app with the same URL already existed and was updated. */
  created: boolean;
}

export interface AppPassResponse {
  /** Compact ES256 JWT. Verify it with the SHark JWKS; never trust it unverified. */
  token: string;
  expiresAt: string;
  app: AppDto;
}

/** Claims of a pass, as verified by a web app's server. */
export interface AppPassClaims {
  iss: string;
  /** The app origin, e.g. `https://app.example.com`. */
  aud: string;
  /** Pairwise user ID: stable for this origin and different for every other app. */
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  app_id: string;
  name?: string;
  email?: string;
}

/** `code` returned when a pass needs owner consent first. */
export const API_ERROR_CODE_CONSENT_REQUIRED = "consent_required" as const;

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export interface BillingDto {
  configured: boolean;
  plan: "free" | "pro";
  priceMonthly: number;
  features: {
    deviceRouting: boolean;
  };
  limits: {
    devices: number | null;
    notificationsPerMonth: number;
    servicePerMinute: number;
    accountPerMinute: number;
  };
  usage: {
    notificationsRemaining: number | null;
  };
}

export interface BillingRedirectResponse {
  url: string;
}

/** One purchasable plan, as shown on the public pricing page. */
export interface PricingPlanDto {
  id: string;
  name: string;
  description: string | null;
  /** USD per month; 0 for the free plan. */
  priceMonthly: number;
  /** null means unlimited. */
  notificationsPerMonth: number | null;
  /** null means unlimited. */
  devices: number | null;
  deviceRouting: boolean;
  servicePerMinute: number;
  accountPerMinute: number;
}

export interface PricingPlansDto {
  /** Whether the plans were loaded live from the billing provider. */
  source: "autumn" | "static";
  plans: PricingPlanDto[];
}

// ---------------------------------------------------------------------------
// Push data payload (delivered to the iOS app + notification service extension)
// ---------------------------------------------------------------------------

export const webhookPushDataSchema = z.object({
  v: z.literal(PUSH_SCHEMA_VERSION),
  eventId: z.string(),
  serviceId: z.string(),
  /** Alias of serviceId kept for forwards compatibility with multi-source plans. */
  sourceId: z.string(),
  /** Display name shown as the notification sender. */
  sourceName: z.string(),
  avatarUrl: z.url().optional(),
  /** Destination URL to open when the notification is tapped. */
  url: z.url().optional(),
  conversationId: z.string(),
  /** Web app opened in SHark on tap, at `url` when present; ignored by older builds. */
  appId: z.string().optional(),
});
export const interactionPushDataSchema = z.object({
  v: z.literal(PUSH_SCHEMA_VERSION),
  interactionId: z.string(),
  eventId: z.string().optional(),
  interactionKind: interactionKindSchema,
  sourceName: z.string(),
  conversationId: z.string(),
  categoryId: z.enum([HARK_APPROVAL_CATEGORY_ID, HARK_YES_NO_CATEGORY_ID, HARK_REPLY_CATEGORY_ID]),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  responseToken: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{43}$/)
    .optional(),
  avatarUrl: z.url().optional(),
  url: z.url().optional(),
});
export const notificationWithdrawalPushDataSchema = z.object({
  v: z.literal(PUSH_SCHEMA_VERSION),
  command: z.literal("notification.withdraw"),
  eventId: z.string().min(1),
});
export const pushDataSchema = z.union([
  webhookPushDataSchema,
  interactionPushDataSchema,
  notificationWithdrawalPushDataSchema,
]);
export type PushData = z.infer<typeof pushDataSchema>;
export type InteractionPushData = z.infer<typeof interactionPushDataSchema>;
export type NotificationWithdrawalPushData = z.infer<typeof notificationWithdrawalPushDataSchema>;

// ---------------------------------------------------------------------------
// Generic API envelope
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  issues?: unknown;
}
export * from "./board";
