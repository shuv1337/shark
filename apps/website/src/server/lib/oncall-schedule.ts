/**
 * Pure on-call schedule math. Every function is deterministic for a given
 * input and instant, so shifts can be computed on read instead of stored.
 *
 * A rotation hands off at local wall-clock time `handoffAt` in an IANA time
 * zone, so a daily shift stays anchored to (say) 09:00 across DST changes
 * and is 23 or 25 hours long on transition days. Shift `k` starts on local
 * date `anchor + k * periodDays` and belongs to `memberIds[k % n]`.
 */

export type RotationPeriod = "daily" | "weekly";

export interface RotationConfig {
  memberIds: readonly string[];
  period: RotationPeriod;
  /** `HH:MM`, local to `timezone`. */
  handoffAt: string;
  timezone: string;
  /** First handoff (epoch ms), already normalized by {@link normalizeRotationStart}. */
  startsAt: number;
}

export interface OverrideWindow {
  id?: string;
  userId: string;
  startsAt: number;
  endsAt: number;
  /** Creation time (epoch ms); breaks ties between overrides that start together. */
  createdAt?: number;
}

export interface Shift {
  userId: string;
  startsAt: number;
  endsAt: number;
  override: boolean;
  overrideId?: string;
}

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let value = formatters.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    if (formatters.size > 500) formatters.clear();
    formatters.set(timezone, value);
  }
  return value;
}

export function isValidTimeZone(timezone: string): boolean {
  try {
    formatter(timezone);
    return true;
  } catch {
    return false;
  }
}

