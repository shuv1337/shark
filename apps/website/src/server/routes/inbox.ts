import {
  INBOX_FILTERS,
  type InboxActionDto,
  type InboxDetailDto,
  type InboxFilter,
  type InboxItemDto,
  type InboxItemEventDto,
  type InboxPageDto,
} from "@hark/contracts";
import { and, asc, count, desc, eq, isNull, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { inboxItem, inboxItemEvent, interaction } from "../db/schema";
import { syncInboxForUser } from "../lib/inbox";
import { type AuthedEnv, requireAuth } from "../middleware";

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

function encodeCursor(date: Date, id: string): string {
  return Buffer.from(JSON.stringify([date.getTime(), id])).toString("base64url");
}

function decodeCursor(value: string | undefined): { occurredAt: Date; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString()) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== "number" ||
      !Number.isFinite(parsed[0]) ||
      typeof parsed[1] !== "string"
    ) {
      return null;
    }
    const occurredAt = new Date(parsed[0]);
    if (!Number.isFinite(occurredAt.getTime())) return null;
    return { occurredAt, id: parsed[1] };
  } catch {
    return null;
  }
}

type ItemRow = typeof inboxItem.$inferSelect & {
  interactionKind: string | null;
  choices: string[] | null;
  actionDigest: string | null;
  primaryLabel: string | null;
  secondaryLabel: string | null;
  expiresAt: Date | null;
};

function toItemDto(row: ItemRow): InboxItemDto {
  const action: InboxActionDto | null =
    row.needsAction &&
    row.entityType === "interaction" &&
    row.interactionKind &&
    row.choices &&
    row.actionDigest &&
    row.expiresAt
      ? {
          interactionId: row.entityId,
          kind: row.interactionKind as InboxActionDto["kind"],
          choices: row.choices,
          actionDigest: row.actionDigest,
          primaryLabel: row.primaryLabel,
          secondaryLabel: row.secondaryLabel,
          expiresAt: row.expiresAt.toISOString(),
        }
      : null;
  return {
    id: row.id,
    kind: row.kind as InboxItemDto["kind"],
    sourceName: row.sourceName,
    sourceImageUrl: row.sourceImageUrl,
    title: row.title,
    body: row.body,
    imageUrl: row.imageUrl,
    url: row.url,
    status: row.status,
    result: row.result,
    accepted: row.acceptedCount,
    failed: row.failedCount,
    needsAction: row.needsAction,
    readAt: row.readAt?.toISOString() ?? null,
    occurredAt: row.occurredAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    action,
  };
}

async function itemRows(userId: string, itemId?: string): Promise<ItemRow[]> {
  return db
    .select({
      id: inboxItem.id,
      userId: inboxItem.userId,
      entityType: inboxItem.entityType,
      entityId: inboxItem.entityId,
      kind: inboxItem.kind,
      sourceName: inboxItem.sourceName,
      sourceImageUrl: inboxItem.sourceImageUrl,
      title: inboxItem.title,
      body: inboxItem.body,
      imageUrl: inboxItem.imageUrl,
      url: inboxItem.url,
      status: inboxItem.status,
      result: inboxItem.result,
      acceptedCount: inboxItem.acceptedCount,
      failedCount: inboxItem.failedCount,
      needsAction: inboxItem.needsAction,
      readAt: inboxItem.readAt,
      occurredAt: inboxItem.occurredAt,
      updatedAt: inboxItem.updatedAt,
      interactionKind: interaction.kind,
      choices: interaction.choices,
      actionDigest: interaction.actionDigest,
      primaryLabel: interaction.primaryLabel,
      secondaryLabel: interaction.secondaryLabel,
      expiresAt: interaction.expiresAt,
    })
    .from(inboxItem)
    .leftJoin(
      interaction,
      and(eq(inboxItem.entityType, "interaction"), eq(interaction.id, inboxItem.entityId)),
    )
    .where(and(eq(inboxItem.userId, userId), ...(itemId ? [eq(inboxItem.id, itemId)] : [])));
}

