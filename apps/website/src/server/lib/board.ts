import { createHash } from "node:crypto";
import {
  BOARD_AGED_ASK_DAYS,
  BOARD_DEFAULT_HEARTBEAT_TTL_SECONDS,
  BOARD_DONE_MAX_ITEMS,
  BOARD_DONE_WINDOW_DAYS,
  BOARD_MAX_OPEN_ASKS_PER_TOKEN,
  type BoardAnswerInput,
  type BoardAnswersPageDto,
  type BoardAnswerVia,
  type BoardAskDto,
  type BoardAskEventDto,
  type BoardAskResolvedEvent,
  type BoardAskUpsertInput,
  type BoardCallbackStateDto,
  type BoardCrewEntryDto,
  type BoardDismissInput,
  type BoardDoneInput,
  type BoardNoteDto,
  type BoardNoteUpsertInput,
  type BoardPageDto,
  type BoardSnoozeInput,
  type BoardWorkItemDto,
  type BoardWorkUpsertInput,
  findBoardSecret,
} from "@hark/contracts";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { db } from "../db";
import { apiToken, boardAsk, boardAskEvent, boardNote, boardWorkItem } from "../db/schema";
import { deliverBoardCallbacks } from "./board-callbacks";
import { sendBoardAskPush, sweepBoardPushRetries } from "./board-push";
import { boardVersion, notifyBoardChanged } from "./board-stream";
import { newId } from "./id";
import { encryptCallbackToken } from "./token";

export type AskRow = typeof boardAsk.$inferSelect;
export type WorkRow = typeof boardWorkItem.$inferSelect;
export type NoteRow = typeof boardNote.$inferSelect;
export type TokenRow = typeof apiToken.$inferSelect;

export type BoardFailure = {
  ok: false;
  status: 400 | 404 | 409 | 422;
  error: string;
  ask?: AskRow;
};

const ACTIVE_WORK_STATES = ["queued", "in_flight", "review", "blocked"] as const;
const TERMINAL_WORK_STATES = ["done", "failed", "cancelled"] as const;

// ---------------------------------------------------------------------------
// Digests and DTOs
// ---------------------------------------------------------------------------

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Pins the exact question the captain sees; a click on an older revision is refused. */
export function askDigest(fields: {
  id: string;
  revision: number;
  title: string;
  body: string | null;
  options: unknown;
  allowText: boolean;
  kind: string;
}): string {
  return sha256([
    fields.id,
    fields.revision,
    fields.title,
    fields.body,
    fields.options,
    fields.allowText,
    fields.kind,
  ]);
}

/** Every field a re-assert may change; a difference bumps the revision. */
function contentHash(input: {
  title: string;
  body: string | null;
  kind: string;
  options: unknown;
  allowText: boolean;
  allowLater: boolean;
  priority: string;
  taskId: string | null;
  links: unknown;
}): string {
  return sha256([
    input.title,
    input.body,
    input.kind,
    input.options,
    input.allowText,
    input.allowLater,
    input.priority,
    input.taskId,
    input.links,
  ]);
}

function optionLabel(row: AskRow, optionId: string | null): string | null {
  if (!optionId) return null;
  if (row.kind === "todo" && optionId === "done") return "Done";
  return row.options.find((option) => option.id === optionId)?.label ?? null;
}

export function toAskDto(row: AskRow, now = new Date()): BoardAskDto {
  const callback = row.callbackUrl
    ? {
        status: (row.callbackStatus ?? "pending") as BoardCallbackStateDto["status"],
        attempts: row.callbackAttempts,
        lastError: row.callbackLastError,
        deliveredAt: row.callbackDeliveredAt?.toISOString() ?? null,
      }
    : null;
  return {
    id: row.id,
    key: row.askKey,
    revision: row.revision,
    agent: row.agentLabel,
    agentDisplay: row.agentDisplay,
    title: row.title,
    body: row.body,
    kind: row.kind as BoardAskDto["kind"],
    options: row.options as BoardAskDto["options"],
    allowText: row.allowText,
    allowLater: row.allowLater,
    priority: row.priority as BoardAskDto["priority"],
    taskId: row.waitingTaskId,
    links: row.links as BoardAskDto["links"],
    status: row.status as BoardAskDto["status"],
    digest: row.actionDigest,
    snoozeUntil: row.snoozeUntil?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    answer: row.answeredAt
      ? {
          optionId: row.answerOptionId,
          optionLabel: optionLabel(row, row.answerOptionId),
          text: row.answerText,
          answeredAt: row.answeredAt.toISOString(),
          via: (row.answeredVia ?? "web") as BoardAnswerVia,
        }
      : null,
    cancelReason: row.cancelReason,
    callback,
    ackedAt: row.ackedAt?.toISOString() ?? null,
    lastAssertedAt: row.lastAssertedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    aged:
      row.status === "open" &&
      now.getTime() - row.createdAt.getTime() > BOARD_AGED_ASK_DAYS * 86_400_000,
  };
}

