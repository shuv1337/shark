import type { InboxNotificationSummaryDto, InboxProjectSummaryDto } from "@hark/contracts";
import { INBOX_UNFILED_PROJECT } from "@hark/contracts";

/**
 * Pure state logic for the project notification screen, kept React-free so
 * the mark-all availability and boundary rules are unit-testable.
 */

/**
 * Authoritative unread count for the opened project from the summary API,
 * or `null` when the summary does not know the project (older server, list
 * still loading, or a project deleted since the inbox rendered).
 */
export function projectSummaryUnread(
  projects: readonly InboxProjectSummaryDto[],
  projectParam: string,
): number | null {
  const summary = projects.find((candidate) =>
    projectParam === INBOX_UNFILED_PROJECT
      ? candidate.projectId === null
      : candidate.projectId === projectParam,
  );
  return summary ? summary.unreadCount : null;
}

/** Unread rows within the currently loaded page. */
export function loadedUnreadCount(items: readonly InboxNotificationSummaryDto[]): number {
  return items.filter((item) => item.readAt === null).length;
}

/**
 * Mark-all-read stays available while either source reports unread rows:
 * the loaded page gives an immediate signal, and the authoritative project
 * summary covers unread rows beyond the loaded page (or a page that loaded
 * only read rows). A missing summary falls back to the loaded page alone.
 * Without a server-issued read-through token there is no safe boundary to
 * submit, so the action stays disabled until a list load supplies one.
 */
export function canMarkAllRead(
  loadedUnread: number,
  summaryUnread: number | null,
  readThrough: string | null,
): boolean {
  if (readThrough === null) return false;
  return loadedUnread > 0 || (summaryUnread ?? 0) > 0;
}

/**
 * Read-through boundary for mark-all-read: the opaque snapshot token issued
 * by the list response. The server marks only rows it covered, so
 * notifications arriving during the tap stay unread even when their
 * timestamps tie with the newest loaded row, while unread rows beyond the
 * loaded page are still included. Empty or missing tokens (an older server
 * mid-rollout) normalize to `null`, which keeps mark-all disabled.
 */
export function normalizeReadThroughToken(token: string | null | undefined): string | null {
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** Optimistic local copy of the server-side mark-all-read result. */
export function markLoadedItemsRead(
  items: readonly InboxNotificationSummaryDto[],
  readAt: string,
): InboxNotificationSummaryDto[] {
  return items.map((item) => (item.readAt === null ? { ...item, readAt } : item));
}
