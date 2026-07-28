// Session health signal.
//
// Two failure modes previously stayed invisible and turned a one-off login
// hiccup into permanent, undiagnosable 401s:
//
//   1. `initiateDesktopSteamLogin` falls back to the local sidecar login when
//      the server login (Variante C) fails. The sidecar signs its token with a
//      machine-local key, so the server can never decrypt it — the app looks
//      logged in while every sync call is rejected.
//   2. A stored token the server refuses was reused on every start, because
//      nothing ever cleared it.
//
// Both are reported here so the UI can say what is wrong instead of leaving the
// user with a working-looking app that silently stops syncing.

export const SESSION_HEALTH_OK = "ok";
/** Logged in, but the token is sidecar-signed → server sync cannot work. */
export const SESSION_HEALTH_LOCAL_ONLY = "local-only";
/** The server actively refused the stored token; it has been cleared. */
export const SESSION_HEALTH_REJECTED = "rejected";

let state = { status: SESSION_HEALTH_OK, reason: null };
const listeners = new Set();

function emit(next) {
  if (state.status === next.status && state.reason === next.reason) {
    return;
  }
  state = next;
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch {
      // a broken subscriber must not block the others
    }
  });
}

export function getSessionHealth() {
  return state;
}

export function subscribeSessionHealth(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reportSessionHealthy() {
  emit({ status: SESSION_HEALTH_OK, reason: null });
}

export function reportSessionLocalOnly(reason) {
  emit({ status: SESSION_HEALTH_LOCAL_ONLY, reason: reason || null });
}

export function reportSessionRejected(reason) {
  emit({ status: SESSION_HEALTH_REJECTED, reason: reason || null });
}
