// ═══════════════════════════════════════════════════════════════════
// Cloudflare Access (single owner)
// ═══════════════════════════════════════════════════════════════════
//
// The upstream server sits behind a Cloudflare Zero Trust tunnel. Two consumers
// need its Access cookie and they get it from the same place — the persistent
// `defaultSession` cookie jar:
//
//   1. the renderer's own fetch() (Chromium attaches it automatically), and
//   2. the PHP sidecar's upstream curl proxy, which is a separate process and
//      therefore needs the cookie handed to it as `X-Upstream-Cf-Cookie`
//      (see the header bridge in sidecar.js).
//
// (2) used to be a one-shot snapshot: written once at startup and once after a
// login window closed. Cloudflare rotates CF_Session during normal renderer
// traffic, so the snapshot went stale while the jar stayed valid — every proxied
// read then got the CF login HTML, the renderer reported
// CLOUDFLARE_ACCESS_LOGIN_REQUIRED, and a login window opened for a session that
// was never actually broken. This module makes the sidecar's copy track the jar
// (`cookies.on("changed")`), so the two consumers cannot drift apart.

import { BrowserWindow, session as electronSession } from "electron";

import { setUpstreamCfCookieHeader, getUpstreamCfCookieHeader } from "./sidecar.js";

const LOGIN_TIMEOUT_MS = 300000;
const COOKIE_POLL_INTERVAL_MS = 1500;
// After CF_Authorization appears, give the redirect chain a moment to also set
// CF_Session before reporting success. Resolving on the first sight of the token
// returned to the caller mid-handshake; the live cache below would repair it a
// tick later, but the caller's immediate retry would still hit a half state.
const LOGIN_SETTLE_MS = 600;
const COOKIE_REFRESH_DEBOUNCE_MS = 150;

// ── Module state ──────────────────────────────────────────────────

// The origin whose CF cookies we mirror into the sidecar. Set from the stored
// server config at startup and updated whenever the user changes the server, so
// a switched host does not keep publishing the previous host's cookie.
let trackedOrigin = "";
let cookieChangeListenerInstalled = false;
let cookieRefreshTimer = null;
// One login window per origin: a burst of failing reads must not open a window
// each. Keyed by origin so switching servers is not blocked by a stale entry.
const loginPromisesByOrigin = new Map();

// ── URL / cookie helpers ──────────────────────────────────────────

export function ensureUrlScheme(value) {
  const normalized = String(value || "").replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
}

// The renderer may pass the API base (".../api/index.php"); Access cookies live
// on the origin, so reduce whatever we get to that.
export function resolveAccessOrigin(serverUrl) {
  try {
    return new URL(ensureUrlScheme(serverUrl)).origin;
  } catch {
    return "";
  }
}

function isCloudflareCookieName(name) {
  const lower = String(name || "").toLowerCase();
  return lower.startsWith("cf_") || lower === "__cflb" || lower.startsWith("cf-access-");
}

// The cookies that prove an Access login, as opposed to cf_clearance (anti-bot)
// and __cflb (load balancer) which CF sets on the very first page load — long
// before the user authenticates.
function isAccessIdentityCookieName(name) {
  const lower = String(name || "").toLowerCase();
  return lower === "cf_authorization" || lower.startsWith("cf-access-");
}

function isAccessSessionCookieName(name) {
  const lower = String(name || "").toLowerCase();
  return lower === "cf_session" || lower === "cf_appsession";
}

function isCookieExpired(cookie, nowSec = Date.now() / 1000) {
  return cookie?.expirationDate !== undefined && cookie.expirationDate <= nowSec;
}

function cookieDomainMatchesHost(cookieDomain, host) {
  const domain = String(cookieDomain || "").replace(/^\./, "").toLowerCase();
  const target = String(host || "").toLowerCase();
  if (!domain || !target) {
    return false;
  }
  return target === domain || target.endsWith(`.${domain}`);
}

