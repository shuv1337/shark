import type {
  OncallGroupDto,
  OncallOverrideDto,
  OncallPageCreateInput,
  OncallPageCreateResponse,
  OncallPageDto,
  OncallPageStatus,
  OncallPersonDto,
  OncallRotationInput,
  OncallShiftDto,
} from "@hark/contracts";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { db, type Executor } from "../db";
import {
  app,
  device,
  oncallGroup,
  oncallOverride,
  oncallPage,
  oncallPageRecipient,
  teamMember,
  user as userTable,
} from "../db/schema";
import { isEmailAllowed } from "./admission";
import { checkAppUrl, toAppSummaryDto } from "./apps";
import { checkNotificationAllowance, trackNotification } from "./billing";
import { newId } from "./id";
import {
  currentShift,
  isValidTimeZone,
  nextInRotation,
  normalizeRotationStart,
  type OverrideWindow,
  type RotationConfig,
  type Shift,
  upcomingShifts,
} from "./oncall-schedule";
import { buildPageClaimedPushMessages, buildPagePushMessages, sendPushMessages } from "./push";
import { RATE_LIMIT_ERRORS, type RateAdmission, type RateWindow } from "./rate-windows";
import { memberIds } from "./teams";
import { generatePageResponseToken, hashPageResponseToken } from "./token";

export type GroupRow = typeof oncallGroup.$inferSelect;
export type PageRow = typeof oncallPage.$inferSelect;

const OPEN_STATUSES = ["triggered", "acknowledged"] as const;
const UPCOMING_SHIFTS = 5;
/** New pages a group accepts per minute; duplicates that merge do not count. */
export const PAGES_PER_GROUP_PER_MINUTE = 10;
/**
 * First wait before the worker pages an undelivered recipient again. Each
 * further retry waits twice as long, up to {@link UNDELIVERED_RETRY_MAX_MS}.
 */
export const UNDELIVERED_RETRY_MS = 60_000;
export const UNDELIVERED_RETRY_MAX_MS = 15 * 60_000;
/** The worker stops retrying pages older than this; escalation steps still run. */
export const UNDELIVERED_RETRY_MAX_AGE_MS = 24 * 3_600_000;
/**
 * How long an attempt may stay in flight before it is presumed lost (for
 * example, the server restarted mid-send). Expo requests time out well
 * before this (see `EXPO_RESPONSE_TIMEOUT_MS`), so a slow request is not
 * mistaken for a lost one and paged twice.
 */
export const DELIVERY_STALE_MS = 5 * 60_000;
/** Retries per worker pass, so a backlog after a deploy drains gradually. */
export const RETRIES_PER_PASS = 10;
/** Expo refusals that repeating the same page cannot fix. */
const PERMANENT_PUSH_ERRORS = new Set([
  "MessageTooBig",
  "InvalidPayload",
  "InvalidCredentials",
  "MismatchSenderId",
]);

export type DeliveryStatus = "pending" | "delivered" | "failed" | "skipped" | "undeliverable";

/** Wait before retry `attempts + 1`, with jitter so retries do not land together. */
export function retryDelayMs(attempts: number, random = Math.random()): number {
  const base = Math.min(
    UNDELIVERED_RETRY_MS * 2 ** Math.max(0, attempts - 1),
    UNDELIVERED_RETRY_MAX_MS,
  );
  return Math.round(base * (1 + 0.2 * random));
}

// ---------------------------------------------------------------------------
// Groups and schedules
// ---------------------------------------------------------------------------

export function rotationOf(group: GroupRow): RotationConfig {
  return {
    memberIds: group.memberIds,
    period: group.period === "weekly" ? "weekly" : "daily",
    handoffAt: group.handoffAt,
    timezone: group.timezone,
    startsAt: group.startsAt.getTime(),
  };
}

async function activeOverrides(groupId: string, now: number) {
  return db
    .select()
    .from(oncallOverride)
    .where(and(eq(oncallOverride.groupId, groupId), gt(oncallOverride.endsAt, new Date(now))))
    .orderBy(asc(oncallOverride.startsAt), asc(oncallOverride.id));
}

export function overrideWindows(rows: Array<typeof oncallOverride.$inferSelect>): OverrideWindow[] {
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    startsAt: row.startsAt.getTime(),
    endsAt: row.endsAt.getTime(),
    createdAt: row.createdAt.getTime(),
  }));
}

export async function people(ids: Iterable<string>): Promise<Map<string, OncallPersonDto>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: userTable.id, name: userTable.name, image: userTable.image })
    .from(userTable)
    .where(inArray(userTable.id, unique));
  return new Map(rows.map((row) => [row.id, { userId: row.id, name: row.name, image: row.image }]));
}

function personOrUnknown(map: Map<string, OncallPersonDto>, id: string): OncallPersonDto {
  return map.get(id) ?? { userId: id, name: "Former member", image: null };
}

function toShiftDto(shift: Shift, map: Map<string, OncallPersonDto>): OncallShiftDto {
  return {
    person: personOrUnknown(map, shift.userId),
    startsAt: new Date(shift.startsAt).toISOString(),
    endsAt: new Date(shift.endsAt).toISOString(),
    override: shift.override,
    ...(shift.overrideId ? { overrideId: shift.overrideId } : {}),
  };
}

/** Who is on call right now, from the rotation or an override. */
export async function onCallNow(group: GroupRow, now = Date.now()): Promise<Shift | null> {
  const overrides = overrideWindows(await activeOverrides(group.id, now));
  return currentShift(rotationOf(group), overrides, now);
}

