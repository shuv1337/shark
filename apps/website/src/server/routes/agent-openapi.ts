import {
  API_TOKEN_SCOPES,
  type ApiTokenScope,
  agentNotificationCreateSchema,
  appCreateSchema,
  appUpdateSchema,
  INBOX_ACTIVITY_KINDS,
  INBOX_PAGE_MAX_LIMIT,
  INTERACTION_KINDS,
  INTERACTION_STATUSES,
  inboxMarkAllReadSchema,
  interactionCreateSchema,
  LIVE_ACTIVITY_STATUSES,
  liveActivityEndSchema,
  liveActivityStartSchema,
  liveActivityUpdateSchema,
  serviceCreateSchema,
  serviceUpdateSchema,
} from "@hark/contracts";
import { Hono } from "hono";
import { z } from "zod";

/**
 * Hand-maintained OpenAPI 3.1 description of every `/api/agent/**` route.
 *
 * Request bodies are generated from the zod contracts the routes validate
 * with, so they cannot drift from the server's parsing. Response shapes are
 * written by hand from the DTOs in `@hark/contracts`. `agent-openapi.test.ts`
 * fails when a registered agent route is missing here (or vice versa).
 */

type JsonSchema = Record<string, unknown>;

function requestSchema(schema: z.ZodType): JsonSchema {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as JsonSchema;
  return json;
}

