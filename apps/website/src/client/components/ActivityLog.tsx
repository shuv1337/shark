import type { EventDto } from "@hark/contracts";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { subscribeToReconnect, useOffline } from "../lib/connection";
import { EmptyState, ErrorText, InlineCode, SkeletonList } from "./DashboardKit";
import { quietButton } from "./ui";

const ACTIVITY_POLL_INTERVAL_MS = 10_000;

/**
 * Webhook delivery attempts, one level below the inbox: what each service sent,
 * what SHark did with it, and why anything failed. Self-contained — the Inbox
 * page renders it for the Activity filter.
 */
export function ActivityLogSection() {
  const [events, setEvents] = useState<EventDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // The shell's banner is the one place that says the page is not current; a
  // red "Could not load activity" under a real log would contradict it.
  const offline = useOffline();

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      setEvents((await api.listEvents()).events);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load activity");
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), ACTIVITY_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

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

  return (
    <section aria-labelledby="activity-heading" className="mt-8">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold" id="activity-heading">
            Activity
          </h2>
          <p className="mt-1 text-sm text-ink-subtle">Latest webhook delivery attempts.</p>
        </div>
        <button
          className={quietButton}
          disabled={refreshing}
          onClick={() => void load(true)}
          type="button"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {events === null && offline ? (
        // Nothing has loaded in this browser and nothing is on its way, so a
        // skeleton would be pretending.
        <p className="rounded-2xl border border-dashed border-line-strong px-5 py-4 text-[15px] text-ink-muted">
          Activity has not loaded in this browser yet. It will fill in when you're back online.
        </p>
      ) : null}
      {events === null && !error && !offline ? (
        <SkeletonList label="Loading activity" rowClassName="h-12" rows={4} />
      ) : null}
      {events?.length === 0 ? (
        <EmptyState title="No webhook activity yet">
          Every POST to a service webhook shows here with the devices that accepted it. Try{" "}
          <InlineCode>
            curl -X POST &lt;your webhook URL&gt; -d '{"{"}"body":"Hello"{"}"}'
          </InlineCode>
          .
        </EmptyState>
      ) : null}
      {events && events.length > 0 ? (
        <ol className="divide-y divide-line border-y border-line">
          {events.map((activityEvent) => (
            <li className="flex gap-2.5 py-3" key={activityEvent.id}>
              <ActivityAvatar activityEvent={activityEvent} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="truncate text-sm leading-5 font-medium">
                    {activityEvent.serviceTitle} · {activityEvent.title}
                  </p>
                  <time
                    className="shrink-0 text-xs text-ink-faint"
                    dateTime={activityEvent.createdAt}
                    title={new Date(activityEvent.createdAt).toLocaleString()}
                  >
                    {new Date(activityEvent.createdAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <p className="mt-0.5 truncate text-xs leading-4 text-ink-subtle">
                  {activityEvent.body}
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-ink-faint">
                  {activityLabel(activityEvent)}
                  {activityEvent.error ? ` · ${activityEvent.error}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      <ErrorText>{offline ? null : error}</ErrorText>
    </section>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "accepted" || status === "delivered"
      ? "bg-accent"
      : status === "failed"
        ? "bg-danger-strong"
        : status === "partial"
          ? "bg-warn"
          : status === "processing" || status === "withdraw_processing"
            ? "bg-info"
            : "bg-idle";
  return <span className={`${color} size-2 rounded-full`} aria-hidden="true" />;
}

function ActivityAvatar({ activityEvent }: { activityEvent: EventDto }) {
  return (
    <span className="relative size-8 shrink-0">
      {activityEvent.imageUrl ? (
        <img
          alt=""
          className="border-media-line size-8 rounded-full border object-cover"
          src={activityEvent.imageUrl}
        />
      ) : (
        <span className="bg-accent-soft text-accent-text grid size-8 place-items-center rounded-full text-xs font-medium">
          {activityEvent.serviceTitle.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="absolute -right-0.5 -bottom-0.5 grid size-3 place-items-center rounded-full bg-surface">
        <StatusDot status={activityEvent.status} />
      </span>
    </span>
  );
}

export function activityLabel(activityEvent: EventDto): string {
  if (activityEvent.status === "accepted" || activityEvent.status === "delivered") {
    return `Accepted for ${activityEvent.deliveredCount} ${activityEvent.deliveredCount === 1 ? "device" : "devices"}`;
  }
  if (activityEvent.status === "partial") {
    return `Partially accepted for ${activityEvent.deliveredCount} devices`;
  }
  if (activityEvent.status === "no_devices") return "No active devices";
  if (activityEvent.status === "processing" || activityEvent.status === "withdraw_processing") {
    return "Processing";
  }
  if (activityEvent.status === "withdrawn") return "Withdrawn";
  if (activityEvent.status === "withdraw_partial") return "Partially withdrawn";
  return "Failed";
}
