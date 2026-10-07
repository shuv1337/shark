import {
  API_ERROR_CODE_NOT_FOUND,
  type AppSummaryDto,
  INBOX_PAGE_MAX_LIMIT,
  INBOX_PREVIEW_MAX_CHARS,
  INBOX_UNFILED_PROJECT,
  INBOX_UNFILED_PROJECT_NAME,
  type InboxNotificationDetailDto,
  type InboxNotificationOrigin,
  type InboxNotificationPageDto,
  type InboxNotificationSummaryDto,
  type InboxProjectSummaryDto,
  type InboxProjectsDto,
  inboxMarkAllReadSchema,
  type NotificationBodyFormat,
} from "@hark/contracts";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { agentNotification, app, event, project, service } from "../db/schema";
import { toAppSummaryDto } from "../lib/apps";
import {
  type AgentEnv,
  type AuthedEnv,
  requireApiToken,
  requireAuth,
  requireScopes,
} from "../middleware";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface CompositeId {
  origin: InboxNotificationOrigin;
  id: string;
}

/** Parses `event:<id>` / `notification:<id>`; anything else is treated as unknown. */
function parseCompositeId(value: string): CompositeId | null {
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const origin = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (id.length === 0 || id.length > 100) return null;
  if (origin !== "event" && origin !== "notification") return null;
  return { origin, id };
}

/** Single-line preview bounded in code points; the full body never leaves the detail route. */
function boundPreview(raw: string, sourceLength: number): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const characters = Array.from(collapsed);
  if (sourceLength <= INBOX_PREVIEW_MAX_CHARS && characters.length <= INBOX_PREVIEW_MAX_CHARS) {
    return collapsed;
  }
  const clipped = characters
    .slice(0, INBOX_PREVIEW_MAX_CHARS - 1)
    .join("")
    .trimEnd();
  return `${clipped}…`;
}

function toBodyFormat(value: string | null): NotificationBodyFormat {
  return value === "markdown" ? "markdown" : "text";
}

function toIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

interface CursorPosition {
  createdAt: number;
  id: string;
}

function encodeCursor(position: CursorPosition): string {
  return Buffer.from(`${position.createdAt}:${position.id}`, "utf8").toString("base64url");
}

function decodeCursor(value: string): CursorPosition | null {
  if (value.length === 0 || value.length > 300) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator <= 0) return null;
  const createdAt = Number.parseInt(decoded.slice(0, separator), 10);
  const id = decoded.slice(separator + 1);
  if (!Number.isFinite(createdAt) || createdAt < 0 || !parseCompositeId(id)) return null;
  return { createdAt, id };
}

// ---------------------------------------------------------------------------
// Read-through tokens
//
// Mark-all-read must never touch a notification the client has not observed.
// Timestamps cannot express that boundary: two rows inserted in the same
// millisecond are indistinguishable, so a `createdAt <=` bound could mark a
// concurrent arrival read. SQLite rowids are strictly monotonic per table
// while a database lives (both source tables are ordinary rowid tables that
// only ever insert), so the pair of per-table maximum rowids observed at
// response time is an exact high-water snapshot: any row inserted later has
// a higher rowid even when its timestamp ties.
//
// The token is opaque to clients and is never trusted for scope: it only
// carries the two rowid bounds, while ownership and the requested project
// filter are always re-applied in SQL. A forged token can therefore at most
// mark the caller's own rows read.
// ---------------------------------------------------------------------------

interface ReadThroughSnapshot {
  /** Maximum `event` rowid observed for the scope; 0 when the scope is empty. */
  event: number;
  /** Maximum `agent_notification` rowid observed for the scope; 0 when empty. */
  notification: number;
}

const READ_THROUGH_VERSION = "rt1";
const READ_THROUGH_TOKEN_MAX_LENGTH = 200;

