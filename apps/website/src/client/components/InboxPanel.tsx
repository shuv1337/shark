import {
  INBOX_FILTERS,
  type InboxDetailDto,
  type InboxFilter,
  type InboxItemDto,
  type InboxItemEventDto,
  isInboxItemActive,
  isInboxItemDeliveryFailure,
} from "@hark/contracts";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

const FILTER_LABELS: Record<InboxFilter, string> = {
  all: "All",
  needs_action: "Needs action",
  active: "Active",
  failed: "Failed",
  notifications: "Notifications",
};

export function InboxPanel() {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [items, setItems] = useState<InboxItemDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InboxDetailDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);

  const load = useCallback(
    async (cursor?: string | null) => {
      const page = await api.listInbox(filter, cursor);
      setItems((current) => (cursor ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
      setUnresolvedCount(page.unresolvedCount);
      setError(null);
    },
    [filter],
  );

  useEffect(() => {
    setLoading(true);
    setItems([]);
    void load()
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "Could not load your inbox"),
      )
      .finally(() => setLoading(false));
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not refresh your inbox");
    } finally {
      setRefreshing(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await load(nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load older items");
    } finally {
      setLoadingMore(false);
    }
  };

  const openItem = async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const value = await api.getInboxItem(id);
      setDetail(value);
      const readAt = value.item.readAt ?? new Date().toISOString();
      setItems((current) => current.map((item) => (item.id === id ? { ...item, readAt } : item)));
      if (!value.item.readAt) {
        void api.markInboxItemRead(id).catch(() => {});
      }
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : "Could not load this notification");
    } finally {
      setDetailLoading(false);
    }
  };

  const markAllRead = async () => {
    setMarkingRead(true);
    try {
      await api.markAllInboxRead();
      const readAt = new Date().toISOString();
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not mark the inbox as read");
    } finally {
      setMarkingRead(false);
    }
  };

  const hasUnread = items.some((item) => !item.readAt);

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
        <div className="flex items-center gap-2">
          {hasUnread ? (
            <button
              className="rounded-full px-3 py-1.5 text-xs font-medium text-ink-subtle transition hover:bg-surface-hover hover:text-ink disabled:opacity-50"
              disabled={markingRead}
              onClick={() => void markAllRead()}
              type="button"
            >
              {markingRead ? "Marking…" : "Mark all read"}
            </button>
          ) : null}
          <button
            className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-hover disabled:opacity-50"
            disabled={refreshing}
            onClick={() => void refresh()}
            type="button"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <fieldset className="mt-5 flex gap-2 overflow-x-auto pb-1">
        <legend className="sr-only">Inbox filters</legend>
        {INBOX_FILTERS.map((value) => {
          const selected = value === filter;
          return (
            <button
              aria-pressed={selected}
              className={
                selected
                  ? "shrink-0 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent"
                  : "shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-hover"
              }
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {FILTER_LABELS[value]}
            </button>
          );
        })}
      </fieldset>

      {error ? (
        <p className="mt-4 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="border-b border-line py-8 text-sm text-ink-faint">Loading inbox…</p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
          <p className="text-sm font-medium text-ink-muted">Nothing here yet</p>
          <p className="mt-1 text-sm text-ink-faint">
            New notifications and activity will stay here.
          </p>
        </div>
      ) : null}
      {items.length > 0 ? (
        <ol className="mt-4 divide-y divide-line border-y border-line">
          {items.map((item) => (
            <li key={item.id}>
              <InboxRow item={item} onOpen={() => void openItem(item.id)} />
            </li>
          ))}
        </ol>
      ) : null}
      {nextCursor ? (
        <button
          className="mt-4 w-full rounded-xl border border-line py-2.5 text-sm font-medium text-ink-muted transition hover:bg-surface-hover disabled:opacity-50"
          disabled={loadingMore}
          onClick={() => void loadMore()}
          type="button"
        >
          {loadingMore ? "Loading…" : "Load older"}
        </button>
      ) : null}

      {selectedId ? (
        <InboxDetailModal
          detail={detail}
          error={detailError}
          loading={detailLoading}
          onClose={() => {
            setSelectedId(null);
            setDetail(null);
            setDetailError(null);
          }}
        />
      ) : null}
    </section>
  );
}

export function InboxRow({ item, onOpen }: { item: InboxItemDto; onOpen: () => void }) {
  return (
    <button
      className="group flex w-full items-start gap-3 py-4 text-left transition hover:bg-accent-wash"
      onClick={onOpen}
      type="button"
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
      <span className="mt-7 text-base text-ink-disabled transition group-hover:translate-x-0.5 group-hover:text-accent-text">
        ›
      </span>
    </button>
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

function InboxDetailModal({
  detail,
  error,
  loading,
  onClose,
}: {
  detail: InboxDetailDto | null;
  error: string | null;
  loading: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="hark-modal-backdrop">
      <button
        aria-label="Close notification detail"
        className="hark-modal-dismiss"
        onClick={onClose}
        type="button"
      />
      <div
        aria-labelledby="inbox-detail-title"
        aria-modal="true"
        className="hark-modal-panel max-h-[calc(100dvh-2rem)] w-[min(100%,42rem)] overflow-y-auto"
        role="dialog"
      >
        <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
          <p className="text-sm font-semibold">Notification</p>
          <button
            aria-label="Close"
            className="grid size-8 place-items-center rounded-full text-xl leading-none text-ink-faint transition hover:bg-surface-hover hover:text-ink"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        {loading ? <p className="py-12 text-center text-sm text-ink-faint">Loading…</p> : null}
        {error ? <p className="py-10 text-center text-sm text-danger">{error}</p> : null}
        {detail ? <InboxDetailContent detail={detail} /> : null}
      </div>
    </div>
  );
}

export function InboxDetailContent({ detail }: { detail: InboxDetailDto }) {
  const { item } = detail;
  return (
    <div className="pt-6">
      <div className="flex items-center gap-3">
        <InboxAvatar item={{ ...item, readAt: item.readAt ?? item.updatedAt }} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{item.sourceName}</p>
          <time className="block text-xs text-ink-faint" dateTime={item.occurredAt}>
            {formatInboxDateTime(item.occurredAt)}
          </time>
        </div>
      </div>

      <h2 className="mt-6 text-2xl leading-tight font-semibold" id="inbox-detail-title">
        {item.title}
      </h2>
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
          className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-medium text-accent-text transition hover:bg-accent-soft"
          href={item.url}
          rel="noreferrer"
          target="_blank"
        >
          Open link <span aria-hidden="true">↗</span>
        </a>
      ) : null}

      {item.action ? (
        <div className="mt-6 rounded-xl border border-danger-line bg-danger-soft px-4 py-4">
          <p className="text-sm font-semibold text-danger">Needs your response</p>
          <p className="mt-1 text-sm leading-5 text-ink-muted">
            Respond from a registered iPhone or the macOS menu bar app so the reply comes from a
            signed device.
          </p>
          <p className="mt-2 text-xs text-ink-faint">
            Expires {formatInboxDateTime(item.action.expiresAt)}
          </p>
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-line bg-surface-muted px-4 py-4">
          <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Status</p>
          <p className="mt-1 text-sm font-semibold">{item.result ?? item.status}</p>
          <p className="mt-1 text-xs text-ink-faint">
            Accepted {item.accepted}
            {item.failed ? ` · Failed ${item.failed}` : ""}
          </p>
        </div>
      )}

      <div className="mt-8">
        <h3 className="text-sm font-semibold">Timeline</h3>
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
