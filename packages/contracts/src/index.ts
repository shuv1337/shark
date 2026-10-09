import { z } from "zod";

/** Version of the push `data` payload schema understood by the iOS extension. */
export const PUSH_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Notification body capacity and UTF-8 helpers
// ---------------------------------------------------------------------------

/** Maximum notification body length in UTF-16 code units (`String.length`). */
export const NOTIFICATION_BODY_MAX_CHARS = 8_000 as const;
/** Maximum notification body size in UTF-8 bytes (16 KiB). */
export const NOTIFICATION_BODY_MAX_BYTES = 16_384 as const;
/** Interactive prompts keep the original limit so approval UIs stay bounded. */
export const INTERACTIVE_BODY_MAX_CHARS = 2_000 as const;
/** Maximum summary length; summaries replace the body in pushes and lists. */
export const NOTIFICATION_SUMMARY_MAX_CHARS = 500 as const;
/** Maximum project display-name length. */
export const PROJECT_NAME_MAX_CHARS = 80 as const;
/** Hard cap on projects per account; deliveries above it degrade to Unfiled. */
export const MAX_PROJECTS_PER_ACCOUNT = 500 as const;

/**
 * UTF-8 byte length computed without TextEncoder so the same code runs in
 * Node, Hermes, and browsers. Lone surrogates count like replacement output.
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) as number;
    if (code > 0xffff) index += 1;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Longest prefix of `value` that fits `maxBytes` without splitting a code point. */
export function truncateToUtf8Bytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (utf8ByteLength(value) <= maxBytes) return value;
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const size = utf8ByteLength(character);
    if (bytes + size > maxBytes) break;
    bytes += size;
    result += character;
  }
  return result;
}

export const NOTIFICATION_BODY_FORMATS = ["text", "markdown"] as const;
export const notificationBodyFormatSchema = z.enum(NOTIFICATION_BODY_FORMATS);
export type NotificationBodyFormat = z.infer<typeof notificationBodyFormatSchema>;

const notificationBodySchema = z
  .string()
  .trim()
  .min(1, "body is required")
  .max(NOTIFICATION_BODY_MAX_CHARS)
  .refine(
    (value) => utf8ByteLength(value) <= NOTIFICATION_BODY_MAX_BYTES,
    `body must be at most ${NOTIFICATION_BODY_MAX_BYTES} bytes of UTF-8`,
  );

const notificationSummarySchema = z.string().trim().min(1).max(NOTIFICATION_SUMMARY_MAX_CHARS);

/**
 * Lower-case NFC identity used to deduplicate project names per account.
 * Display names keep their original casing; identity is case-insensitive.
 */
export function normalizeProjectName(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PROJECT_NAME_MAX_CHARS)
  .refine(
    (value) =>
      Array.from(value).every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      }),
    "Project names must be a single line",
  );

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

export const tapDestinationUrlSchema = webUrlSchema;

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

export const teamIdSchema = z
  .string()
  .trim()
  .regex(/^team_[A-Za-z0-9_-]{8,64}$/, "Must be a SHark team ID (team_…)");

export const oncallGroupIdSchema = z
  .string()
  .trim()
  .regex(/^ocg_[A-Za-z0-9_-]{8,64}$/, "Must be a SHark on-call group ID (ocg_…)");

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

export type AgentServiceDto = Omit<ServiceDto, "webhookUrl">;

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