function encodeReadThroughToken(snapshot: ReadThroughSnapshot): string {
  return Buffer.from(
    `${READ_THROUGH_VERSION}:${snapshot.event}:${snapshot.notification}`,
    "utf8",
  ).toString("base64url");
}

/** A rowid bound: a plain non-negative decimal integer within safe range. */
function parseRowidBound(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,15}$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function decodeReadThroughToken(value: string): ReadThroughSnapshot | null {
  // Node's base64url decoder silently skips foreign characters, so the shape
  // is checked before decoding instead of relying on a decode failure.
  if (value.length === 0 || value.length > READ_THROUGH_TOKEN_MAX_LENGTH) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  const parts = decoded.split(":");
  if (parts.length !== 3 || parts[0] !== READ_THROUGH_VERSION) return null;
  const event = parseRowidBound(parts[1]);
  const notification = parseRowidBound(parts[2]);
  if (event === null || notification === null) return null;
  return { event, notification };
}

/**
 * Per-table maximum rowids currently visible to `userId` under the optional
 * project filter. Read before the page query so the snapshot never covers a
 * row the accompanying response could have missed.
 */
function readThroughSnapshot(
  userId: string,
  projectParam: string | undefined,
): ReadThroughSnapshot {
  const eventFilters = [sql`s.user_id = ${userId}`];
  const agentFilters = [sql`n.user_id = ${userId}`];
  if (projectParam === INBOX_UNFILED_PROJECT) {
    eventFilters.push(sql`e.project_id is null`);
    agentFilters.push(sql`n.project_id is null`);
  } else if (projectParam !== undefined) {
    eventFilters.push(sql`e.project_id = ${projectParam}`);
    agentFilters.push(sql`n.project_id = ${projectParam}`);
  }
  const [row] = db.all(sql`
    select
      (
        select coalesce(max(e.rowid), 0)
        from event e
        inner join service s on s.id = e.service_id
        where ${sql.join(eventFilters, sql` and `)}
      ) as eventMax,
      (
        select coalesce(max(n.rowid), 0)
        from agent_notification n
        where ${sql.join(agentFilters, sql` and `)}
      ) as agentMax
  `) as Array<{ eventMax: number; agentMax: number }>;
  return { event: row?.eventMax ?? 0, notification: row?.agentMax ?? 0 };
}

// The bounded projection both list endpoints read. Raw SQL keeps the union
// in one round trip and guarantees only a preview-sized slice of the body is
// ever selected for lists.
function notificationUnionSql(userId: string) {
  return sql`
    select
      'event:' || e.id as id,
      'event' as origin,
      e.project_id as project_id,
      s.title as source_name,
      coalesce(e.image_url, s.image_url) as source_image_url,
      e.title as title,
      substr(coalesce(e.summary, e.body), 1, 320) as raw_preview,
      length(coalesce(e.summary, e.body)) as content_length,
      e.url as url,
      e.body_format as body_format,
      e.read_at as read_at,
      e.created_at as created_at,
      a.id as app_id,
      a.name as app_name,
      a.origin as app_origin,
      a.icon_url as app_icon_url
    from event e
    inner join service s on s.id = e.service_id
    left join app a on a.id = e.app_id and a.user_id = ${userId}
    where s.user_id = ${userId}

    union all

    select
      'notification:' || n.id as id,
      'notification' as origin,
      n.project_id as project_id,
      t.name as source_name,
      n.image_url as source_image_url,
      n.title as title,
      substr(coalesce(n.summary, n.body), 1, 320) as raw_preview,
      length(coalesce(n.summary, n.body)) as content_length,
      n.url as url,
      n.body_format as body_format,
      n.read_at as read_at,
      n.created_at as created_at,
      a.id as app_id,
      a.name as app_name,
      a.origin as app_origin,
      a.icon_url as app_icon_url
    from agent_notification n
    inner join api_token t on t.id = n.requester_token_id
    left join app a on a.id = n.app_id and a.user_id = ${userId}
    where n.user_id = ${userId}
  `;
}