function wallClock(instant: number, timezone: string) {
  const parts: Record<string, number> = {};
  for (const part of formatter(timezone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** UTC offset (ms) of `timezone` at `instant`. */
function offsetAt(instant: number, timezone: string): number {
  const wall = wallClock(instant, timezone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

export function localDate(instant: number, timezone: string): LocalDate {
  const { year, month, day } = wallClock(instant, timezone);
  return { year, month, day };
}

function dayNumber(date: LocalDate): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / DAY_MS);
}

function fromDayNumber(value: number): LocalDate {
  const date = new Date(value * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function parseHandoff(handoffAt: string): [number, number] {
  const [hour, minute] = handoffAt.split(":").map(Number);
  return [hour ?? 0, minute ?? 0];
}

/**
 * The instant a local wall-clock time occurs. Ambiguous times (clocks going
 * back) resolve to the earlier instant; skipped times (clocks going forward)
 * resolve to the same wall time on the new offset, i.e. later.
 */
export function zonedTimeToUtc(date: LocalDate, handoffAt: string, timezone: string): number {
  const [hour, minute] = parseHandoff(handoffAt);
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const before = offsetAt(wall - DAY_MS, timezone);
  const after = offsetAt(wall + DAY_MS, timezone);
  const valid = [...new Set([before, after])]
    .map((offset) => wall - offset)
    .filter((candidate) => {
      const check = wallClock(candidate, timezone);
      return (
        check.year === date.year &&
        check.month === date.month &&
        check.day === date.day &&
        check.hour === hour &&
        check.minute === minute
      );
    });
  if (valid.length > 0) return Math.min(...valid);
  return wall - before;
}

function periodDays(period: RotationPeriod): number {
  return period === "weekly" ? 7 : 1;
}

/**
 * Normalizes a rotation's first handoff: an explicit `startsAt` keeps its
 * local date and moves to `handoffAt`; without one, the latest handoff at
 * or before `now` is used so the first member is on call immediately.
 */
export function normalizeRotationStart(
  handoffAt: string,
  timezone: string,
  startsAt: number | undefined,
  now: number,
): number {
  if (startsAt !== undefined) {
    return zonedTimeToUtc(localDate(startsAt, timezone), handoffAt, timezone);
  }
  const today = localDate(now, timezone);
  const candidate = zonedTimeToUtc(today, handoffAt, timezone);
  if (candidate <= now) return candidate;
  return zonedTimeToUtc(fromDayNumber(dayNumber(today) - 1), handoffAt, timezone);
}

/** Start of rotation shift `index` (epoch ms). */
export function shiftStart(rotation: RotationConfig, index: number): number {
  const anchor = dayNumber(localDate(rotation.startsAt, rotation.timezone));
  return zonedTimeToUtc(
    fromDayNumber(anchor + index * periodDays(rotation.period)),
    rotation.handoffAt,
    rotation.timezone,
  );
}

/** Index of the rotation shift covering `instant`, or -1 before the first handoff. */
export function rotationIndexAt(rotation: RotationConfig, instant: number): number {
  if (instant < rotation.startsAt) return -1;
  const anchor = dayNumber(localDate(rotation.startsAt, rotation.timezone));
  const elapsedDays = dayNumber(localDate(instant, rotation.timezone)) - anchor;
  let index = Math.max(0, Math.floor(elapsedDays / periodDays(rotation.period)));
  while (index > 0 && shiftStart(rotation, index) > instant) index -= 1;
  while (shiftStart(rotation, index + 1) <= instant) index += 1;
  return index;
}

export function rotationMemberAt(rotation: RotationConfig, index: number): string | null {
  const count = rotation.memberIds.length;
  if (index < 0 || count === 0) return null;
  return rotation.memberIds[index % count] ?? null;
}

/**
 * Whether `a` takes precedence over `b` where both cover the same instant:
 * the later `startsAt` wins, then the later `createdAt`, then the greater
 * `id`. The order is total, so the winner never depends on input order.
 *
 * Deliberately not newest-created-wins: that would let a long override
 * created after a short cover silently erase the cover, while this rule's
 * one sharp edge (a new override partly covered by a later-starting one) is
 * refused with 409 at creation, so a new override never shadows an existing
 * one it would surround. (A later-starting override can still take over the
 * tail of an earlier cover.)
 */
function outranks(a: OverrideWindow, b: OverrideWindow): boolean {
  if (a.startsAt !== b.startsAt) return a.startsAt > b.startsAt;
  const aCreated = a.createdAt ?? 0;
  const bCreated = b.createdAt ?? 0;
  if (aCreated !== bCreated) return aCreated > bCreated;
  return (a.id ?? "") > (b.id ?? "");
}

/**
 * Override in force at `instant`. Overlaps resolve by {@link outranks}: the
 * override that started last wins, so a short cover inside a longer one
 * takes over for its window and the longer one resumes when it ends; among
 * overrides starting together the newest wins.
 */
export function activeOverride(
  overrides: readonly OverrideWindow[],
  instant: number,
): OverrideWindow | null {
  let winner: OverrideWindow | null = null;
  for (const candidate of overrides) {
    if (candidate.startsAt <= instant && instant < candidate.endsAt) {
      if (!winner || outranks(candidate, winner)) winner = candidate;
    }
  }
  return winner;
}

function nextOverrideStart(overrides: readonly OverrideWindow[], after: number): number {
  let next = Number.POSITIVE_INFINITY;
  for (const candidate of overrides) {
    if (candidate.startsAt > after && candidate.startsAt < next) next = candidate.startsAt;
  }
  return next;
}

/** Latest override end in `(from, to]`, i.e. when an earlier override handed back. */
function latestOverrideEnd(
  overrides: readonly OverrideWindow[],
  from: number,
  to: number,
  except?: OverrideWindow,
): number {
  let latest = from;
  for (const candidate of overrides) {
    if (candidate === except) continue;
    if (candidate.endsAt > latest && candidate.endsAt <= to) latest = candidate.endsAt;
  }
  return latest;
}

/**
 * The shift covering `instant` followed by the next ones, `count` in total.
 * When nobody covers `instant` the list starts with the next future shift.
 */
export function upcomingShifts(
  rotation: RotationConfig,
  overrides: readonly OverrideWindow[],
  instant: number,
  count = 5,
): Shift[] {
  const shifts: Shift[] = [];
  let cursor = instant;
  for (let guard = 0; guard < count * 4 + 10 && shifts.length < count; guard += 1) {
    const override = activeOverride(overrides, cursor);
    const upcomingOverride = nextOverrideStart(overrides, cursor);
    if (override) {
      const startsAt =
        shifts.length === 0
          ? latestOverrideEnd(overrides, override.startsAt, cursor, override)
          : cursor;
      const endsAt = Math.min(override.endsAt, upcomingOverride);
      shifts.push({
        userId: override.userId,
        startsAt,
        endsAt,
        override: true,
        ...(override.id ? { overrideId: override.id } : {}),
      });
      cursor = endsAt;
      continue;
    }
    const index = rotationIndexAt(rotation, cursor);
    const userId = rotationMemberAt(rotation, index);
    if (userId === null) {
      // Not started yet (or nobody in the rotation): jump to whatever comes next.
      const next = Math.min(
        index < 0 && rotation.memberIds.length > 0 ? rotation.startsAt : Number.POSITIVE_INFINITY,
        upcomingOverride,
      );
      if (!Number.isFinite(next)) break;
      cursor = next;
      continue;
    }
    const start = shiftStart(rotation, index);
    const startsAt = shifts.length === 0 ? latestOverrideEnd(overrides, start, cursor) : cursor;
    const endsAt = Math.min(shiftStart(rotation, index + 1), upcomingOverride);
    shifts.push({ userId, startsAt, endsAt, override: false });
    cursor = endsAt;
  }
  return shifts;
}

export function currentShift(
  rotation: RotationConfig,
  overrides: readonly OverrideWindow[],
  instant: number,
): Shift | null {
  const [first] = upcomingShifts(rotation, overrides, instant, 1);
  return first && first.startsAt <= instant ? first : null;
}

/**
 * Whether `userId` is on call, by the rotation or an override, for all of
 * `[from, to)`. Any gap or anyone else's shift in the window makes it false.
 */
export function onCallThroughout(
  rotation: RotationConfig,
  overrides: readonly OverrideWindow[],
  userId: string,
  from: number,
  to: number,
): boolean {
  let cursor = from;
  for (let guard = 0; cursor < to; guard += 1) {
    if (guard > 10_000) return false;
    const shift = currentShift(rotation, overrides, cursor);
    if (!shift || shift.userId !== userId || shift.endsAt <= cursor) return false;
    cursor = shift.endsAt;
  }
  return true;
}

/**
 * The next rotation member to page after `lastPagedUserId`, skipping anyone
 * already notified. When the last person paged is not in the rotation (an
 * override), the scheduled rotation member is next.
 */
export function nextInRotation(
  rotation: RotationConfig,
  lastPagedUserId: string | null,
  alreadyNotified: ReadonlySet<string>,
  instant: number,
): string | null {
  const members = rotation.memberIds;
  const count = members.length;
  if (count === 0) return null;
  let base = lastPagedUserId === null ? -1 : members.indexOf(lastPagedUserId);
  if (base < 0) {
    const index = rotationIndexAt(rotation, instant);
    base = index < 0 ? -1 : (index % count) - 1;
  }
  for (let step = 1; step <= count; step += 1) {
    const candidate = members[(((base + step) % count) + count) % count];
    if (candidate && !alreadyNotified.has(candidate)) return candidate;
  }
  return null;
}
