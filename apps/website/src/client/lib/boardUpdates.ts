/**
 * Keeps an open board current. Primary signal: the server-sent `changed` event
 * on /api/board/stream, which carries only a version number. Fallbacks: a push
 * arriving at the service worker, the page becoming visible again, and a slow
 * poll in case a proxy buffers the stream.
 */
export const BOARD_POLL_INTERVAL_MS = 15_000;

export function subscribeToBoardUpdates(
  refresh: () => void,
  options: { pollIntervalMs?: number; eventSource?: typeof EventSource } = {},
): () => void {
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefresh = () => {
    clearTimeout(debounce);
    debounce = setTimeout(refresh, 250);
  };

  const onMessage = (event: MessageEvent) => {
    if (event.data?.type === "hark:inbox-updated") scheduleRefresh();
  };
  const onResume = () => {
    if (document.visibilityState === "visible") scheduleRefresh();
  };
  navigator.serviceWorker?.addEventListener("message", onMessage);
  window.addEventListener("focus", onResume);
  document.addEventListener("visibilitychange", onResume);

  const Source = options.eventSource ?? (typeof EventSource === "undefined" ? null : EventSource);
  let stream: EventSource | null = null;
  let lastVersion: string | null = null;
  if (Source) {
    try {
      stream = new Source("/api/board/stream");
      stream.addEventListener("changed", (event) => {
        const version = (event as MessageEvent).data as string;
        if (version === lastVersion) return;
        // The first event only confirms the connection; the page already loaded.
        if (lastVersion !== null) scheduleRefresh();
        lastVersion = version;
      });
      stream.addEventListener("error", () => {
        // EventSource reconnects by itself; the poll below covers the gap.
      });
    } catch {
      stream = null;
    }
  }
  const poll = setInterval(scheduleRefresh, options.pollIntervalMs ?? BOARD_POLL_INTERVAL_MS);

  return () => {
    clearTimeout(debounce);
    clearInterval(poll);
    stream?.close();
    navigator.serviceWorker?.removeEventListener("message", onMessage);
    window.removeEventListener("focus", onResume);
    document.removeEventListener("visibilitychange", onResume);
  };
}