interface NotificationRow {
  id: string;
  origin: InboxNotificationOrigin;
  projectId: string | null;
  sourceName: string;
  sourceImageUrl: string | null;
  title: string;
  rawPreview: string;
  contentLength: number;
  url: string | null;
  bodyFormat: string | null;
  readAt: number | null;
  createdAt: number;
  appId: string | null;
  appName: string | null;
  appOrigin: string | null;
  appIconUrl: string | null;
}

function rowAppSummary(row: NotificationRow): AppSummaryDto | null {
  if (row.appId === null || row.appName === null || row.appOrigin === null) return null;
  return { id: row.appId, name: row.appName, origin: row.appOrigin, iconUrl: row.appIconUrl };
}

/** Owner-scoped app summary for detail routes; deleted apps resolve to null. */
async function appSummaryFor(userId: string, appId: string | null): Promise<AppSummaryDto | null> {
  if (!appId) return null;
  const [row] = await db
    .select()
    .from(app)
    .where(and(eq(app.id, appId), eq(app.userId, userId)))
    .limit(1);
  return row ? toAppSummaryDto(row) : null;
}

async function projectNamesById(userId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(eq(project.userId, userId));
  return new Map(rows.map((row) => [row.id, row.name]));
}

function toSummaryDto(
  row: NotificationRow,
  projectNames: Map<string, string>,
): InboxNotificationSummaryDto {
  return {
    id: row.id,
    origin: row.origin,
    projectId: row.projectId,
    projectName: row.projectId ? (projectNames.get(row.projectId) ?? null) : null,
    sourceName: row.sourceName,
    sourceImageUrl: row.sourceImageUrl,
    title: row.title,
    preview: boundPreview(row.rawPreview, row.contentLength),
    url: row.url,
    bodyFormat: toBodyFormat(row.bodyFormat),
    readAt: toIso(row.readAt),
    createdAt: new Date(row.createdAt).toISOString(),
    app: rowAppSummary(row),
  };
}

// The `code` lets the app distinguish a modern server confirming the
// notification is gone from an old server that lacks these routes entirely
// (whose 404 carries no structured code) and fall back to the legacy inbox.
const NOT_FOUND = { error: "Notification not found", code: API_ERROR_CODE_NOT_FOUND } as const;

// ---------------------------------------------------------------------------
// Operations shared by the session and agent-token routes
// ---------------------------------------------------------------------------

/** A handler result: the success body, or an error status with its JSON body. */
type Outcome<T> =
  | { ok: true; body: T }
  | { ok: false; status: 400 | 404; body: { error: string; code?: string; issues?: unknown } };

const notFound = { ok: false, status: 404, body: NOT_FOUND } as const;

function invalid(error: string, issues?: unknown): Outcome<never> {
  return { ok: false, status: 400, body: issues === undefined ? { error } : { error, issues } };
}