export async function toGroupDto(group: GroupRow, now = Date.now()): Promise<OncallGroupDto> {
  const overrideRows = await activeOverrides(group.id, now);
  const windows = overrideWindows(overrideRows);
  const rotation = rotationOf(group);
  const shifts = upcomingShifts(rotation, windows, now, UPCOMING_SHIFTS);
  const current = currentShift(rotation, windows, now);
  const map = await people([
    ...group.memberIds,
    ...overrideRows.map((row) => row.userId),
    ...shifts.map((shift) => shift.userId),
  ]);
  const [open] = await db
    .select({ value: count() })
    .from(oncallPage)
    .where(and(eq(oncallPage.groupId, group.id), inArray(oncallPage.status, [...OPEN_STATUSES])));
  const overrides: OncallOverrideDto[] = overrideRows.map((row) => ({
    id: row.id,
    person: personOrUnknown(map, row.userId),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  }));
  return {
    id: group.id,
    teamId: group.teamId,
    name: group.name,
    rotation: {
      members: group.memberIds.map((id) => personOrUnknown(map, id)),
      period: rotation.period,
      handoffAt: group.handoffAt,
      timezone: group.timezone,
      startsAt: group.startsAt.toISOString(),
    },
    escalation: group.escalation,
    current: current ? toShiftDto(current, map) : null,
    upcoming: shifts.map((shift) => toShiftDto(shift, map)),
    overrides,
    openPageCount: open?.value ?? 0,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

/** Group with its team, scoped to a member of that team. */
export async function memberGroup(
  groupId: string,
  userId: string,
): Promise<{ group: GroupRow; role: string } | undefined> {
  const [row] = await db
    .select({ group: oncallGroup, role: teamMember.role })
    .from(oncallGroup)
    .innerJoin(
      teamMember,
      and(eq(teamMember.teamId, oncallGroup.teamId), eq(teamMember.userId, userId)),
    )
    .where(eq(oncallGroup.id, groupId))
    .limit(1);
  return row;
}

export type RotationCheck =
  | {
      ok: true;
      values: Pick<GroupRow, "memberIds" | "period" | "handoffAt" | "timezone" | "startsAt">;
    }
  | { ok: false; error: string };

/** Validates a rotation against the team and normalizes its first handoff. */
export async function checkRotation(
  teamId: string,
  rotation: OncallRotationInput,
  now = Date.now(),
): Promise<RotationCheck> {
  if (!isValidTimeZone(rotation.timezone)) return { ok: false, error: "Unknown time zone" };
  const ordered = [...new Set(rotation.memberIds)];
  if (ordered.length !== rotation.memberIds.length) {
    return { ok: false, error: "Each member can appear in the rotation once" };
  }
  const members = new Set(await memberIds(teamId));
  if (!ordered.every((id) => members.has(id))) {
    return { ok: false, error: "Every rotation member must belong to the team" };
  }
  const startsAt = normalizeRotationStart(
    rotation.handoffAt,
    rotation.timezone,
    rotation.startsAt ? Date.parse(rotation.startsAt) : undefined,
    now,
  );
  return {
    ok: true,
    values: {
      memberIds: ordered,
      period: rotation.period,
      handoffAt: rotation.handoffAt,
      timezone: rotation.timezone,
      startsAt: new Date(startsAt),
    },
  };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export async function toPageDtos(rows: PageRow[]): Promise<OncallPageDto[]> {
  if (rows.length === 0) return [];
  const pageIds = rows.map((row) => row.id);
  const [groups, recipients, apps] = await Promise.all([
    db
      .select({ id: oncallGroup.id, name: oncallGroup.name })
      .from(oncallGroup)
      .where(inArray(oncallGroup.id, [...new Set(rows.map((row) => row.groupId))])),
    db
      .select()
      .from(oncallPageRecipient)
      .where(inArray(oncallPageRecipient.pageId, pageIds))
      .orderBy(asc(oncallPageRecipient.notifiedAt), asc(oncallPageRecipient.step)),
    db
      .select()
      .from(app)
      .where(
        inArray(
          app.id,
          rows.flatMap((row) => (row.appId ? [row.appId] : [])),
        ),
      ),
  ]);
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const appsById = new Map(apps.map((row) => [row.id, row]));
  const map = await people([
    ...recipients.map((recipient) => recipient.userId),
    ...rows
      .flatMap((row) => [row.acknowledgedByUserId, row.resolvedByUserId])
      .filter((id): id is string => typeof id === "string"),
  ]);
  const recipientsOf = (pageId: string, statuses: readonly string[]) =>
    recipients
      .filter(
        (recipient) => recipient.pageId === pageId && statuses.includes(recipient.deliveryStatus),
      )
      .map((recipient) => personOrUnknown(map, recipient.userId));
  return rows.map((row) => {
    const pageApp = row.appId ? appsById.get(row.appId) : undefined;
    return {
      id: row.id,
      groupId: row.groupId,
      groupName: groupNames.get(row.groupId) ?? "",
      teamId: row.teamId,
      title: row.title,
      body: row.body,
      url: row.url,
      app: pageApp ? toAppSummaryDto(pageApp) : null,
      status: row.status as OncallPageStatus,
      dedupKey: row.dedupKey,
      repeatCount: row.repeatCount,
      notified: recipientsOf(row.id, ["delivered"]),
      undelivered: recipientsOf(row.id, ["failed", "skipped", "undeliverable"]),
      escalationStep: row.escalationStep,
      nextEscalationAt: row.nextEscalationAt?.toISOString() ?? null,
      acknowledgedBy: row.acknowledgedByUserId
        ? personOrUnknown(map, row.acknowledgedByUserId)
        : null,
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      resolvedBy: row.resolvedByUserId ? personOrUnknown(map, row.resolvedByUserId) : null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      source: row.sourceName,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function toPageDto(row: PageRow): Promise<OncallPageDto> {
  const [dto] = await toPageDtos([row]);
  return dto as OncallPageDto;
}

/** Page scoped to a member of its team. */
export async function memberPage(pageId: string, userId: string): Promise<PageRow | undefined> {
  const [row] = await db
    .select({ page: oncallPage })
    .from(oncallPage)
    .innerJoin(
      teamMember,
      and(eq(teamMember.teamId, oncallPage.teamId), eq(teamMember.userId, userId)),
    )
    .where(eq(oncallPage.id, pageId))
    .limit(1);
  return row?.page;
}

async function devicesOf(userIds: string[]) {
  if (userIds.length === 0) return [];
  return db
    .select({ userId: device.userId, token: device.expoPushToken })
    .from(device)
    .where(
      and(inArray(device.userId, userIds), eq(device.active, true), eq(device.platform, "ios")),
    );
}

async function deactivateStale(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db.update(device).set({ active: false }).where(inArray(device.expoPushToken, tokens));
}

/** An attempt that is still sending, not presumed lost. */
function inFlight(now: number): SQL {
  return and(
    eq(oncallPageRecipient.deliveryStatus, "pending"),
    gt(oncallPageRecipient.notifiedAt, new Date(now - DELIVERY_STALE_MS)),
  ) as SQL;
}

/**
 * Who an escalation step or a person may page again: anyone whose push did
 * not land, including a permanent refusal, or whose attempt was lost.
 */
function redeliverableByStep(now: number): SQL {
  return or(
    inArray(oncallPageRecipient.deliveryStatus, ["failed", "skipped", "undeliverable"]),
    and(
      eq(oncallPageRecipient.deliveryStatus, "pending"),
      lte(oncallPageRecipient.notifiedAt, new Date(now - DELIVERY_STALE_MS)),
    ),
  ) as SQL;
}

/** Who the worker retries on its own: a due failure or skip, or a lost attempt. */
function dueForRetry(now: number): SQL {
  return or(
    and(
      inArray(oncallPageRecipient.deliveryStatus, ["failed", "skipped"]),
      lte(oncallPageRecipient.nextAttemptAt, new Date(now)),
    ),
    and(
      eq(oncallPageRecipient.deliveryStatus, "pending"),
      lte(oncallPageRecipient.notifiedAt, new Date(now - DELIVERY_STALE_MS)),
    ),
  ) as SQL;
}

function pageIsTriggered(pageId: string): SQL {
  return inArray(
    oncallPageRecipient.pageId,
    db
      .select({ id: oncallPage.id })
      .from(oncallPage)
      .where(and(eq(oncallPage.id, pageId), eq(oncallPage.status, "triggered"))),
  );
}

/**
 * Starts a delivery attempt for `userId` with a fresh one-shot credential.
 * A recipient already delivered, or with an attempt in flight, is not
 * claimed. An undelivered recipient's earlier credential never reached a
 * device, so replacing it is safe. Returns the credential, or null.
 */
async function claimDelivery(
  pageId: string,
  userId: string,
  step: number,
  now: number,
): Promise<string | null> {
  const responseToken = generatePageResponseToken();
  // Synchronous, so a page acknowledged or resolved meanwhile gains no new recipient.
  const outcome = db.transaction((tx) => {
    const open = tx
      .select({ id: oncallPage.id })
      .from(oncallPage)
      .where(and(eq(oncallPage.id, pageId), eq(oncallPage.status, "triggered")))
      .get();
    if (!open) return "closed" as const;
    const inserted = tx
      .insert(oncallPageRecipient)
      .values({
        pageId,
        userId,
        step,
        responseTokenHash: hashPageResponseToken(responseToken),
        deliveryStatus: "pending",
        deliveryAttempts: 1,
        notifiedAt: new Date(now),
      })
      .onConflictDoNothing()
      .returning({ userId: oncallPageRecipient.userId })
      .get();
    return inserted ? ("inserted" as const) : ("exists" as const);
  });
  if (outcome === "closed") return null;
  if (outcome === "inserted") return responseToken;
  return reclaimDelivery(pageId, userId, now, redeliverableByStep(now));
}

/**
 * Claims another attempt for an existing undelivered recipient matching
 * `eligible`. A credential claimed by a lock-screen action in progress is
 * never replaced, and a page closed meanwhile is not paged again.
 */
async function reclaimDelivery(
  pageId: string,
  userId: string,
  now: number,
  eligible: SQL,
): Promise<string | null> {
  const responseToken = generatePageResponseToken();
  const reclaimed = await db
    .update(oncallPageRecipient)
    .set({
      responseTokenHash: hashPageResponseToken(responseToken),
      acceptedCount: 0,
      deliveryStatus: "pending",
      deliveryAttempts: sql`${oncallPageRecipient.deliveryAttempts} + 1`,
      nextAttemptAt: null,
      notifiedAt: new Date(now),
    })
    .where(
      and(
        eq(oncallPageRecipient.pageId, pageId),
        eq(oncallPageRecipient.userId, userId),
        eligible,
        isNull(oncallPageRecipient.responseTokenUsedAt),
        pageIsTriggered(pageId),
      ),
    )
    .returning({ userId: oncallPageRecipient.userId });
  return reclaimed.length > 0 ? responseToken : null;
}

/**
 * Sends one claimed attempt and records the outcome. A failure or skip is
 * scheduled for retry with backoff; a permanent refusal is not. Returns
 * pushes accepted.
 */
async function deliver(
  page: PageRow,
  groupName: string,
  userId: string,
  responseToken: string,
  tokens: string[],
): Promise<number> {
  let accepted = 0;
  let deliveryStatus: DeliveryStatus = "skipped";
  let staleTokens: string[] = [];
  let retry = true;
  if (tokens.length > 0) {
    try {
      const messages = buildPagePushMessages({
        to: tokens,
        pageId: page.id,
        teamId: page.teamId,
        groupName,
        title: page.title,
        body: page.body ?? `${groupName}: paged by ${page.sourceName}`,
        responseToken,
        ...(page.url ? { url: page.url } : {}),
        ...(page.appId ? { appId: page.appId } : {}),
      });
      const [current] = await db
        .select({ status: oncallPage.status })
        .from(oncallPage)
        .where(eq(oncallPage.id, page.id))
        .limit(1);
      if (current?.status !== "triggered") {
        // Closed since the claim; send nothing and leave nothing to retry.
        retry = false;
      } else {
        const result = await sendPushMessages(messages);
        accepted = result.accepted;
        staleTokens = result.staleTokens;
        const codes = result.errorCodes ?? [];
        if (accepted > 0) deliveryStatus = "delivered";
        else if (codes.length > 0 && codes.every((code) => PERMANENT_PUSH_ERRORS.has(code))) {
          deliveryStatus = "undeliverable";
          retry = false;
        } else deliveryStatus = "failed";
        if (accepted === 0) {
          console.error("[oncall] Page push not accepted", { pageId: page.id, codes });
        }
      }
    } catch (error) {
      console.error("[oncall] Page push failed", error);
      deliveryStatus = "failed";
    }
  }
  const hash = hashPageResponseToken(responseToken);
  const attempt = and(
    eq(oncallPageRecipient.pageId, page.id),
    eq(oncallPageRecipient.userId, userId),
    eq(oncallPageRecipient.responseTokenHash, hash),
  );
  // Scoped to this attempt's credential so a slower, superseded attempt cannot overwrite a newer one.
  const [row] = await db
    .select({ attempts: oncallPageRecipient.deliveryAttempts })
    .from(oncallPageRecipient)
    .where(attempt)
    .limit(1);
  const nextAttemptAt =
    deliveryStatus === "delivered" || !retry || !row
      ? null
      : new Date(Date.now() + retryDelayMs(row.attempts));
  await db
    .update(oncallPageRecipient)
    .set({ acceptedCount: accepted, deliveryStatus, nextAttemptAt })
    .where(attempt);
  await deactivateStale(staleTokens);
  if (accepted > 0) {
    const reached = tokens.filter((token) => !staleTokens.includes(token));
    await withdrawIfClosed(page.id, reached).catch((error: unknown) => {
      console.error("[oncall] Could not withdraw a late page push", error);
    });
  }
  return accepted;
}

/**
 * Withdraws a page push that was accepted after the page was acknowledged or
 * resolved. The page.claimed sent when it closed may have reached the
 * device first, which would leave this alert showing.
 */
async function withdrawIfClosed(pageId: string, tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  const [current] = await db
    .select({
      status: oncallPage.status,
      acknowledgedByUserId: oncallPage.acknowledgedByUserId,
      resolvedByUserId: oncallPage.resolvedByUserId,
    })
    .from(oncallPage)
    .where(eq(oncallPage.id, pageId))
    .limit(1);
  if (!current || current.status === "triggered") return;
  const closedBy = current.acknowledgedByUserId ?? current.resolvedByUserId;
  const result = await sendPushMessages(
    buildPageClaimedPushMessages(tokens, pageId, closedBy ? await userName(closedBy) : "Someone"),
  );
  await deactivateStale(result.staleTokens);
}

/**
 * Pages `userIds`, skipping anyone already delivered or with an attempt in
 * flight, each with their own one-shot lock-screen credential. Returns
 * pushes accepted by Expo and how many people an attempt was started for.
 */
async function notifyRecipients(
  page: PageRow,
  groupName: string,
  userIds: string[],
  step: number,
): Promise<{ accepted: number; attempted: number }> {
  let accepted = 0;
  let attempted = 0;
  const targets = await devicesOf(userIds);
  for (const userId of userIds) {
    const responseToken = await claimDelivery(page.id, userId, step, Date.now());
    if (!responseToken) continue;
    attempted += 1;
    const tokens = targets.filter((target) => target.userId === userId).map((t) => t.token);
    accepted += await deliver(page, groupName, userId, responseToken, tokens);
  }
  return { accepted, attempted };
}

/** Team members who may still sign in; removed operators are never paged. */
async function pageableMemberIds(teamId: string): Promise<Set<string>> {
  const rows = await db
    .select({ userId: teamMember.userId, email: userTable.email })
    .from(teamMember)
    .innerJoin(userTable, eq(userTable.id, teamMember.userId))
    .where(eq(teamMember.teamId, teamId));
  return new Set(rows.filter((row) => isEmailAllowed(row.email)).map((row) => row.userId));
}

/** Rotation members still in the team, or the whole team when the rotation is empty. */
async function groupMembers(group: GroupRow): Promise<string[]> {
  const team = await pageableMemberIds(group.teamId);
  const rotation = group.memberIds.filter((id) => team.has(id));
  return rotation.length > 0 ? rotation : [...team];
}

function nextEscalationAt(group: GroupRow, step: number, from: number): Date | null {
  const next = group.escalation[step];
  return next ? new Date(from + next.afterMinutes * 60_000) : null;
}

export interface RaisePageInput {
  group: GroupRow;
  input: OncallPageCreateInput;
  /** Whose notification allowance the page counts against. */
  creatorUserId: string;
  sourceName: string;
  /** Webhook or API token that raised the page, whose rate window it counts against. */
  origin?: { serviceId?: string; requesterTokenId?: string };
  /**
   * Runs synchronously in the transaction that inserts a new page (never for
   * a merge). Returning a window rejects the page with 429, so a per-minute
   * window checked here cannot be overshot by concurrent requests.
   */
  admit?: RateAdmission;
}

export type RaisePageOutcome =
  | { ok: true; status: 200 | 201; body: OncallPageCreateResponse }
  | { ok: false; status: 400 | 429; error: string; refused?: RateWindow };

function mergeDuplicate(
  executor: Executor,
  group: GroupRow,
  dedupKey: string,
): PageRow | undefined {
  return executor
    .update(oncallPage)
    .set({
      repeatCount: sql`${oncallPage.repeatCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(oncallPage.groupId, group.id),
        eq(oncallPage.dedupKey, dedupKey),
        inArray(oncallPage.status, [...OPEN_STATUSES]),
      ),
    )
    .returning()
    .get();
}

/**
 * Raises a page on a group: it goes to whoever is on call now (or the whole
 * group when nobody is), then escalates on the group's schedule until
 * someone acknowledges. Duplicate `dedupKey`s merge into the open page.
 */
export async function raisePage({
  group,
  input,
  creatorUserId,
  sourceName,
  origin,
  admit,
}: RaisePageInput): Promise<RaisePageOutcome> {
  let appId: string | null = null;
  if (input.appId) {
    const [row] = await db
      .select()
      .from(app)
      .where(and(eq(app.id, input.appId), eq(app.teamId, group.teamId)))
      .limit(1);
    if (!row) return { ok: false, status: 400, error: "appId must be one of the team's apps" };
    const checked = checkAppUrl(row, input.url);
    if (!checked.ok) return { ok: false, status: 400, error: checked.error };
    appId = row.id;
  }

  const mergedOutcome = (row: PageRow): Promise<RaisePageOutcome> =>
    toPageDto(row).then((page) => ({
      ok: true,
      status: 200,
      body: { page, deduplicated: true, accepted: 0 },
    }));

  if (input.dedupKey) {
    const existing = mergeDuplicate(db, group, input.dedupKey);
    if (existing) return mergedOutcome(existing);
  }

  if (!(await checkNotificationAllowance(creatorUserId))) {
    return { ok: false, status: 429, error: "Monthly notification limit reached" };
  }

  const now = Date.now();
  const team = await pageableMemberIds(group.teamId);
  const shift = await onCallNow(group, now);
  const initial = shift && team.has(shift.userId) ? [shift.userId] : await groupMembers(group);

  const values: typeof oncallPage.$inferInsert = {
    id: newId("page"),
    groupId: group.id,
    teamId: group.teamId,
    title: input.title,
    body: input.body ?? null,
    url: input.url ?? null,
    appId,
    status: "triggered",
    dedupKey: input.dedupKey ?? null,
    escalationStep: 0,
    nextEscalationAt: nextEscalationAt(group, 0, now),
    lastPagedUserId: initial.length === 1 ? (initial[0] ?? null) : null,
    sourceName,
    requesterServiceId: origin?.serviceId ?? null,
    requesterTokenId: origin?.requesterTokenId ?? null,
    createdByUserId: creatorUserId,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
  // Synchronous, so concurrent requests cannot both pass the group cap or the
  // caller's windows, and a page with the same key raised meanwhile is merged
  // instead of conflicting.
  const created = db.transaction((tx) => {
    if (input.dedupKey) {
      const existing = mergeDuplicate(tx, group, input.dedupKey);
      if (existing) return { kind: "merged" as const, page: existing };
    }
    const recent = tx
      .select({ value: count() })
      .from(oncallPage)
      .where(
        and(eq(oncallPage.groupId, group.id), gte(oncallPage.createdAt, new Date(now - 60_000))),
      )
      .get();
    if ((recent?.value ?? 0) >= PAGES_PER_GROUP_PER_MINUTE) {
      return { kind: "limited" as const, error: "On-call page rate limit exceeded" };
    }
    const refused = admit?.(tx);
    if (refused) {
      return { kind: "limited" as const, error: RATE_LIMIT_ERRORS[refused], refused };
    }
    return {
      kind: "created" as const,
      page: tx.insert(oncallPage).values(values).returning().get(),
    };
  });
  if (created.kind === "merged") return mergedOutcome(created.page);
  if (created.kind === "limited") {
    return {
      ok: false,
      status: 429,
      error: created.error,
      ...("refused" in created ? { refused: created.refused } : {}),
    };
  }
  const page = created.page;
  if (!page) throw new Error("Failed to create page");

  const { accepted } = await notifyRecipients(page, group.name, initial, 0);
  if (accepted > 0) await trackNotification(creatorUserId, page.id);
  return {
    ok: true,
    status: 201,
    body: { page: await toPageDto(page), deduplicated: false, accepted },
  };
}

/** Everyone a delivery was attempted for, delivered or not. */
async function recipientUserIds(pageId: string): Promise<Set<string>> {
  const rows = await db
    .select({ userId: oncallPageRecipient.userId })
    .from(oncallPageRecipient)
    .where(eq(oncallPageRecipient.pageId, pageId));
  return new Set(rows.map((row) => row.userId));
}

/** Recipients whose page reached a device; escalation does not page them again. */
async function deliveredUserIds(pageId: string): Promise<Set<string>> {
  const rows = await db
    .select({ userId: oncallPageRecipient.userId })
    .from(oncallPageRecipient)
    .where(
      and(
        eq(oncallPageRecipient.pageId, pageId),
        eq(oncallPageRecipient.deliveryStatus, "delivered"),
      ),
    );
  return new Set(rows.map((row) => row.userId));
}

async function allInFlight(pageId: string, userIds: string[], now: number): Promise<boolean> {
  const [row] = await db
    .select({ value: count() })
    .from(oncallPageRecipient)
    .where(
      and(
        eq(oncallPageRecipient.pageId, pageId),
        inArray(oncallPageRecipient.userId, userIds),
        inFlight(now),
      ),
    );
  return (row?.value ?? 0) === userIds.length;
}

export type EscalateOutcome =
  | { ok: true; page: PageRow }
  | { ok: false; status: 404 | 409; error: string; page?: PageRow };

/**
 * Runs the page's next escalation step. The worker calls this when a step
 * is due; a person can run it early. Past the last configured step a manual
 * escalation pages the whole group.
 */
export async function escalatePage(pageId: string, manual: boolean): Promise<EscalateOutcome> {
  const [row] = await db
    .select({ page: oncallPage, group: oncallGroup })
    .from(oncallPage)
    .innerJoin(oncallGroup, eq(oncallGroup.id, oncallPage.groupId))
    .where(eq(oncallPage.id, pageId))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: "Page not found" };
  const { page, group } = row;
  if (page.status !== "triggered") {
    return { ok: false, status: 409, error: `Page is already ${page.status}`, page };
  }
  const stepIndex = page.escalationStep;
  const configured = group.escalation[stepIndex];
  const step = configured ?? (manual ? { afterMinutes: 0, target: "group" as const } : null);
  const now = Date.now();
  if (!step) {
    await db
      .update(oncallPage)
      .set({ nextEscalationAt: null })
      .where(and(eq(oncallPage.id, page.id), eq(oncallPage.escalationStep, stepIndex)));
    return { ok: true, page: { ...page, nextEscalationAt: null } };
  }

  // A person whose push failed or was skipped was not paged, so they stay eligible.
  const notified = await deliveredUserIds(page.id);
  const team = await pageableMemberIds(group.teamId);
  let targets: string[];
  let lastPagedUserId = page.lastPagedUserId;
  if (step.target === "next") {
    const rotation = rotationOf(group);
    const next = nextInRotation(
      { ...rotation, memberIds: rotation.memberIds.filter((id) => team.has(id)) },
      page.lastPagedUserId,
      notified,
      now,
    );
    targets = next ? [next] : [];
    if (next) lastPagedUserId = next;
  } else {
    targets = (await groupMembers(group)).filter((id) => !notified.has(id));
  }
  if (manual && targets.length === 0) {
    return { ok: false, status: 409, error: "Everyone in the group has already been paged", page };
  }
  if (targets.length > 0 && (await allInFlight(page.id, targets, now))) {
    // Running the step now would page nobody; keep it for when those attempts settle.
    if (manual) {
      return { ok: false, status: 409, error: "This page is still being delivered", page };
    }
    const retryAt = new Date(now + 30_000);
    await db
      .update(oncallPage)
      .set({ nextEscalationAt: retryAt })
      .where(
        and(
          eq(oncallPage.id, page.id),
          eq(oncallPage.status, "triggered"),
          eq(oncallPage.escalationStep, stepIndex),
        ),
      );
    return { ok: true, page: { ...page, nextEscalationAt: retryAt } };
  }

  // Claimed by step number, so the worker and a person cannot run a step twice.
  const [claimed] = await db
    .update(oncallPage)
    .set({
      escalationStep: stepIndex + 1,
      nextEscalationAt: nextEscalationAt(group, stepIndex + 1, now),
      lastPagedUserId,
      updatedAt: new Date(now),
    })
    .where(
      and(
        eq(oncallPage.id, page.id),
        eq(oncallPage.status, "triggered"),
        eq(oncallPage.escalationStep, stepIndex),
      ),
    )
    .returning();
  if (!claimed) {
    const [latest] = await db.select().from(oncallPage).where(eq(oncallPage.id, page.id)).limit(1);
    return { ok: false, status: 409, error: "Page changed; try again", page: latest ?? page };
  }
  const { accepted, attempted } = await notifyRecipients(
    claimed,
    group.name,
    targets,
    stepIndex + 1,
  );
  if (targets.length > 0 && attempted === 0) {
    // A concurrent attempt took every target after the check above; give the step back.
    const [restored] = await db
      .update(oncallPage)
      .set({
        escalationStep: stepIndex,
        nextEscalationAt: manual ? page.nextEscalationAt : new Date(now + 30_000),
        lastPagedUserId: page.lastPagedUserId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(oncallPage.id, page.id),
          eq(oncallPage.status, "triggered"),
          eq(oncallPage.escalationStep, stepIndex + 1),
        ),
      )
      .returning();
    if (restored) {
      return manual
        ? { ok: false, status: 409, error: "This page is still being delivered", page: restored }
        : { ok: true, page: restored };
    }
  }
  if (accepted > 0 && claimed.createdByUserId) {
    await trackNotification(claimed.createdByUserId, `${claimed.id}:${stepIndex + 1}`);
  }
  return { ok: true, page: claimed };
}

/** Clears the page from everyone else's devices once it is claimed. */
async function sendClaimed(page: PageRow, exceptUserId: string, claimedBy: string): Promise<void> {
  const recipients = [...(await recipientUserIds(page.id))].filter((id) => id !== exceptUserId);
  const targets = await devicesOf(recipients);
  if (targets.length === 0) return;
  const result = await sendPushMessages(
    buildPageClaimedPushMessages(
      targets.map((target) => target.token),
      page.id,
      claimedBy,
    ),
  );
  await deactivateStale(result.staleTokens);
}

async function userName(userId: string): Promise<string> {
  const [row] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row?.name ?? "Someone";
}

export type PageTransition =
  | { ok: true; page: PageRow }
  | { ok: false; status: 409; error: string; page: PageRow };

/** First acknowledgement wins; it stops escalation and clears everyone else's alert. */
export async function acknowledgePage(page: PageRow, userId: string): Promise<PageTransition> {
  const now = new Date();
  const [updated] = await db
    .update(oncallPage)
    .set({
      status: "acknowledged",
      acknowledgedByUserId: userId,
      acknowledgedAt: now,
      nextEscalationAt: null,
      updatedAt: now,
    })
    .where(and(eq(oncallPage.id, page.id), eq(oncallPage.status, "triggered")))
    .returning();
  if (!updated) {
    const [latest] = await db.select().from(oncallPage).where(eq(oncallPage.id, page.id)).limit(1);
    const current = latest ?? page;
    return { ok: false, status: 409, error: `Page is already ${current.status}`, page: current };
  }
  void sendClaimed(updated, userId, await userName(userId)).catch((error: unknown) => {
    console.error("[oncall] Could not send page.claimed", error);
  });
  return { ok: true, page: updated };
}

export async function resolvePage(
  page: PageRow,
  userId: string,
  note: string | undefined,
): Promise<PageTransition> {
  const now = new Date();
  const [updated] = await db
    .update(oncallPage)
    .set({
      status: "resolved",
      resolvedByUserId: userId,
      resolvedAt: now,
      resolveNote: note ?? null,
      nextEscalationAt: null,
      updatedAt: now,
    })
    .where(and(eq(oncallPage.id, page.id), inArray(oncallPage.status, [...OPEN_STATUSES])))
    .returning();
  if (!updated) {
    const [latest] = await db.select().from(oncallPage).where(eq(oncallPage.id, page.id)).limit(1);
    return { ok: false, status: 409, error: "Page is already resolved", page: latest ?? page };
  }
  // An unacknowledged page is still ringing on phones; clear it.
  if (page.status === "triggered") {
    void sendClaimed(updated, userId, await userName(userId)).catch((error: unknown) => {
      console.error("[oncall] Could not send page.claimed", error);
    });
  }
  return { ok: true, page: updated };
}

/** Resolves a lock-screen credential to its page and a still-admitted recipient. */
export async function pageRecipientByToken(pageId: string, responseToken: string) {
  const [row] = await db
    .select({
      page: oncallPage,
      userId: oncallPageRecipient.userId,
      usedAt: oncallPageRecipient.responseTokenUsedAt,
      email: userTable.email,
    })
    .from(oncallPageRecipient)
    .innerJoin(oncallPage, eq(oncallPage.id, oncallPageRecipient.pageId))
    .innerJoin(
      teamMember,
      and(
        eq(teamMember.teamId, oncallPage.teamId),
        eq(teamMember.userId, oncallPageRecipient.userId),
      ),
    )
    .innerJoin(userTable, eq(userTable.id, oncallPageRecipient.userId))
    .where(
      and(
        eq(oncallPageRecipient.pageId, pageId),
        eq(oncallPageRecipient.responseTokenHash, hashPageResponseToken(responseToken)),
      ),
    )
    .limit(1);
  if (!row || !isEmailAllowed(row.email)) return undefined;
  return { page: row.page, userId: row.userId, usedAt: row.usedAt };
}

export interface PageListQuery {
  status?: string;
  cursor?: string;
  limit?: string;
}

function encodeCursor(row: PageRow): string {
  return Buffer.from(`${row.createdAt.getTime()}:${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(value: string): { createdAt: number; id: string } | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  const separator = decoded.indexOf(":");
  const createdAt = Number.parseInt(decoded.slice(0, separator), 10);
  const id = decoded.slice(separator + 1);
  if (separator <= 0 || !Number.isFinite(createdAt) || !id) return null;
  return { createdAt, id };
}

export async function listTeamPages(
  teamId: string,
  query: PageListQuery,
): Promise<
  | { ok: true; body: { pages: OncallPageDto[]; nextCursor: string | null } }
  | { ok: false; error: string }
> {
  const status = query.status ?? "open";
  if (status !== "open" && status !== "all")
    return { ok: false, error: "status must be open or all" };
  const limit = Number.parseInt(query.limit ?? "20", 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return { ok: false, error: "limit must be between 1 and 50" };
  }
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  if (cursor === null) return { ok: false, error: "Invalid cursor" };
  const filters = [eq(oncallPage.teamId, teamId)];
  if (status === "open") filters.push(inArray(oncallPage.status, [...OPEN_STATUSES]));
  if (cursor) {
    const at = new Date(cursor.createdAt);
    filters.push(
      or(
        lt(oncallPage.createdAt, at),
        and(eq(oncallPage.createdAt, at), lt(oncallPage.id, cursor.id)),
      ) as SQL,
    );
  }
  const rows = await db
    .select()
    .from(oncallPage)
    .where(and(...filters))
    .orderBy(desc(oncallPage.createdAt), desc(oncallPage.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    ok: true,
    body: {
      pages: await toPageDtos(page),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    },
  };
}

/** Open pages that notified the user, newest first. */
export async function openPagesFor(userId: string): Promise<OncallPageDto[]> {
  const rows = await db
    .select({ page: oncallPage })
    .from(oncallPage)
    .innerJoin(
      oncallPageRecipient,
      and(eq(oncallPageRecipient.pageId, oncallPage.id), eq(oncallPageRecipient.userId, userId)),
    )
    .innerJoin(
      teamMember,
      and(eq(teamMember.teamId, oncallPage.teamId), eq(teamMember.userId, userId)),
    )
    .where(inArray(oncallPage.status, [...OPEN_STATUSES]))
    .orderBy(desc(oncallPage.createdAt))
    .limit(50);
  return toPageDtos(rows.map((row) => row.page));
}

// ---------------------------------------------------------------------------
// Escalation worker
// ---------------------------------------------------------------------------

let running: Promise<void> | null = null;

/**
 * Pages again recipients of open pages whose push failed or was skipped,
 * once their backoff has passed, until it is delivered, the page is
 * acknowledged or resolved, or the page is older than
 * {@link UNDELIVERED_RETRY_MAX_AGE_MS}. Escalation steps still run on the
 * group's schedule; this covers the time between and after them.
 */
async function retryUndelivered(now: Date): Promise<void> {
  const at = now.getTime();
  const due = await db
    .select({
      page: oncallPage,
      groupName: oncallGroup.name,
      userId: oncallPageRecipient.userId,
    })
    .from(oncallPageRecipient)
    .innerJoin(oncallPage, eq(oncallPage.id, oncallPageRecipient.pageId))
    .innerJoin(oncallGroup, eq(oncallGroup.id, oncallPage.groupId))
    .where(
      and(
        eq(oncallPage.status, "triggered"),
        gte(oncallPage.createdAt, new Date(at - UNDELIVERED_RETRY_MAX_AGE_MS)),
        dueForRetry(at),
        isNull(oncallPageRecipient.responseTokenUsedAt),
      ),
    )
    .orderBy(asc(oncallPageRecipient.notifiedAt))
    .limit(RETRIES_PER_PASS);
  const pageable = new Map<string, Set<string>>();
  for (const { page, groupName, userId } of due) {
    try {
      let team = pageable.get(page.teamId);
      if (!team) {
        team = await pageableMemberIds(page.teamId);
        pageable.set(page.teamId, team);
      }
      if (!team.has(userId)) {
        // Not pageable now; check again later instead of retrying.
        await db
          .update(oncallPageRecipient)
          .set({
            deliveryStatus: sql`case when ${oncallPageRecipient.deliveryStatus} = 'pending' then 'failed' else ${oncallPageRecipient.deliveryStatus} end`,
            nextAttemptAt: new Date(at + UNDELIVERED_RETRY_MAX_MS),
          })
          .where(
            and(
              eq(oncallPageRecipient.pageId, page.id),
              eq(oncallPageRecipient.userId, userId),
              dueForRetry(at),
            ),
          );
        continue;
      }
      const responseToken = await reclaimDelivery(page.id, userId, Date.now(), dueForRetry(at));
      if (!responseToken) continue;
      const tokens = (await devicesOf([userId])).map((target) => target.token);
      const accepted = await deliver(page, groupName, userId, responseToken, tokens);
      if (accepted > 0 && page.createdByUserId) {
        await trackNotification(page.createdByUserId, `${page.id}:retry:${userId}`);
      }
    } catch (error) {
      console.error("[oncall] Page retry failed", error);
    }
  }
}

/**
 * Runs every due escalation step, then pages again anyone a push did not
 * reach. State lives in the database, so restarts resume.
 */
export function processDueEscalations(now = new Date()): Promise<void> {
  if (running) return running;
  running = (async () => {
    const due = await db
      .select({ id: oncallPage.id })
      .from(oncallPage)
      .where(
        and(
          eq(oncallPage.status, "triggered"),
          isNotNull(oncallPage.nextEscalationAt),
          lte(oncallPage.nextEscalationAt, now),
        ),
      )
      .orderBy(asc(oncallPage.nextEscalationAt))
      .limit(50);
    for (const { id } of due) {
      try {
        await escalatePage(id, false);
      } catch (error) {
        console.error("[oncall] Escalation failed", error);
      }
    }
    await retryUndelivered(now);
  })().finally(() => {
    running = null;
  });
  return running;
}

export function startOncallEscalationWorker(): () => void {
  void processDueEscalations();
  const timer = setInterval(() => void processDueEscalations(), 15_000);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Claims a lock-screen credential for one action. Credentials are single-use:
 * the first successful acknowledge or escalate spends it. Returns false when
 * it was already spent (including by a concurrent request) or was replaced
 * by a newer delivery attempt since it was looked up.
 */
export async function claimPageResponseToken(
  pageId: string,
  userId: string,
  responseToken: string,
): Promise<boolean> {
  const claimed = await db
    .update(oncallPageRecipient)
    .set({ responseTokenUsedAt: new Date() })
    .where(
      and(
        eq(oncallPageRecipient.pageId, pageId),
        eq(oncallPageRecipient.userId, userId),
        eq(oncallPageRecipient.responseTokenHash, hashPageResponseToken(responseToken)),
        isNull(oncallPageRecipient.responseTokenUsedAt),
      ),
    )
    .returning({ userId: oncallPageRecipient.userId });
  return claimed.length > 0;
}

/** Returns a claimed credential when its action did not happen. */
export async function releasePageResponseToken(
  pageId: string,
  userId: string,
  responseToken: string,
): Promise<void> {
  await db
    .update(oncallPageRecipient)
    .set({ responseTokenUsedAt: null })
    .where(
      and(
        eq(oncallPageRecipient.pageId, pageId),
        eq(oncallPageRecipient.userId, userId),
        eq(oncallPageRecipient.responseTokenHash, hashPageResponseToken(responseToken)),
      ),
    );
}