export function toWorkDto(row: WorkRow, now = new Date()): BoardWorkItemDto {
  const active = (ACTIVE_WORK_STATES as readonly string[]).includes(row.state);
  return {
    id: row.id,
    key: row.workKey,
    agent: row.agentLabel,
    agentDisplay: row.agentDisplay,
    title: row.title,
    state: row.state as BoardWorkItemDto["state"],
    statusLabel: row.statusLabel,
    detail: row.detail,
    progress: row.progress,
    links: row.links as BoardWorkItemDto["links"],
    host: row.host,
    waitingAskId: row.waitingAskId,
    startedAt: row.startedAt?.toISOString() ?? null,
    lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
    heartbeatTtlSeconds: row.heartbeatTtlSeconds,
    stale: active && now.getTime() - row.lastHeartbeatAt.getTime() > row.heartbeatTtlSeconds * 1000,
    completedAt: row.completedAt?.toISOString() ?? null,
    completionVerb: row.completionVerb as BoardWorkItemDto["completionVerb"],
    note: row.note,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toNoteDto(row: NoteRow): BoardNoteDto {
  return {
    id: row.id,
    key: row.noteKey,
    agent: row.agentLabel,
    agentDisplay: row.agentDisplay,
    text: row.text,
    detail: row.detail,
    link: row.link,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Deterministic per (ask, revision, status), so receivers can dedupe without a lookup. */
export function resolvedEventFor(row: AskRow): BoardAskResolvedEvent {
  return {
    type: "board.ask.resolved",
    eventId: `${row.id}:r${row.revision}:${row.status}`,
    askId: row.id,
    askKey: row.askKey,
    revision: row.revision,
    status: row.status as BoardAskResolvedEvent["status"],
    optionId: row.answerOptionId,
    optionLabel: optionLabel(row, row.answerOptionId),
    text: row.answerText,
    answeredAt: row.answeredAt?.toISOString() ?? null,
    answeredVia: (row.answeredVia as BoardAnswerVia | null) ?? null,
    cancelReason: row.cancelReason,
    waitingTaskId: row.waitingTaskId,
    agent: row.agentLabel,
  };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export async function appendAskEvent(
  askId: string,
  input: {
    dedupeKey: string;
    kind: string;
    actorType: "token" | "session" | "device_credential" | "system";
    actorRef?: string | null;
    revision: number;
    detail?: string | null;
    occurredAt?: Date;
  },
): Promise<void> {
  await db
    .insert(boardAskEvent)
    .values({
      id: newId("bevt"),
      askId,
      dedupeKey: input.dedupeKey,
      kind: input.kind,
      actorType: input.actorType,
      actorRef: input.actorRef ?? null,
      revision: input.revision,
      detail: input.detail?.slice(0, 500) ?? null,
      occurredAt: input.occurredAt ?? new Date(),
    })
    .onConflictDoNothing();
}

export async function askEvents(askId: string): Promise<BoardAskEventDto[]> {
  const rows = await db
    .select()
    .from(boardAskEvent)
    .where(eq(boardAskEvent.askId, askId))
    .orderBy(asc(boardAskEvent.occurredAt), asc(boardAskEvent.id));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    actorType: row.actorType as BoardAskEventDto["actorType"],
    revision: row.revision,
    detail: row.detail,
    occurredAt: row.occurredAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Secret screening
// ---------------------------------------------------------------------------

function screen(values: Array<string | null | undefined>): BoardFailure | null {
  for (const value of values) {
    const hit = findBoardSecret(value);
    if (hit) {
      return {
        ok: false,
        status: 422,
        error: `Board content looks like it contains a ${hit}; link to it instead`,
      };
    }
  }
  return null;
}

function screenAsk(input: BoardAskUpsertInput): BoardFailure | null {
  return screen([
    input.key,
    input.callback?.url,
    input.title,
    input.body,
    input.taskId,
    input.agentDisplay,
    ...input.options.map((option) => option.label),
    ...input.links.flatMap((link) => [link.label, link.url]),
  ]);
}

// ---------------------------------------------------------------------------
// Agent writes
// ---------------------------------------------------------------------------

async function openAskByKey(userId: string, key: string): Promise<AskRow | undefined> {
  const [row] = await db
    .select()
    .from(boardAsk)
    .where(and(eq(boardAsk.userId, userId), eq(boardAsk.askKey, key), eq(boardAsk.status, "open")))
    .limit(1);
  return row;
}

async function pushAsk(row: AskRow, token: TokenRow): Promise<boolean> {
  try {
    const result = await sendBoardAskPush(row, token);
    if (!result) {
      await appendAskEvent(row.id, {
        dedupeKey: `push_failed:r${row.revision}`,
        kind: "push_failed",
        actorType: "system",
        revision: row.revision,
        detail: "No active notification targets",
      });
      return false;
    }
    // Another attempt for this revision is still sending and records its own outcome.
    if (result.inFlight) return false;
    if (result.accepted > 0) {
      await db
        .update(boardAsk)
        .set({ pushNotificationId: result.notificationId })
        .where(eq(boardAsk.id, row.id));
    }
    await appendAskEvent(row.id, {
      dedupeKey: `pushed:r${row.revision}`,
      kind: result.accepted > 0 ? "pushed" : "push_failed",
      actorType: "system",
      revision: row.revision,
      detail: result.accepted > 0 ? `${result.accepted} accepted` : "No provider accepted",
    });
    return result.accepted > 0;
  } catch (error) {
    await appendAskEvent(row.id, {
      dedupeKey: `push_failed:r${row.revision}`,
      kind: "push_failed",
      actorType: "system",
      revision: row.revision,
      detail: error instanceof Error ? error.message : "Push failed",
    });
    return false;
  }
}

export type UpsertAskOutcome =
  | { ok: true; row: AskRow; created: boolean; changed: boolean; pushed: boolean }
  | BoardFailure;

type UpsertAskStep =
  | { kind: "unchanged"; row: AskRow; retryPush: boolean }
  | { kind: "revised"; row: AskRow }
  | { kind: "created"; row: AskRow }
  | BoardFailure;

export async function upsertAsk(
  token: TokenRow,
  input: BoardAskUpsertInput,
): Promise<UpsertAskOutcome> {
  const rejected = screenAsk(input);
  if (rejected) return rejected;
  const now = new Date();
  const body = input.body?.length ? input.body : null;
  const expiresAt =
    input.expiresInSeconds === undefined || input.expiresInSeconds === null
      ? null
      : new Date(now.getTime() + input.expiresInSeconds * 1000);
  const callbackFields = input.callback
    ? {
        callbackUrl: input.callback.url,
        callbackTokenCiphertext: encryptCallbackToken(input.callback.token),
        callbackStatus: null as string | null,
      }
    : {};
  const content = {
    title: input.title,
    body,
    kind: input.kind,
    options: input.options,
    allowText: input.allowText,
    allowLater: input.allowLater,
    priority: input.priority,
    taskId: input.taskId ?? null,
    links: input.links,
  };
  const shouldPush = input.push === "auto" && input.priority !== "p2";

  // Synchronous transaction: the open-row read, the cap check, and the write
  // cannot interleave with another request on the single SQLite connection, so
  // a re-assert never lands on a row the captain answered in between and the
  // open cap holds under parallel PUTs.
  let step: UpsertAskStep;
  try {
    step = db.transaction((tx): UpsertAskStep => {
      const existing = tx
        .select()
        .from(boardAsk)
        .where(
          and(
            eq(boardAsk.userId, token.userId),
            eq(boardAsk.askKey, input.key),
            eq(boardAsk.status, "open"),
          ),
        )
        .get();
      if (existing) {
        if (existing.requesterTokenId !== token.id) {
          return { ok: false, status: 409, error: "Another agent owns this ask key" };
        }
        const openAndCurrent = and(
          eq(boardAsk.id, existing.id),
          eq(boardAsk.status, "open"),
          eq(boardAsk.revision, existing.revision),
        );
        const unchanged =
          contentHash({
            title: existing.title,
            body: existing.body,
            kind: existing.kind,
            options: existing.options,
            allowText: existing.allowText,
            allowLater: existing.allowLater,
            priority: existing.priority,
            taskId: existing.waitingTaskId,
            links: existing.links,
          }) === contentHash(content);
        if (unchanged) {
          const row = tx
            .update(boardAsk)
            .set({
              lastAssertedAt: now,
              agentDisplay: input.agentDisplay ?? existing.agentDisplay,
              ...(input.expiresInSeconds !== undefined ? { expiresAt } : {}),
              ...callbackFields,
            })
            .where(openAndCurrent)
            .returning()
            .get();
          if (!row) return { ok: false, status: 409, error: "Ask changed concurrently" };
          return {
            kind: "unchanged",
            row,
            retryPush: shouldPush && row.pushNotificationId === null,
          };
        }
        const revision = existing.revision + 1;
        const row = tx
          .update(boardAsk)
          .set({
            ...content,
            waitingTaskId: content.taskId,
            revision,
            actionDigest: askDigest({ id: existing.id, revision, ...content }),
            agentDisplay: input.agentDisplay ?? existing.agentDisplay,
            snoozeUntil: null,
            expiresAt,
            pushNotificationId: null,
            lastAssertedAt: now,
            updatedAt: now,
            ...callbackFields,
          })
          .where(openAndCurrent)
          .returning()
          .get();
        if (!row) return { ok: false, status: 409, error: "Ask changed concurrently" };
        return { kind: "revised", row };
      }

      const open = tx
        .select({ value: count() })
        .from(boardAsk)
        .where(and(eq(boardAsk.requesterTokenId, token.id), eq(boardAsk.status, "open")))
        .get();
      if ((open?.value ?? 0) >= BOARD_MAX_OPEN_ASKS_PER_TOKEN) {
        return {
          ok: false,
          status: 409,
          error: `This agent already has ${BOARD_MAX_OPEN_ASKS_PER_TOKEN} open asks; answer or cancel some first`,
        };
      }
      const id = newId("bask");
      const row = tx
        .insert(boardAsk)
        .values({
          id,
          userId: token.userId,
          requesterTokenId: token.id,
          agentLabel: token.name,
          agentDisplay: input.agentDisplay ?? null,
          askKey: input.key,
          revision: 1,
          ...content,
          waitingTaskId: content.taskId,
          status: "open",
          expiresAt,
          actionDigest: askDigest({ id, revision: 1, ...content }),
          ...callbackFields,
          lastAssertedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      if (!row) return { ok: false, status: 409, error: "Ask was created concurrently" };
      return { kind: "created", row };
    });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      return { ok: false, status: 409, error: "Ask was created concurrently; retry" };
    }
    throw error;
  }
  if ("ok" in step) return step;

  if (step.kind === "unchanged") {
    // The earlier push for this revision never reached a device: one retry per
    // re-assert, under the same idempotency key, so a flaky send is not final.
    const pushed = step.retryPush ? await pushAsk(step.row, token) : false;
    return { ok: true, row: step.row, created: false, changed: false, pushed };
  }
  const { row } = step;
  await appendAskEvent(row.id, {
    dedupeKey: step.kind === "created" ? "opened" : `revised:r${row.revision}`,
    kind: step.kind === "created" ? "opened" : "revised",
    actorType: "token",
    actorRef: token.id,
    revision: row.revision,
  });
  const pushed = shouldPush ? await pushAsk(row, token) : false;
  notifyBoardChanged(token.userId);
  return { ok: true, row, created: step.kind === "created", changed: true, pushed };
}

/** Marks an ask terminal and queues its callback; shared by answer, dismiss, cancel, expiry. */
function terminalFields(row: AskRow, status: "answered" | "expired" | "cancelled", now: Date) {
  return {
    status,
    resolvedAt: now,
    updatedAt: now,
    ...(row.callbackUrl ? { callbackStatus: "pending", callbackNextAttemptAt: now } : {}),
  };
}

export async function cancelAsk(
  token: TokenRow,
  key: string,
  reason: string | undefined,
): Promise<{ ok: true; row: AskRow } | BoardFailure> {
  const rejected = screen([reason]);
  if (rejected) return rejected;
  const existing = await openAskByKey(token.userId, key);
  if (!existing || existing.requesterTokenId !== token.id) {
    return { ok: false, status: 404, error: "No open ask with that key" };
  }
  const now = new Date();
  const [row] = await db
    .update(boardAsk)
    .set({
      ...terminalFields(existing, "cancelled", now),
      cancelReason: reason ?? "Cancelled by agent",
    })
    .where(and(eq(boardAsk.id, existing.id), eq(boardAsk.status, "open")))
    .returning();
  if (!row) return { ok: false, status: 409, error: "Ask is no longer open" };
  await appendAskEvent(row.id, {
    dedupeKey: `cancelled:r${row.revision}`,
    kind: "cancelled",
    actorType: "token",
    actorRef: token.id,
    revision: row.revision,
    detail: reason ?? null,
  });
  notifyBoardChanged(token.userId);
  void deliverBoardCallbacks();
  return { ok: true, row };
}

export async function ackAsk(
  token: TokenRow,
  key: string,
): Promise<{ ok: true; row: AskRow } | BoardFailure> {
  const [existing] = await db
    .select()
    .from(boardAsk)
    .where(
      and(
        eq(boardAsk.requesterTokenId, token.id),
        eq(boardAsk.askKey, key),
        isNotNull(boardAsk.resolvedAt),
        isNull(boardAsk.ackedAt),
      ),
    )
    .orderBy(desc(boardAsk.resolvedAt))
    .limit(1);
  if (!existing)
    return { ok: false, status: 404, error: "No unacknowledged resolved ask with that key" };
  const now = new Date();
  const [row] = await db
    .update(boardAsk)
    .set({ ackedAt: now, updatedAt: now })
    .where(eq(boardAsk.id, existing.id))
    .returning();
  if (!row) return { ok: false, status: 409, error: "Ask changed concurrently" };
  await appendAskEvent(row.id, {
    dedupeKey: `acked:r${row.revision}:${row.status}`,
    kind: "acked",
    actorType: "token",
    actorRef: token.id,
    revision: row.revision,
  });
  notifyBoardChanged(token.userId);
  return { ok: true, row };
}

/** The open ask for a key, else the most recently resolved one. */
export async function askForToken(token: TokenRow, key: string): Promise<AskRow | undefined> {
  const [row] = await db
    .select()
    .from(boardAsk)
    .where(and(eq(boardAsk.requesterTokenId, token.id), eq(boardAsk.askKey, key)))
    .orderBy(sql`case when ${boardAsk.status} = 'open' then 0 else 1 end`, desc(boardAsk.createdAt))
    .limit(1);
  return row;
}

function encodeCursor(resolvedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([resolvedAt.getTime(), id])).toString("base64url");
}

function decodeCursor(value: string | undefined): { resolvedAt: Date; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString()) as unknown;
    if (!Array.isArray(parsed) || typeof parsed[0] !== "number" || typeof parsed[1] !== "string") {
      return null;
    }
    return { resolvedAt: new Date(parsed[0]), id: parsed[1] };
  } catch {
    return null;
  }
}

/** Terminal transitions for this token, oldest first, after `since`. */
export async function answersForToken(
  token: TokenRow,
  since: string | undefined,
  limit = 100,
): Promise<BoardAnswersPageDto> {
  const cursor = decodeCursor(since);
  const rows = await db
    .select()
    .from(boardAsk)
    .where(
      and(
        eq(boardAsk.requesterTokenId, token.id),
        isNotNull(boardAsk.resolvedAt),
        ...(cursor
          ? [
              or(
                gt(boardAsk.resolvedAt, cursor.resolvedAt),
                and(eq(boardAsk.resolvedAt, cursor.resolvedAt), gt(boardAsk.id, cursor.id)),
              ),
            ]
          : []),
      ),
    )
    .orderBy(asc(boardAsk.resolvedAt), asc(boardAsk.id))
    .limit(limit);
  const last = rows.at(-1);
  return {
    events: rows.map(resolvedEventFor),
    cursor: last ? encodeCursor(last.resolvedAt as Date, last.id) : (since ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Captain actions
// ---------------------------------------------------------------------------

async function ownedAsk(userId: string, askId: string): Promise<AskRow | undefined> {
  const [row] = await db
    .select()
    .from(boardAsk)
    .where(and(eq(boardAsk.id, askId), eq(boardAsk.userId, userId)))
    .limit(1);
  return row;
}

export interface CaptainActor {
  via: BoardAnswerVia;
  sessionHash?: string | null;
  deviceId?: string | null;
}

export async function answerAsk(
  userId: string,
  askId: string,
  input: BoardAnswerInput,
  actor: CaptainActor,
): Promise<{ ok: true; row: AskRow } | BoardFailure> {
  const existing = await ownedAsk(userId, askId);
  if (!existing) return { ok: false, status: 404, error: "Ask not found" };
  if (existing.status !== "open") {
    return { ok: false, status: 409, error: "This ask is no longer open", ask: existing };
  }
  if (input.digest !== existing.actionDigest) {
    return {
      ok: false,
      status: 409,
      error: "This question changed; reload the card",
      ask: existing,
    };
  }
  if (input.optionId !== undefined) {
    const valid =
      (existing.kind === "todo" && input.optionId === "done") ||
      existing.options.some((option) => option.id === input.optionId);
    if (!valid) return { ok: false, status: 422, error: "That option is not on this ask" };
  } else if (!existing.allowText) {
    return { ok: false, status: 422, error: "This ask does not take a typed reply" };
  }
  const now = new Date();
  const [row] = await db
    .update(boardAsk)
    .set({
      ...terminalFields(existing, "answered", now),
      answerOptionId: input.optionId ?? null,
      answerText: input.text ?? null,
      answeredAt: now,
      answeredVia: actor.via,
      answeredSessionHash: actor.sessionHash ?? null,
      answeredByDeviceId: actor.deviceId ?? null,
    })
    .where(
      and(
        eq(boardAsk.id, existing.id),
        eq(boardAsk.status, "open"),
        eq(boardAsk.revision, existing.revision),
      ),
    )
    .returning();
  if (!row) return { ok: false, status: 409, error: "This ask changed concurrently" };
  await appendAskEvent(row.id, {
    dedupeKey: `answered:r${row.revision}`,
    kind: "answered",
    actorType: actor.deviceId ? "device_credential" : "session",
    actorRef: actor.deviceId ?? actor.sessionHash ?? null,
    revision: row.revision,
    detail: input.optionId ? `option ${input.optionId}` : "typed reply",
  });
  notifyBoardChanged(userId);
  void deliverBoardCallbacks();
  return { ok: true, row };
}

export async function snoozeAsk(
  userId: string,
  askId: string,
  input: BoardSnoozeInput,
  actor: CaptainActor,
): Promise<{ ok: true; row: AskRow } | BoardFailure> {
  const existing = await ownedAsk(userId, askId);
  if (!existing) return { ok: false, status: 404, error: "Ask not found" };
  if (existing.status !== "open") {
    return { ok: false, status: 409, error: "This ask is no longer open", ask: existing };
  }
  if (input.digest !== existing.actionDigest) {
    return {
      ok: false,
      status: 409,
      error: "This question changed; reload the card",
      ask: existing,
    };
  }
  if (!existing.allowLater) return { ok: false, status: 422, error: "This ask cannot be snoozed" };
  const until = new Date(input.until);
  if (!Number.isFinite(until.getTime()) || until.getTime() <= Date.now()) {
    return { ok: false, status: 422, error: "Later needs a future date" };
  }
  const now = new Date();
  const [row] = await db
    .update(boardAsk)
    .set({ snoozeUntil: until, updatedAt: now })
    .where(
      and(
        eq(boardAsk.id, existing.id),
        eq(boardAsk.status, "open"),
        eq(boardAsk.revision, existing.revision),
      ),
    )
    .returning();
  if (!row) return { ok: false, status: 409, error: "This ask changed concurrently" };
  await appendAskEvent(row.id, {
    dedupeKey: `snoozed:r${row.revision}:${until.getTime()}`,
    kind: "snoozed",
    actorType: "session",
    actorRef: actor.sessionHash ?? null,
    revision: row.revision,
    detail: `until ${until.toISOString()}`,
  });
  notifyBoardChanged(userId);
  return { ok: true, row };
}

export async function dismissAsk(
  userId: string,
  askId: string,
  input: BoardDismissInput,
  actor: CaptainActor,
): Promise<{ ok: true; row: AskRow } | BoardFailure> {
  const rejected = screen([input.reason]);
  if (rejected) return rejected;
  const existing = await ownedAsk(userId, askId);
  if (!existing) return { ok: false, status: 404, error: "Ask not found" };
  if (existing.status !== "open") {
    return { ok: false, status: 409, error: "This ask is no longer open", ask: existing };
  }
  if (input.digest !== existing.actionDigest) {
    return {
      ok: false,
      status: 409,
      error: "This question changed; reload the card",
      ask: existing,
    };
  }
  const now = new Date();
  const [row] = await db
    .update(boardAsk)
    .set({
      ...terminalFields(existing, "cancelled", now),
      cancelReason: input.reason ?? "Dismissed by the captain",
      answeredVia: actor.via,
      answeredSessionHash: actor.sessionHash ?? null,
    })
    .where(
      and(
        eq(boardAsk.id, existing.id),
        eq(boardAsk.status, "open"),
        eq(boardAsk.revision, existing.revision),
      ),
    )
    .returning();
  if (!row) return { ok: false, status: 409, error: "This ask changed concurrently" };
  await appendAskEvent(row.id, {
    dedupeKey: `cancelled:r${row.revision}`,
    kind: "cancelled",
    actorType: "session",
    actorRef: actor.sessionHash ?? null,
    revision: row.revision,
    detail: input.reason ?? "Dismissed by the captain",
  });
  notifyBoardChanged(userId);
  void deliverBoardCallbacks();
  return { ok: true, row };
}

export { ownedAsk };

// ---------------------------------------------------------------------------
// Work items and notes
// ---------------------------------------------------------------------------

export async function upsertWork(
  token: TokenRow,
  input: BoardWorkUpsertInput,
): Promise<{ ok: true; row: WorkRow; created: boolean } | BoardFailure> {
  const rejected = screen([
    input.key,
    input.title,
    input.detail,
    input.statusLabel,
    input.host,
    input.agentDisplay,
    ...(input.links ?? []).flatMap((link) => [link.label, link.url]),
  ]);
  if (rejected) return rejected;
  const now = new Date();
  // Read, merge, and write in one synchronous transaction so concurrent heartbeats on a key
  // cannot copy each other's stale snapshot over a field the other just set.
  const outcome = db.transaction(
    (tx): { ok: true; row: WorkRow; created: boolean } | BoardFailure => {
      const existing = tx
        .select()
        .from(boardWorkItem)
        .where(and(eq(boardWorkItem.userId, token.userId), eq(boardWorkItem.workKey, input.key)))
        .get();
      if (
        existing &&
        existing.requesterTokenId !== token.id &&
        existing.requesterTokenId !== null
      ) {
        return { ok: false, status: 409, error: "Another agent owns this work key" };
      }
      let waitingAskId: string | null;
      if (input.waitingAskKey) {
        const asks = tx
          .select({ id: boardAsk.id, status: boardAsk.status })
          .from(boardAsk)
          .where(and(eq(boardAsk.userId, token.userId), eq(boardAsk.askKey, input.waitingAskKey)))
          .all();
        if (asks.length === 0) {
          return { ok: false, status: 400, error: "No ask with that waitingAskKey" };
        }
        // An ask answered before the work reported it is no longer something to wait on.
        waitingAskId = asks.find((ask) => ask.status === "open")?.id ?? null;
      } else if (input.waitingAskKey === null || input.state !== "blocked") {
        waitingAskId = null;
      } else {
        waitingAskId = existing?.waitingAskId ?? null;
      }
      // Omitted fields keep the stored value; null (or [] for links) clears them.
      const kept = <T>(value: T | null | undefined, stored: T | null | undefined): T | null =>
        value === undefined ? (stored ?? null) : value;
      const fields = {
        requesterTokenId: token.id,
        agentLabel: token.name,
        agentDisplay: kept(input.agentDisplay, existing?.agentDisplay),
        title: input.title,
        state: input.state,
        statusLabel: kept(input.statusLabel, existing?.statusLabel),
        detail: kept(input.detail, existing?.detail),
        progress: kept(input.progress, existing?.progress),
        links: input.links ?? existing?.links ?? [],
        host: kept(input.host, existing?.host),
        waitingAskId,
        heartbeatTtlSeconds:
          kept(input.heartbeatTtlSeconds, existing?.heartbeatTtlSeconds) ??
          BOARD_DEFAULT_HEARTBEAT_TTL_SECONDS,
        lastHeartbeatAt: now,
        completedAt: null,
        completionVerb: null,
        updatedAt: now,
      };
      if (existing) {
        const startedAt =
          existing.startedAt ??
          (input.state === "in_flight" || input.state === "review" ? now : null);
        const row = tx
          .update(boardWorkItem)
          .set({ ...fields, startedAt })
          .where(eq(boardWorkItem.id, existing.id))
          .returning()
          .get();
        if (!row) return { ok: false, status: 409, error: "Work item changed concurrently" };
        return { ok: true, row, created: false };
      }
      const row = tx
        .insert(boardWorkItem)
        .values({
          id: newId("bwork"),
          userId: token.userId,
          workKey: input.key,
          ...fields,
          startedAt: input.state === "in_flight" || input.state === "review" ? now : null,
          createdAt: now,
        })
        .returning()
        .get();
      if (!row) return { ok: false, status: 409, error: "Work item was created concurrently" };
      return { ok: true, row, created: true };
    },
  );
  if (outcome.ok) notifyBoardChanged(token.userId);
  return outcome;
}

export async function markDone(
  token: TokenRow,
  input: BoardDoneInput,
): Promise<{ ok: true; row: WorkRow } | BoardFailure> {
  const rejected = screen([
    input.key,
    input.title,
    input.note,
    input.agentDisplay,
    ...input.links.flatMap((link) => [link.label, link.url]),
  ]);
  if (rejected) return rejected;
  const now = new Date();
  const [existing] = await db
    .select()
    .from(boardWorkItem)
    .where(and(eq(boardWorkItem.userId, token.userId), eq(boardWorkItem.workKey, input.key)))
    .limit(1);
  if (existing && existing.requesterTokenId !== token.id && existing.requesterTokenId !== null) {
    return { ok: false, status: 409, error: "Another agent owns this work key" };
  }
  if (!existing && !input.title) {
    return { ok: false, status: 422, error: "A new done item needs a title" };
  }
  const links = existing
    ? [
        ...existing.links,
        ...input.links.filter((link) => !existing.links.some((known) => known.url === link.url)),
      ]
    : input.links;
  const fields = {
    requesterTokenId: token.id,
    agentLabel: token.name,
    agentDisplay: input.agentDisplay ?? existing?.agentDisplay ?? null,
    title: input.title ?? existing?.title ?? input.key,
    state: input.outcome,
    links,
    note: input.note ?? null,
    waitingAskId: null,
    completedAt: now,
    completionVerb: input.verb,
    lastHeartbeatAt: now,
    updatedAt: now,
  };
  const [row] = existing
    ? await db
        .update(boardWorkItem)
        .set(fields)
        .where(eq(boardWorkItem.id, existing.id))
        .returning()
    : await db
        .insert(boardWorkItem)
        .values({
          id: newId("bwork"),
          userId: token.userId,
          workKey: input.key,
          ...fields,
          startedAt: null,
          createdAt: now,
        })
        .returning();
  if (!row) return { ok: false, status: 409, error: "Work item changed concurrently" };
  notifyBoardChanged(token.userId);
  return { ok: true, row };
}

export async function upsertNote(
  token: TokenRow,
  input: BoardNoteUpsertInput,
): Promise<{ ok: true; row: NoteRow; created: boolean } | BoardFailure> {
  const rejected = screen([input.key, input.text, input.detail, input.link, input.agentDisplay]);
  if (rejected) return rejected;
  const now = new Date();
  const expiresAt =
    input.expiresInSeconds === undefined || input.expiresInSeconds === null
      ? null
      : new Date(now.getTime() + input.expiresInSeconds * 1000);
  const [existing] = await db
    .select()
    .from(boardNote)
    .where(and(eq(boardNote.userId, token.userId), eq(boardNote.noteKey, input.key)))
    .limit(1);
  if (existing && existing.requesterTokenId !== token.id && existing.requesterTokenId !== null) {
    return { ok: false, status: 409, error: "Another agent owns this note key" };
  }
  const fields = {
    requesterTokenId: token.id,
    agentLabel: token.name,
    agentDisplay: input.agentDisplay ?? existing?.agentDisplay ?? null,
    text: input.text,
    detail: input.detail ?? null,
    link: input.link ?? null,
    expiresAt,
    updatedAt: now,
  };
  const [row] = existing
    ? await db.update(boardNote).set(fields).where(eq(boardNote.id, existing.id)).returning()
    : await db
        .insert(boardNote)
        .values({
          id: newId("bnote"),
          userId: token.userId,
          noteKey: input.key,
          ...fields,
          createdAt: now,
        })
        .returning();
  if (!row) return { ok: false, status: 409, error: "Note changed concurrently" };
  notifyBoardChanged(token.userId);
  return { ok: true, row, created: !existing };
}

export async function clearNote(token: TokenRow, key: string): Promise<boolean> {
  const deleted = await db
    .delete(boardNote)
    .where(
      and(
        eq(boardNote.userId, token.userId),
        eq(boardNote.noteKey, key),
        or(eq(boardNote.requesterTokenId, token.id), isNull(boardNote.requesterTokenId)),
      ),
    )
    .returning({ id: boardNote.id });
  if (deleted.length > 0) notifyBoardChanged(token.userId);
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------
// Sweeps
// ---------------------------------------------------------------------------

/** Flips open asks past their expiry and queues their callbacks. */
export async function sweepExpiredAsks(now = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(boardAsk)
    .where(
      and(eq(boardAsk.status, "open"), isNotNull(boardAsk.expiresAt), lte(boardAsk.expiresAt, now)),
    )
    .limit(100);
  const users = new Set<string>();
  // `now` only decides what is due; the recorded transition time is the real clock.
  const recordedAt = new Date();
  for (const existing of due) {
    const [row] = await db
      .update(boardAsk)
      .set(terminalFields(existing, "expired", recordedAt))
      .where(and(eq(boardAsk.id, existing.id), eq(boardAsk.status, "open")))
      .returning();
    if (!row) continue;
    await appendAskEvent(row.id, {
      dedupeKey: `expired:r${row.revision}`,
      kind: "expired",
      actorType: "system",
      revision: row.revision,
    });
    users.add(row.userId);
  }
  for (const userId of users) notifyBoardChanged(userId);
  if (users.size > 0) void deliverBoardCallbacks();
  return due.length;
}

export function startBoardSweeper(): () => void {
  const sweep = () => {
    void sweepExpiredAsks().catch(() => {});
    try {
      sweepBoardPushRetries();
    } catch (error) {
      console.error("[board] Retry sweep failed", error);
    }
  };
  sweep();
  const timer = setInterval(sweep, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// The captain's page
// ---------------------------------------------------------------------------

const PRIORITY_ORDER = sql`case ${boardAsk.priority} when 'p0' then 0 when 'p1' then 1 else 2 end`;

export async function boardPageForUser(userId: string, now = new Date()): Promise<BoardPageDto> {
  const doneSince = new Date(now.getTime() - BOARD_DONE_WINDOW_DAYS * 86_400_000);
  const [openAsks, withAgentAsks, doneAsks, activeWork, doneWork, notes, crewRows] =
    await Promise.all([
      db
        .select()
        .from(boardAsk)
        .where(and(eq(boardAsk.userId, userId), eq(boardAsk.status, "open")))
        .orderBy(PRIORITY_ORDER, asc(boardAsk.createdAt)),
      db
        .select()
        .from(boardAsk)
        .where(
          and(
            eq(boardAsk.userId, userId),
            inArray(boardAsk.status, ["answered", "cancelled"]),
            isNull(boardAsk.ackedAt),
            isNotNull(boardAsk.answeredVia),
          ),
        )
        .orderBy(desc(boardAsk.resolvedAt)),
      db
        .select()
        .from(boardAsk)
        .where(
          and(
            eq(boardAsk.userId, userId),
            eq(boardAsk.status, "answered"),
            isNotNull(boardAsk.ackedAt),
            gt(boardAsk.resolvedAt, doneSince),
          ),
        )
        .orderBy(desc(boardAsk.resolvedAt))
        .limit(BOARD_DONE_MAX_ITEMS),
      db
        .select()
        .from(boardWorkItem)
        .where(
          and(
            eq(boardWorkItem.userId, userId),
            inArray(boardWorkItem.state, [...ACTIVE_WORK_STATES]),
          ),
        )
        .orderBy(desc(boardWorkItem.lastHeartbeatAt)),
      db
        .select()
        .from(boardWorkItem)
        .where(
          and(
            eq(boardWorkItem.userId, userId),
            inArray(boardWorkItem.state, [...TERMINAL_WORK_STATES]),
            gt(boardWorkItem.completedAt, doneSince),
          ),
        )
        .orderBy(desc(boardWorkItem.completedAt))
        .limit(BOARD_DONE_MAX_ITEMS),
      db
        .select()
        .from(boardNote)
        .where(
          and(
            eq(boardNote.userId, userId),
            or(isNull(boardNote.expiresAt), gt(boardNote.expiresAt, now)),
          ),
        )
        .orderBy(desc(boardNote.updatedAt)),
      db
        .select({ id: apiToken.id, name: apiToken.name, lastUsedAt: apiToken.lastUsedAt })
        .from(apiToken)
        .where(
          and(
            eq(apiToken.userId, userId),
            isNull(apiToken.revokedAt),
            or(
              sql`exists (select 1 from ${boardAsk} where ${boardAsk.requesterTokenId} = ${apiToken.id})`,
              sql`exists (select 1 from ${boardWorkItem} where ${boardWorkItem.requesterTokenId} = ${apiToken.id})`,
              sql`exists (select 1 from ${boardNote} where ${boardNote.requesterTokenId} = ${apiToken.id})`,
            ),
          ),
        )
        .orderBy(desc(apiToken.lastUsedAt)),
    ]);

  const waiting = openAsks.filter(
    (row) => !row.snoozeUntil || row.snoozeUntil.getTime() <= now.getTime(),
  );
  const crew: BoardCrewEntryDto[] = crewRows.map((token) => ({
    tokenId: token.id,
    agent: token.name,
    lastSeenAt: token.lastUsedAt?.toISOString() ?? null,
    openAsks: openAsks.filter((row) => row.requesterTokenId === token.id).length,
    inFlight: activeWork.filter(
      (row) => row.requesterTokenId === token.id && row.state !== "queued",
    ).length,
  }));
  const done = [
    ...doneWork.map((item) => ({ kind: "work" as const, item: toWorkDto(item, now) })),
    ...doneAsks.map((item) => ({ kind: "ask" as const, item: toAskDto(item, now) })),
  ]
    .sort((a, b) => {
      const at = a.kind === "work" ? a.item.completedAt : a.item.answer?.answeredAt;
      const bt = b.kind === "work" ? b.item.completedAt : b.item.answer?.answeredAt;
      return (bt ? Date.parse(bt) : 0) - (at ? Date.parse(at) : 0);
    })
    .slice(0, BOARD_DONE_MAX_ITEMS);
  const latest = Math.max(
    0,
    ...openAsks.map((row) => row.updatedAt.getTime()),
    ...withAgentAsks.map((row) => row.updatedAt.getTime()),
    ...activeWork.map((row) => row.updatedAt.getTime()),
    ...notes.map((row) => row.updatedAt.getTime()),
  );
  return {
    waiting: waiting.map((row) => toAskDto(row, now)),
    withAgent: withAgentAsks.map((row) => toAskDto(row, now)),
    inFlight: activeWork.filter((row) => row.state !== "queued").map((row) => toWorkDto(row, now)),
    queued: activeWork.filter((row) => row.state === "queued").map((row) => toWorkDto(row, now)),
    notes: notes.map(toNoteDto),
    done,
    crew,
    cursor: `${boardVersion(userId)}:${latest}`,
    generatedAt: now.toISOString(),
  };
}
