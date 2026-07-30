export function inboxIdFromNotificationData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const value = data as { interactionId?: unknown; eventId?: unknown };
  if (typeof value.interactionId === "string" && value.interactionId) {
    return `ibox:interaction:${value.interactionId}`;
  }
  if (typeof value.eventId === "string" && value.eventId) {
    const entity = value.eventId.startsWith("anot") ? "agent_notification" : "event";
    return `ibox:${entity}:${value.eventId}`;
  }
  return null;
}
