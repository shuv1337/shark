/** Refresh an open inbox when a push arrives or a suspended page resumes. */
export function subscribeToInboxUpdates(refresh: () => void): () => void {
  let followUp: ReturnType<typeof setTimeout> | undefined;

  const onMessage = (event: MessageEvent) => {
    if (event.data?.type !== "hark:inbox-updated") return;
    refresh();

    // Push can arrive before the server finishes recording fanout results.
    // Coalesce a burst into one follow-up read to pick up its final state.
    clearTimeout(followUp);
    followUp = setTimeout(refresh, 1000);
  };
  const onResume = () => {
    if (document.visibilityState === "visible") refresh();
  };

  navigator.serviceWorker?.addEventListener("message", onMessage);
  window.addEventListener("focus", onResume);
  document.addEventListener("visibilitychange", onResume);

  return () => {
    clearTimeout(followUp);
    navigator.serviceWorker?.removeEventListener("message", onMessage);
    window.removeEventListener("focus", onResume);
    document.removeEventListener("visibilitychange", onResume);
  };
}