async function listInboxProjects(userId: string): Promise<InboxProjectsDto> {
  interface BucketRow {
    projectId: string | null;
    total: number;
    unread: number;
    latestTitle: string | null;
    latestPreview: string | null;
    latestImageUrl: string | null;
    latestLength: number | null;
    latestAt: number | null;
  }
  const buckets = db.all(sql`
      select
        project_id as projectId,
        total,
        unread,
        title as latestTitle,
        raw_preview as latestPreview,
        source_image_url as latestImageUrl,
        content_length as latestLength,
        created_at as latestAt
      from (
        select
          project_id, title, raw_preview, source_image_url, content_length, created_at,
          row_number() over (partition by project_id order by created_at desc, id desc) as rn,
          count(*) over (partition by project_id) as total,
          sum(case when read_at is null then 1 else 0 end) over (partition by project_id) as unread
        from (${notificationUnionSql(userId)})
      )
      where rn = 1
      order by latestAt desc
    `) as BucketRow[];

  const knownProjects = await db
    .select({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
    })
    .from(project)
    .where(eq(project.userId, userId));
  const namesById = new Map(knownProjects.map((row) => [row.id, row.name]));

  const populated: InboxProjectSummaryDto[] = buckets.map((bucket) => ({
    projectId: bucket.projectId,
    name: bucket.projectId
      ? (namesById.get(bucket.projectId) ?? INBOX_UNFILED_PROJECT_NAME)
      : INBOX_UNFILED_PROJECT_NAME,
    unreadCount: bucket.unread,
    totalCount: bucket.total,
    latestTitle: bucket.latestTitle,
    latestPreview:
      bucket.latestPreview === null
        ? null
        : boundPreview(bucket.latestPreview, bucket.latestLength ?? 0),
    latestImageUrl: bucket.latestImageUrl,
    latestAt: toIso(bucket.latestAt),
  }));

  const seen = new Set(populated.map((summary) => summary.projectId));
  const empty: InboxProjectSummaryDto[] = knownProjects
    .filter((row) => !seen.has(row.id))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map((row) => ({
      projectId: row.id,
      name: row.name,
      unreadCount: 0,
      totalCount: 0,
      latestTitle: null,
      latestPreview: null,
      latestImageUrl: null,
      latestAt: null,
    }));

  const projects = [...populated, ...empty];
  const totalUnread = projects.reduce((sum, summary) => sum + summary.unreadCount, 0);
  return { projects, totalUnread };
}

interface InboxPageQuery {
  limit?: string;
  project?: string;
  unread?: string;
  cursor?: string;
}

