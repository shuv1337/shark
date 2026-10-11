import type { LiveActivityDto, LiveActivityStatus } from "@hark/contracts";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { subscribeToInboxUpdates } from "../lib/inboxUpdates";
import { Badge } from "./DashboardKit";

/**
 * Live Activities currently on the lock screen, as a section of the inbox:
 * they are the one inbox kind that keeps changing after it arrives, so they
 * read better grouped than interleaved by time.
 *
 * Renders nothing when there are none — an empty "Live Activities" heading
 * would teach nothing the inbox's own empty state does not already say.
 */
function liveActivityTone(status: LiveActivityStatus) {
  if (status === "active" || status === "starting") return "ok" as const;
  if (status === "failed") return "danger" as const;
  if (status === "partial") return "warn" as const;
  return "quiet" as const;
}

export function LiveActivitiesSection() {
  const [activities, setActivities] = useState<LiveActivityDto[] | null>(null);

  const load = useCallback(async () => {
    try {
      setActivities((await api.listLiveActivities()).activities);
    } catch {
      // Keep the last successful snapshot; the inbox list carries the errors.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeToInboxUpdates(() => void load()), [load]);

  if (!activities || activities.length === 0) return null;

  return (
    <section aria-labelledby="live-activities-heading" className="mt-12">
      <h2 className="text-lg font-semibold" id="live-activities-heading">
        Live Activities
      </h2>
      <p className="mt-1 text-sm text-ink-subtle">
        Updating on your lock screen right now, newest update first.
      </p>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {activities.map((activity) => (
          <li className="flex items-center justify-between gap-4 py-3" key={activity.id}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{activity.props.title}</p>
              <p className="truncate text-xs text-ink-subtle">{activity.props.status}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-[11px] text-ink-faint">seq {activity.sequence}</span>
              <Badge tone={liveActivityTone(activity.status)}>{activity.status}</Badge>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
