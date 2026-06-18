// Lightweight in-process signal so a watchlist mutation (add/batch-add/remove)
// triggered from one surface (global search, search tab, import) can tell the
// already-mounted Watchlist view to refetch. The Watchlist tab stays mounted
// via `forceMount`, so without this it keeps stale state until a full reload.

let version = 0;
const listeners = new Set();

export function getWatchlistMutationVersion() {
  return version;
}

export function subscribeWatchlistMutation(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyWatchlistMutated() {
  version += 1;
  listeners.forEach((listener) => {
    try {
      listener(version);
    } catch {
      // a broken subscriber must not block the others
    }
  });
}
