import { useSyncExternalStore } from "react";
import { api } from "./api";
import { clearAppBadge, setAppBadge } from "./appBadge";
import { subscribeToInboxUpdates } from "./inboxUpdates";

/**
 * The numbers the primary navigation shows, in one place so the shell and the
 * pages never disagree.
 *
 * The inbox badge is the exact unread total from `/api/inbox/counts`, never a
 * figure derived from the page of items a list happens to hold: the two sets
 * drift apart as soon as something unread is older than the first page.
 * Anything that changes read state asks for the number again rather than
 * guessing at a delta.
 *
 * "Needs action" is a second, different fact — a request can be read and still
 * waiting on you — so it is a separate signal, shown as a dot rather than
 * folded into the count.
 *
 * A page that already loaded the data publishes its own count, which is both
 * free and exact. Otherwise the store reads: on first subscribe, whenever a
 * push arrives or the tab is resumed, and on a slow poll in case neither
 * fires. Phase 3 replaces the poll with one live stream.
 */
export interface NavCounts {
  /** Asks on the board waiting on an answer from you. */
  boardWaiting: number;
  /** Inbox items you have not read. */
  inboxUnread: number;
  /** Inbox items still waiting on your response, read or not. */
  inboxNeedsAction: number;
}

export const COUNTS_POLL_INTERVAL_MS = 30_000;

const ZERO: NavCounts = { boardWaiting: 0, inboxUnread: 0, inboxNeedsAction: 0 };

let counts: NavCounts = ZERO;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

/**
 * The number on the installed app's icon: what is waiting on you on the board
 * plus what you have not read. "Needs action" is deliberately left out —
 * adding it would double-count an unread approval, and the icon has room for
 * one number, not a nuance.
 *
 * Zero clears the badge rather than drawing a 0, which on iOS and macOS is
 * the difference between a clean icon and a permanent dot.
 *
 * The badge outlives the page, so this cannot key off the in-memory counts
 * changing: they start at zero, and a fresh load that reads zero and zero
 * would change nothing and leave yesterday's number on the icon. It paints
 * from the first moment both sources have answered — including, especially,
 * when the answer is that there is nothing waiting — and after that whenever
 * the total it would draw differs from the one already on the icon.
 */
let boardReported = false;
let inboxReported = false;
let painted: number | undefined;

type Source = "board" | "inbox";

function paintBadge(): void {
  if (!boardReported || !inboxReported) return;
  const total = counts.boardWaiting + counts.inboxUnread;
  if (total === painted) return;
  painted = total;
  // Both helpers no-op where the Badging API is unsupported.
  void (total > 0 ? setAppBadge(total) : clearAppBadge());
}

function set(next: Partial<NavCounts>, source?: Source): void {
  if (source === "board") boardReported = true;
  if (source === "inbox") inboxReported = true;
  const merged = { ...counts, ...next };
  const unchanged =
    merged.boardWaiting === counts.boardWaiting &&
    merged.inboxUnread === counts.inboxUnread &&
    merged.inboxNeedsAction === counts.inboxNeedsAction;
  counts = merged;
  // Before the listeners, and whether or not anything changed: a load that
  // learns both counts are zero has to clear a badge a previous session left.
  paintBadge();
  if (unchanged) return;
  for (const listener of listeners) listener();
}

export function publishBoardWaiting(count: number): void {
  set({ boardWaiting: count }, "board");
}

/** Re-read the inbox badge. Call after anything that changes read state. */
export async function refreshInboxCounts(): Promise<void> {
  try {
    const { unread, needsAction } = await api.getInboxCounts();
    set({ inboxUnread: unread, inboxNeedsAction: needsAction }, "inbox");
  } catch {
    // Keep the last known numbers; the poll and the next push try again.
  }
}

async function refresh(): Promise<void> {
  const [board] = await Promise.allSettled([api.getBoard(), refreshInboxCounts()]);
  if (board.status === "fulfilled") set({ boardWaiting: board.value.waiting.length }, "board");
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!stop) {
    void refresh();
    const unsubscribe = subscribeToInboxUpdates(() => void refresh());
    const poll = setInterval(() => void refresh(), COUNTS_POLL_INTERVAL_MS);
    stop = () => {
      unsubscribe();
      clearInterval(poll);
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stop?.();
    stop = null;
  };
}

const noop = () => () => {};

/**
 * Live nav counts. Pass `false` while signed out so nothing is requested.
 *
 * The server snapshot is the same value as the client one: every private shell
 * ships an empty `#root`, so nothing here is ever hydrated against markup from
 * another process, and a count published before a render has to appear in it.
 */
export function useNavCounts(enabled = true): NavCounts {
  const snapshot = () => (enabled ? counts : ZERO);
  return useSyncExternalStore(enabled ? subscribe : noop, snapshot, snapshot);
}

/**
 * Sign-out: nothing is waiting on a signed-out browser, so the badge goes and
 * the numbers go with it, without waiting for a read that would now 401.
 */
export function clearNavCounts(): void {
  counts = ZERO;
  // A signed-out browser has no counts to report, so the next session starts
  // its badge from scratch rather than from this one's last total.
  boardReported = false;
  inboxReported = false;
  painted = undefined;
  void clearAppBadge();
  for (const listener of listeners) listener();
}

/** Test seam: drop every subscriber and reset the counts. */
export function resetNavCounts(): void {
  stop?.();
  stop = null;
  listeners.clear();
  counts = ZERO;
  boardReported = false;
  inboxReported = false;
  painted = undefined;
}
