import { useSyncExternalStore } from "react";

/**
 * Whether this browser can currently reach the server.
 *
 * `navigator.onLine` on its own is a weak signal: it reports the OS link, so
 * it stays `true` on a captive portal and on a network with no route out, and
 * it only turns `false` when the machine is certain. A request that never
 * reached the server is the stronger evidence, so `lib/api.ts` reports its
 * network failures here and the next successful request clears them.
 *
 * Two things read this. The shell shows one banner saying the page is showing
 * what was last loaded, and every control whose only job is to send something
 * to the server disables itself with a reason rather than failing on the tap.
 * Nothing here ever hides data that is already on screen.
 */

/** The reason an action is unavailable, for its `title`. */
export const OFFLINE_HINT = "You're offline. This needs a connection.";

let unreachable = false;
let bound = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function bind(): void {
  if (bound || typeof window === "undefined") return;
  bound = true;
  // Coming back online clears the remembered failure too: the link is the
  // only thing that could have caused it, and waiting for the next request to
  // prove it would leave the banner up over a working page.
  window.addEventListener("online", () => {
    unreachable = false;
    emit();
  });
  window.addEventListener("offline", emit);
}

export function isOffline(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.onLine === false || unreachable;
}

/** Called by the API layer when `fetch` rejected before reaching the server. */
export function reportNetworkFailure(): void {
  if (unreachable) return;
  unreachable = true;
  emit();
}

/** Called by the API layer on any response at all, including a 4xx or 5xx. */
export function reportNetworkSuccess(): void {
  if (!unreachable) return;
  unreachable = false;
  emit();
}

function subscribe(listener: () => void): () => void {
  bind();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A server render is never the thing that is offline. */
const online = () => false;

export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, isOffline, online);
}

/**
 * Props for a control that cannot work without the server. Spread it last so
 * it wins over the control's own busy state, and so the `title` says why.
 */
export function offlineProps(offline: boolean): { disabled?: true; title?: string } {
  return offline ? { disabled: true, title: OFFLINE_HINT } : {};
}

/** Test seam: forget the remembered failure and drop every subscriber. */
export function resetConnection(): void {
  unreachable = false;
  listeners.clear();
}