async function listInboxNotifications(
  userId: string,
  query: InboxPageQuery,
): Promise<Outcome<InboxNotificationPageDto>> {
  const requestedLimit = Number.parseInt(query.limit ?? "20", 10);
  if (
    !Number.isFinite(requestedLimit) ||
    requestedLimit < 1 ||
    requestedLimit > INBOX_PAGE_MAX_LIMIT
  ) {
    return invalid(`limit must be between 1 and ${INBOX_PAGE_MAX_LIMIT}`);
  }

  const projectParam = query.project;
  if (projectParam !== undefined && (projectParam.length === 0 || projectParam.length > 100)) {
    return invalid("Invalid project filter");
  }
  const unreadParam = query.unread;
  if (unreadParam !== undefined && unreadParam !== "1" && unreadParam !== "true") {
    return invalid("Invalid unread filter");
  }

  const cursorParam = query.cursor;
  const cursor = cursorParam === undefined ? undefined : decodeCursor(cursorParam);
  if (cursor === null) return invalid("Invalid cursor");

  const filters = [sql`1 = 1`];
  if (projectParam === INBOX_UNFILED_PROJECT) filters.push(sql`project_id is null`);
  else if (projectParam !== undefined) filters.push(sql`project_id = ${projectParam}`);
  if (unreadParam !== undefined) filters.push(sql`read_at is null`);
  if (cursor) {
    filters.push(
      sql`(created_at < ${cursor.createdAt} or (created_at = ${cursor.createdAt} and id < ${cursor.id}))`,
    );
  }

  // Snapshot the high-water rowids before reading the page (both queries
  // are synchronous, so nothing can insert in between). The snapshot spans
  // the account/project scope regardless of the unread filter or cursor:
  // every row it covers was visible to this client at response time.
  const readThroughToken = encodeReadThroughToken(readThroughSnapshot(userId, projectParam));

  const rows = db.all(sql`
      select
        id,
        origin,
        project_id as projectId,
        source_name as sourceName,
        source_image_url as sourceImageUrl,
        title,
        raw_preview as rawPreview,
        content_length as contentLength,
        url,
        body_format as bodyFormat,
        read_at as readAt,
        created_at as createdAt,
        app_id as appId,
        app_name as appName,
        app_origin as appOrigin,
        app_icon_url as appIconUrl
      from (${notificationUnionSql(userId)})
      where ${sql.join(filters, sql` and `)}
      order by created_at desc, id desc
      limit ${requestedLimit + 1}
    `) as NotificationRow[];

  const projectNames = await projectNamesById(userId);
  const page = rows.slice(0, requestedLimit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > requestedLimit && last
      ? encodeCursor({ createdAt: last.createdAt, id: last.id })
      : null;
  return {
    ok: true,
    body: {
      items: page.map((row) => toSummaryDto(row, projectNames)),
      nextCursor,
      readThroughToken,
    },
  };
}

async function getInboxNotification(
  userId: string,
  compositeId: string,
): Promise<InboxNotificationDetailDto | null> {
  const target = parseCompositeId(compositeId);
  if (!target) return null;

  if (target.origin === "event") {
    const [row] = await db
      .select({ event, serviceTitle: service.title, serviceImageUrl: service.imageUrl })
      .from(event)
      .innerJoin(service, eq(event.serviceId, service.id))
      .where(and(eq(event.id, target.id), eq(service.userId, userId)))
      .limit(1);
    if (!row) return null;
    const projectNames = await projectNamesById(userId);
    const detail: InboxNotificationDetailDto = {
      id: `event:${row.event.id}`,
      origin: "event",
      projectId: row.event.projectId,
      projectName: row.event.projectId ? (projectNames.get(row.event.projectId) ?? null) : null,
      sourceName: row.serviceTitle,
      sourceImageUrl: row.event.imageUrl ?? row.serviceImageUrl,
      title: row.event.title,
      preview: boundPreview(
        row.event.summary ?? row.event.body,
        Array.from(row.event.summary ?? row.event.body).length,
      ),
      url: row.event.url,
      bodyFormat: toBodyFormat(row.event.bodyFormat),
      readAt: row.event.readAt?.toISOString() ?? null,
      createdAt: row.event.createdAt.toISOString(),
      app: await appSummaryFor(userId, row.event.appId),
      body: row.event.body,
      summary: row.event.summary,
      status: row.event.status,
    };
    return detail;
  }

  const [row] = await db
    .select()
    .from(agentNotification)
    .where(and(eq(agentNotification.id, target.id), eq(agentNotification.userId, userId)))
    .limit(1);
  if (!row) return null;
  const [tokenRow] = (await db.all(
    sql`select name from api_token where id = ${row.requesterTokenId} limit 1`,
  )) as Array<{ name: string }>;
  const projectNames = await projectNamesById(userId);
  const detail: InboxNotificationDetailDto = {
    id: `notification:${row.id}`,
    origin: "notification",
    projectId: row.projectId,
    projectName: row.projectId ? (projectNames.get(row.projectId) ?? null) : null,
    sourceName: tokenRow?.name ?? row.title,
    sourceImageUrl: row.imageUrl,
    title: row.title,
    preview: boundPreview(row.summary ?? row.body, Array.from(row.summary ?? row.body).length),
    url: row.url,
    bodyFormat: toBodyFormat(row.bodyFormat),
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    app: await appSummaryFor(userId, row.appId),
    body: row.body,
    summary: row.summary,
    status: null,
  };
  return detail;
}

async function markAllInboxRead(
  userId: string,
  input: unknown,
): Promise<Outcome<{ ok: true; updated: number }>> {
  const parsed = inboxMarkAllReadSchema.safeParse(input);
  if (!parsed.success) {
    return invalid("Invalid read-all request", parsed.error.issues);
  }
  const snapshot = decodeReadThroughToken(parsed.data.readThrough);
  if (!snapshot) {
    return invalid("Invalid read-through token");
  }
  const now = new Date();
  const projectFilter = parsed.data.project;

  // The token only bounds the snapshot moment via rowids. Ownership and
  // the requested project scope are enforced here, in SQL — never taken
  // from the token — so a forged token cannot reach foreign rows.
  const ownedServices = db
    .select({ id: service.id })
    .from(service)
    .where(eq(service.userId, userId));
  const eventConditions = [
    isNull(event.readAt),
    sql`${event}.rowid <= ${snapshot.event}`,
    sql`${event.serviceId} in ${ownedServices}`,
  ];
  const agentConditions = [
    isNull(agentNotification.readAt),
    sql`${agentNotification}.rowid <= ${snapshot.notification}`,
    eq(agentNotification.userId, userId),
  ];
  if (projectFilter === INBOX_UNFILED_PROJECT) {
    eventConditions.push(isNull(event.projectId));
    agentConditions.push(isNull(agentNotification.projectId));
  } else if (projectFilter !== undefined) {
    eventConditions.push(eq(event.projectId, projectFilter));
    agentConditions.push(eq(agentNotification.projectId, projectFilter));
  }

  // A zero bound means the snapshot saw no rows in that table; rowids
  // start at 1, so skip the statement instead of scanning for nothing.
  const [eventRows, agentRows] = await Promise.all([
    snapshot.event === 0
      ? []
      : db
          .update(event)
          .set({ readAt: now })
          .where(and(...eventConditions))
          .returning({ id: event.id }),
    snapshot.notification === 0
      ? []
      : db
          .update(agentNotification)
          .set({ readAt: now })
          .where(and(...agentConditions))
          .returning({ id: agentNotification.id }),
  ]);
  return { ok: true, body: { ok: true, updated: eventRows.length + agentRows.length } };
}

type ReadMarkResult = { ok: true; readAt: string | null; idempotent?: true };

async function markInboxRead(
  userId: string,
  compositeId: string,
): Promise<Outcome<ReadMarkResult>> {
  const target = parseCompositeId(compositeId);
  if (!target) return notFound;
  const now = new Date();

  if (target.origin === "event") {
    const [current] = await db
      .select({ id: event.id, readAt: event.readAt })
      .from(event)
      .innerJoin(service, eq(event.serviceId, service.id))
      .where(and(eq(event.id, target.id), eq(service.userId, userId)))
      .limit(1);
    if (!current) return notFound;
    // Idempotent: an already-read notification keeps its first read time.
    if (current.readAt) {
      return {
        ok: true,
        body: { ok: true, readAt: current.readAt.toISOString(), idempotent: true },
      };
    }
    await db
      .update(event)
      .set({ readAt: now })
      .where(and(eq(event.id, target.id), isNull(event.readAt)));
    const [settled] = await db
      .select({ readAt: event.readAt })
      .from(event)
      .where(eq(event.id, target.id))
      .limit(1);
    return { ok: true, body: { ok: true, readAt: (settled?.readAt ?? now).toISOString() } };
  }

  const [current] = await db
    .select({ id: agentNotification.id, readAt: agentNotification.readAt })
    .from(agentNotification)
    .where(and(eq(agentNotification.id, target.id), eq(agentNotification.userId, userId)))
    .limit(1);
  if (!current) return notFound;
  if (current.readAt) {
    return { ok: true, body: { ok: true, readAt: current.readAt.toISOString(), idempotent: true } };
  }
  await db
    .update(agentNotification)
    .set({ readAt: now })
    .where(and(eq(agentNotification.id, target.id), isNull(agentNotification.readAt)));
  const [settled] = await db
    .select({ readAt: agentNotification.readAt })
    .from(agentNotification)
    .where(eq(agentNotification.id, target.id))
    .limit(1);
  return { ok: true, body: { ok: true, readAt: (settled?.readAt ?? now).toISOString() } };
}

async function markInboxUnread(
  userId: string,
  compositeId: string,
): Promise<Outcome<ReadMarkResult>> {
  const target = parseCompositeId(compositeId);
  if (!target) return notFound;

  if (target.origin === "event") {
    const [current] = await db
      .select({ id: event.id })
      .from(event)
      .innerJoin(service, eq(event.serviceId, service.id))
      .where(and(eq(event.id, target.id), eq(service.userId, userId)))
      .limit(1);
    if (!current) return notFound;
    // Last write wins; marking an unread notification unread is a no-op.
    await db.update(event).set({ readAt: null }).where(eq(event.id, target.id));
    return { ok: true, body: { ok: true, readAt: null } };
  }

  const [current] = await db
    .select({ id: agentNotification.id })
    .from(agentNotification)
    .where(and(eq(agentNotification.id, target.id), eq(agentNotification.userId, userId)))
    .limit(1);
  if (!current) return notFound;
  await db
    .update(agentNotification)
    .set({ readAt: null })
    .where(eq(agentNotification.id, target.id));
  return { ok: true, body: { ok: true, readAt: null } };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function pageQuery(query: (name: string) => string | undefined): InboxPageQuery {
  return {
    limit: query("limit"),
    project: query("project"),
    unread: query("unread"),
    cursor: query("cursor"),
  };
}

export const inboxRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/projects", async (c) => c.json(await listInboxProjects(c.get("user").id)))
  .get("/notifications", async (c) => {
    const result = await listInboxNotifications(
      c.get("user").id,
      pageQuery((name) => c.req.query(name)),
    );
    return result.ok ? c.json(result.body) : c.json(result.body, result.status);
  })
  .get("/notifications/:id", async (c) => {
    const detail = await getInboxNotification(c.get("user").id, c.req.param("id"));
    return detail ? c.json({ notification: detail }) : c.json(NOT_FOUND, 404);
  })
  .post("/notifications/read-all", async (c) => {
    const result = await markAllInboxRead(c.get("user").id, await c.req.json().catch(() => null));
    return result.ok ? c.json(result.body) : c.json(result.body, result.status);
  })
  .post("/notifications/:id/read", async (c) => {
    const result = await markInboxRead(c.get("user").id, c.req.param("id"));
    return result.ok ? c.json(result.body) : c.json(result.body, result.status);
  })
  .post("/notifications/:id/unread", async (c) => {
    const result = await markInboxUnread(c.get("user").id, c.req.param("id"));
    return result.ok ? c.json(result.body) : c.json(result.body, result.status);
  });

/** Agent-token twin of {@link inboxRoute}, mounted at `/api/agent/inbox`. */
export const inboxAgentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/projects", requireScopes("inbox:read"), async (c) =>
    c.json(await listInboxProjects(c.get("apiToken").userId)),
  )
  .get("/notifications", requireScopes("inbox:read"), async (c) => {
    const result = await listInboxNotifications(
      c.get("apiToken").userId,
      pageQuery((name) => c.req.query(name)),
    );
    return result.ok ? c.json(result.body) : c.json(result.body, result.status);
  })
  .get("/notifications/:id", requireScopes("inbox:read"), async (c) => {
    const detail = await getInboxNotification(c.get("apiToken").userId, c.req.param("id"));
    return detail ? c.json({ notification: detail }) : c.json(NOT_FOUND, 404);
  })
  .post("/notifications/read-all", requireScopes("inbox:write"), async (c) => {
    const result = await markAllInboxRead(
      c.get("apiToken").userId,
      await c.req.json().catch(() => null),
    );
    return result.ok ? c.json(result.body) : c.json(result.body, result.status);
  })
  .post("/notifications/:id/read", requireScopes("inbox:write"), async (c) => {
    const result = await markInboxRead(c.get("apiToken").userId, c.req.param("id"));
    return result.ok ? c.json(result.body) : c.json(result.body, result.status);
  })
  .post("/notifications/:id/unread", requireScopes("inbox:write"), async (c) => {
    const result = await markInboxUnread(c.get("apiToken").userId, c.req.param("id"));
    return result.ok ? c.json(result.body) : c.json(result.body, result.status);
  });
