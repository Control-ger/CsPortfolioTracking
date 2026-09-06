import { translate } from "./i18n/index.js";

// Session health signal.
//
// A stored token the server refuses used to be reused on every start, because
// nothing ever cleared it: the app looked logged in while every sync call was
// rejected. It is reported here so the UI can say what is wrong instead of
// leaving the user with a working-looking app that silently stops syncing.
//
// There used to be a second state, "local-only", for the sidecar token that
// `initiateDesktopSteamLogin` fell back to when the server login failed. That
// fallback is gone — a token the configured server can never decrypt is not a
// rescue — so the state has no source any more.

export const SESSION_HEALTH_OK = "ok";
/** The server actively refused the stored token; it has been cleared. */
export const SESSION_HEALTH_REJECTED = "rejected";

let state = { status: SESSION_HEALTH_OK, reason: null };
const listeners = new Set();

// Keys, not text: these are persisted into `sync_notifications`, so the row
// outlives the language it was written in. The rendered text is stored
// alongside as the fallback for a reader that has no catalogue.
const NOTIFICATION_KEYS = {
  [SESSION_HEALTH_REJECTED]: {
    titleKey: "common:notifications.sessionExpiredTitle",
    messageKey: "common:notifications.sessionExpiredMessage",
  },
};

// Persist into the in-app notification centre so the state is still findable
// after the avatar badge has been glanced over. Desktop-only: the local store
// is where those entries live. Best-effort — a failing notification must never
// break the sync path that reports the state.
async function persistNotification(status, reason) {
  const keys = NOTIFICATION_KEYS[status];
  const store = typeof window !== "undefined" ? window.electronAPI?.localStore : null;
  if (!keys || !store || typeof store.createNotification !== "function") {
    return;
  }

  try {
    // The notification centre reads with `resolveDesktopLocalUserId(user, 1)`
    // (steam-<steamId>). Writing under a different scope would file the entry
    // where nothing ever looks for it. Dynamic import keeps auth.js out of the
    // static graph — it imports this module.
    const { getCurrentUser } = await import("./auth.js");
    const { resolveDesktopLocalUserId } = await import("./userIdentity.js");
    const userId = resolveDesktopLocalUserId(await getCurrentUser(), 1);

    await store.createNotification({
      userId,
      category: "session_health",
      titleKey: keys.titleKey,
      messageKey: keys.messageKey,
      title: translate(keys.titleKey),
      message: translate(keys.messageKey),
      payload: { status, reason: reason || null },
      // Sync retries every 60s; without this the centre would fill up with
      // identical entries within minutes.
      dedupeWindowHours: 6,
    });
  } catch {
    // best-effort only — a failing notification must never break sync
  }
}

function emit(next) {
  if (state.status === next.status && state.reason === next.reason) {
    return;
  }
  const previousStatus = state.status;
  state = next;
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch {
      // a broken subscriber must not block the others
    }
  });

  if (next.status !== SESSION_HEALTH_OK && next.status !== previousStatus) {
    persistNotification(next.status, next.reason);
  }
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

export function reportSessionRejected(reason) {
  emit({ status: SESSION_HEALTH_REJECTED, reason: reason || null });
}
