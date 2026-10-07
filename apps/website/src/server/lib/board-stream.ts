/**
 * In-process change signal for the board. SHark runs as one process, so a
 * per-user listener set is enough: writers call `notifyBoardChanged`, the SSE
 * route forwards the new version to open pages, and pages re-fetch the board.
 * Only the version travels over the stream, never board content.
 */
type Listener = (version: number) => void;

const listeners = new Map<string, Set<Listener>>();
const versions = new Map<string, number>();

export function boardVersion(userId: string): number {
  return versions.get(userId) ?? 0;
}

export function notifyBoardChanged(userId: string): number {
  const version = boardVersion(userId) + 1;
  versions.set(userId, version);
  for (const listener of listeners.get(userId) ?? []) {
    try {
      listener(version);
    } catch {
      // A broken listener never blocks the write that triggered it.
    }
  }
  return version;
}

export function subscribeBoard(userId: string, listener: Listener): () => void {
  const set = listeners.get(userId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(userId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(userId);
      // Nobody is watching, so the counter can restart; pages refetch on any
      // `changed` event rather than comparing versions across connections.
      versions.delete(userId);
    }
  };
}

/** Test hook. */
export function resetBoardStream(): void {
  listeners.clear();
  versions.clear();
}