const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` });
const str: JsonSchema = { type: "string" };
const nullableStr: JsonSchema = { type: ["string", "null"] };
const dateTime: JsonSchema = { type: "string", format: "date-time" };
const nullableDateTime: JsonSchema = { type: ["string", "null"], format: "date-time" };
const int: JsonSchema = { type: "integer" };
const bool: JsonSchema = { type: "boolean" };
const arrayOf = (items: JsonSchema): JsonSchema => ({ type: "array", items });

function object(properties: Record<string, JsonSchema>, optional: string[] = []): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
  };
}

const ok = object({ ok: { const: true } });

const schemas: Record<string, JsonSchema> = {
  Error: object({ error: str, code: str, issues: {}, required: arrayOf(str) }, [
    "code",
    "issues",
    "required",
  ]),
  Ok: ok,
  TokenStatus: object({
    authenticated: { const: true },
    token: object({
      id: str,
      name: str,
      prefix: str,
      scopes: arrayOf(ref("Scope")),
      createdAt: dateTime,
      lastUsedAt: nullableDateTime,
      expiresAt: nullableDateTime,
    }),
  }),
  Scope: { type: "string", enum: [...API_TOKEN_SCOPES] },
  ApiToken: object({
    id: str,
    name: str,
    prefix: { ...str, description: "Identifying prefix only; secrets are never returned." },
    scopes: arrayOf(ref("Scope")),
    expiresAt: nullableDateTime,
    lastUsedAt: nullableDateTime,
    createdAt: dateTime,
    revokedAt: nullableDateTime,
  }),
  Device: object({
    id: str,
    platform: { const: "ios" },
    deviceName: nullableStr,
    active: bool,
    liveActivitiesCapable: bool,
    liveActivityTokenEnvironment: { enum: ["sandbox", "production", null] },
    liveActivityTokenUpdatedAt: nullableDateTime,
    interactiveLiveActivitiesCapable: bool,
    createdAt: dateTime,
    lastSeenAt: dateTime,
  }),
  AgentService: object({
    id: str,
    title: str,
    imageUrl: nullableStr,
    url: nullableStr,
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  ServiceCreated: object({
    service: {
      allOf: [ref("AgentService"), object({ webhookUrl: nullableStr })],
    },
    webhookUrl: {
      ...str,
      description: "Full webhook URL containing the plaintext token. Returned once.",
    },
  }),
  Event: object({
    id: str,
    serviceId: str,
    serviceTitle: str,
    title: nullableStr,
    body: str,
    imageUrl: nullableStr,
    url: nullableStr,
    status: str,
    deliveredCount: int,
    error: nullableStr,
    createdAt: dateTime,
  }),
  AgentNotification: object(
    {
      id: str,
      title: str,
      body: str,
      imageUrl: nullableStr,
      url: nullableStr,
      createdAt: dateTime,
      projectId: nullableStr,
      summary: nullableStr,
      bodyFormat: { enum: ["text", "markdown"] },
      appId: str,
    },
    ["projectId", "summary", "bodyFormat", "appId"],
  ),
  AgentNotificationCreated: object(
    {
      notification: ref("AgentNotification"),
      accepted: int,
      idempotent: bool,
      message: str,
    },
    ["idempotent", "message"],
  ),
  AgentNotificationWithdrawn: object({
    ok: { const: true },
    notificationId: str,
    status: { enum: ["withdrawn", "withdraw_partial"] },
    accepted: int,
  }),
  Interaction: object({
    id: str,
    title: str,
    prompt: str,
    kind: { enum: [...INTERACTION_KINDS] },
    presentation: { enum: ["notification", "live_activity"] },
    status: { enum: [...INTERACTION_STATUSES] },
    choices: arrayOf(str),
    response: nullableStr,
    imageUrl: nullableStr,
    url: nullableStr,
    actionDigest: str,
    primaryLabel: nullableStr,
    secondaryLabel: nullableStr,
    accepted: int,
    respondingDeviceId: nullableStr,
    expiresAt: dateTime,
    createdAt: dateTime,
    respondedAt: nullableDateTime,
    canceledAt: nullableDateTime,
  }),
  InboxInteraction: {
    allOf: [
      ref("Interaction"),
      object({ sourceName: str, sourceImageUrl: nullableStr, projectId: nullableStr }, [
        "projectId",
      ]),
    ],
  },
  InteractionCreated: object(
    {
      interaction: ref("Interaction"),
      accepted: int,
      idempotent: bool,
      liveActivityId: str,
      message: str,
    },
    ["idempotent", "liveActivityId", "message"],
  ),
  LiveActivity: object({
    id: str,
    key: nullableStr,
    props: { type: "object", description: "LiveActivityProps (title, status, progress, …)." },
    status: { enum: [...LIVE_ACTIVITY_STATUSES] },
    sequence: int,
    accepted: int,
    failed: int,
    expiresAt: dateTime,
    createdAt: dateTime,
    updatedAt: dateTime,
    endedAt: nullableDateTime,
  }),
  LiveActivityMutation: object(
    {
      activity: ref("LiveActivity"),
      accepted: int,
      failed: int,
      replaced: int,
      idempotent: bool,
      message: str,
    },
    ["replaced", "idempotent", "message"],
  ),
  AppSummary: object({ id: str, name: str, origin: str, iconUrl: nullableStr }),
  App: {
    allOf: [
      ref("AppSummary"),
      object({
        url: str,
        projectId: nullableStr,
        projectName: nullableStr,
        shareName: bool,
        shareEmail: bool,
        consentedAt: nullableDateTime,
        lastOpenedAt: nullableDateTime,
        createdBy: nullableStr,
        createdAt: dateTime,
        updatedAt: dateTime,
      }),
    ],
  },
  InboxProjects: object({
    projects: arrayOf(
      object({
        projectId: nullableStr,
        name: str,
        unreadCount: int,
        totalCount: int,
        latestTitle: nullableStr,
        latestPreview: nullableStr,
        latestImageUrl: nullableStr,
        latestAt: nullableDateTime,
      }),
    ),
    totalUnread: int,
  }),
  InboxNotificationSummary: object({
    id: { ...str, description: "Composite ID: `event:<id>` or `notification:<id>`." },
    origin: { enum: ["event", "notification"] },
    projectId: nullableStr,
    projectName: nullableStr,
    sourceName: str,
    sourceImageUrl: nullableStr,
    title: str,
    preview: str,
    url: nullableStr,
    bodyFormat: { enum: ["text", "markdown"] },
    readAt: nullableDateTime,
    createdAt: dateTime,
    app: { anyOf: [ref("AppSummary"), { type: "null" }] },
  }),
  InboxNotificationPage: object({
    items: arrayOf(ref("InboxNotificationSummary")),
    nextCursor: nullableStr,
    readThroughToken: str,
  }),
  InboxNotificationDetail: {
    allOf: [
      ref("InboxNotificationSummary"),
      object({ body: str, summary: nullableStr, status: nullableStr }),
    ],
  },
  ReadMark: object({ ok: { const: true }, readAt: nullableDateTime, idempotent: bool }, [
    "idempotent",
  ]),
  ActivityFeedPage: object({
    items: arrayOf(
      object({
        id: str,
        kind: { enum: [...INBOX_ACTIVITY_KINDS] },
        sourceName: str,
        sourceImageUrl: nullableStr,
        title: str,
        detail: nullableStr,
        url: nullableStr,
        result: nullableStr,
        createdAt: dateTime,
      }),
    ),
    page: int,
    pageSize: int,
    total: int,
  }),
  Billing: object({
    configured: bool,
    plan: { enum: ["free", "pro"] },
    priceMonthly: { type: "number" },
    features: object({ deviceRouting: bool }),
    limits: object({
      devices: { type: ["integer", "null"] },
      notificationsPerMonth: int,
      servicePerMinute: int,
      accountPerMinute: int,
    }),
    usage: object({ notificationsRemaining: { type: ["integer", "null"] } }),
  }),
};

interface Operation {
  summary: string;
  /** Scopes the token must hold; empty means any valid agent token. */
  scopes: ApiTokenScope[];
  request?: z.ZodType;
  params?: Array<{ name: string; in: "path" | "query" | "header"; schema: JsonSchema }>;
  /** Successful status and its response schema. */
  status?: 200 | 201;
  response: JsonSchema;
  description?: string;
}

const idParam = (name = "id") => ({ name, in: "path" as const, schema: str });
const idempotencyHeader = { name: "Idempotency-Key", in: "header" as const, schema: str };
const wrap = (key: string, schema: JsonSchema) => object({ [key]: schema });

const operations: Record<
  string,
  Partial<Record<"get" | "post" | "patch" | "delete", Operation>>
> = {
  "/auth/status": {
    get: { summary: "Describe the calling token", scopes: [], response: ref("TokenStatus") },
  },
  "/auth/revoke": {
    post: { summary: "Revoke the calling token", scopes: [], response: ok },
  },
  "/tokens": {
    get: {
      summary: "List the account's API tokens (never secrets)",
      scopes: ["tokens:manage"],
      response: wrap("tokens", arrayOf(ref("ApiToken"))),
      description:
        "There is no create route: an agent token cannot mint tokens, so it can never escalate its own scopes or outlive its revocation. Create tokens from a signed-in session or `harkctl auth login`.",
    },
  },
  "/tokens/{id}": {
    delete: {
      summary: "Revoke another token of the same account",
      scopes: ["tokens:manage"],
      params: [idParam()],
      response: ok,
    },
  },
  "/devices": {
    get: {
      summary: "List registered devices",
      scopes: ["devices:read"],
      response: wrap("devices", arrayOf(ref("Device"))),
      description: "Registration is phone-only: only the Hark app holds a push token.",
    },
  },
  "/devices/{id}": {
    delete: {
      summary: "Remove a device; it registers again when Hark next opens on it",
      scopes: ["devices:write"],
      params: [idParam()],
      response: ok,
    },
  },
  "/services": {
    get: {
      summary: "List webhook services (without webhook URLs)",
      scopes: ["services:read"],
      response: wrap("services", arrayOf(ref("AgentService"))),
    },
    post: {
      summary: "Create a webhook service; the webhook URL is returned once",
      scopes: ["services:write"],
      request: serviceCreateSchema,
      status: 201,
      response: ref("ServiceCreated"),
    },
  },
  "/services/{id}": {
    get: {
      summary: "Get a webhook service",
      scopes: ["services:read"],
      params: [idParam()],
      response: wrap("service", ref("AgentService")),
    },
    patch: {
      summary: "Update a webhook service's title, avatar, or tap URL",
      scopes: ["services:write"],
      params: [idParam()],
      request: serviceUpdateSchema,
      response: wrap("service", ref("AgentService")),
    },
    delete: {
      summary: "Delete a webhook service",
      scopes: ["services:write"],
      params: [idParam()],
      response: ok,
    },
  },
  "/services/{id}/rotate": {
    post: {
      summary: "Rotate the webhook token; the new URL is returned once",
      scopes: ["services:write"],
      params: [idParam()],
      response: ref("ServiceCreated"),
    },
  },
  "/events": {
    get: {
      summary: "Recent webhook deliveries",
      scopes: ["events:read"],
      params: [{ name: "limit", in: "query", schema: { ...int, minimum: 1, maximum: 100 } }],
      response: wrap("events", arrayOf(ref("Event"))),
    },
  },
  "/activity-feed": {
    get: {
      summary: "Merged account activity history, newest first (20 per page)",
      scopes: ["events:read"],
      params: [
        { name: "filter", in: "query", schema: { enum: ["all", ...INBOX_ACTIVITY_KINDS] } },
        { name: "page", in: "query", schema: { ...int, minimum: 0 } },
      ],
      response: ref("ActivityFeedPage"),
    },
  },
  "/notifications": {
    post: {
      summary: "Send a one-shot push",
      scopes: ["notifications:send"],
      params: [idempotencyHeader],
      request: agentNotificationCreateSchema,
      status: 201,
      response: ref("AgentNotificationCreated"),
    },
  },
  "/notifications/{id}/withdraw": {
    post: {
      summary: "Withdraw an agent notification from the account's devices",
      scopes: ["notifications:send"],
      params: [idParam()],
      response: ref("AgentNotificationWithdrawn"),
      description:
        "Sends a silent command that removes the push from Notification Center and marks the inbox copy read. Accepts `anot_…` or `notification:anot_…`. Returns 502 when no device accepted the command.",
    },
  },
  "/interactions": {
    get: {
      summary: "List the account's pending prompts from every source",
      scopes: ["interactions:read"],
      response: wrap("interactions", arrayOf(ref("InboxInteraction"))),
      description:
        "There is deliberately no agent route that answers a prompt: approvals come only from a human on the phone or a signed-in session.",
    },
    post: {
      summary: "Ask a question (approval, yes/no, or reply)",
      scopes: ["interactions:create", "notifications:send"],
      params: [idempotencyHeader],
      request: interactionCreateSchema,
      status: 201,
      response: ref("InteractionCreated"),
    },
  },
  "/interactions/{id}": {
    get: {
      summary: "Get a prompt created by this token",
      scopes: ["interactions:read"],
      params: [idParam()],
      response: wrap("interaction", ref("Interaction")),
    },
  },
  "/interactions/{id}/wait": {
    get: {
      summary: "Long-poll a prompt created by this token until it is answered",
      scopes: ["interactions:read"],
      params: [
        idParam(),
        { name: "timeout", in: "query", schema: { type: "number", minimum: 0, maximum: 25 } },
      ],
      response: object({ interaction: ref("Interaction"), timedOut: bool }),
    },
  },
  "/interactions/{id}/cancel": {
    post: {
      summary: "Cancel a pending prompt created by this token",
      scopes: ["interactions:create"],
      params: [idParam()],
      response: wrap("interaction", ref("Interaction")),
    },
  },
  "/activities": {
    get: {
      summary: "List Live Activities started by this token",
      scopes: ["activities:read"],
      params: [{ name: "limit", in: "query", schema: { ...int, minimum: 1, maximum: 100 } }],
      response: wrap("activities", arrayOf(ref("LiveActivity"))),
    },
    post: {
      summary: "Start a Live Activity",
      scopes: ["activities:write"],
      params: [idempotencyHeader],
      request: liveActivityStartSchema,
      status: 201,
      response: ref("LiveActivityMutation"),
    },
  },
  "/activities/{identifier}": {
    get: {
      summary: "Get a Live Activity by ID or key",
      scopes: ["activities:read"],
      params: [idParam("identifier")],
      response: wrap("activity", ref("LiveActivity")),
    },
    patch: {
      summary: "Update a Live Activity",
      scopes: ["activities:write"],
      params: [idParam("identifier"), idempotencyHeader],
      request: liveActivityUpdateSchema,
      response: ref("LiveActivityMutation"),
    },
  },
  "/activities/{identifier}/end": {
    post: {
      summary: "End a Live Activity",
      scopes: ["activities:write"],
      params: [idParam("identifier"), idempotencyHeader],
      request: liveActivityEndSchema,
      response: ref("LiveActivityMutation"),
    },
  },
  "/apps": {
    get: {
      summary: "List web apps",
      scopes: ["apps:read"],
      response: wrap("apps", arrayOf(ref("App"))),
    },
    post: {
      summary: "Register a web app (an existing URL is updated)",
      scopes: ["apps:write"],
      request: appCreateSchema,
      status: 201,
      response: object({ app: ref("App"), created: bool, message: str }, ["message"]),
    },
  },
  "/apps/{id}": {
    get: {
      summary: "Get a web app",
      scopes: ["apps:read"],
      params: [idParam()],
      response: wrap("app", ref("App")),
    },
    patch: {
      summary: "Update a web app's name, URL, icon, or project",
      scopes: ["apps:write"],
      params: [idParam()],
      request: appUpdateSchema,
      response: object({ app: ref("App"), message: str }, ["message"]),
      description:
        "Sharing preferences and sign-in consent are owner decisions made on the phone and cannot be changed here. Moving the URL to a new origin clears consent.",
    },
    delete: {
      summary: "Remove a web app",
      scopes: ["apps:write"],
      params: [idParam()],
      response: ok,
    },
  },
  "/apps/{id}/revoke": {
    post: {
      summary: "Revoke sign-in consent; the owner approves again on next open",
      scopes: ["apps:write"],
      params: [idParam()],
      response: wrap("app", ref("App")),
      description: "Agents can reduce access but never grant it: Hark passes are phone-only.",
    },
  },
  "/inbox/projects": {
    get: {
      summary: "Inbox projects with unread counts",
      scopes: ["inbox:read"],
      response: ref("InboxProjects"),
    },
  },
  "/inbox/notifications": {
    get: {
      summary: "Inbox notifications, newest first, with cursor pagination",
      scopes: ["inbox:read"],
      params: [
        {
          name: "limit",
          in: "query",
          schema: { ...int, minimum: 1, maximum: INBOX_PAGE_MAX_LIMIT },
        },
        {
          name: "project",
          in: "query",
          schema: { ...str, description: "Project ID, or `unfiled`." },
        },
        { name: "unread", in: "query", schema: { enum: ["1", "true"] } },
        { name: "cursor", in: "query", schema: str },
      ],
      response: ref("InboxNotificationPage"),
    },
  },
  "/inbox/notifications/{id}": {
    get: {
      summary: "One inbox notification with its full body",
      scopes: ["inbox:read"],
      params: [idParam()],
      response: wrap("notification", ref("InboxNotificationDetail")),
    },
  },
  "/inbox/notifications/read-all": {
    post: {
      summary: "Mark everything up to a list response's readThroughToken read",
      scopes: ["inbox:write"],
      request: inboxMarkAllReadSchema,
      response: object({ ok: { const: true }, updated: int }),
    },
  },
  "/inbox/notifications/{id}/read": {
    post: {
      summary: "Mark one notification read",
      scopes: ["inbox:write"],
      params: [idParam()],
      response: ref("ReadMark"),
    },
  },
  "/inbox/notifications/{id}/unread": {
    post: {
      summary: "Mark one notification unread",
      scopes: ["inbox:write"],
      params: [idParam()],
      response: ref("ReadMark"),
    },
  },
  "/billing": {
    get: {
      summary: "Plan, limits, and remaining usage",
      scopes: ["billing:read"],
      response: ref("Billing"),
      description: "Checkout and the billing portal are session-only.",
    },
  },
};

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ref("Error") } },
});

function toPathItem(path: string): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  for (const [method, operation] of Object.entries(operations[path] ?? {})) {
    if (!operation) continue;
    const status = String(operation.status ?? 200);
    item[method] = {
      summary: operation.summary,
      ...(operation.description ? { description: operation.description } : {}),
      operationId: `${method}${path.replace(/[{}]/g, "").replace(/[/-](\w)/g, (_, c: string) => c.toUpperCase())}`,
      security: [{ bearer: operation.scopes }],
      "x-hark-scopes": operation.scopes,
      ...(operation.params
        ? {
            parameters: operation.params.map((param) => ({
              ...param,
              required: param.in === "path",
            })),
          }
        : {}),
      ...(operation.request
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: requestSchema(operation.request) } },
            },
          }
        : {}),
      responses: {
        [status]: {
          description: "Success",
          content: { "application/json": { schema: operation.response } },
        },
        "400": errorResponse("Invalid request"),
        "401": errorResponse("Missing, unknown, revoked, or expired token"),
        "403": errorResponse("The token lacks a required scope"),
        "404": errorResponse("Not found for this account"),
      },
    };
  }
  return item;
}

export const AGENT_API_PREFIX = "/api/agent";

export const agentOpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Hark Agent API",
    version: "1.0.0",
    description:
      "Scoped bearer-token API for agents and scripts (`Authorization: Bearer hark_…`). Every route is owner-scoped: resources of other accounts return 404. Human-only actions are deliberately absent: answering prompts, approving app sign-in or issuing Hark passes, changing app sharing, creating API tokens, registering devices, and starting checkout or the billing portal.",
  },
  servers: [{ url: AGENT_API_PREFIX }],
  components: {
    securitySchemes: {
      bearer: {
        type: "http",
        scheme: "bearer",
        description: "A Hark agent token from `harkctl auth login` or the dashboard.",
      },
    },
    schemas,
  },
  paths: Object.fromEntries(Object.keys(operations).map((path) => [path, toPathItem(path)])),
  "x-hark-scopes": [...API_TOKEN_SCOPES],
};

/** Public, unauthenticated discovery document. Mount before the agent routes. */
export const agentOpenApiRoute = new Hono().get("/openapi.json", (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.json(agentOpenApiDocument);
});
