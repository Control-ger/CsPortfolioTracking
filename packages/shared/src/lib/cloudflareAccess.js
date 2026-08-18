import { resolveAccessBaseUrl } from "./serverConfig.js";
import { translate } from "./i18n/index.js";

// ═══════════════════════════════════════════════════════════════════
// Cloudflare Access (renderer side, single owner)
// ═══════════════════════════════════════════════════════════════════
//
// Three call sites used to detect CF challenges and open login windows on their
// own (auth.js, desktopSync.js, api/core.js), each with a different detector and
// a different amount of coalescing. The consequences were concrete:
//
//   - auth.js classified ANY `text/html` + `server: cloudflare` response as a
//     challenge, with no status check — a 404 or 502 HTML error page from the
//     origin opened a login window, and that window clears the Access cookies
//     before it loads. A server hiccup logged the user out of Cloudflare.
//   - desktopSync.js had no coalescing at all, so a burst of failing requests
//     asked for a window each.
//
// Everything CF-related in the renderer now goes through this module.

// A forced login window that did not fix the problem must not be reopened on the
// next request — that is what made the window flash open and shut repeatedly.
const FORCED_LOGIN_COOLDOWN_MS = 60000;

let pendingEnsure = null;
let pendingForcedLogin = null;
let forcedLoginBlockedUntil = 0;

function getLoginBridge() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.electronAPI?.cloudflareAccess?.login || null;
}

async function resolveConfiguredServerBase() {
  if (typeof window === "undefined" || !window.electronAPI?.serverConfig?.get) {
    return "";
  }
  try {
    const config = await window.electronAPI.serverConfig.get();
    return String(config?.serverUrl || config?.url || "").trim();
  } catch {
    return "";
  }
}

/**
 * Does this response mean "Cloudflare Access wants a login", as opposed to a
 * normal API error that merely travelled through Cloudflare?
 *
 * The status gate is the load-bearing part: without it every HTML error page
 * served by the edge is mistaken for a challenge.
 */
export function isCloudflareAccessChallengeResponse(response) {
  const url = String(response?.url || "");
  if (url.includes("/cdn-cgi/access/") || url.includes(".cloudflareaccess.com")) {
    return true;
  }

  const deniedReason = String(response?.headers?.get?.("cf-access-denied-reason") || "").trim();
  if (deniedReason) {
    return true;
  }

  if (response?.status !== 401 && response?.status !== 403) {
    return false;
  }

  const challengeHint = String(response?.headers?.get?.("cf-mitigated") || "").toLowerCase();
  if (challengeHint.includes("challenge")) {
    return true;
  }

  // Avoid false positives for normal API auth errors (JSON 401/403).
  const contentType = String(response?.headers?.get?.("content-type") || "").toLowerCase();
  const serverHeader = String(response?.headers?.get?.("server") || "").toLowerCase();
  return contentType.includes("text/html") && serverHeader.includes("cloudflare");
}

/**
 * Upstream answered without a challenge, so whatever the last failure was, it is
 * over — let the next genuine expiry prompt immediately instead of waiting out
 * the cooldown.
 */
export function notifyCloudflareAccessHealthy() {
  forcedLoginBlockedUntil = 0;
}

/**
 * Ask the main process for a usable Cloudflare Access session.
 *
 * Without `force` this is cheap and never shows a window: the main process
 * re-reads the live cookie jar, republishes it to the PHP sidecar, and reports
 * success if a valid Access identity is already there. That covers the most
 * common failure — the sidecar holding a cookie copy that Cloudflare has since
 * rotated — without interrupting the user.
 *
 * `force` opens the real login window and is meant for the caller that already
 * retried after a plain ensure and still got a challenge.
 */
export async function ensureCloudflareAccessLogin(serverBaseUrl, options = {}) {
  const login = getLoginBridge();
  if (!login) {
    return { ok: false, unavailable: true };
  }

  const accessBaseUrl = resolveAccessBaseUrl(serverBaseUrl || (await resolveConfiguredServerBase()));
  if (!accessBaseUrl) {
    return { ok: false, error: translate("common:runtimeErrors.noServerUrl") };
  }

  const force = options.force === true;
  const cfLoginUrl = options.cfLoginUrl || null;

  if (!force) {
    if (!pendingEnsure) {
      pendingEnsure = Promise.resolve(login(accessBaseUrl, { cfLoginUrl }))
        .catch((error) => {
          console.warn("[cloudflare] access session refresh failed", error);
          return { ok: false, error: error?.message || String(error) };
        })
        .finally(() => {
          pendingEnsure = null;
        });
    }
    return await pendingEnsure;
  }

  if (Date.now() < forcedLoginBlockedUntil) {
    return { ok: false, throttled: true };
  }

  if (!pendingForcedLogin) {
    pendingForcedLogin = Promise.resolve(login(accessBaseUrl, { cfLoginUrl, force: true }))
      .catch((error) => {
        console.warn("[cloudflare] access login failed", error);
        return { ok: false, error: error?.message || String(error) };
      })
      .finally(() => {
        // Arm the cooldown even on success: "ok" only means a CF token was
        // observed, not that the upstream accepts it.
        forcedLoginBlockedUntil = Date.now() + FORCED_LOGIN_COOLDOWN_MS;
        pendingForcedLogin = null;
      });
  }
  return await pendingForcedLogin;
}

/**
 * fetch() against a Cloudflare-protected origin, recovering from a challenge.
 *
 * Two escalation steps on purpose: the silent refresh first (no window), and
 * only if the challenge survives it, the login window.
 */
export async function fetchWithCloudflareAccess(url, options, serverBaseUrl) {
  const requestInit = { ...options, credentials: "include" };

  let response = await fetch(url, requestInit);
  if (!isCloudflareAccessChallengeResponse(response)) {
    notifyCloudflareAccessHealthy();
    return response;
  }

  if (!getLoginBridge()) {
    return response;
  }

  const refresh = await ensureCloudflareAccessLogin(serverBaseUrl, { cfLoginUrl: response.url });
  if (refresh?.ok) {
    response = await fetch(url, requestInit);
    if (!isCloudflareAccessChallengeResponse(response)) {
      notifyCloudflareAccessHealthy();
      return response;
    }
  }

  const loginResult = await ensureCloudflareAccessLogin(serverBaseUrl, {
    force: true,
    cfLoginUrl: response.url,
  });
  if (!loginResult?.ok) {
    return response;
  }

  response = await fetch(url, requestInit);
  if (!isCloudflareAccessChallengeResponse(response)) {
    notifyCloudflareAccessHealthy();
  }
  return response;
}