export const webhookRequestSchema = z
  .object({
    body: notificationBodySchema,
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
    // The fields below are additive and deliberately carry no defaults, so the
    // parsed output of a pre-existing request is byte-identical across deploys
    // and stored idempotency request hashes keep matching.
    project: projectNameSchema.optional(),
    summary: notificationSummarySchema.optional(),
    bodyFormat: notificationBodyFormatSchema.optional(),
    /** Opens this SHark web app on tap; `url`, when present, must share its origin. */
    appId: appIdSchema.optional(),
    /**
     * Pages this on-call group instead of notifying the owner's devices. The
     * service owner must belong to the group's team. Mutually exclusive with
     * `deviceIds` and `response`.
     */
    oncall: oncallGroupIdSchema.optional(),
  })
  .superRefine((value, context) => {
    // Interactive bodies become interaction prompts, whose limit is unchanged.
    if (value.response && value.body.length > INTERACTIVE_BODY_MAX_CHARS) {
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: `Interactive notification bodies are limited to ${INTERACTIVE_BODY_MAX_CHARS} characters`,
      });
    }
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
      /** Set when the request paged an on-call group (`eventId` then repeats it). */
      pageId?: string;
      /** `true` when the page merged into an open page with the same dedup key. */
      deduplicated?: boolean;
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
  "shell",
  "verdict",
  "signal",
] as const;
export const liveActivityStyleSchema = z.enum(LIVE_ACTIVITY_STYLES);
export type LiveActivityStyle = z.infer<typeof liveActivityStyleSchema>;
export const INTERACTIVE_LIVE_ACTIVITY_STYLES = ["approval", "shell", "verdict", "signal"] as const;
export const interactiveLiveActivityStyleSchema = z.enum(INTERACTIVE_LIVE_ACTIVITY_STYLES);
export type InteractiveLiveActivityStyle = z.infer<typeof interactiveLiveActivityStyleSchema>;
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
    if (
      (value.style === "approval" ||
        value.style === "shell" ||
        value.style === "verdict" ||
        value.style === "signal") &&
      !value.interaction
    ) {
      context.addIssue({
        code: "custom",
        path: ["interaction"],
        message: "Interactive Live Activity styles require an interaction",
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

export const ordinaryLiveActivityStyleSchema = z.enum([
  "standard",
  "ring",
  "hero",
  "terminal",
  "steps",
]);

export const liveActivityStartSchema = z.object({
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
  style: ordinaryLiveActivityStyleSchema.default("standard"),
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
  style: ordinaryLiveActivityStyleSchema.optional(),
  staleAfterSeconds: z.number().int().min(0).max(28_800).optional(),
  ifSequence: z.number().int().nonnegative().optional(),
});

export const LIVE_ACTIVITY_UPDATE_FIELDS = Object.keys(liveActivityUpdateObject.shape);

export const liveActivityUpdateSchema = liveActivityUpdateObject.refine(
  (input) => Object.keys(input).some((key) => key !== "ifSequence"),
  "At least one of title, status, detail, progress, symbol, privacyMode, accentColor, style, or staleAfterSeconds is required",
);
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

export interface InboxLiveActivityDto extends LiveActivityDto {
  sourceName: string;
  sourceImageUrl: string | null;
  /** Present when the activity can be associated with a project. */
  projectId?: string | null;
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
  "devices:write",
  "inbox:read",
  "inbox:write",
  "billing:read",
  "tokens:manage",
  "board:read",
  "board:write",
  "teams:read",
  "teams:write",
  "oncall:read",
  "oncall:write",
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
  /**
   * `oauth` marks the grant behind a connected MCP/OAuth client. Revoking it
   * signs that client out (access and refresh tokens). Omitted by older
   * servers, which only had `token`.
   */
  kind?: ApiTokenKind;
  /** The connected OAuth client, for `kind: "oauth"`. */
  oauthClient?: { clientId: string; name: string } | null;
}

export const API_TOKEN_KINDS = ["token", "oauth"] as const;
export type ApiTokenKind = (typeof API_TOKEN_KINDS)[number];

/** Plain-language labels for consent screens and token pickers. */
export const API_TOKEN_SCOPE_DESCRIPTIONS: Record<
  ApiTokenScope,
  { label: string; description: string }
> = {
  "notifications:send": {
    label: "Send notifications",
    description: "Push notifications to your devices and withdraw them.",
  },
  "interactions:create": {
    label: "Ask questions",
    description: "Send approvals, yes/no questions, and reply prompts, and cancel them.",
  },
  "interactions:read": {
    label: "Read answers",
    description: "See your pending prompts and wait for your answers.",
  },
  "activities:read": {
    label: "Read Live Activities",
    description: "See the Live Activities it started.",
  },
  "activities:write": {
    label: "Run Live Activities",
    description: "Start, update, and end Live Activities on your Lock Screen.",
  },
  "services:read": {
    label: "Read webhook services",
    description: "List your webhook services (without their URLs).",
  },
  "services:write": {
    label: "Manage webhook services",
    description: "Create, edit, rotate, and delete webhook services.",
  },
  "devices:read": { label: "Read devices", description: "List your registered devices." },
  "devices:write": { label: "Remove devices", description: "Remove registered devices." },
  "events:read": {
    label: "Read history",
    description: "See webhook deliveries and your activity history.",
  },
  "apps:read": { label: "Read web apps", description: "List your SHark web apps." },
  "apps:write": {
    label: "Manage web apps",
    description: "Add, edit, move, and remove web apps, and revoke their sign-in.",
  },
  "inbox:read": { label: "Read your inbox", description: "Read notifications in your inbox." },
  "inbox:write": { label: "Mark inbox read", description: "Mark notifications read or unread." },
  "billing:read": { label: "Read your plan", description: "See your plan, limits, and usage." },
  "tokens:manage": {
    label: "Manage API tokens",
    description: "List and revoke your API tokens and connected clients. It can never create one.",
  },
  "teams:read": { label: "Read teams", description: "See your teams, members, and invites." },
  "teams:write": {
    label: "Manage teams",
    description: "Create and rename teams, invite and remove members, and change roles.",
  },
  "oncall:read": {
    label: "Read on-call",
    description: "See on-call schedules, your shifts, and pages.",
  },
  "oncall:write": {
    label: "Page and manage on-call",
    description: "Page people, edit schedules and overrides, and resolve pages.",
  },
  "board:read": {
    label: "Read the board",
    description: "See its own asks, work items, and notes, and wait for your answers.",
  },
  "board:write": {
    label: "Post to the board",
    description: "Raise asks, track work, and leave notes on your board.",
  },
  "watch:read": {
    label: "Apple Watch inbox",
    description: "Read the Apple Watch companion snapshot.",
  },
  "watch:respond": {
    label: "Answer from Apple Watch",
    description: "Answer prompts from the Apple Watch companion.",
  },
  "macos:read": {
    label: "Mac inbox",
    description: "Read the Mac companion snapshot and mark items read.",
  },
  "macos:respond": {
    label: "Answer from Mac",
    description: "Answer prompts from the Mac companion.",
  },
  "macos:register": {
    label: "Register a Mac",
    description: "Register and remove Mac companion devices.",
  },
};

// ---------------------------------------------------------------------------
// OAuth and the remote MCP server
// ---------------------------------------------------------------------------

/** The MCP endpoint path; its absolute URL is the OAuth resource/audience. */
export const MCP_PATH = "/mcp" as const;

/** Lets an OAuth client refresh its access without asking again. */
export const OAUTH_OFFLINE_ACCESS_SCOPE = "offline_access" as const;

/**
 * Scopes held only by SHark's own Apple Watch and Mac companions. They can
 * answer prompts, which is a human decision, so OAuth clients never get them.
 */
export const NATIVE_COMPANION_SCOPES = [
  "watch:read",
  "watch:respond",
  "macos:read",
  "macos:respond",
  "macos:register",
] as const satisfies readonly ApiTokenScope[];

const NATIVE_COMPANION_SCOPE_SET = new Set<string>(NATIVE_COMPANION_SCOPES);

/** API token scopes an OAuth client may be granted. */
export const OAUTH_API_SCOPES = API_TOKEN_SCOPES.filter(
  (scope) => !NATIVE_COMPANION_SCOPE_SET.has(scope),
);

/** Every OAuth scope SHark issues: the grantable API token scopes plus `offline_access`. */
export const OAUTH_SCOPES = [...OAUTH_API_SCOPES, OAUTH_OFFLINE_ACCESS_SCOPE] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

/**
 * Requested when a client asks for no scope: everything except
 * `tokens:manage`, which a client must request explicitly.
 */
export const OAUTH_DEFAULT_SCOPES: readonly OAuthScope[] = OAUTH_SCOPES.filter(
  (scope) => scope !== "tokens:manage",
);

/** A connected MCP/OAuth client as shown in the dashboard. */
export interface OAuthClientGrantDto {
  clientId: string;
  name: string;
  iconUrl: string | null;
  clientUri: string | null;
  /** Hosts the client redirects to after sign-in (for example `localhost`). */
  redirectHosts: string[];
  /** The scopes you granted, excluding `offline_access`. */
  scopes: ApiTokenScope[];
  /** Whether the client may refresh its access without asking again. */
  offlineAccess: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  /** The `kind: "oauth"` API token row that represents this grant. */
  tokenId: string | null;
}

export interface OAuthClientGrantListResponse {
  clients: OAuthClientGrantDto[];
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
/** On-call page with Acknowledge / Escalate actions. */
export const HARK_PAGE_CATEGORY_ID = "HARK_PAGE_V1" as const;
export const HARK_ACKNOWLEDGE_ACTION_ID = "HARK_ACKNOWLEDGE" as const;
export const HARK_ESCALATE_ACTION_ID = "HARK_ESCALATE" as const;
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
    style: interactiveLiveActivityStyleSchema.optional(),
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
    if (presentation !== "live_activity" && value.style !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["style"],
        message: "Interactive Live Activity styles require live_activity presentation",
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

export interface InboxInteractionDto extends InteractionDto {
  sourceName: string;
  sourceImageUrl: string | null;
  /** Present for webhook interactions created from a project notification. */
  projectId?: string | null;
}

export const INBOX_ACTIVITY_KINDS = ["notification", "live_activity", "response"] as const;
export type InboxActivityKind = (typeof INBOX_ACTIVITY_KINDS)[number];

export interface InboxActivityDto {
  id: string;
  kind: InboxActivityKind;
  sourceName: string;
  sourceImageUrl: string | null;
  title: string;
  detail: string | null;
  url: string | null;
  result: string | null;
  createdAt: string;
}

export interface InboxActivityPageDto {
  items: InboxActivityDto[];
  page: number;
  pageSize: number;
  total: number;
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
  body: notificationBodySchema,
  title: z.string().trim().min(1).max(80).default("SHark"),
  imageUrl: publicHttpsUrlSchema.optional(),
  url: webUrlSchema.optional(),
  deviceIds: z
    .array(z.string().trim().min(1).max(100))
    .min(1)
    .max(50)
    .transform((ids) => [...new Set(ids)].sort())
    .optional(),
  // Additive fields without defaults: old request hashes must stay stable.
  project: projectNameSchema.optional(),
  summary: notificationSummarySchema.optional(),
  bodyFormat: notificationBodyFormatSchema.optional(),
  /** Opens this SHark web app on tap; `url`, when present, must share its origin. */
  appId: appIdSchema.optional(),
  /**
   * Pages this on-call group instead of notifying the token owner's devices.
   * The owner must belong to the group's team. Cannot be combined with
   * `deviceIds`; the response is then an `OncallPageCreateResponse`.
   */
  oncall: oncallGroupIdSchema.optional(),
});
export type AgentNotificationCreateInput = z.infer<typeof agentNotificationCreateSchema>;

export interface AgentNotificationDto {
  projectId?: string | null;
  summary?: string | null;
  bodyFormat?: NotificationBodyFormat;
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

export interface AgentNotificationWithdrawResponse {
  ok: true;
  notificationId: string;
  /** `withdraw_partial` when only some active devices accepted the command. */
  status: "withdrawn" | "withdraw_partial";
  /** Silent commands accepted by push providers, not proof of removal on a device. */
  accepted: number;
  idempotent?: boolean;
}

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
  project: projectNameSchema.optional(),
  /** Adds the app to this team (caller must be a member) instead of the caller's own apps. */
  teamId: teamIdSchema.optional(),
});

/** Moves a personal app into a team, or (`null`) back to the caller's own apps. */
export const appShareSchema = z.strictObject({
  teamId: teamIdSchema.nullable(),
  /** Notifies every other team member that the app was added. Defaults to true. */
  notify: z.boolean().optional(),
});
export type AppShareInput = z.infer<typeof appShareSchema>;
export type AppCreateInput = z.infer<typeof appCreateSchema>;

/** Owner-controlled sharing preferences; the pairwise SHark ID is always shared. */
export const appSharingSchema = z.object({
  shareName: z.boolean().optional(),
  shareEmail: z.boolean().optional(),
});
export type AppSharingInput = z.infer<typeof appSharingSchema>;

export const appUpdateSchema = z
  .strictObject({
    name: appNameSchema.optional(),
    url: appUrlSchema.optional(),
    /** `null` clears the icon. */
    iconUrl: publicHttpsUrlSchema.nullable().optional(),
    /** Project name; `null` moves the app out of its project. */
    project: projectNameSchema.nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, "At least one field is required");
export type AppUpdateInput = z.infer<typeof appUpdateSchema>;

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
  projectId: string | null;
  projectName: string | null;
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
  /**
   * Team that owns the app; `null` for personal apps. For team apps the
   * sharing, consent and last-opened fields describe the viewing member only:
   * every member approves sign-in and chooses what to share for themselves.
   */
  team?: TeamSummaryDto | null;
  /** Display name of the person who added the app; absent on older servers. */
  addedBy?: string | null;
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
  /** Present for team apps: the team the viewer belongs to and their role in it. */
  team_id?: string;
  team_role?: TeamRole;
}

/** `code` returned when a pass needs owner consent first. */
export const API_ERROR_CODE_CONSENT_REQUIRED = "consent_required" as const;

// ---------------------------------------------------------------------------
// Teams (shared apps, seats and on-call groups)
// ---------------------------------------------------------------------------

export const TEAM_ROLES = ["owner", "admin", "member"] as const;
export const teamRoleSchema = z.enum(TEAM_ROLES);
export type TeamRole = z.infer<typeof teamRoleSchema>;

export const TEAM_NAME_MAX_CHARS = 60 as const;
export const MAX_TEAMS_PER_ACCOUNT = 20 as const;
export const MAX_MEMBERS_PER_TEAM = 500 as const;
/** Seats included without a paid team plan (the creator's own seat). */
export const TEAM_FREE_SEATS = 1 as const;
/** Monthly price per seat beyond the free one, in USD. */
export const TEAM_SEAT_PRICE_MONTHLY = 5 as const;
export const TEAM_INVITE_TTL_SECONDS = 604_800 as const;

const singleLine = (value: string) =>
  Array.from(value).every((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  });

export const teamNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(TEAM_NAME_MAX_CHARS)
  .refine(singleLine, "Team names must be a single line");

export const teamCreateSchema = z.strictObject({ name: teamNameSchema });
export type TeamCreateInput = z.infer<typeof teamCreateSchema>;

export const teamUpdateSchema = z.strictObject({ name: teamNameSchema });
export type TeamUpdateInput = z.infer<typeof teamUpdateSchema>;

export interface TeamSummaryDto {
  id: string;
  name: string;
}

export interface TeamDto extends TeamSummaryDto {
  /** The viewer's role in this team. */
  role: TeamRole;
  memberCount: number;
  appCount: number;
  oncallGroupCount: number;
  seats: {
    used: number;
    /** Seats covered without payment (TEAM_FREE_SEATS) plus paid seats. */
    available: number | null;
    /** Seats billed at TEAM_SEAT_PRICE_MONTHLY. */
    billable: number;
  };
  plan: "free" | "team";
  createdAt: string;
}

export interface TeamMemberDto {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: TeamRole;
  joinedAt: string;
}

export const teamMemberUpdateSchema = z.strictObject({ role: teamRoleSchema });
export type TeamMemberUpdateInput = z.infer<typeof teamMemberUpdateSchema>;

export const teamInviteCreateSchema = z.strictObject({
  /** Optional: an existing SHark user with this email also gets a push notification. */
  email: z.email().max(254).optional(),
  role: z.enum(["admin", "member"]).default("member"),
});
export type TeamInviteCreateInput = z.infer<typeof teamInviteCreateSchema>;

export interface TeamInviteDto {
  id: string;
  teamId: string;
  email: string | null;
  role: TeamRole;
  invitedBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface TeamInviteCreateResponse {
  invite: TeamInviteDto;
  /** Plaintext join code, returned once. */
  code: string;
  /** `https://<origin>/join/<code>`; opens the iPhone app when installed. */
  url: string;
}

/** Public preview shown before accepting an invite. */
export interface TeamInvitePreviewDto {
  teamName: string;
  invitedBy: string;
  role: TeamRole;
  memberCount: number;
  expiresAt: string;
}

export interface TeamJoinResponse {
  team: TeamDto;
  /** `false` when the viewer was already a member. */
  joined: boolean;
}

/** `code` returned when a team has no free seat and no paid team plan. */
export const API_ERROR_CODE_SEAT_LIMIT = "seat_limit" as const;

// ---------------------------------------------------------------------------
// On-call groups and pages
// ---------------------------------------------------------------------------

export const ONCALL_ROTATION_PERIODS = ["daily", "weekly"] as const;
export const oncallRotationPeriodSchema = z.enum(ONCALL_ROTATION_PERIODS);
export const ONCALL_ESCALATION_TARGETS = ["next", "group"] as const;
export const MAX_ONCALL_GROUPS_PER_TEAM = 50 as const;
export const MAX_ESCALATION_STEPS = 5 as const;

export const oncallEscalationStepSchema = z.strictObject({
  /** Minutes after the previous step (or the page) with no acknowledgement. */
  afterMinutes: z.number().int().min(1).max(1440),
  /** `next`: the next person in the rotation. `group`: every member of the group. */
  target: z.enum(ONCALL_ESCALATION_TARGETS),
});
export type OncallEscalationStep = z.infer<typeof oncallEscalationStepSchema>;

export const oncallRotationSchema = z.strictObject({
  /** Rotation order; every ID must be a team member. */
  memberIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  period: oncallRotationPeriodSchema,
  /** Local handoff time `HH:MM` in `timezone`. */
  handoffAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
  /** IANA time zone, e.g. `America/New_York`. */
  timezone: z.string().min(1).max(64),
  /**
   * First handoff. Its local date in `timezone` is kept and the time is
   * normalized to `handoffAt`. Defaults to the latest handoff at or before
   * now, so the first member in `memberIds` is on call immediately.
   */
  startsAt: z.iso.datetime().optional(),
});
export type OncallRotationInput = z.infer<typeof oncallRotationSchema>;

export const oncallGroupCreateSchema = z.strictObject({
  name: teamNameSchema,
  rotation: oncallRotationSchema,
  escalation: z
    .array(oncallEscalationStepSchema)
    .max(MAX_ESCALATION_STEPS)
    .default([
      { afterMinutes: 5, target: "next" },
      { afterMinutes: 10, target: "group" },
    ]),
});
export type OncallGroupCreateInput = z.infer<typeof oncallGroupCreateSchema>;

export const oncallGroupUpdateSchema = z
  .strictObject({
    name: teamNameSchema.optional(),
    rotation: oncallRotationSchema.optional(),
    escalation: z.array(oncallEscalationStepSchema).max(MAX_ESCALATION_STEPS).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, "At least one field is required");
export type OncallGroupUpdateInput = z.infer<typeof oncallGroupUpdateSchema>;

/** Temporarily puts someone on call (e.g. covering a shift). */
export const oncallOverrideCreateSchema = z.strictObject({
  userId: z.string().min(1).max(100),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});
export type OncallOverrideCreateInput = z.infer<typeof oncallOverrideCreateSchema>;

export interface OncallPersonDto {
  userId: string;
  name: string;
  image: string | null;
}

export interface OncallShiftDto {
  person: OncallPersonDto;
  startsAt: string;
  endsAt: string;
  /** `true` when an override replaces the rotation for this shift. */
  override: boolean;
  /** The override behind this shift, for removal; absent on rotation shifts. */
  overrideId?: string;
}

/** A scheduled override; ended overrides are not listed. */
export interface OncallOverrideDto {
  id: string;
  person: OncallPersonDto;
  startsAt: string;
  endsAt: string;
}

export interface OncallGroupDto {
  id: string;
  teamId: string;
  name: string;
  rotation: {
    members: OncallPersonDto[];
    period: (typeof ONCALL_ROTATION_PERIODS)[number];
    handoffAt: string;
    timezone: string;
    startsAt: string;
  };
  escalation: OncallEscalationStep[];
  current: OncallShiftDto | null;
  /** The next few shifts, current first. */
  upcoming: OncallShiftDto[];
  /** Current and future overrides, soonest first; absent on older servers. */
  overrides?: OncallOverrideDto[];
  openPageCount: number;
  createdAt: string;
  updatedAt: string;
}

export const ONCALL_PAGE_STATUSES = ["triggered", "acknowledged", "resolved"] as const;
export type OncallPageStatus = (typeof ONCALL_PAGE_STATUSES)[number];

export const oncallPageCreateSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(INTERACTIVE_BODY_MAX_CHARS).optional(),
  url: tapDestinationUrlSchema.optional(),
  /** Team app opened when the page is tapped; must belong to the group's team. */
  appId: appIdSchema.optional(),
  /** Pages with an open page of the same key are merged instead of re-paging. */
  dedupKey: z.string().trim().min(1).max(200).optional(),
});
export type OncallPageCreateInput = z.infer<typeof oncallPageCreateSchema>;

export interface OncallPageDto {
  id: string;
  groupId: string;
  groupName: string;
  teamId: string;
  title: string;
  body: string | null;
  url: string | null;
  app: AppSummaryDto | null;
  status: OncallPageStatus;
  dedupKey: string | null;
  /** How many times a duplicate page was merged into this one. */
  repeatCount: number;
  /** People notified so far, in order. */
  notified: OncallPersonDto[];
  escalationStep: number;
  nextEscalationAt: string | null;
  acknowledgedBy: OncallPersonDto | null;
  acknowledgedAt: string | null;
  resolvedBy: OncallPersonDto | null;
  resolvedAt: string | null;
  /** Service or token name that raised the page. */
  source: string;
  createdAt: string;
}

export interface OncallPageCreateResponse {
  page: OncallPageDto;
  /** `true` when merged into an open page with the same `dedupKey`. */
  deduplicated: boolean;
  /** Push requests accepted for the first notified person. */
  accepted: number;
}

export const oncallPageResolveSchema = z.strictObject({
  note: z.string().trim().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Project inbox (session-authenticated mobile API)
// ---------------------------------------------------------------------------

export interface ProjectDto {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Reserved project filter naming the synthetic bucket of unfiled notifications. */
export const INBOX_UNFILED_PROJECT = "unfiled" as const;
/** Display name of the synthetic bucket. */
export const INBOX_UNFILED_PROJECT_NAME = "Other" as const;
/** Character bound applied to previews returned by inbox list endpoints. */
export const INBOX_PREVIEW_MAX_CHARS = 240 as const;
/** Maximum page size accepted by the inbox notification list. */
export const INBOX_PAGE_MAX_LIMIT = 50 as const;

export interface InboxProjectSummaryDto {
  /** `null` identifies the synthetic Unfiled bucket. */
  projectId: string | null;
  name: string;
  unreadCount: number;
  totalCount: number;
  latestTitle: string | null;
  latestPreview: string | null;
  /** Resolved image from the latest notification; older servers omit it. */
  latestImageUrl?: string | null;
  latestAt: string | null;
}

export interface InboxProjectsDto {
  projects: InboxProjectSummaryDto[];
  totalUnread: number;
}

/** Origin half of the stable composite notification ID. */
export const INBOX_NOTIFICATION_ORIGINS = ["event", "notification"] as const;
export type InboxNotificationOrigin = (typeof INBOX_NOTIFICATION_ORIGINS)[number];

export interface InboxNotificationSummaryDto {
  /** Stable composite ID: `event:<id>` (webhook) or `notification:<id>` (agent). */
  id: string;
  origin: InboxNotificationOrigin;
  projectId: string | null;
  projectName: string | null;
  sourceName: string;
  sourceImageUrl: string | null;
  title: string;
  /** Bounded preview; the full body is only returned by the detail route. */
  preview: string;
  url: string | null;
  bodyFormat: NotificationBodyFormat;
  readAt: string | null;
  createdAt: string;
  /** Web app opened by this notification; older servers omit it. */
  app?: AppSummaryDto | null;
}

export interface InboxNotificationPageDto {
  items: InboxNotificationSummaryDto[];
  /** Opaque keyset cursor; `null` when the page is the last one. */
  nextCursor: string | null;
  /**
   * Opaque server-issued high-water snapshot of the requested scope, taken
   * before the page was read. Submitting it as `readThrough` to read-all
   * marks only rows that existed at snapshot time, so notifications arriving
   * afterwards stay unread even when their `createdAt` collides at
   * millisecond precision with the newest returned row.
   */
  readThroughToken: string;
}

export interface InboxNotificationDetailDto extends InboxNotificationSummaryDto {
  body: string;
  summary: string | null;
  /** Delivery status for webhook events; `null` for agent notifications. */
  status: string | null;
}

export const inboxMarkAllReadSchema = z.object({
  /**
   * Opaque `readThroughToken` from a list response. It bounds read-all to
   * rows the client observed, so notifications arriving during the tap stay
   * unread; the server never trusts it for ownership or project scope.
   */
  readThrough: z.string().min(1).max(200),
  /** Project ID, or `unfiled` for the synthetic bucket. Omit for the account. */
  project: z.string().trim().min(1).max(100).optional(),
});
export type InboxMarkAllReadInput = z.infer<typeof inboxMarkAllReadSchema>;

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
  projectId: z.string().optional(),
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
export const oncallPagePushDataSchema = z.object({
  v: z.literal(PUSH_SCHEMA_VERSION),
  pageId: z.string(),
  teamId: z.string(),
  groupName: z.string(),
  categoryId: z.literal(HARK_PAGE_CATEGORY_ID),
  /** One-shot credential for acknowledging from the lock screen. */
  responseToken: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{43}$/)
    .optional(),
  url: tapDestinationUrlSchema.optional(),
  appId: z.string().optional(),
});
/** Silent command clearing a page from devices once someone acknowledges it. */
export const oncallPageClaimedPushDataSchema = z.object({
  v: z.literal(PUSH_SCHEMA_VERSION),
  command: z.literal("page.claimed"),
  pageId: z.string().min(1),
  claimedBy: z.string(),
});
export const pushDataSchema = z.union([
  webhookPushDataSchema,
  interactionPushDataSchema,
  notificationWithdrawalPushDataSchema,
  oncallPagePushDataSchema,
  oncallPageClaimedPushDataSchema,
]);
export type OncallPagePushData = z.infer<typeof oncallPagePushDataSchema>;
export type PushData = z.infer<typeof pushDataSchema>;
export type InteractionPushData = z.infer<typeof interactionPushDataSchema>;
export type NotificationWithdrawalPushData = z.infer<typeof notificationWithdrawalPushDataSchema>;

// ---------------------------------------------------------------------------
// Generic API envelope
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  /**
   * Machine-readable discriminator carried alongside the human-readable
   * message. Older servers omit it, which lets clients distinguish "this
   * server answered and the resource is gone" from "this server does not
   * implement the route at all" (a bare 404).
   */
  code?: string;
  issues?: unknown;
}
export * from "./board";

export const API_ERROR_CODE_NOT_FOUND = "not_found" as const;
