/* eslint-disable */

import { app, BrowserWindow, protocol as electronProtocol, session as electronSession, shell } from "electron";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { createWriteStream } from "fs";

import {
  setMainWindow,
  setupAutoUpdater,
  clearUpdateCheckTimer,
  startUpdateDownload,
} from "./updater.js";

import {
  getStoredCsFloatApiKey,
  getStoredSkinBaronApiKey,
  getStoredSkinBaronSessionCookie,
  getOrCreateEncryptionKey,
  getSidecarSecretsUnlocked,
  apiConfigureSecretVaultPassword,
  apiUnlockSecretVault,
  apiLockSecretVault,
  apiUpdateSecretVaultPreferences,
  apiOpenSkinBaronSessionLoginWindow,
} from "./secret-vault.js";

import {
  phpSidecar,
  sidecarSecret,
  setSidecarProcess,
  setSidecarSecret,
  setSidecarHeaderBridgeInstalled,
  startPhpSidecar,
  stopPhpSidecar,
  restartPhpSidecar,
  ensurePhpSidecarForRenderer,
  installSidecarRequestHeaderBridge,
  resolveRuntimePath,
  isAsarVirtualPath,
  readDotEnvFile,
  setUpstreamCfCookieHeader,
} from "./sidecar.js";

import {
  registerAllIpcHandlers,
  setBackendBaseUrl,
  setIpcDeps,
} from "./ipc-handlers.js";

// ── Constants ─────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTOCOL = "cs-investor-hub";
const APP_NAME = "CS Investor Hub";

// ── Module-level shared state ──────────────────────────────────────
let mainWindow = null;
let backendBaseUrl = null;
let distIndexPath = null;
let createLocalStore = null;
let localStore = null;
let cloudflareAccessLoginPromise = null;
let pendingProtocolUrl = null;

// ═══════════════════════════════════════════════════════════════════
// File logging
// ═══════════════════════════════════════════════════════════════════

function setupFileLogging() {
  if (!app.isPackaged) {
    return;
  }

  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    if (!fsSync.existsSync(logDir)) {
      fsSync.mkdirSync(logDir, { recursive: true });
    }

    const logFile = path.join(logDir, "main.log");
    const logStream = createWriteStream(logFile, { flags: "a" });

    const originalLog = console.log.bind(console);
    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);

    console.log = (...args) => {
      originalLog(...args);
      logStream.write(`[LOG] ${new Date().toISOString()} ${args.map((a) => String(a)).join(" ")}\n`);
    };

    console.warn = (...args) => {
      originalWarn(...args);
      logStream.write(`[WARN] ${new Date().toISOString()} ${args.map((a) => String(a)).join(" ")}\n`);
    };

    console.error = (...args) => {
      originalError(...args);
      logStream.write(`[ERROR] ${new Date().toISOString()} ${args.map((a) => String(a)).join(" ")}\n`);
    };

    process.on("exit", () => {
      try {
        logStream.end();
      } catch {
        // ignore
      }
    });
  } catch (error) {
    console.warn("[setupFileLogging] Failed to set up file logging:", error);
  }
}

// ═══════════════════════════════════════════════════════════════════
// File path helpers (cache / session / server-config)
// ═══════════════════════════════════════════════════════════════════

function getCacheFilePath() {
  return path.join(app.getPath("userData"), "desktop-cache.json");
}

function getSessionFilePath() {
  return path.join(app.getPath("userData"), "desktop-session.json");
}

function getServerConfigFilePath() {
  return path.join(app.getPath("userData"), "server-config.json");
}

// ── Cache file management ─────────────────────────────────────────

