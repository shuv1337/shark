import {
  INBOX_FILTERS,
  type InboxDetailDto,
  type InboxFilter,
  type InboxItemDto,
  type InboxItemEventDto,
  isInboxItemActive,
  isInboxItemDeliveryFailure,
} from "@hark/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ApiRequestError, api } from "../lib/api";
import { offlineProps, subscribeToReconnect, useOffline } from "../lib/connection";
import { refreshInboxCounts } from "../lib/counts";
import { subscribeToInboxUpdates } from "../lib/inboxUpdates";
import { ActivityLogSection } from "./ActivityLog";
import { useConfirm } from "./ConfirmDialog";
import { EmptyState, ErrorText, InlineCode, SkeletonList } from "./DashboardKit";
import { IconChevronDown, IconExternalLink } from "./icons";
import { focusRing, quietButton, rowButton, secondaryButton } from "./ui";

/**
 * The inbox: notifications, interactions and Live Activities, newest first.
 *
 * Activity is a sixth filter rather than a page of its own — it answers the
 * same question ("what has my agent sent?") one level lower, at the delivery
 * attempt. Selecting it swaps the list for the webhook delivery log.
 */
type InboxView = InboxFilter | "activity";

const INBOX_VIEWS = [...INBOX_FILTERS, "activity"] as const satisfies readonly InboxView[];

const VIEW_LABELS: Record<InboxView, string> = {
  all: "All",
  needs_action: "Needs action",
  active: "Active",
  failed: "Failed",
  notifications: "Notifications",
  activity: "Activity",
};

/** What an empty list of each kind means, and what to do about it. */
const EMPTY_COPY: Record<InboxFilter, { title: string; body: React.ReactNode }> = {
  all: {
    title: "Nothing yet",
    body: (
      <>
        Send one from your terminal: <InlineCode>sharkctl notify "Deploy finished"</InlineCode>, or
        POST to a service webhook. Everything SHark delivers lands here.
      </>
    ),
  },
  needs_action: {
    title: "Nothing needs you",
    body: "Approvals and questions from your agents appear here until you answer them from a registered iPhone or the macOS menu bar app.",
  },
  active: {
    title: "Nothing in flight",
    body: "Live Activities and pending requests show here while they are still running.",
  },
  failed: {
    title: "No failed deliveries",
    body: "A notification that no device accepted shows here with the reason, so you can re-register a device or fix the webhook.",
  },
  notifications: {
    title: "No notifications yet",
    body: (
      <>
        Plain notifications — no buttons, no response — appear here. Try{" "}
        <InlineCode>sharkctl notify "Build green"</InlineCode>.
      </>
    ),
  },
};

