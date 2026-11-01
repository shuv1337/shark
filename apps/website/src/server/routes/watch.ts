import {
  BOARD_WORK_ACTIVE_STATES,
  type WatchSnapshotDto,
  type WatchWorkItemDto,
  watchInteractionResponseSchema,
} from "@hark/contracts";
import { and, desc, eq, gt, inArray, isNull, notInArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { boardWorkItem, inboxItem, interaction, liveActivity } from "../db/schema";
import { track } from "../lib/analytics";
import { isWorkStale } from "../lib/board";
import { syncInboxForUser } from "../lib/inbox";
import { deliverInteractionCallbacks } from "../lib/interaction-callbacks";
import { type AgentEnv, requireApiToken, requireScopes } from "../middleware";
import { resolveInteractionLiveActivity } from "./activities";

const LIVE_STATUSES = ["starting", "active", "partial"] as const;
const WATCH_WORK_LIMIT = 5;
const WATCH_MESSAGE_LIMIT = 5;
const BOARD_STATE_LABELS: Record<(typeof BOARD_WORK_ACTIVE_STATES)[number], string> = {
  queued: "Queued",
  in_flight: "In progress",
  review: "In review",
  blocked: "Blocked",
};
const STALE_LABEL = "Stale";
const WAITING_ANSWER_LABEL = "Waiting for your answer";
const WITHDRAWN_STATUSES = ["withdrawn", "withdraw_partial", "withdraw_processing"];

type LiveActivityRow = typeof liveActivity.$inferSelect;
type BoardWorkRow = typeof boardWorkItem.$inferSelect;

function liveActivityProps(row: LiveActivityRow) {
  return row.props as {
    title?: string;
    status?: string;
    detail?: string;
    progress?: number;
    privacyMode?: string;
  };
}

function toLiveActivityWork(row: LiveActivityRow): WatchWorkItemDto {
  const props = liveActivityProps(row);
  const isPrivate = props.privacyMode === "private";
  return {
    id: row.id,
    title: isPrivate ? "Agent task" : (props.title ?? "Active work"),
    status: isPrivate ? "In progress" : (props.status ?? "In progress"),
    detail: isPrivate ? null : (props.detail ?? null),
    progress: typeof props.progress === "number" ? props.progress : null,
    updatedAt: row.updatedAt.toISOString(),
    private: isPrivate,
  };
}

/**
 * A board item and the Live Activity its agent runs for the same task share one
 * slot. The board row wins; the activity only fills progress and status it lacks.
 */
function toBoardWork(row: BoardWorkRow, stale: boolean, activity?: LiveActivityRow) {
  const props = activity ? liveActivityProps(activity) : {};
  const activityStatus = props.privacyMode === "private" ? undefined : props.status;
  const updatedAt =
    activity && activity.updatedAt > row.updatedAt ? activity.updatedAt : row.updatedAt;
  let status: string;
  if (stale) status = STALE_LABEL;
  else if (row.statusLabel) status = row.statusLabel;
  else if (row.state === "blocked" && row.waitingAskId) status = WAITING_ANSWER_LABEL;
  else
    status =
      activityStatus ??
      BOARD_STATE_LABELS[row.state as keyof typeof BOARD_STATE_LABELS] ??
      row.state;
  return {
    id: row.id,
    title: row.title,
    status,
    detail: row.detail,
    progress: row.progress ?? (typeof props.progress === "number" ? props.progress : null),
    updatedAt: updatedAt.toISOString(),
    private: false,
  } satisfies WatchWorkItemDto;
}

const normalizeTitle = (title: string | undefined) =>
  (title ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Pairs each board row with at most one activity: same key first, then same token and title. */
function pairActivities(board: BoardWorkRow[], activities: LiveActivityRow[]) {
  const pairs = new Map<string, LiveActivityRow>();
  const unpaired = new Set(activities);
  for (const row of board) {
    const match = [...unpaired].find((activity) => activity.key === row.workKey);
    if (match) {
      pairs.set(row.id, match);
      unpaired.delete(match);
    }
  }
  for (const row of board) {
    if (pairs.has(row.id) || !row.requesterTokenId) continue;
    const title = normalizeTitle(row.title);
    const match = [...unpaired].find(
      (activity) =>
        activity.requesterTokenId === row.requesterTokenId &&
        normalizeTitle(liveActivityProps(activity).title) === title,
    );
    if (match) {
      pairs.set(row.id, match);
      unpaired.delete(match);
    }
  }
  return { pairs, unpaired: [...unpaired] };
}

async function snapshotFor(userId: string): Promise<WatchSnapshotDto> {
  await syncInboxForUser(userId);
  const now = new Date();
  const activities = db
    .select()
    .from(liveActivity)
    .where(
      and(
        eq(liveActivity.userId, userId),
        inArray(liveActivity.status, LIVE_STATUSES),
        isNull(liveActivity.interactionId),
        gt(liveActivity.expiresAt, now),
      ),
    )
    .orderBy(desc(liveActivity.updatedAt))
    .limit(WATCH_WORK_LIMIT)
    .all();
  const boardWork = db
    .select()
    .from(boardWorkItem)
    .where(
      and(
        eq(boardWorkItem.userId, userId),
        inArray(boardWorkItem.state, [...BOARD_WORK_ACTIVE_STATES]),
      ),
    )
    .orderBy(desc(boardWorkItem.updatedAt))
    .all();
  const { pairs, unpaired } = pairActivities(boardWork, activities);
  const running: WatchWorkItemDto[] = unpaired.map(toLiveActivityWork);
  const queued: WatchWorkItemDto[] = [];
  const stale: WatchWorkItemDto[] = [];
  for (const row of boardWork) {
    const isStale = isWorkStale(row, now);
    const item = toBoardWork(row, isStale, pairs.get(row.id));
    if (isStale) stale.push(item);
    else if (row.state === "queued") queued.push(item);
    else running.push(item);
  }
  const byRecency = (a: WatchWorkItemDto, b: WatchWorkItemDto) =>
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  const work = [...running.sort(byRecency), ...queued, ...stale.sort(byRecency)].slice(
    0,
    WATCH_WORK_LIMIT,
  );
  const messages = db
    .select()
    .from(inboxItem)
    .where(
      and(
        eq(inboxItem.userId, userId),
        eq(inboxItem.kind, "notification"),
        notInArray(inboxItem.status, WITHDRAWN_STATUSES),
      ),
    )
    .orderBy(desc(inboxItem.occurredAt), desc(inboxItem.id))
    .limit(WATCH_MESSAGE_LIMIT)
    .all();
  const pending = db
    .select()
    .from(interaction)
    .where(
      and(
        eq(interaction.userId, userId),
        eq(interaction.status, "pending"),
        inArray(interaction.kind, ["approval", "yes_no"]),
        gt(interaction.expiresAt, now),
      ),
    )
    .orderBy(desc(interaction.createdAt))
    .limit(1)
    .get();

  return {
    generatedAt: now.toISOString(),
    activeWork: work[0] ?? null,
    work,
    pendingInteraction: pending
      ? {
          id: pending.id,
          title: pending.title,
          prompt: pending.prompt,
          kind: pending.kind as "approval" | "yes_no",
          actionDigest: pending.actionDigest,
          expiresAt: pending.expiresAt.toISOString(),
          primaryLabel: pending.primaryLabel,
          secondaryLabel: pending.secondaryLabel,
        }
      : null,
    recentMessages: messages.map((row) => ({
      id: row.id,
      source: row.sourceName,
      title: row.title,
      body: row.body,
      occurredAt: row.occurredAt.toISOString(),
    })),
  };
}

/**
 * A watch token is restricted to this snapshot and to resolving its own
 * yes/no or approval actions. The server remains authoritative for races.
 */
export const watchRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/snapshot", requireScopes("watch:read"), async (c) =>
    c.json(await snapshotFor(c.get("apiToken").userId)),
  )
  .post("/interactions/:id/respond", requireScopes("watch:respond"), async (c) => {
    const parsed = watchInteractionResponseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid interaction response" }, 400);
    const token = c.get("apiToken");
    const current = db
      .select()
      .from(interaction)
      .where(and(eq(interaction.id, c.req.param("id")), eq(interaction.userId, token.userId)))
      .get();
    if (!current) return c.json({ error: "Interaction not found" }, 404);
    if (current.actionDigest !== parsed.data.actionDigest) {
      return c.json({ error: "Interaction action digest mismatch" }, 409);
    }
    if (
      (current.kind === "approval" && !["approve", "deny"].includes(parsed.data.action)) ||
      (current.kind === "yes_no" && !["yes", "no"].includes(parsed.data.action)) ||
      current.kind === "reply"
    ) {
      return c.json({ error: "This interaction cannot be answered on Apple Watch" }, 400);
    }
    const now = new Date();
    const status =
      parsed.data.action === "approve"
        ? "approved"
        : parsed.data.action === "deny"
          ? "denied"
          : parsed.data.action;
    const [resolved] = await db
      .update(interaction)
      .set({ status, response: parsed.data.action, respondedAt: now })
      .where(
        and(
          eq(interaction.id, current.id),
          eq(interaction.userId, token.userId),
          eq(interaction.status, "pending"),
          gt(interaction.expiresAt, now),
        ),
      )
      .returning();
    if (!resolved) {
      return c.json(
        { error: "Interaction is already terminal", snapshot: await snapshotFor(token.userId) },
        409,
      );
    }
    track({
      name: "interaction_responded",
      userId: token.userId,
      outcome: parsed.data.action,
      metadata: { kind: current.kind, surface: "watch" },
    });
    void deliverInteractionCallbacks();
    void resolveInteractionLiveActivity(resolved);
    return c.json({
      ok: true,
      status: resolved.status,
      snapshot: await snapshotFor(token.userId),
    });
  });
