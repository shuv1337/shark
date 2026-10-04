import type * as Notifications from "expo-notifications";

const DEFAULT_ACTION = "expo.modules.notifications.actions.DEFAULT";
const DUPLICATE_WINDOW_MS = 5_000;

// Cold-launch retrieval and the live listener can report the same tap. Coalesce
// those deliveries, while allowing a later intentional tap to open it again.
export function createNotificationResponseHandler(
  handle: (response: Notifications.NotificationResponse) => Promise<void>,
  now = Date.now,
): (response: Notifications.NotificationResponse) => Promise<void> {
  const recent = new Map<string, { task: Promise<void>; finishedAt: number | null }>();
  return (response) => {
    const id = response.notification.request.identifier;
    if (response.actionIdentifier !== DEFAULT_ACTION || !id) return handle(response);
    const key = `${id}:${response.notification.date}`;
    const previous = recent.get(key);
    if (
      previous &&
      (previous.finishedAt === null || now() - previous.finishedAt < DUPLICATE_WINDOW_MS)
    ) {
      return previous.task;
    }
    for (const [entryKey, entry] of recent) {
      if (entry.finishedAt !== null && now() - entry.finishedAt >= DUPLICATE_WINDOW_MS) {
        recent.delete(entryKey);
      }
    }
    const entry = { task: Promise.resolve(), finishedAt: null as number | null };
    entry.task = Promise.resolve()
      .then(() => handle(response))
      .then(
        () => {
          entry.finishedAt = now();
        },
        (error) => {
          recent.delete(key);
          throw error;
        },
      );
    recent.set(key, entry);
    // Retain a small tap history; pending operations are already bounded by the
    // notification source and are not discarded during their own processing.
    for (const [entryKey, candidate] of recent) {
      if (recent.size <= 64) break;
      if (candidate.finishedAt !== null) recent.delete(entryKey);
    }
    return entry.task;
  };
}