export const inboxRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const userId = c.get("user").id;
    await syncInboxForUser(userId);
    const requestedFilter = c.req.query("filter") ?? "all";
    if (!INBOX_FILTERS.includes(requestedFilter as InboxFilter)) {
      return c.json({ error: "Invalid inbox filter" }, 400);
    }
    const filter = requestedFilter as InboxFilter;
    const requestedLimit = Number.parseInt(c.req.query("limit") ?? String(DEFAULT_PAGE_SIZE), 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
    const cursorValue = c.req.query("cursor");
    const cursor = decodeCursor(cursorValue);
    if (cursorValue && !cursor) return c.json({ error: "Invalid inbox cursor" }, 400);

    const filterCondition =
      filter === "needs_action"
        ? eq(inboxItem.needsAction, true)
        : filter === "active"
          ? and(
              eq(inboxItem.kind, "live_activity"),
              or(
                eq(inboxItem.status, "starting"),
                eq(inboxItem.status, "active"),
                eq(inboxItem.status, "partial"),
              ),
            )
          : filter === "failed"
            ? or(
                eq(inboxItem.status, "failed"),
                eq(inboxItem.status, "no_devices"),
                eq(inboxItem.status, "partial"),
              )
            : filter === "notifications"
              ? eq(inboxItem.kind, "notification")
              : undefined;
    const cursorCondition = cursor
      ? or(
          lt(inboxItem.occurredAt, cursor.occurredAt),
          and(eq(inboxItem.occurredAt, cursor.occurredAt), lt(inboxItem.id, cursor.id)),
        )
      : undefined;

    const rows = await db
      .select({
        id: inboxItem.id,
        userId: inboxItem.userId,
        entityType: inboxItem.entityType,
        entityId: inboxItem.entityId,
        kind: inboxItem.kind,
        sourceName: inboxItem.sourceName,
        sourceImageUrl: inboxItem.sourceImageUrl,
        title: inboxItem.title,
        body: inboxItem.body,
        imageUrl: inboxItem.imageUrl,
        url: inboxItem.url,
        status: inboxItem.status,
        result: inboxItem.result,
        acceptedCount: inboxItem.acceptedCount,
        failedCount: inboxItem.failedCount,
        needsAction: inboxItem.needsAction,
        readAt: inboxItem.readAt,
        occurredAt: inboxItem.occurredAt,
        updatedAt: inboxItem.updatedAt,
        interactionKind: interaction.kind,
        choices: interaction.choices,
        actionDigest: interaction.actionDigest,
        primaryLabel: interaction.primaryLabel,
        secondaryLabel: interaction.secondaryLabel,
        expiresAt: interaction.expiresAt,
      })
      .from(inboxItem)
      .leftJoin(
        interaction,
        and(eq(inboxItem.entityType, "interaction"), eq(interaction.id, inboxItem.entityId)),
      )
      .where(
        and(
          eq(inboxItem.userId, userId),
          ...(filterCondition ? [filterCondition] : []),
          ...(cursorCondition ? [cursorCondition] : []),
        ),
      )
      .orderBy(desc(inboxItem.occurredAt), desc(inboxItem.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const [unresolved] = await db
      .select({ value: count() })
      .from(inboxItem)
      .where(and(eq(inboxItem.userId, userId), eq(inboxItem.needsAction, true)));
    const last = page.at(-1);
    const response: InboxPageDto = {
      items: page.map(toItemDto),
      nextCursor: hasMore && last ? encodeCursor(last.occurredAt, last.id) : null,
      unresolvedCount: unresolved?.value ?? 0,
    };
    return c.json(response);
  })
  .get("/:id", async (c) => {
    const userId = c.get("user").id;
    await syncInboxForUser(userId);
    const [row] = await itemRows(userId, c.req.param("id"));
    if (!row) return c.json({ error: "Inbox item not found" }, 404);
    const events = await db
      .select()
      .from(inboxItemEvent)
      .where(eq(inboxItemEvent.inboxItemId, row.id))
      .orderBy(asc(inboxItemEvent.occurredAt), asc(inboxItemEvent.id));
    const response: InboxDetailDto = {
      item: toItemDto(row),
      events: events.map(
        (event): InboxItemEventDto => ({
          id: event.id,
          kind: event.kind,
          detail: event.detail,
          result: event.result,
          accepted: event.acceptedCount,
          failed: event.failedCount,
          occurredAt: event.occurredAt.toISOString(),
        }),
      ),
    };
    return c.json(response);
  })
  .post("/:id/read", async (c) => {
    const userId = c.get("user").id;
    const updated = await db
      .update(inboxItem)
      .set({ readAt: new Date() })
      .where(and(eq(inboxItem.id, c.req.param("id")), eq(inboxItem.userId, userId)))
      .returning({ id: inboxItem.id });
    if (updated.length === 0) return c.json({ error: "Inbox item not found" }, 404);
    return c.json({ ok: true });
  })
  .post("/read-all", async (c) => {
    await db
      .update(inboxItem)
      .set({ readAt: new Date() })
      .where(and(eq(inboxItem.userId, c.get("user").id), isNull(inboxItem.readAt)));
    return c.json({ ok: true });
  });