export function InboxPanel() {
  const [view, setView] = useState<InboxView>("all");
  const [items, setItems] = useState<InboxItemDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRequest = useRef(0);
  const filter: InboxFilter | null = view === "activity" ? null : view;
  // Reading is local; marking read is a write, and it is the one control here
  // that cannot do anything useful without the server.
  const offline = useOffline();

  const load = useCallback(
    async (cursor?: string | null, initial = false) => {
      if (!filter) return;
      const request = ++listRequest.current;
      setLoading(initial);
      setRefreshing(!cursor && !initial);
      setLoadingMore(Boolean(cursor));
      try {
        const page = await api.listInbox(filter, cursor);
        // A push refresh or filter change supersedes any older page request.
        if (request !== listRequest.current) return;
        setItems((current) => (cursor ? [...current, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
        setUnresolvedCount(page.unresolvedCount);
        setError(null);
      } catch (reason) {
        if (request !== listRequest.current) return;
        setError(reason instanceof Error ? reason.message : "Could not load your inbox");
      } finally {
        if (request === listRequest.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [filter],
  );

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void load(undefined, true);
    return () => {
      listRequest.current++;
    };
  }, [load]);

  useEffect(() => subscribeToInboxUpdates(() => void load()), [load]);

  /*
   * Back online: drop the error this page stopped showing while the shell's
   * banner was up, and read again. Without this the error would simply
   * reappear as the banner left, over data that is about to be replaced.
   */
  useEffect(
    () =>
      subscribeToReconnect(() => {
        setError(null);
        void load();
      }),
    [load],
  );

  // Reading the list says nothing about how many unread items are behind it,
  // so the badge is read from the server alongside the first page.
  useEffect(() => {
    void refreshInboxCounts();
  }, []);

  const loadMore = async () => {
    if (!nextCursor || loading || refreshing || loadingMore) return;
    await load(nextCursor);
  };

  const markAllRead = async () => {
    setMarkingRead(true);
    try {
      await api.markAllInboxRead();
      const readAt = new Date().toISOString();
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
      void load();
      void refreshInboxCounts();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not mark the inbox as read");
    } finally {
      setMarkingRead(false);
    }
  };

  const hasUnread = items.some((item) => !item.readAt);
  const empty = filter ? EMPTY_COPY[filter] : null;

  return (
    <section aria-labelledby="inbox-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold" id="inbox-heading">
              Inbox
            </h1>
            {unresolvedCount > 0 ? (
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent-text">
                {unresolvedCount} waiting
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-ink-subtle">
            Complete notification, interaction, and Live Activity history.
          </p>
        </div>
        {filter ? (
          <div className="flex items-center gap-2">
            {hasUnread ? (
              <button
                className={quietButton}
                disabled={markingRead}
                onClick={() => void markAllRead()}
                type="button"
                {...offlineProps(offline)}
              >
                {markingRead ? "Marking…" : "Mark all read"}
              </button>
            ) : null}
            <button
              className={rowButton}
              disabled={refreshing}
              onClick={() => void load()}
              type="button"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        ) : null}
      </div>

      {/*
       * `min-w-0` is load-bearing: the UA stylesheet gives `fieldset` a
       * `min-inline-size: min-content`, which `overflow-x-auto` alone cannot
       * clear. Without it the chips set a min-content floor on the whole
       * page, widening the layout viewport until the fixed tab bar overhangs
       * the screen on a phone.
       */}
      <fieldset className="mt-5 flex min-w-0 gap-2 overflow-x-auto pb-1">
        <legend className="sr-only">Inbox filters</legend>
        {INBOX_VIEWS.map((value) => {
          const selected = value === view;
          return (
            <button
              aria-pressed={selected}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors ${focusRing} ${
                selected
                  ? "bg-accent font-semibold text-on-accent"
                  : "border border-line bg-surface font-medium text-ink-muted hover:bg-surface-hover hover:text-ink"
              }`}
              key={value}
              onClick={() => setView(value)}
              type="button"
            >
              {VIEW_LABELS[value]}
            </button>
          );
        })}
      </fieldset>

      {view === "activity" ? <ActivityLogSection /> : null}

      {filter ? (
        <>
          {/* Offline, the shell's banner says it; a red box here would claim
              the list on screen is wrong, which it is not. */}
          {error && !offline ? (
            <p
              className="mt-4 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {loading ? (
            <SkeletonList
              className="mt-4"
              label="Loading your inbox"
              rowClassName="h-20"
              rows={4}
            />
          ) : null}
          {!loading && !error && items.length === 0 && empty ? (
            <div className="mt-4">
              <EmptyState title={empty.title}>{empty.body}</EmptyState>
            </div>
          ) : null}
          {items.length > 0 ? (
            <ol className="mt-4 divide-y divide-line border-y border-line">
              {items.map((item) => (
                <li key={item.id}>
                  <InboxRow item={item} to={inboxItemPath(item.id)} />
                </li>
              ))}
            </ol>
          ) : null}
          {nextCursor ? (
            <button
              className={`${secondaryButton} mt-4 w-full`}
              disabled={loading || refreshing || loadingMore}
              onClick={() => void loadMore()}
              type="button"
            >
              {loadingMore ? "Loading…" : "Load older"}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** Inbox item ids carry colons (`ibox:event:…`), so they need encoding. */
export function inboxItemPath(id: string): string {
  return `/inbox/${encodeURIComponent(id)}`;
}

export function InboxRow({ item, to }: { item: InboxItemDto; to: string }) {
  return (
    <Link
      className={`group flex w-full items-start gap-3 rounded-lg py-4 text-left transition-colors hover:bg-accent-wash ${focusRing}`}
      to={to}
    >
      <InboxAvatar item={item} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-4">
          <span className="truncate text-sm font-semibold text-ink">{item.title}</span>
          <time
            className="shrink-0 text-xs text-ink-faint"
            dateTime={item.occurredAt}
            title={new Date(item.occurredAt).toLocaleString()}
          >
            {formatInboxTime(item.occurredAt)}
          </time>
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-subtle">
          {item.sourceName} · {inboxKindLabel(item.kind)}
        </span>
        <span className="mt-1 block overflow-hidden text-sm leading-5 text-ink-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
          {item.body}
        </span>
        <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
          <span className={`size-1.5 rounded-full ${inboxStateDot(item)}`} aria-hidden="true" />
          {inboxStateLabel(item)}
        </span>
      </span>
      <IconChevronDown className="mt-6 size-4 shrink-0 -rotate-90 text-ink-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-accent-text" />
    </Link>
  );
}

function InboxAvatar({ item }: { item: InboxItemDto }) {
  return (
    <span className="relative mt-0.5 size-9 shrink-0">
      {item.sourceImageUrl ? (
        <img
          alt=""
          className="size-9 rounded-full border border-media-line object-cover"
          referrerPolicy="no-referrer"
          src={item.sourceImageUrl}
        />
      ) : (
        <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">
          {item.sourceName.slice(0, 1).toUpperCase()}
        </span>
      )}
      {!item.readAt ? (
        <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-paper bg-accent">
          <span className="sr-only">Unread</span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * One inbox item as a page of its own at `/inbox/:id`: linkable from a push,
 * reloadable, and dismissed with the browser's own back button rather than a
 * modal's close control.
 */
export function InboxDetailView({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [detail, setDetail] = useState<InboxDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState(false);
  const { confirm, dialog } = useConfirm();
  const offline = useOffline();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const value = await api.getInboxItem(id);
      setDetail(value);
      setError(null);
      // Opening an item is reading it, so the badge drops as soon as the
      // server agrees it has been read.
      if (!value.item.readAt) {
        void api
          .markInboxItemRead(id)
          .then(() => refreshInboxCounts())
          .catch(() => {});
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this notification");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const dismiss = async (interactionId: string) => {
    const confirmed = await confirm({
      title: "Dismiss this request",
      message: "The agent will see it as canceled. This cannot be undone.",
      confirmLabel: "Dismiss",
      destructive: true,
    });
    if (!confirmed) return;
    setDismissing(true);
    try {
      await api.dismissInteraction(interactionId);
    } catch (reason) {
      // A 409 means it already resolved elsewhere; the reload below shows the outcome.
      if (!(reason instanceof ApiRequestError && reason.status === 409)) {
        setError(reason instanceof Error ? reason.message : "Could not dismiss this request");
        setDismissing(false);
        return;
      }
    }
    try {
      setDetail(await api.getInboxItem(id));
    } catch {
      // The item stays on screen in its last known state.
    }
    void refreshInboxCounts();
    setDismissing(false);
  };

  return (
    <>
      <button
        className={`${quietButton} mb-5 -ml-3`}
        onClick={() => {
          // Going back keeps the list's filter and scroll. A push deep link or
          // a typed URL is the first entry in the history (`key: "default"`),
          // with nothing to pop, so that lands on the inbox instead.
          if (location.key === "default") navigate("/inbox");
          else navigate(-1);
        }}
        type="button"
      >
        <IconChevronDown className="size-4 rotate-90" />
        Inbox
      </button>

      {loading && !detail ? (
        <SkeletonList label="Loading this notification" rowClassName="h-16" rows={4} />
      ) : null}
      {/*
       * Offline with nothing cached is not the same as a notification that
       * does not exist. Saying "not available" and printing "Failed to fetch"
       * would tell the operator their item is gone when it is only out of
       * reach, so this says what is actually true and offers the way back.
       */}
      {error && !detail && offline ? (
        <div>
          <h1 className="text-[28px] leading-[1.15] font-medium tracking-[-0.015em] text-ink">
            This notification has not loaded yet
          </h1>
          <p className="mt-2 max-w-[30rem] text-ink-muted">
            You're offline, so SHark could not fetch it. It will open when you're back online.
          </p>
          <Link className={`${secondaryButton} mt-6 h-11`} to="/inbox">
            Back to the inbox
          </Link>
        </div>
      ) : null}
      {error && !detail && !offline ? (
        <div>
          <h1 className="text-[28px] leading-[1.15] font-medium tracking-[-0.015em] text-ink">
            This notification is not available
          </h1>
          <p className="mt-2 max-w-[30rem] text-ink-muted">{error}</p>
          <Link className={`${secondaryButton} mt-6 h-11`} to="/inbox">
            Back to the inbox
          </Link>
        </div>
      ) : null}
      {detail ? (
        <>
          <InboxDetailContent
            detail={detail}
            dismissing={dismissing}
            onDismiss={(interactionId) => void dismiss(interactionId)}
          />
          <ErrorText>{offline ? null : error}</ErrorText>
        </>
      ) : null}
      {dialog}
    </>
  );
}

export function InboxDetailContent({
  detail,
  dismissing = false,
  onDismiss,
}: {
  detail: InboxDetailDto;
  dismissing?: boolean;
  onDismiss?: (interactionId: string) => void;
}) {
  const { item } = detail;
  const offline = useOffline();
  return (
    <div>
      <div className="flex items-center gap-3">
        <InboxAvatar item={{ ...item, readAt: item.readAt ?? item.updatedAt }} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{item.sourceName}</p>
          <time className="block text-xs text-ink-faint" dateTime={item.occurredAt}>
            {formatInboxDateTime(item.occurredAt)}
          </time>
        </div>
      </div>

      <h1 className="mt-6 text-2xl leading-tight font-semibold">{item.title}</h1>
      <p className="mt-3 whitespace-pre-wrap text-base leading-7 text-ink-muted">{item.body}</p>

      {item.imageUrl ? (
        <img
          alt=""
          className="mt-6 max-h-80 w-full rounded-xl border border-media-line object-cover"
          referrerPolicy="no-referrer"
          src={item.imageUrl}
        />
      ) : null}
      {item.url ? (
        <a
          className={`${secondaryButton} mt-5 text-accent-text`}
          href={item.url}
          rel="noreferrer"
          target="_blank"
        >
          Open link
          <IconExternalLink className="size-4" />
        </a>
      ) : null}

      {item.action ? (
        <div className="mt-6 rounded-xl border border-danger-line bg-danger-soft px-4 py-4">
          <p className="text-sm font-semibold text-danger">Needs your response</p>
          <p className="mt-1 text-sm leading-5 text-ink-muted">
            Respond from a registered iPhone or the macOS menu bar app so the reply comes from a
            signed device.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-faint">
              Expires {formatInboxDateTime(item.action.expiresAt)}
            </p>
            {onDismiss ? (
              <button
                className={`${rowButton} bg-surface`}
                disabled={dismissing}
                onClick={() => {
                  if (item.action) onDismiss(item.action.interactionId);
                }}
                type="button"
                {...offlineProps(offline)}
              >
                {dismissing ? "Dismissing…" : "Dismiss"}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-line bg-surface-muted px-4 py-4">
          <p className="text-sm font-medium text-ink-muted">Status</p>
          <p className="mt-1 text-sm font-semibold">{item.result ?? item.status}</p>
          <p className="mt-1 text-xs text-ink-faint">
            Accepted {item.accepted}
            {item.failed ? ` · Failed ${item.failed}` : ""}
          </p>
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-sm font-semibold">Timeline</h2>
        {detail.events.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">No timeline events recorded.</p>
        ) : (
          <ol className="mt-4">
            {detail.events.map((event, index) => (
              <InboxTimelineEvent
                event={event}
                isLast={index === detail.events.length - 1}
                key={event.id}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function InboxTimelineEvent({ event, isLast }: { event: InboxItemEventDto; isLast: boolean }) {
  return (
    <li className="flex gap-3">
      <span className="flex w-3 shrink-0 flex-col items-center">
        <span className="mt-1.5 size-2 rounded-full bg-accent" />
        {!isLast ? <span className="mt-1 min-h-9 w-px flex-1 bg-line" /> : null}
      </span>
      <span className={isLast ? "pb-0" : "pb-5"}>
        <span className="block text-sm font-medium">
          {event.result ?? inboxTimelineLabel(event.kind)}
        </span>
        {event.detail ? (
          <span className="mt-0.5 block text-sm leading-5 text-ink-muted">{event.detail}</span>
        ) : null}
        <time className="mt-1 block text-xs text-ink-faint" dateTime={event.occurredAt}>
          {formatInboxDateTime(event.occurredAt)}
        </time>
      </span>
    </li>
  );
}

export function inboxKindLabel(kind: InboxItemDto["kind"]) {
  if (kind === "live_activity") return "Live Activity";
  if (kind === "interaction") return "Interaction";
  return "Notification";
}

export function inboxStateLabel(item: InboxItemDto) {
  return item.needsAction ? "Needs action" : (item.result ?? item.status);
}

export function inboxStateDot(item: InboxItemDto) {
  if (item.needsAction) return "bg-accent";
  if (isInboxItemDeliveryFailure(item)) return "bg-danger-strong";
  if (isInboxItemActive(item)) return "bg-info";
  return "bg-idle";
}

function formatInboxTime(value: string) {
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatInboxDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function inboxTimelineLabel(kind: string) {
  return kind
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
