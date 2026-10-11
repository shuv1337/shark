/**
 * The one relative-time formatter for the whole client. Compact by design: it
 * appears in dense card headers, list rows and timelines, so it stays short
 * enough to sit beside a title without wrapping.
 */
export function relativeTime(iso: string, now = Date.now()): string {
  const delta = Math.max(0, now - Date.parse(iso));
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