// A cookie store can legitimately hold two entries with the same name for one
// origin: the host-only cookie Cloudflare sets (`cs2.example.com`) and a domain
// cookie (`.cs2.example.com`). Both match a request to that origin, so a naive
// join emits `CF_Authorization=<a>; CF_Authorization=<b>` — Cloudflare Access
// rejects that outright and every proxied request 403s. Keep exactly one value
// per name, preferring the host-only cookie (the one CF itself issued).
export function buildCfCookieHeaderFromList(cookies) {
  const byName = new Map();
  const nowSec = Date.now() / 1000;
  for (const cookie of Array.isArray(cookies) ? cookies : []) {
    if (!isCloudflareCookieName(cookie?.name) || isCookieExpired(cookie, nowSec)) {
      continue;
    }
    const key = String(cookie.name).toLowerCase();
    const existing = byName.get(key);
    const isHostOnly = !String(cookie.domain || "").startsWith(".");
    if (!existing || (isHostOnly && String(existing.domain || "").startsWith("."))) {
      byName.set(key, cookie);
    }
  }
  return [...byName.values()].map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

// ── Live cookie mirror for the sidecar ────────────────────────────

// Read the Cloudflare Access cookies for `origin` from the defaultSession — the
// authoritative store the renderer's fetch() also uses. Returns the
// "name=value; ..." header string, or "" when no CF cookie is present.
export async function getAccessCookieHeader(serverUrl) {
  const origin = resolveAccessOrigin(serverUrl);
  if (!origin) {
    return "";
  }
  try {
    const cookies = await electronSession.defaultSession.cookies.get({ url: origin });
    return buildCfCookieHeaderFromList(cookies);
  } catch {
    return "";
  }
}

// Earlier builds re-asserted CF cookies with an explicit `domain`, which stores
// a DOMAIN cookie (`.host`) next to Cloudflare's host-only one. Both match the
// origin, so the renderer's own fetch() sends two values for the same name and
// CF Access rejects the request — a corruption that survives in existing
// profiles even after the writing bug is fixed. Drop the domain-scoped copy
// whenever a host-only cookie of the same name exists for this origin.
async function purgeDuplicateCfCookies(origin) {
  if (!origin) {
    return;
  }
  try {
    const cookies = (await electronSession.defaultSession.cookies.get({ url: origin })).filter(
      (cookie) => isCloudflareCookieName(cookie?.name),
    );
    const hostOnlyNames = new Set(
      cookies
        .filter((cookie) => !String(cookie.domain || "").startsWith("."))
        .map((cookie) => String(cookie.name).toLowerCase()),
    );

    for (const cookie of cookies) {
      const domain = String(cookie.domain || "");
      if (!domain.startsWith(".") || !hostOnlyNames.has(String(cookie.name).toLowerCase())) {
        continue;
      }
      const cookieUrl = `${cookie.secure ? "https" : "http"}://${domain.replace(/^\./, "")}${cookie.path || "/"}`;
      await electronSession.defaultSession.cookies.remove(cookieUrl, cookie.name).catch(() => {});
      console.log("[cloudflare] removed duplicate cookie", `${cookie.name}@${domain}`);
    }
  } catch (error) {
    console.warn("[cloudflare] failed to purge duplicate cookies", error);
  }
}

// Re-read the jar and publish the result to the sidecar header bridge. Cheap and
// idempotent — call it whenever the jar may have changed.
export async function refreshUpstreamCfCookie(serverUrl = trackedOrigin) {
  const origin = resolveAccessOrigin(serverUrl);
  if (!origin) {
    setUpstreamCfCookieHeader("");
    return "";
  }
  const header = await getAccessCookieHeader(origin);
  setUpstreamCfCookieHeader(header);
  return header;
}

function scheduleUpstreamCfCookieRefresh() {
  if (cookieRefreshTimer) {
    return;
  }
  // A single login writes several cookies back to back; debounce so one burst
  // produces one read instead of one per cookie.
  cookieRefreshTimer = setTimeout(() => {
    cookieRefreshTimer = null;
    void refreshUpstreamCfCookie().catch((error) => {
      console.warn("[cloudflare] upstream cookie refresh failed", error?.message || error);
    });
  }, COOKIE_REFRESH_DEBOUNCE_MS);
  if (typeof cookieRefreshTimer.unref === "function") {
    cookieRefreshTimer.unref();
  }
}

function installCookieChangeListener() {
  if (cookieChangeListenerInstalled) {
    return;
  }
  try {
    electronSession.defaultSession.cookies.on("changed", (_event, cookie) => {
      if (!trackedOrigin || !isCloudflareCookieName(cookie?.name)) {
        return;
      }
      let host = "";
      try {
        host = new URL(trackedOrigin).hostname;
      } catch {
        return;
      }
      if (!cookieDomainMatchesHost(cookie?.domain, host)) {
        return;
      }
      // Fires for additions AND removals, so an expired/cleared cookie takes the
      // sidecar's copy with it instead of leaving a stale value behind.
      scheduleUpstreamCfCookieRefresh();
    });
    cookieChangeListenerInstalled = true;
  } catch (error) {
    console.warn("[cloudflare] failed to observe cookie changes", error?.message || error);
  }
}

// Point the mirror at a server and prime it from any still-valid prior login, so
// the sidecar proxy authenticates immediately on a cold start. Call again after
// the user changes the server URL.
export async function trackCloudflareAccessServer(serverUrl) {
  const origin = resolveAccessOrigin(serverUrl);
  trackedOrigin = origin;
  installCookieChangeListener();
  if (!origin) {
    setUpstreamCfCookieHeader("");
    return "";
  }
  await purgeDuplicateCfCookies(origin);
  return await refreshUpstreamCfCookie(origin);
}

// ── Identity ──────────────────────────────────────────────────────

// Identity means an actual Access token for this origin — NOT merely "some CF
// cookie is present". cf_clearance and __cflb exist before authentication, so
// treating any cf_* cookie as proof reported a valid session for an
// unauthenticated user.
export async function hasCloudflareAccessIdentity(serverUrl) {
  const origin = resolveAccessOrigin(serverUrl);
  if (!origin) {
    return false;
  }
  try {
    const cookies = await electronSession.defaultSession.cookies.get({ url: origin });
    const nowSec = Date.now() / 1000;
    const hasToken = cookies.some(
      (cookie) => isAccessIdentityCookieName(cookie?.name) && !isCookieExpired(cookie, nowSec),
    );
    if (!hasToken) {
      return false;
    }
    // CF pairs the long-lived CF_Authorization with a short-lived CF_Session. An
    // expired session cookie still present in the jar means every protected
    // request keeps failing with "Invalid login session" — that is not a valid
    // identity, even though the token itself looks fine.
    const staleSession = cookies.some(
      (cookie) => isAccessSessionCookieName(cookie?.name) && isCookieExpired(cookie, nowSec),
    );
    return !staleSession;
  } catch {
    return false;
  }
}

// ── Login window ──────────────────────────────────────────────────

// A successful login persists CF_Authorization. When it later expires, the next
// login window would find the stale cookie instantly, "succeed", and close
// before the user can authenticate — the open/close flicker. Clear the Access
// cookies right before opening the window so the poll below can only succeed on
// a genuinely fresh login.
async function clearStaleCloudflareAccessCookies(origin) {
  if (!origin) {
    return;
  }

  const sessions = [
    electronSession.fromPartition("persist:cloudflare-access"),
    electronSession.defaultSession,
  ];

  const isStale = (name) => isAccessIdentityCookieName(name) || isAccessSessionCookieName(name);

  for (const sess of sessions) {
    try {
      // Scoped to the target origin on purpose: the identity provider's own
      // cookies (…cloudflareaccess.com) must survive, otherwise every expiry
      // forces a full email + PIN round trip instead of a silent SSO refresh.
      // Within that scope, delete via each cookie's OWN domain/path rather than a
      // single remove() against the origin — an origin can carry both a host-only
      // and a `.host` cookie of the same name, and removing by origin drops only
      // one of them. The survivor makes the next window "succeed" instantly while
      // the duplicate keeps every request failing.
      const cookies = (await sess.cookies.get({ url: origin })).filter((cookie) =>
        isStale(cookie?.name),
      );
      for (const cookie of cookies) {
        const host = String(cookie.domain || "").replace(/^\./, "");
        if (!host) {
          continue;
        }
        const cookieUrl = `${cookie.secure ? "https" : "http"}://${host}${cookie.path || "/"}`;
        await sess.cookies.remove(cookieUrl, cookie.name).catch(() => {});
        await sess.cookies.remove(origin, cookie.name).catch(() => {});
      }

      const leftovers = (await sess.cookies.get({ url: origin })).filter((cookie) =>
        isStale(cookie?.name),
      );
      if (leftovers.length > 0) {
        console.warn(
          "[cloudflare] stale access cookies survived removal",
          leftovers.map((cookie) => `${cookie.name}@${cookie.domain}`),
        );
      }
    } catch (error) {
      console.warn("[cloudflare] failed to clear stale access cookies", error);
    }
  }
}

// CF sets its cookies SameSite=Lax, which a renderer cross-origin fetch() will
// NOT send. Re-assert each one with sameSite:no_restriction + secure so the
// renderer's API calls to the protected origin carry it.
async function reassertCookiesForRendererFetch(origin, cookies) {
  const nowSec = Date.now() / 1000;
  for (const cookie of cookies) {
    // Never re-assert an already-expired cookie: cookies.set with a past
    // expirationDate is dropped anyway, and re-seeding a dead CF_Session would
    // only reintroduce the "Invalid login session" state.
    if (isCookieExpired(cookie, nowSec)) {
      continue;
    }
    // Deliberately NO `domain`: passing one makes Chromium store a DOMAIN cookie
    // (`.host`) alongside Cloudflare's host-only cookie of the same name. Both
    // then match the origin, the request sends two CF_Authorization values, and
    // CF Access rejects it — which re-triggers the login window on every single
    // API call. Omitting `domain` keeps the cookie host-only, so it overwrites
    // CF's own entry instead of shadowing it.
    const details = {
      url: origin,
      name: cookie.name,
      value: cookie.value,
      secure: true,
      sameSite: "no_restriction",
    };
    if (cookie.expirationDate !== undefined) {
      details.expirationDate = cookie.expirationDate;
    }
    await electronSession.defaultSession.cookies.set(details);
  }
}

export function openCloudflareAccessLoginWindow(serverUrl, cfLoginUrl = null) {
  const normalizedUrl = ensureUrlScheme(serverUrl);
  const origin = resolveAccessOrigin(normalizedUrl);
  if (!origin) {
    return Promise.reject(new Error("Keine Server-URL angegeben."));
  }

  const pending = loginPromisesByOrigin.get(origin);
  if (pending) {
    return pending;
  }

  const loginPromise = new Promise((resolve, reject) => {
    let loginWindow = null;
    let finished = false;
    let pollTimer = null;
    // The poll runs both on `did-navigate` and on an interval, so two passes can
    // observe the token at once. Without this they would both re-assert cookies
    // and race each other's writes.
    let completing = false;

    const finish = (handler) => {
      if (finished) return;
      finished = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      clearTimeout(timeoutId);
      loginPromisesByOrigin.delete(origin);
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.removeAllListeners("closed");
        loginWindow.close();
      }
      loginWindow = null;
      handler();
    };

    const timeoutId = setTimeout(() => {
      finish(() => reject(new Error("Cloudflare Access Login Timeout.")));
    }, LOGIN_TIMEOUT_MS);

    const readTargetCookies = async () =>
      // Scope the read to the TARGET ORIGIN. An unfiltered get({}) also returns
      // the identity provider's cookies (…cloudflareaccess.com), which CF sets
      // the moment the email/PIN step succeeds — before it redirects to the
      // app's /cdn-cgi/access/callback that mints the *application* token.
      // Completing on the IdP cookie closed the window one hop early and copied
      // the IdP JWT onto the app domain, where Access rejects it: the login
      // looked successful, every request still 403'd, and the window reopened.
      await loginWindow.webContents.session.cookies.get({ url: origin });

    const pollCookies = async () => {
      if (finished || completing || !loginWindow || loginWindow.isDestroyed()) return;
      try {
        let cookies = await readTargetCookies();
        const nowSec = Date.now() / 1000;
        const hasToken = cookies.some(
          (cookie) => isAccessIdentityCookieName(cookie?.name) && !isCookieExpired(cookie, nowSec),
        );
        if (!hasToken) {
          return;
        }
        completing = true;

        // Let the rest of the redirect chain land (CF_Session usually arrives a
        // beat after CF_Authorization), then read once more so what we hand back
        // is the complete set.
        await new Promise((settle) => setTimeout(settle, LOGIN_SETTLE_MS));
        if (finished || !loginWindow || loginWindow.isDestroyed()) return;
        cookies = await readTargetCookies();

        const cfCookies = cookies.filter((cookie) => isCloudflareCookieName(cookie?.name));

        try {
          // The login window shares defaultSession, so the cookies are already
          // here — but not in a form the renderer's cross-origin fetch() sends.
          await reassertCookiesForRendererFetch(origin, cfCookies);
        } catch (cookieError) {
          console.warn("[cloudflare] failed to set cookies in default session", cookieError);
        }

        // Publish to the sidecar immediately rather than waiting for the debounced
        // change listener, so the caller's retry right after this resolves already
        // proxies with the fresh cookie.
        await refreshUpstreamCfCookie(origin);

        const identityOk = await hasCloudflareAccessIdentity(origin);
        console.log("[cloudflare] login window completed", {
          identityOk,
          cookieCount: cfCookies.length,
          upstreamHeaderPresent: Boolean(getUpstreamCfCookieHeader()),
        });

        finish(() => resolve({ ok: true, cookieCount: cfCookies.length, identityOk }));
      } catch (error) {
        // Let the next tick try again — a transient read failure must not leave
        // the completion latch stuck and strand the window until the timeout.
        completing = false;
        console.warn("[cloudflare] cookie poll error:", error);
      }
    };

    const start = async () => {
      await clearStaleCloudflareAccessCookies(origin);
      // The jar is empty for this origin now; keep the sidecar in step so it does
      // not proxy a cookie we just deleted while the window is open.
      await refreshUpstreamCfCookie(origin);

      loginWindow = new BrowserWindow({
        width: 1180,
        height: 860,
        minWidth: 980,
        minHeight: 700,
        show: true,
        title: "Cloudflare Access Login",
        webPreferences: {
          contextIsolation: true,
          // Share the main window's defaultSession (no partition). CF sets
          // CF_Authorization on this session during login, so it is immediately
          // available to the renderer's fetch() calls — no cross-session copy.
        },
      });

      loginWindow.on("closed", () => {
        finish(() =>
          reject(
            new Error(
              "Cloudflare Access Login wurde geschlossen, bevor der Authentifizierungsprozess abgeschlossen war.",
            ),
          ),
        );
      });

      // Load a protected API path to force a CF login. We deliberately do NOT
      // reuse a `cdn-cgi/access/*` challenge URL (e.g. the `authorized?nonce=…`
      // SSO callback): those carry a single-use nonce and, once consumed, reload
      // as "Invalid login session", so the window could never obtain a fresh
      // session. Hitting the protected resource makes CF mint a brand-new SSO
      // flow (silent via the still-valid IdP cookie) that issues fresh
      // CF_Authorization + CF_Session together.
      const isConsumedAccessUrl = /\/cdn-cgi\/access\//i.test(String(cfLoginUrl || ""));
      const loginTriggerUrl =
        cfLoginUrl && !isConsumedAccessUrl ? cfLoginUrl : `${normalizedUrl}/api/v1/sync/pull`;
      loginWindow.webContents.on("did-navigate", () => {
        void pollCookies();
      });
      await loginWindow.loadURL(loginTriggerUrl);
      pollTimer = setInterval(() => {
        void pollCookies();
      }, COOKIE_POLL_INTERVAL_MS);
    };

    start().catch((error) => {
      finish(() => reject(error));
    });
  });

  loginPromisesByOrigin.set(origin, loginPromise);
  return loginPromise;
}

// The single entry point every caller should use.
//
// A caller lands here because *something* reported a Cloudflare challenge, which
// is not the same as "the user must log in again". By far the most common cause
// was the sidecar proxying a stale cookie copy, so try the cheap repair first —
// re-read the live jar and publish it — and only open a window when there is
// genuinely no usable identity. `force` is for the caller that already retried
// after a refresh and still got a challenge; only then is a real login due.
export async function ensureCloudflareAccessSession(serverUrl, options = {}) {
  const origin = resolveAccessOrigin(serverUrl);
  if (!origin) {
    throw new Error("Keine Server-URL angegeben.");
  }

  const force = options.force === true;
  await purgeDuplicateCfCookies(origin);
  const header = await refreshUpstreamCfCookie(origin);

  if (!force && (await hasCloudflareAccessIdentity(origin))) {
    return {
      ok: true,
      alreadyAuthenticated: true,
      cookieHeaderPresent: Boolean(header),
    };
  }

  return await openCloudflareAccessLoginWindow(serverUrl, options.cfLoginUrl || null);
}