async function readCacheFile() {
  const filePath = getCacheFilePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeCacheFile(data) {
  const filePath = getCacheFilePath();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

// ── Session file management ───────────────────────────────────────

async function readSessionFile() {
  const filePath = getSessionFilePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeSessionFile(data) {
  const filePath = getSessionFilePath();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function deleteSessionFile() {
  const filePath = getSessionFilePath();
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Server config
// ═══════════════════════════════════════════════════════════════════

function getStoredServerConfig() {
  const filePath = getServerConfigFilePath();
  if (!fsSync.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fsSync.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeServerConfig(config) {
  const filePath = getServerConfigFilePath();
  const merged = {
    ...getStoredServerConfig(),
    ...(config || {}),
  };
  fsSync.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

function ensureHttpScheme(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  return `https://${trimmed}`;
}

function looksLikeCloudflareAccessChallenge(response) {
  const finalUrl = String(response?.url || "");
  if (finalUrl.includes("/cdn-cgi/access/") || finalUrl.includes(".cloudflareaccess.com")) {
    return true;
  }
  const server = String(response?.headers?.get?.("server") || "").toLowerCase();
  const deniedReason = String(response?.headers?.get?.("cf-access-denied-reason") || "").trim();
  return Boolean(deniedReason) || (response?.status === 403 && server.includes("cloudflare"));
}

async function testServerConnection(serverUrl) {
  // The settings UI persists a host-only value (e.g. "cs2.example.cc"); without
  // a scheme `fetch` throws and the test always reports "Verbindung fehlgeschlagen".
  const base = ensureHttpScheme(String(serverUrl || "").replace(/\/+$/, ""));
  if (!base) {
    return { ok: false, error: "Keine URL angegeben." };
  }

  // The server entry point may sit at the host root or behind /api/index.php
  // (depending on rewrite rules), so probe the same candidate shapes the
  // sidecar/sync layer uses.
  const candidates = [
    `${base}/api/v1/health`,
    `${base}/api/index.php/api/v1/health`,
    `${base}/index.php/api/v1/health`,
  ];

  let lastStatus = null;
  let networkError = null;
  for (const url of candidates) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        return { ok: true, status: response.status };
      }
      if (looksLikeCloudflareAccessChallenge(response)) {
        return {
          ok: true,
          status: response.status,
          note: "Server erreichbar – Cloudflare Access Login erforderlich.",
        };
      }
      lastStatus = response.status;
    } catch (error) {
      networkError = error;
    }
  }

  if (lastStatus !== null) {
    // We reached the host but no candidate returned a healthy/2xx response.
    return { ok: false, status: lastStatus, error: `Server erreichbar, aber HTTP ${lastStatus}.` };
  }
  return {
    ok: false,
    error: networkError?.message
      ? `Verbindung fehlgeschlagen: ${networkError.message}`
      : "Verbindung fehlgeschlagen.",
  };
}

// ═══════════════════════════════════════════════════════════════════
// Cloudflare Access
// ═══════════════════════════════════════════════════════════════════

function isCloudflareCookieName(name) {
  const lower = String(name || "").toLowerCase();
  return lower.startsWith("cf_") || lower === "__cflb" || lower.startsWith("cf-access-");
}

function buildCfCookieHeaderFromList(cookies) {
  return (Array.isArray(cookies) ? cookies : [])
    .filter((cookie) => isCloudflareCookieName(cookie?.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function ensureUrlScheme(value) {
  const normalized = String(value || "").replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
}

// Read the live Cloudflare Access cookies for the configured server from the
// defaultSession — the authoritative store the renderer's fetch() also uses (the
// login flow re-asserts CF cookies there with sameSite:no_restriction). Returns
// the "name=value; ..." header string, or "" when no CF cookie is present.
// (Previously read desktop-session.json without awaiting the async reader, so it
// always returned null; the cookie is not reliably persisted there anyway.)
async function getAccessCookieHeader(serverUrl) {
  const origin = (() => {
    try {
      return new URL(ensureUrlScheme(serverUrl)).origin;
    } catch {
      return "";
    }
  })();
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

// Refresh the sidecar's upstream CF cookie cache from the live defaultSession so
// the PHP upstream proxy can authenticate after a cold start (reusing a still
// valid cookie from a previous login), not only right after a fresh login.
async function refreshUpstreamCfCookieFromSession(serverUrl) {
  const header = await getAccessCookieHeader(serverUrl);
  setUpstreamCfCookieHeader(header);
  return header;
}

async function hasCloudflareAccessIdentity(serverUrl) {
  const cookieHeader = await getAccessCookieHeader(serverUrl);
  return Boolean(cookieHeader);
}

// A successful Cloudflare Access login persists cf_authorization in the
// persist:cloudflare-access partition. When that cookie later expires, the next
// login window finds the stale cookie instantly, "succeeds", and closes before
// the user can authenticate — producing an endless open/close loop. Clearing the
// stale Access cookies before opening the window forces a real login.
async function clearStaleCloudflareAccessCookies(targetUrl) {
  let origin;
  try {
    origin = new URL(targetUrl).origin;
  } catch {
    return;
  }

  const sessions = [
    electronSession.fromPartition("persist:cloudflare-access"),
    electronSession.defaultSession,
  ];

  for (const sess of sessions) {
    try {
      const cookies = await sess.cookies.get({});
      for (const cookie of cookies) {
        const lower = String(cookie.name || "").toLowerCase();
        // CF_Session is the short-lived session cookie; an expired one that is
        // not cleared lets the login window "succeed" on the still-valid
        // CF_Authorization while every protected request keeps failing with
        // "Invalid login session". Clear it too so a real fresh session is issued.
        if (
          lower === "cf_authorization" ||
          lower === "cf_session" ||
          lower === "cf_appsession" ||
          lower.startsWith("cf-access-")
        ) {
          await sess.cookies.remove(origin, cookie.name).catch(() => {});
        }
      }
    } catch (error) {
      console.warn("[cloudflare] failed to clear stale access cookies", error);
    }
  }
}

async function openCloudflareAccessLoginWindow(serverUrl, cfLoginUrl = null) {
  const normalizedUrl = String(serverUrl || "").replace(/\/+$/, "");
  if (!normalizedUrl) {
    throw new Error("Keine Server-URL angegeben.");
  }

  if (cloudflareAccessLoginPromise) {
    return cloudflareAccessLoginPromise;
  }

  cloudflareAccessLoginPromise = new Promise((resolve, reject) => {
    let loginWindow = null;
    let finished = false;
    let pollTimer = null;

    const cleanup = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const finish = (handler) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      loginWindow = null;
      cloudflareAccessLoginPromise = null;
      handler();
    };

    const timeoutId = setTimeout(() => {
      finish(() => reject(new Error("Cloudflare Access Login Timeout.")));
    }, 300000);

    const pollCookies = async () => {
      if (finished || !loginWindow || loginWindow.isDestroyed()) return;
      try {
        const cookies = await loginWindow.webContents.session.cookies.get({});

        // A completed Cloudflare Access login is proven by the CF_Authorization
        // JWT (or a cf-access-* cookie). Generic Cloudflare cookies such as
        // cf_clearance (anti-bot) and __cflb (load balancer) are set on the very
        // first page load, before the user authenticates — treating them as the
        // success signal closed the window immediately without a real session.
        const cfAccessToken = cookies.find((cookie) => {
          const lower = String(cookie.name || "").toLowerCase();
          return lower === "cf_authorization" || lower.startsWith("cf-access-");
        });

        // CF Access pairs the long-lived CF_Authorization with a short-lived
        // CF_Session. CF_Authorization can stay valid for weeks, so completing on
        // it alone closes the window before CF re-issues a fresh CF_Session —
        // every protected request then loops on "Invalid login session". Only
        // complete when there is no EXPIRED CF_Session present (the stale one is
        // cleared up front, so a fresh token + session arrive together).
        const nowSec = Date.now() / 1000;
        const expiredSession = cookies.find((cookie) => {
          if (String(cookie.name || "").toLowerCase() !== "cf_session") {
            return false;
          }
          return cookie.expirationDate !== undefined && cookie.expirationDate <= nowSec;
        });

        if (cfAccessToken && !expiredSession) {
          clearTimeout(timeoutId);
          const cfCookies = cookies.filter(
            (cookie) =>
              cookie.name.toLowerCase().startsWith("cf_") ||
              cookie.name === "__cflb" ||
              cookie.name === "cf_clearance",
          );
          const cookieMap = {};
          for (const cookie of cfCookies) {
            cookieMap[cookie.name] = cookie.value;
          }
          cookieMap[cfAccessToken.name] = cfAccessToken.value;

          try {
            const session = await readSessionFile();
            session[normalizedUrl] = { cookies: cookieMap, updatedAt: new Date().toISOString() };
            await writeSessionFile(session);
          } catch (writeError) {
            console.warn("[cloudflare] failed to persist session cookies", writeError);
          }

          try {
            // electronSession is the top-level named import from "electron".
            // The login window now shares defaultSession, so CF_Authorization is
            // already present here — but CF sets it SameSite=Lax, which a
            // renderer cross-origin fetch() will NOT send. Re-assert each cookie
            // with sameSite:no_restriction + secure so it is sent with the
            // renderer's API calls to the Cloudflare-protected origin.
            const origin = new URL(normalizedUrl).origin;
            const hostname = new URL(normalizedUrl).hostname;
            const cookiesByName = new Map(cfCookies.map((c) => [c.name, c]));
            cookiesByName.set(cfAccessToken.name, cfAccessToken);
            for (const cookie of cookiesByName.values()) {
              // Never re-assert an already-expired cookie (e.g. a stale
              // CF_Session): cookies.set with a past expirationDate is dropped,
              // and re-seeding it would only reintroduce the dead session.
              if (cookie.expirationDate !== undefined && cookie.expirationDate <= nowSec) {
                continue;
              }
              const details = {
                url: origin,
                name: cookie.name,
                value: cookie.value,
                domain: hostname,
                secure: true,
                sameSite: "no_restriction",
              };
              if (cookie.expirationDate !== undefined) {
                details.expirationDate = cookie.expirationDate;
              }
              await electronSession.defaultSession.cookies.set(details);
            }

            // Seed the sidecar upstream proxy cookie cache so proxied reads
            // (prices/history/search/composition) authenticate through CF
            // immediately, without waiting for the startup session refresh.
            setUpstreamCfCookieHeader(buildCfCookieHeaderFromList([...cookiesByName.values()]));

            // Diagnostic: confirm CF_Authorization is now in defaultSession so a
            // failing login can be told apart from a failing cookie delivery.
            const verify = await electronSession.defaultSession.cookies.get({ name: cfAccessToken.name });
            const verifySession = await electronSession.defaultSession.cookies.get({ name: "cf_session" });
            console.log("[cloudflare] CF_Authorization in defaultSession after login:", {
              present: verify.length > 0,
              sameSite: verify[0]?.sameSite,
              domain: verify[0]?.domain,
              secure: verify[0]?.secure,
              cfSessionPresent: verifySession.length > 0,
              cfSessionExpiresInSec:
                verifySession[0]?.expirationDate !== undefined
                  ? Math.round(verifySession[0].expirationDate - Date.now() / 1000)
                  : null,
            });
          } catch (cookieError) {
            console.warn("[cloudflare] failed to set cookies in default session", cookieError);
          }

          finish(() => resolve({ ok: true, cookieCount: cfCookies.length }));
        }
      } catch (error) {
        console.warn("[cloudflare] cookie poll error:", error);
      }
    };

    const start = async () => {
      // Drop any expired Access cookie first so the poll below only succeeds
      // after a genuine fresh login (otherwise the window closes instantly).
      await clearStaleCloudflareAccessCookies(normalizedUrl);

      loginWindow = new BrowserWindow({
        parent: undefined,
        modal: false,
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
        clearTimeout(timeoutId);
        finish(() => reject(new Error("Cloudflare Access Login wurde geschlossen, bevor der Authentifizierungsprozess abgeschlossen war.")));
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
      }, 1500);
    };

    start().catch((error) => {
      clearTimeout(timeoutId);
      finish(() => reject(error));
    });
  });

  return cloudflareAccessLoginPromise;
}

// Variante C: obtain a SERVER-issued Steam session token.
// The remote server runs the Steam OpenID flow and, for a custom-protocol
// returnUrl, redirects to cs-portfolio://auth/steam/callback#token=<token>.
// We open the Steam OpenID URL in a window that shares defaultSession (so the
// CF_Authorization cookie lets the protected callback through) and intercept the
// cs-portfolio:// navigation to capture the token without leaving Electron.
async function openSteamServerLoginWindow(steamOpenIdUrl) {
  const url = String(steamOpenIdUrl || "").trim();
  if (!/^https:\/\//i.test(url)) {
    throw new Error("Ungueltige Steam-Login-URL.");
  }

  return new Promise((resolve, reject) => {
    let loginWindow = null;
    let finished = false;

    const finish = (handler) => {
      if (finished) return;
      finished = true;
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.removeAllListeners("closed");
        loginWindow.close();
      }
      loginWindow = null;
      handler();
    };

    const timeoutId = setTimeout(() => {
      finish(() => reject(new Error("Steam Login Timeout.")));
    }, 300000);

    // Returns: null = not our protocol, "" = protocol but no token, "<token>" = ok
    const extractToken = (candidate) => {
      const raw = String(candidate || "");
      if (!raw.toLowerCase().startsWith("cs-portfolio://")) {
        return null;
      }
      const hashIndex = raw.indexOf("#");
      const fragment = hashIndex >= 0 ? raw.slice(hashIndex + 1) : "";
      const token = new URLSearchParams(fragment).get("token");
      return token || "";
    };

    // Diagnostic: log each navigation hop's host (never the token) so a failed
    // capture can be told apart from "no callback ever arrived".
    const logHop = (source, candidateUrl) => {
      const raw = String(candidateUrl || "");
      let host = raw;
      try {
        host = new URL(raw).host || raw.slice(0, 40);
      } catch {
        host = raw.slice(0, 40);
      }
      console.log(`[steam-login] ${source}: ${host}`);
    };

    const handleCandidate = (event, candidateUrl, source) => {
      logHop(source, candidateUrl);
      const token = extractToken(candidateUrl);
      if (token === null) {
        return; // unrelated navigation (Steam/CF pages)
      }
      console.log(`[steam-login] callback reached; token extracted: ${token ? "yes" : "NO (fragment missing)"}`);
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      clearTimeout(timeoutId);
      if (token) {
        finish(() => resolve({ ok: true, token }));
      } else {
        finish(() => reject(new Error("Steam Login lieferte keinen Token (Fragment fehlt).")));
      }
    };

    loginWindow = new BrowserWindow({
      width: 1180,
      height: 860,
      minWidth: 980,
      minHeight: 700,
      show: true,
      title: "Steam Login",
      webPreferences: {
        contextIsolation: true,
        // No partition → shares defaultSession (carries the CF_Authorization
        // cookie so the protected callback is not blocked by Cloudflare Access).
      },
    });

    // The custom-scheme redirect can surface as a redirect, a navigation, or a
    // failed load (ERR_UNKNOWN_URL_SCHEME) depending on platform — handle all.
    loginWindow.webContents.on("will-redirect", (event, nextUrl) => handleCandidate(event, nextUrl, "will-redirect"));
    loginWindow.webContents.on("will-navigate", (event, nextUrl) => handleCandidate(event, nextUrl, "will-navigate"));
    loginWindow.webContents.on("did-fail-load", (_event, code, _desc, validatedUrl) =>
      handleCandidate(null, validatedUrl, `did-fail-load(${code})`),
    );

    loginWindow.on("closed", () => {
      clearTimeout(timeoutId);
      finish(() => reject(new Error("Steam Login wurde geschlossen, bevor er abgeschlossen war.")));
    });

    loginWindow.loadURL(url).catch(() => {
      // Loading may reject when the flow ends on the custom scheme; the
      // did-fail-load / will-redirect handlers above capture the token.
    });
  });
}

async function ensureCloudflareAccessSession(serverUrl) {
  if (await hasCloudflareAccessIdentity(serverUrl)) {
    return { ok: true, alreadyAuthenticated: true };
  }
  return await openCloudflareAccessLoginWindow(serverUrl);
}

// ═══════════════════════════════════════════════════════════════════
// Local store loader
// ═══════════════════════════════════════════════════════════════════

async function getLocalStore() {
  if (createLocalStore) {
    return createLocalStore;
  }
  try {
    // Dynamic import() needs a file:// URL for absolute paths on Windows,
    // otherwise the drive letter (C:) is parsed as a URL scheme and throws
    // ERR_UNSUPPORTED_ESM_URL_SCHEME.
    const localStorePath = resolveRuntimePath(
      "apps", "desktop", "src", "localStore", "index.js",
    );
    const localStoreModule = await import(pathToFileURL(localStorePath).href);
    createLocalStore = localStoreModule.createLocalStore;
    return createLocalStore;
  } catch (error) {
    console.error("[main] failed to load local store:", error);
    createLocalStore = null;
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Create window
// ═══════════════════════════════════════════════════════════════════

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 980,
    minHeight: 700,
    show: false,
    frame: false,
    icon: resolveRuntimePath("icon.ico"),
    title: APP_NAME,
    webPreferences: {
      preload: resolveRuntimePath("apps", "desktop", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  });

  if (distIndexPath && fsSync.existsSync(distIndexPath)) {
    win.loadFile(distIndexPath);
  } else {
    const devUrl = "http://localhost:5173";
    console.log("[main] loading dev server:", devUrl);
    win.loadURL(devUrl);
  }

  win.once("ready-to-show", () => {
    win.show();
    if (pendingProtocolUrl) {
      const url = pendingProtocolUrl;
      pendingProtocolUrl = null;
      handleProtocolUrl(url);
    }
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  mainWindow = win;

  return win;
}

// ═══════════════════════════════════════════════════════════════════
// Protocol handler (cs-investor-hub://)
// ═══════════════════════════════════════════════════════════════════

function registerProtocol() {
  if (!app.isPackaged) {
    return;
  }
  try {
    app.setAsDefaultProtocolClient(PROTOCOL);
    console.log(`[protocol] registered ${PROTOCOL}://`);
  } catch (error) {
    console.warn("[protocol] failed to register protocol client:", error);
  }
}

function handleProtocolUrl(url) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingProtocolUrl = url;
    return;
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("protocol-url", url);
}

// ═══════════════════════════════════════════════════════════════════
// App lifecycle
// ═══════════════════════════════════════════════════════════════════

// ── Single instance lock ─────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }

    const protocolUrl = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (protocolUrl) {
      handleProtocolUrl(protocolUrl);
    }
  });
}

// ── macOS open-url ──────────────────────────────────────────────

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (url && url.startsWith(`${PROTOCOL}://`)) {
    handleProtocolUrl(url);
  }
});

// ── before-quit ─────────────────────────────────────────────────

app.on("before-quit", () => {
  clearUpdateCheckTimer();
  stopPhpSidecar();
});

// ── window-all-closed ───────────────────────────────────────────

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// ── app.whenReady ───────────────────────────────────────────────

app.whenReady().then(async () => {
  setupFileLogging();

  app.setName(APP_NAME);

  // Determine dist index path
  const distPath = resolveRuntimePath("dist", "index.html");
  if (fsSync.existsSync(distPath)) {
    distIndexPath = distPath;
    console.log("[main] dist found:", distIndexPath);
  } else {
    console.log("[main] no dist found, will use dev server");
  }

  registerProtocol();

  // Resolve backend base URL
  const serverConfig = getStoredServerConfig();
  const configuredUrl = String(serverConfig?.serverUrl || "").trim();
  if (configuredUrl) {
    backendBaseUrl = configuredUrl;
  } else {
    const dotEnv = readDotEnvFile(
      path.resolve(__dirname, "..", "..", "..", ".env"),
    );
    backendBaseUrl = String(dotEnv?.BACKEND_BASE_URL || "").trim() || "http://localhost:8080";
  }
  setBackendBaseUrl(backendBaseUrl);

  // Ensure encryption key for session tokens
  getOrCreateEncryptionKey();

  // Load local store module
  const storeLoader = await getLocalStore();
  if (typeof storeLoader === "function") {
    try {
      // createLocalStore(userDataPath) resolves the SQLite path from this
      // argument; omitting it makes path.join() throw "path must be a string"
      // and leaves localStore null → every IPC call returns
      // "Local store not available".
      localStore = storeLoader(app.getPath("userData"));
    } catch (storeError) {
      console.warn("[main] local store init error:", storeError);
    }
  }

  // Wire up IPC dependencies
  setIpcDeps({
    getLocalStore: () => localStore,
    readCacheFile,
    writeCacheFile,
    readSessionFile,
    writeSessionFile,
    deleteSessionFile,
    openCloudflareAccessLoginWindow,
    openSteamServerLoginWindow,
    getStoredServerConfig,
    writeServerConfig,
    testServerConnection,
  });

  // Register all IPC handlers
  registerAllIpcHandlers();

  // Start sidecar
  try {
    await startPhpSidecar();
    console.log("[main] sidecar started");
  } catch (error) {
    console.warn("[main] sidecar start failed (will retry after vault unlock):", error?.message);
  }

  // Install request header bridge for sidecar auth
  await installSidecarRequestHeaderBridge();

  // Seed the upstream CF cookie cache from any still-valid prior login so the
  // sidecar proxy authenticates immediately on cold start, before the user
  // triggers a fresh CF login window.
  try {
    const seedServerUrl = String(getStoredServerConfig?.()?.serverUrl || "").trim();
    if (seedServerUrl) {
      await refreshUpstreamCfCookieFromSession(seedServerUrl);
    }
  } catch (cfSeedError) {
    console.warn("[cloudflare] failed to seed upstream cookie cache", cfSeedError?.message || cfSeedError);
  }

  // Register updater refs
  const win = createWindow();
  const { setMainWindow: setUpdaterMainWindow, setLocalStoreRefs } = await import("./updater.js");
  setUpdaterMainWindow(win);
  setLocalStoreRefs(getLocalStore, localStore);

  // Setup auto-updater
  setupAutoUpdater();

  console.log(`[main] ${APP_NAME} ready`);
});

// Export for testing / external use
export {
  getStoredServerConfig,
  writeServerConfig,
  testServerConnection,
  readCacheFile,
  writeCacheFile,
  readSessionFile,
  writeSessionFile,
  deleteSessionFile,
  getLocalStore,
  createWindow,
  getAccessCookieHeader,
  hasCloudflareAccessIdentity,
  openCloudflareAccessLoginWindow,
  openSteamServerLoginWindow,
  ensureCloudflareAccessSession,
};
