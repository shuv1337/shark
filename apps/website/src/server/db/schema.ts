import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Better Auth core tables
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  welcomeNotificationSentAt: integer("welcome_notification_sent_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** Native Apple grants are separate from Better Auth accounts so refresh tokens stay encrypted. */
export const appleNativeGrant = sqliteTable(
  "apple_native_grant",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    appleSubject: text("apple_subject").notNull(),
    clientId: text("client_id").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
    /** Domain-separated digest of Apple's single-use authorization code. */
    authorizationCodeHash: text("authorization_code_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("apple_native_grant_user_unique").on(table.userId),
    uniqueIndex("apple_native_grant_code_hash_unique").on(table.authorizationCodeHash),
    index("apple_native_grant_subject_idx").on(table.appleSubject),
  ],
);

// ---------------------------------------------------------------------------
// Stable compatibility-domain tables
// ---------------------------------------------------------------------------

export const service = sqliteTable(
  "service",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    imageUrl: text("image_url"),
    url: text("url"),
    /** SHA-256 hex digest of the webhook token. The plaintext token is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    /** AES-GCM encrypted token, used to let the owner copy the URL again. */
    tokenCiphertext: text("token_ciphertext"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("service_user_id_idx").on(table.userId)],
);

/**
 * User-scoped notification project. Identity is the case-insensitive,
 * NFC-normalized name; the display name keeps the sender's original casing.
 */
export const project = sqliteTable(
  "project",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("project_user_normalized_name_unique").on(table.userId, table.normalizedName),
    index("project_user_created_at_idx").on(table.userId, table.createdAt),
  ],
);

