import type { InboxPageDto } from "@hark/contracts";
import { useSyncExternalStore } from "react";
import { api } from "./api";
import { subscribeToInboxUpdates } from "./inboxUpdates";

/**
 * The two numbers the primary navigation shows as badges, in one place so the
 * shell and the pages never disagree.
 *
 * A page that already loaded the data publishes its own count (`publishBoard`,
 * `publishInbox`), which is both free and exact. For every other route the
 * store reads the counts itself: once on first subscribe, again whenever a push
 * arrives or the tab is resumed (`subscribeToInboxUpdates`), and on a slow poll
 * in case neither fires. Phase 3 replaces the poll with one live stream shared
 * by the board and the inbox.
 */
export interface NavCounts {
  /** Asks on the board waiting on an answer from you. */
  boardWaiting: number;
  /** Inbox items that are unread or still need your response. */
  inboxAttention: number;
}

export const COUNTS_POLL_INTERVAL_MS = 30_000;

const ZERO: NavCounts = { boardWaiting: 0, inboxAttention: 0 };

let counts: NavCounts = ZERO;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function set(next: Partial<NavCounts>): void {
  const merged = { ...counts, ...next };
  if (
    merged.boardWaiting === counts.boardWaiting &&
    merged.inboxAttention === counts.inboxAttention
  )
    return;
  counts = merged;
  for (const listener of listeners) listener();
}

/**
 * What the inbox badge counts: anything unread, plus anything still waiting on
 * a response. `unresolvedCount` is the floor because a request needing action
 * can be older than the page of items the inbox just read.
 */
export function inboxAttentionCount(page: InboxPageDto): number {
  const onPage = page.items.filter((item) => !item.readAt || item.needsAction).length;
  return Math.max(page.unresolvedCount, onPage);
}

export function publishBoardWaiting(count: number): void {
  set({ boardWaiting: count });
}

export function publishInboxPage(page: InboxPageDto): void {
  set({ inboxAttention: inboxAttentionCount(page) });
}

async function refresh(): Promise<void> {
  const [board, inbox] = await Promise.allSettled([api.getBoard(), api.listInbox("all")]);
  if (board.status === "fulfilled") set({ boardWaiting: board.value.waiting.length });
  if (inbox.status === "fulfilled") set({ inboxAttention: inboxAttentionCount(inbox.value) });
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

/** Test seam: drop every subscriber and reset both counts. */
export function resetNavCounts(): void {
  stop?.();
  stop = null;
  listeners.clear();
  counts = ZERO;
}
