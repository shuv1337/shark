import type { BoardAskDto, BoardPriority, BoardWorkItemDto } from "@hark/contracts";

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

export function priorityLabel(priority: BoardPriority): string {
  return priority === "p0" ? "Blocking" : priority === "p1" ? "Today" : "Whenever";
}

export function priorityClass(priority: BoardPriority): string {
  return priority === "p0"
    ? "bg-danger-soft text-danger"
    : priority === "p1"
      ? "bg-accent-soft text-accent-text"
      : "bg-surface-muted text-ink-subtle";
}

export function kindLabel(kind: BoardAskDto["kind"]): string {
  return kind === "decision"
    ? "Decision"
    : kind === "approval"
      ? "Approval"
      : kind === "merge"
        ? "Merge"
        : kind === "connect"
          ? "Connect"
          : "To-do";
}

export function workStateLabel(item: BoardWorkItemDto): string {
  if (item.stale) return "Stale";
  switch (item.state) {
    case "queued":
      return "Queued";
    case "in_flight":
      return item.statusLabel ?? "In flight";
    case "review":
      return item.statusLabel ?? "In review";
    case "blocked":
      return item.statusLabel ?? "Blocked";
    case "done":
      return item.completionVerb ?? "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function answerSummary(ask: BoardAskDto): string {
  if (ask.status === "cancelled") return ask.cancelReason ?? "Dismissed";
  if (ask.status === "expired") return "Expired";
  if (!ask.answer) return "";
  return ask.answer.optionLabel ?? ask.answer.text ?? ask.answer.optionId ?? "Answered";
}

export function deliveryLabel(ask: BoardAskDto): string {
  if (ask.ackedAt) return "Agent applied it";
  if (!ask.callback) return "Waiting for the agent to poll";
  switch (ask.callback.status) {
    case "delivered":
      return "Delivered to the agent";
    case "retrying":
      return `Retrying delivery (${ask.callback.attempts})`;
    case "failed":
      return "Delivery failed; the agent can still poll";
    default:
      return "Delivering to the agent";
  }
}

/** Two weeks from now as the default Later date, in local YYYY-MM-DD. */
export function defaultLaterDate(now = new Date()): string {
  const date = new Date(now.getTime() + 7 * 86_400_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
