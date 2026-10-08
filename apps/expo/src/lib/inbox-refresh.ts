/**
 * Pure coordination logic for the inbox screen's refresh triggers, kept
 * React-free so the focus and response-ordering rules are unit-testable.
 *
 * The screen refreshes from several sources — the initial load, a 15-second
 * timer, app-state changes, incoming pushes, pull-to-refresh, and regained
 * navigation focus. These helpers keep those sources from duplicating work
 * or letting a slow stale response overwrite fresher state.
 */

/**
 * Decides which navigation focus events refresh the inbox. The initial-load
 * effect owns the first focus after mount (refreshing there too would issue
 * duplicate requests), so a focus only refreshes once the screen has blurred
 * — returning from the project or notification screens, where read state
 * changes — and only while the session and device are ready.
 */
export interface FocusRefreshPolicy {
  /** Called when the screen gains focus; returns whether to refresh now. */
  onFocus(ready: boolean): boolean;
  /** Called when the screen loses focus. */
  onBlur(): void;
}

export function createFocusRefreshPolicy(): FocusRefreshPolicy {
  let blurred = false;
  return {
    onFocus(ready: boolean): boolean {
      if (!blurred) return false;
      blurred = false;
      // Not ready (session or device still loading): skip, and let the
      // initial-load effect fetch once its gates open.
      return ready;
    },
    onBlur(): void {
      blurred = true;
    },
  };
}

/**
 * Orders overlapping refreshes: every attempt takes a token, and only the
 * newest attempt may apply its response. A slow older response — a timer
 * tick racing a focus refresh, or an old filter's page arriving after the
 * filter changed — is dropped instead of overwriting fresher state.
 */
export interface RefreshSequence {
  /** Starts a refresh attempt and returns its token. */
  begin(): number;
  /** Whether the given attempt is still the newest one started. */
  isCurrent(token: number): boolean;
}

export function createRefreshSequence(): RefreshSequence {
  let latest = 0;
  return {
    begin(): number {
      latest += 1;
      return latest;
    },
    isCurrent(token: number): boolean {
      // `begin` issues tokens from 1, so nothing is current before the
      // first refresh starts.
      return latest > 0 && token === latest;
    },
  };
}