export const device = sqliteTable("device", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expoPushToken: text("expo_push_token").notNull().unique(),
  apnsToken: text("apns_token"),
  platform: text("platform").notNull().default("ios"),
  deviceName: text("device_name"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  liveActivityPushToStartTokenCiphertext: text("live_activity_push_to_start_token_ciphertext"),
  liveActivityTokenEnvironment: text("live_activity_token_environment"),
  liveActivitySchemaVersion: integer("live_activity_schema_version"),
  liveActivityTokenUpdatedAt: integer("live_activity_token_updated_at", { mode: "timestamp_ms" }),
  interactionSchemaVersion: integer("interaction_schema_version"),
  liveActivityInteractionVersion: integer("live_activity_interaction_version"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
});

/** Browser Push API subscription secrets are encrypted at rest. */
export const webPushSubscription = sqliteTable(
  "web_push_subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Domain-separated endpoint digest supports lookup without exposing the capability URL. */
    endpointHash: text("endpoint_hash").notNull().unique(),
    subscriptionCiphertext: text("subscription_ciphertext").notNull(),
    deviceName: text("device_name"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    expirationAt: integer("expiration_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("web_push_subscription_user_active_idx").on(table.userId, table.active)],
);

/** Native macOS notification devices use direct APNs and keep capability tokens encrypted. */
export const macosDevice = sqliteTable(
  "macos_device",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    apnsTokenHash: text("apns_token_hash").notNull().unique(),
    apnsTokenCiphertext: text("apns_token_ciphertext").notNull(),
    environment: text("environment").notNull(),
    deviceName: text("device_name"),
    privacyMode: text("privacy_mode").notNull().default("standard"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("macos_device_user_active_idx").on(table.userId, table.active)],
);

/** Small delivery log kept for debugging; not exposed as analytics. */
export const event = sqliteTable(
  "event",
  {
    id: text("id").primaryKey(),
    serviceId: text("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    imageUrl: text("image_url"),
    url: text("url"),
    status: text("status").notNull(),
    deliveredCount: integer("delivered_count").notNull().default(0),
    error: text("error"),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    /** Web app opened on tap; delivery survives app deletion. */
    appId: text("app_id").references(() => app.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    bodyFormat: text("body_format"),
    summary: text("summary"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("event_service_idempotency_key_unique").on(table.serviceId, table.idempotencyKey),
    index("event_service_created_at_idx").on(table.serviceId, table.createdAt),
    index("event_project_created_at_idx").on(table.projectId, table.createdAt),
    index("event_unread_idx").on(table.serviceId, table.createdAt).where(sql`"read_at" is null`),
  ],
);

export const apiToken = sqliteTable(
  "api_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** SHA-256 digest of a high-entropy token. Plaintext is returned only at creation. */
    tokenHash: text("token_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    /**
     * Set for the grant behind a connected OAuth (MCP) client. Such rows have
     * no usable secret: the client authenticates with OAuth access tokens and
     * this row carries the stable identity agent routes scope ownership to.
     */
    oauthClientId: text("oauth_client_id"),
  },
  (table) => [
    index("api_token_user_created_at_idx").on(table.userId, table.createdAt),
    index("api_token_prefix_idx").on(table.prefix),
    uniqueIndex("api_token_active_oauth_grant_unique")
      .on(table.userId, table.oauthClientId)
      .where(sql`"oauth_client_id" is not null and "revoked_at" is null`),
  ],
);

/** One-shot pushes sent with an agent API token, kept for idempotent retries. */
export const agentNotification = sqliteTable(
  "agent_notification",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Null for SHark's own notices (team invites, shared apps), which have no token. */
    requesterTokenId: text("requester_token_id").references(() => apiToken.id, {
      onDelete: "cascade",
    }),
    /** Sender label for token-less notices; token rows use the token name. */
    sourceName: text("source_name"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    imageUrl: text("image_url"),
    url: text("url"),
    status: text("status").notNull().default("processing"),
    acceptedCount: integer("accepted_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    error: text("error"),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    /** Web app opened on tap; delivery survives app deletion. */
    appId: text("app_id").references(() => app.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    bodyFormat: text("body_format"),
    summary: text("summary"),
    /** Board push attempt that owns a `processing` row; only it may record the outcome. */
    claimId: text("claim_id"),
    claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_notification_token_idempotency_unique").on(
      table.requesterTokenId,
      table.idempotencyKey,
    ),
    index("agent_notification_user_created_at_idx").on(table.userId, table.createdAt),
    index("agent_notification_token_created_at_idx").on(table.requesterTokenId, table.createdAt),
    index("agent_notification_project_created_at_idx").on(table.projectId, table.createdAt),
    index("agent_notification_unread_idx")
      .on(table.userId, table.createdAt)
      .where(sql`"read_at" is null`),
  ],
);

/**
 * One row per retry of a failed or abandoned board push. The notification row
 * counts its first attempt; each retry counts here in the per-minute windows.
 * Rows only matter for 60 seconds; the board sweeper deletes those over an hour old.
 */
export const agentNotificationRetry = sqliteTable(
  "agent_notification_retry",
  {
    id: text("id").primaryKey(),
    notificationId: text("notification_id")
      .notNull()
      .references(() => agentNotification.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requesterTokenId: text("requester_token_id").references(() => apiToken.id, {
      onDelete: "cascade",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("agent_notification_retry_notification_idx").on(table.notificationId),
    index("agent_notification_retry_user_created_at_idx").on(table.userId, table.createdAt),
    index("agent_notification_retry_token_created_at_idx").on(
      table.requesterTokenId,
      table.createdAt,
    ),
  ],
);

// ---------------------------------------------------------------------------
// SHark web apps and project associations
// ---------------------------------------------------------------------------

/** A web app the owner opens full screen in the iPhone app, signed in with a pass. */
export const app = sqliteTable(
  "app",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Launch URL loaded by the in-app web view. */
    url: text("url").notNull(),
    /** Canonical origin of `url`; the pass audience. */
    origin: text("origin").notNull(),
    iconUrl: text("icon_url"),
    shareName: integer("share_name", { mode: "boolean" }).notNull().default(true),
    shareEmail: integer("share_email", { mode: "boolean" }).notNull().default(false),
    /** Null until the owner approves sign-in; revoking clears it. */
    consentedAt: integer("consented_at", { mode: "timestamp_ms" }),
    lastOpenedAt: integer("last_opened_at", { mode: "timestamp_ms" }),
    createdByTokenId: text("created_by_token_id").references(() => apiToken.id, {
      onDelete: "set null",
    }),
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    /**
     * Team that owns the app; null for personal apps. For team apps `userId`
     * is the member who added it, and per-member sharing and consent live in
     * `app_member_state` instead of the columns above.
     */
    teamId: text("team_id").references((): AnySQLiteColumn => team.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("app_user_url_unique").on(table.userId, table.url),
    index("app_user_id_idx").on(table.userId),
    index("app_team_id_idx").on(table.teamId),
  ],
);

/** Each member's own sharing choices and sign-in consent for a team app. */
export const appMemberState = sqliteTable(
  "app_member_state",
  {
    appId: text("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    shareName: integer("share_name", { mode: "boolean" }).notNull().default(true),
    shareEmail: integer("share_email", { mode: "boolean" }).notNull().default(false),
    consentedAt: integer("consented_at", { mode: "timestamp_ms" }),
    lastOpenedAt: integer("last_opened_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("app_member_state_app_user_unique").on(table.appId, table.userId),
    index("app_member_state_user_idx").on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// Teams and on-call
// ---------------------------------------------------------------------------

export const team = sqliteTable("team", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const teamMember = sqliteTable(
  "team_member",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `owner` (exactly one), `admin`, or `member`. */
    role: text("role").notNull(),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("team_member_team_user_unique").on(table.teamId, table.userId),
    index("team_member_user_idx").on(table.userId),
  ],
);

export const teamInvite = sqliteTable(
  "team_invite",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    /** Domain-separated SHA-256 digest; the plaintext join code is returned once. */
    codeHash: text("code_hash").notNull(),
    email: text("email"),
    role: text("role").notNull(),
    invitedByUserId: text("invited_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    invitedByName: text("invited_by_name").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    acceptedByUserId: text("accepted_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("team_invite_code_hash_unique").on(table.codeHash),
    index("team_invite_team_created_idx").on(table.teamId, table.createdAt),
  ],
);

export const oncallGroup = sqliteTable(
  "oncall_group",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Rotation order of user IDs. Members who leave the team are removed. */
    memberIds: text("member_ids", { mode: "json" }).$type<string[]>().notNull(),
    period: text("period").notNull(),
    handoffAt: text("handoff_at").notNull(),
    timezone: text("timezone").notNull(),
    /** First handoff, normalized to `handoffAt` in `timezone`. */
    startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
    escalation: text("escalation", { mode: "json" })
      .$type<Array<{ afterMinutes: number; target: "next" | "group" }>>()
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("oncall_group_team_idx").on(table.teamId)],
);

export const oncallOverride = sqliteTable(
  "oncall_override",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => oncallGroup.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
    endsAt: integer("ends_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("oncall_override_group_ends_idx").on(table.groupId, table.endsAt)],
);

export const oncallPage = sqliteTable(
  "oncall_page",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => oncallGroup.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"),
    url: text("url"),
    appId: text("app_id").references(() => app.id, { onDelete: "set null" }),
    /** `triggered`, `acknowledged`, or `resolved`. */
    status: text("status").notNull(),
    dedupKey: text("dedup_key"),
    repeatCount: integer("repeat_count").notNull().default(0),
    /** Escalation steps already run. */
    escalationStep: integer("escalation_step").notNull().default(0),
    /** Read by the escalation worker, so pending escalations survive restarts. */
    nextEscalationAt: integer("next_escalation_at", { mode: "timestamp_ms" }),
    /** User most recently paged individually; `next` steps continue after them. */
    lastPagedUserId: text("last_paged_user_id"),
    sourceName: text("source_name").notNull(),
    /** Webhook or API token that raised the page, for their per-minute windows. */
    requesterServiceId: text("requester_service_id").references(() => service.id, {
      onDelete: "set null",
    }),
    requesterTokenId: text("requester_token_id").references(() => apiToken.id, {
      onDelete: "set null",
    }),
    /** User whose notification allowance the page counts against. */
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    acknowledgedByUserId: text("acknowledged_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    acknowledgedAt: integer("acknowledged_at", { mode: "timestamp_ms" }),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    resolveNote: text("resolve_note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("oncall_page_team_created_idx").on(table.teamId, table.createdAt),
    index("oncall_page_escalation_idx").on(table.status, table.nextEscalationAt),
    uniqueIndex("oncall_page_open_dedup_unique")
      .on(table.groupId, table.dedupKey)
      .where(sql`${table.status} in ('triggered', 'acknowledged')`),
  ],
);

/** Everyone a page notified, with their one-shot lock-screen credential. */
export const oncallPageRecipient = sqliteTable(
  "oncall_page_recipient",
  {
    pageId: text("page_id")
      .notNull()
      .references(() => oncallPage.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** 0 for the initial notification, then the escalation step number. */
    step: integer("step").notNull(),
    responseTokenHash: text("response_token_hash").notNull(),
    /** Set on the credential's first successful use; it is single-use. */
    responseTokenUsedAt: integer("response_token_used_at", { mode: "timestamp_ms" }),
    acceptedCount: integer("accepted_count").notNull().default(0),
    /**
     * `pending` while a push is in flight, then `delivered` (Expo accepted at
     * least one push), `failed`, or `skipped` (no active device). Only
     * `delivered` recipients count as paged; the rest are paged again.
     */
    deliveryStatus: text("delivery_status").notNull().default("pending"),
    /** Start of the latest delivery attempt. */
    notifiedAt: integer("notified_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("oncall_page_recipient_page_user_unique").on(table.pageId, table.userId),
    uniqueIndex("oncall_page_recipient_token_unique").on(table.responseTokenHash),
    index("oncall_page_recipient_user_idx").on(table.userId, table.notifiedAt),
    index("oncall_page_recipient_delivery_idx").on(table.deliveryStatus, table.notifiedAt),
  ],
);

/** ES256 keys that sign passes. The private JWK is encrypted at rest. */
export const appSigningKey = sqliteTable("app_signing_key", {
  /** JWK `kid`. */
  id: text("id").primaryKey(),
  algorithm: text("algorithm").notNull(),
  /** Public JWK as JSON, served from the JWKS endpoint while not retired. */
  publicJwk: text("public_jwk").notNull(),
  privateJwkCiphertext: text("private_jwk_ciphertext").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  retiredAt: integer("retired_at", { mode: "timestamp_ms" }),
});

/** Sign-in passes already traded at `POST /apps/enter`; each `jti` enters once. */
export const appPassUse = sqliteTable("app_pass_use", {
  jti: text("jti").primaryKey(),
  /** Pass expiry; rows past it may be pruned. */
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export const deviceAuthorizationRequest = sqliteTable(
  "device_authorization_request",
  {
    id: text("id").primaryKey(),
    /** Domain-separated SHA-256 digest. The plaintext device code is never persisted. */
    deviceCodeHash: text("device_code_hash").notNull(),
    userCode: text("user_code").notNull(),
    clientName: text("client_name").notNull(),
    requestedScopes: text("requested_scopes", { mode: "json" }).$type<string[]>().notNull(),
    status: text("status").notNull().default("pending"),
    approvedUserId: text("approved_user_id").references(() => user.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    tokenExpiresAt: integer("token_expires_at", { mode: "timestamp_ms" }).notNull(),
    pollIntervalSeconds: integer("poll_interval_seconds").notNull(),
    lastPollAt: integer("last_poll_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("device_authorization_device_code_hash_unique").on(table.deviceCodeHash),
    uniqueIndex("device_authorization_user_code_unique").on(table.userCode),
    index("device_authorization_status_expiry_idx").on(table.status, table.expiresAt),
    index("device_authorization_approved_user_idx").on(table.approvedUserId),
  ],
);

export const interaction = sqliteTable(
  "interaction",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requesterTokenId: text("requester_token_id").references(() => apiToken.id, {
      onDelete: "cascade",
    }),
    requesterServiceId: text("requester_service_id").references(() => service.id, {
      onDelete: "cascade",
    }),
    eventId: text("event_id").references(() => event.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    kind: text("kind").notNull(),
    presentation: text("presentation").notNull().default("notification"),
    primaryLabel: text("primary_label"),
    secondaryLabel: text("secondary_label"),
    status: text("status").notNull().default("pending"),
    choices: text("choices", { mode: "json" }).$type<string[]>().notNull(),
    response: text("response"),
    url: text("url"),
    imageUrl: text("image_url"),
    correlationId: text("correlation_id"),
    /** Digest echoed by the notification action to bind responses to the exact interaction. */
    actionDigest: text("action_digest").notNull(),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    responseTokenHash: text("response_token_hash"),
    callbackUrl: text("callback_url"),
    callbackTokenCiphertext: text("callback_token_ciphertext"),
    callbackStatus: text("callback_status"),
    callbackAttempts: integer("callback_attempts").notNull().default(0),
    callbackNextAttemptAt: integer("callback_next_attempt_at", { mode: "timestamp_ms" }),
    callbackLastError: text("callback_last_error"),
    callbackDeliveredAt: integer("callback_delivered_at", { mode: "timestamp_ms" }),
    acceptedCount: integer("accepted_count").notNull().default(0),
    respondingDeviceId: text("responding_device_id").references(() => device.id, {
      onDelete: "set null",
    }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    respondedAt: integer("responded_at", { mode: "timestamp_ms" }),
    canceledAt: integer("canceled_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    check(
      "interaction_requester_check",
      sql`("requester_token_id" is not null) != ("requester_service_id" is not null)`,
    ),
    uniqueIndex("interaction_token_idempotency_unique").on(
      table.requesterTokenId,
      table.idempotencyKey,
    ),
    index("interaction_token_created_at_idx").on(table.requesterTokenId, table.createdAt),
    uniqueIndex("interaction_service_idempotency_unique").on(
      table.requesterServiceId,
      table.idempotencyKey,
    ),
    uniqueIndex("interaction_event_unique").on(table.eventId),
    index("interaction_service_created_at_idx").on(table.requesterServiceId, table.createdAt),
    index("interaction_callback_due_idx").on(table.callbackStatus, table.callbackNextAttemptAt),
    index("interaction_user_responded_at_idx").on(table.userId, table.respondedAt),
    index("interaction_user_status_expiry_idx").on(table.userId, table.status, table.expiresAt),
  ],
);

export const liveActivity = sqliteTable(
  "live_activity",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requesterTokenId: text("requester_token_id").references(() => apiToken.id, {
      onDelete: "cascade",
    }),
    requesterServiceId: text("requester_service_id").references(() => service.id, {
      onDelete: "cascade",
    }),
    interactionId: text("interaction_id")
      .unique()
      .references(() => interaction.id, { onDelete: "cascade" }),
    key: text("key"),
    schemaVersion: integer("schema_version").notNull(),
    props: text("props", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("starting"),
    sequence: integer("sequence").notNull().default(0),
    apnsTimestamp: integer("apns_timestamp").notNull().default(0),
    acceptedCount: integer("accepted_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    staleAt: integer("stale_at", { mode: "timestamp_ms" }),
    dismissalAt: integer("dismissal_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    check(
      "live_activity_requester_check",
      sql`("requester_token_id" is not null) != ("requester_service_id" is not null)`,
    ),
    uniqueIndex("live_activity_token_idempotency_unique").on(
      table.requesterTokenId,
      table.idempotencyKey,
    ),
    uniqueIndex("live_activity_service_idempotency_unique").on(
      table.requesterServiceId,
      table.idempotencyKey,
    ),
    // Keys must be unique only among non-terminal activities, so a requester
    // can reuse a stable key (for example `deploy`) once its activity ends.
    uniqueIndex("live_activity_token_key_unique")
      .on(table.requesterTokenId, table.key)
      .where(sql`${table.status} in ('starting', 'active', 'partial')`),
    uniqueIndex("live_activity_service_key_unique")
      .on(table.requesterServiceId, table.key)
      .where(sql`${table.status} in ('starting', 'active', 'partial')`),
    index("live_activity_user_status_updated_idx").on(table.userId, table.status, table.updatedAt),
    index("live_activity_token_created_idx").on(table.requesterTokenId, table.createdAt),
    index("live_activity_service_created_idx").on(table.requesterServiceId, table.createdAt),
  ],
);

export const liveActivityDelivery = sqliteTable(
  "live_activity_delivery",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => liveActivity.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => device.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull().default("task"),
    status: text("status").notNull().default("pending"),
    environment: text("environment").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    nativeActivityId: text("native_activity_id"),
    updateTokenCiphertext: text("update_token_ciphertext"),
    updateTokenUpdatedAt: integer("update_token_updated_at", { mode: "timestamp_ms" }),
    lastEvent: text("last_event"),
    lastSequence: integer("last_sequence").notNull().default(-1),
    lastApnsStatus: integer("last_apns_status"),
    lastApnsReason: text("last_apns_reason"),
    lastApnsId: text("last_apns_id"),
    lastAttemptAt: integer("last_attempt_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("live_activity_delivery_activity_device_unique").on(
      table.activityId,
      table.deviceId,
    ),
    index("live_activity_delivery_device_status_idx").on(table.deviceId, table.status),
    uniqueIndex("live_activity_delivery_one_active_task_per_device_unique")
      .on(table.deviceId)
      .where(
        sql`${table.purpose} = 'task' and ${table.status} in ('pending', 'accepted', 'active')`,
      ),
    index("live_activity_delivery_native_id_idx").on(table.nativeActivityId),
  ],
);

export const liveActivityOperation = sqliteTable(
  "live_activity_operation",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => liveActivity.id, { onDelete: "cascade" }),
    requesterTokenId: text("requester_token_id").references(() => apiToken.id, {
      onDelete: "cascade",
    }),
    requesterServiceId: text("requester_service_id").references(() => service.id, {
      onDelete: "cascade",
    }),
    props: text("props", { mode: "json" }).$type<Record<string, unknown>>(),
    event: text("event").notNull(),
    sequence: integer("sequence").notNull(),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    acceptedCount: integer("accepted_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "live_activity_operation_requester_check",
      sql`("requester_token_id" is not null) != ("requester_service_id" is not null)`,
    ),
    uniqueIndex("live_activity_operation_token_idempotency_unique").on(
      table.requesterTokenId,
      table.idempotencyKey,
    ),
    uniqueIndex("live_activity_operation_service_idempotency_unique").on(
      table.requesterServiceId,
      table.idempotencyKey,
    ),
    index("live_activity_operation_token_created_idx").on(table.requesterTokenId, table.createdAt),
    index("live_activity_operation_service_created_idx").on(
      table.requesterServiceId,
      table.createdAt,
    ),
    index("live_activity_operation_activity_created_idx").on(table.activityId, table.createdAt),
  ],
);

export const liveActivityDeliveryAttempt = sqliteTable(
  "live_activity_delivery_attempt",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => liveActivity.id, { onDelete: "cascade" }),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => liveActivityDelivery.id, { onDelete: "cascade" }),
    operationId: text("operation_id")
      .notNull()
      .references(() => liveActivityOperation.id, { onDelete: "cascade" }),
    requesterTokenId: text("requester_token_id").references(() => apiToken.id, {
      onDelete: "cascade",
    }),
    requesterServiceId: text("requester_service_id").references(() => service.id, {
      onDelete: "cascade",
    }),
    event: text("event").notNull(),
    sequence: integer("sequence").notNull(),
    apnsStatus: integer("apns_status"),
    apnsReason: text("apns_reason"),
    apnsId: text("apns_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "live_activity_attempt_requester_check",
      sql`("requester_token_id" is not null) != ("requester_service_id" is not null)`,
    ),
    index("live_activity_attempt_token_created_idx").on(table.requesterTokenId, table.createdAt),
    index("live_activity_attempt_activity_created_idx").on(table.activityId, table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Durable account inbox
// ---------------------------------------------------------------------------

/**
 * A stable, account-owned projection of every user-visible notification flow.
 * Source metadata is deliberately snapshotted so revoking an API token or
 * deleting a service cannot erase or rename history.
 */
export const inboxItem = sqliteTable(
  "inbox_item",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    kind: text("kind").notNull(),
    sourceName: text("source_name").notNull(),
    sourceImageUrl: text("source_image_url"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    imageUrl: text("image_url"),
    url: text("url"),
    status: text("status").notNull(),
    result: text("result"),
    acceptedCount: integer("accepted_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    needsAction: integer("needs_action", { mode: "boolean" }).notNull().default(false),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("inbox_item_entity_unique").on(table.entityType, table.entityId),
    index("inbox_item_user_occurred_idx").on(table.userId, table.occurredAt),
    index("inbox_item_user_action_idx").on(table.userId, table.needsAction, table.occurredAt),
    index("inbox_item_user_read_idx").on(table.userId, table.readAt, table.occurredAt),
  ],
);

/** Append-only lifecycle entries displayed as the item's detail timeline. */
export const inboxItemEvent = sqliteTable(
  "inbox_item_event",
  {
    id: text("id").primaryKey(),
    inboxItemId: text("inbox_item_id")
      .notNull()
      .references(() => inboxItem.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    kind: text("kind").notNull(),
    detail: text("detail"),
    result: text("result"),
    acceptedCount: integer("accepted_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("inbox_item_event_dedupe_unique").on(table.inboxItemId, table.dedupeKey),
    index("inbox_item_event_item_occurred_idx").on(table.inboxItemId, table.occurredAt),
  ],
);

// ---------------------------------------------------------------------------
// Self-hosted product analytics
//
// These tables hold aggregate usage signals only: identifiers, enum-ish names,
// coarse buckets and counters. Notification content, prompts, reply text,
// tokens, emails, IP addresses and user agents are never written here.
// ---------------------------------------------------------------------------

/** Append-only usage log. Pruned after ANALYTICS_RETENTION_DAYS. */
export const analyticsEvent = sqliteTable(
  "analytics_event",
  {
    id: text("id").primaryKey(),
    /** Stable event name, e.g. `webhook_delivered`. See lib/analytics.ts. */
    name: text("name").notNull(),
    userId: text("user_id"),
    serviceId: text("service_id"),
    deviceId: text("device_id"),
    /** Billing plan observed when the event happened: `free` or `pro`. */
    plan: text("plan"),
    /** Coarse outcome bucket, e.g. `accepted`, `no_devices`, `push_rejected`. */
    outcome: text("outcome"),
    /** Counter carried by the event, e.g. accepted pushes. */
    value: integer("value").notNull().default(0),
    /** Small JSON object of primitives. Capped in size; never free-form content. */
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("analytics_event_name_created_at_idx").on(table.name, table.createdAt),
    index("analytics_event_user_created_at_idx").on(table.userId, table.createdAt),
    index("analytics_event_created_at_idx").on(table.createdAt),
  ],
);

/** Tiny idempotent rollup keyed by UTC day plus metric name. Kept indefinitely. */
export const analyticsDaily = sqliteTable(
  "analytics_daily",
  {
    /** UTC date as `YYYY-MM-DD`. */
    day: text("day").notNull(),
    /** Event name, or `<name>:value` for the summed counter. */
    metric: text("metric").notNull(),
    value: integer("value").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("analytics_daily_day_metric_unique").on(table.day, table.metric)],
);

/** One row per user per UTC day of activity, so DAU/WAU/MAU is a cheap count. */
export const analyticsUserDay = sqliteTable(
  "analytics_user_day",
  {
    userId: text("user_id").notNull(),
    day: text("day").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("analytics_user_day_user_day_unique").on(table.userId, table.day),
    index("analytics_user_day_day_idx").on(table.day),
  ],
);

// ---------------------------------------------------------------------------
// SHark board (fork-only). Durable asks, work items, and notes written by
// agent tokens and answered only by the captain's session. These tables
// reference upstream tables but never alter their columns.
// ---------------------------------------------------------------------------

/** A question for the captain that outlives any push sent for it. */
export const boardAsk = sqliteTable(
  "board_ask",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requesterTokenId: text("requester_token_id").references(() => apiToken.id, {
      onDelete: "set null",
    }),
    /** Snapshot of `api_token.name` at create time, like `inbox_item.source_name`. */
    agentLabel: text("agent_label").notNull(),
    /** Agent-declared sub-identity; displayed, never trusted. */
    agentDisplay: text("agent_display"),
    askKey: text("ask_key").notNull(),
    revision: integer("revision").notNull().default(1),
    title: text("title").notNull(),
    body: text("body"),
    kind: text("kind").notNull(),
    options: text("options", { mode: "json" })
      .$type<Array<{ id: string; label: string; style: string }>>()
      .notNull(),
    allowText: integer("allow_text", { mode: "boolean" }).notNull().default(false),
    allowLater: integer("allow_later", { mode: "boolean" }).notNull().default(true),
    priority: text("priority").notNull().default("p1"),
    waitingTaskId: text("waiting_task_id"),
    links: text("links", { mode: "json" })
      .$type<Array<{ kind: string; url: string; label?: string }>>()
      .notNull(),
    status: text("status").notNull().default("open"),
    snoozeUntil: integer("snooze_until", { mode: "timestamp_ms" }),
    /** Null: persists until answered or cancelled. */
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    answerOptionId: text("answer_option_id"),
    answerText: text("answer_text"),
    answeredAt: integer("answered_at", { mode: "timestamp_ms" }),
    answeredVia: text("answered_via"),
    answeredByDeviceId: text("answered_by_device_id").references(() => device.id, {
      onDelete: "set null",
    }),
    /** Domain-separated hash of the answering session id; never the raw id. */
    answeredSessionHash: text("answered_session_hash"),
    cancelReason: text("cancel_reason"),
    /** sha256 over the user-visible fields of the current revision. */
    actionDigest: text("action_digest").notNull(),
    pushNotificationId: text("push_notification_id").references(() => agentNotification.id, {
      onDelete: "set null",
    }),
    callbackUrl: text("callback_url"),
    callbackTokenCiphertext: text("callback_token_ciphertext"),
    callbackStatus: text("callback_status"),
    callbackAttempts: integer("callback_attempts").notNull().default(0),
    callbackNextAttemptAt: integer("callback_next_attempt_at", { mode: "timestamp_ms" }),
    callbackLastError: text("callback_last_error"),
    callbackDeliveredAt: integer("callback_delivered_at", { mode: "timestamp_ms" }),
    /** Set when the terminal status still needs to reach the agent (callback or poll). */
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    ackedAt: integer("acked_at", { mode: "timestamp_ms" }),
    lastAssertedAt: integer("last_asserted_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("board_ask_open_key_unique")
      .on(table.userId, table.askKey)
      .where(sql`${table.status} = 'open'`),
    index("board_ask_user_status_idx").on(
      table.userId,
      table.status,
      table.priority,
      table.createdAt,
    ),
    index("board_ask_token_resolved_idx").on(table.requesterTokenId, table.resolvedAt),
    index("board_ask_callback_due_idx").on(table.callbackStatus, table.callbackNextAttemptAt),
    index("board_ask_expiry_idx").on(table.status, table.expiresAt),
  ],
);

/** Append-only audit and delivery log for one ask. */
export const boardAskEvent = sqliteTable(
  "board_ask_event",
  {
    id: text("id").primaryKey(),
    askId: text("ask_id")
      .notNull()
      .references(() => boardAsk.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    kind: text("kind").notNull(),
    actorType: text("actor_type").notNull(),
    actorRef: text("actor_ref"),
    revision: integer("revision").notNull(),
    detail: text("detail"),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("board_ask_event_dedupe_unique").on(table.askId, table.dedupeKey),
    index("board_ask_event_ask_occurred_idx").on(table.askId, table.occurredAt),
  ],
);

/** Queued, in-flight, and recently finished work, one row per agent work key. */
export const boardWorkItem = sqliteTable(
  "board_work_item",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requesterTokenId: text("requester_token_id").references(() => apiToken.id, {
      onDelete: "set null",
    }),
    agentLabel: text("agent_label").notNull(),
    agentDisplay: text("agent_display"),
    workKey: text("work_key").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(),
    statusLabel: text("status_label"),
    detail: text("detail"),
    progress: real("progress"),
    links: text("links", { mode: "json" })
      .$type<Array<{ kind: string; url: string; label?: string }>>()
      .notNull(),
    host: text("host"),
    waitingAskId: text("waiting_ask_id").references(() => boardAsk.id, { onDelete: "set null" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    lastHeartbeatAt: integer("last_heartbeat_at", { mode: "timestamp_ms" }).notNull(),
    heartbeatTtlSeconds: integer("heartbeat_ttl_seconds").notNull().default(21_600),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    completionVerb: text("completion_verb"),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("board_work_item_user_key_unique").on(table.userId, table.workKey),
    index("board_work_item_user_state_idx").on(table.userId, table.state, table.completedAt),
    index("board_work_item_token_idx").on(table.requesterTokenId),
  ],
);

/** Heads-up notes that are not tied to a task. */
export const boardNote = sqliteTable(
  "board_note",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requesterTokenId: text("requester_token_id").references(() => apiToken.id, {
      onDelete: "set null",
    }),
    agentLabel: text("agent_label").notNull(),
    agentDisplay: text("agent_display"),
    noteKey: text("note_key").notNull(),
    text: text("text").notNull(),
    detail: text("detail"),
    link: text("link"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("board_note_user_key_unique").on(table.userId, table.noteKey),
    index("board_note_user_idx").on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// OAuth provider (Better Auth `@better-auth/oauth-provider`) for the MCP server
// ---------------------------------------------------------------------------

/** Registered OAuth clients, mostly MCP clients from dynamic registration. */
export const oauthClient = sqliteTable(
  "oauth_client",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    disabled: integer("disabled", { mode: "boolean" }).default(false),
    skipConsent: integer("skip_consent", { mode: "boolean" }),
    enableEndSession: integer("enable_end_session", { mode: "boolean" }),
    subjectType: text("subject_type"),
    /** JSON string array (the adapter serializes arrays on SQLite). */
    scopes: text("scopes"),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts"),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris"),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    grantTypes: text("grant_types"),
    responseTypes: text("response_types"),
    public: integer("public", { mode: "boolean" }),
    type: text("type"),
    requirePKCE: integer("require_pkce", { mode: "boolean" }),
    referenceId: text("reference_id"),
    metadata: text("metadata"),
  },
  (table) => [index("oauth_client_user_idx").on(table.userId)],
);

/** Hashed opaque refresh tokens (`offline_access`); rotated on every use. */
export const oauthRefreshToken = sqliteTable(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    revoked: integer("revoked", { mode: "timestamp_ms" }),
    authTime: integer("auth_time", { mode: "timestamp_ms" }),
    scopes: text("scopes").notNull(),
  },
  (table) => [
    index("oauth_refresh_token_client_idx").on(table.clientId),
    index("oauth_refresh_token_session_idx").on(table.sessionId),
    index("oauth_refresh_token_user_idx").on(table.userId),
  ],
);

/** Hashed opaque access tokens. `/mcp` looks them up on every request. */
export const oauthAccessToken = sqliteTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    token: text("token").unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    refreshId: text("refresh_id").references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    scopes: text("scopes").notNull(),
  },
  (table) => [
    index("oauth_access_token_client_idx").on(table.clientId),
    index("oauth_access_token_session_idx").on(table.sessionId),
    index("oauth_access_token_user_idx").on(table.userId),
    index("oauth_access_token_refresh_idx").on(table.refreshId),
  ],
);

/** Remembered consent per user and client; the scopes granted last time. */
export const oauthConsent = sqliteTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    scopes: text("scopes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("oauth_consent_client_idx").on(table.clientId),
    index("oauth_consent_user_idx").on(table.userId),
  ],
);
