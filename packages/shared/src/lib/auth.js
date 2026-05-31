/**
 * Steam Authentication Service
 * 
 * Handles Steam OpenID login flow for Desktop (Electron) and Web.
 * Desktop uses custom protocol handler (cs-portfolio://), Web uses normal redirect.
 */

import { unwrapLocalStoreResult } from "./localStoreResult.js";
import { normalizeDesktopLocalUserId } from "./userIdentity.js";

// Resolve configured API base URL - handle Electron file:// origin gracefully
function resolveConfiguredApiBase() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return normalizeApiBase(import.meta.env.VITE_API_BASE_URL);
  }
  // In Electron, window.location.origin may be "file://"
  if (typeof window !== 'undefined' && window.location.origin !== 'file://') {
    return normalizeApiBase(`${window.location.origin}/api/index.php`);
  }
  // Fallback for Electron / unknown environment
  return 'http://localhost:8080/api/index.php';
}

const API_BASE = resolveConfiguredApiBase();

function normalizeApiBase(value) {
  return String(value || '')
    .replace(/\/+$/, '')
    .replace(/\/api\/v1$/i, '');
}

function unwrapApiData(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

async function resolveApiBase() {
  if (isDesktopApp() && window.electronAPI?.backend?.getBaseUrl) {
    const desktopBase = await window.electronAPI.backend.getBaseUrl();
    if (desktopBase) {
      return normalizeApiBase(desktopBase);
    }
  }

  return API_BASE;
}

function isDesktopSidecarBase(apiBase) {
  return /^http:\/\/(127\.0\.0\.1|localhost):\d+$/i.test(String(apiBase || ""));
}

async function applyDesktopSidecarAuthHeaders(apiBase, options = {}) {
  const nextHeaders = new Headers(options?.headers || {});

  if (
    isDesktopSidecarBase(apiBase) &&
    isDesktopApp() &&
    window.electronAPI?.backend?.getAuthHeaders
  ) {
    try {
      const authHeaders = await window.electronAPI.backend.getAuthHeaders();
      if (authHeaders && typeof authHeaders === "object") {
        Object.entries(authHeaders).forEach(([key, value]) => {
          if (value !== undefined && value !== null && String(value).trim() !== "") {
            nextHeaders.set(String(key), String(value));
          }
        });
      }
    } catch (error) {
      console.warn("[auth] failed to resolve desktop sidecar auth headers", error);
    }
  }

  return {
    ...options,
    headers: nextHeaders,
  };
}

async function fetchWithDesktopRetry(path, options) {
  let apiBase = await resolveApiBase();
  let requestOptions = await applyDesktopSidecarAuthHeaders(apiBase, options);
  try {
    return await fetch(`${apiBase}${path}`, requestOptions);
  } catch (error) {
    const isDesktop = isDesktopApp() && window.electronAPI?.backend?.getBaseUrl;
    const shouldRetry =
      isDesktop &&
      error instanceof TypeError &&
      String(error?.message || "").toLowerCase().includes("fetch");

    if (!shouldRetry) {
      throw error;
    }

    const refreshedBase = await window.electronAPI.backend.getBaseUrl();
    if (!refreshedBase) {
      throw error;
    }

    apiBase = normalizeApiBase(refreshedBase);
    requestOptions = await applyDesktopSidecarAuthHeaders(apiBase, options);
    return await fetch(`${apiBase}${path}`, requestOptions);
  }
}

// Custom protocol for desktop app callback
const DESKTOP_PROTOCOL = 'cs-portfolio://auth/steam/callback';
const WEB_AUTH_TOKEN_KEY = 'auth_token';
const WEB_AUTH_USER_KEY = 'auth_user';
const WEB_AUTH_COOKIE_KEY = 'cspt_auth_token';
const WEB_AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Check if running in Electron Desktop environment
 */
function isDesktopApp() {
  return typeof window !== 'undefined' && 
         window.electronAPI !== undefined;
}

function setWebCookie(name, value, maxAgeSeconds) {
  if (typeof document === 'undefined') {
    return;
  }

  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

function getWebCookie(name) {
  if (typeof document === 'undefined') {
    return null;
  }

  const raw = document.cookie || '';
  const prefix = `${name}=`;
  const found = raw
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!found) {
    return null;
  }

  return decodeURIComponent(found.slice(prefix.length));
}

function clearWebCookie(name) {
  if (typeof document === 'undefined') {
    return;
  }
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function hasAnimatedAvatarData(user) {
  if (!user || typeof user !== "object") {
    return false;
  }
  const candidates = [
    user.animatedAvatar,
    user.animated_avatar,
    user.animatedAvatarUrl,
    user.animated_avatar_url,
  ];

  return candidates.some((value) => typeof value === "string" && value.trim() !== "");
}

function isLegacyDevUser(user) {
  const id = String(user?.id || "").trim();
  return id.startsWith("dev-user-");
}

/**
 * Initiate Steam login flow
 * 
 * Desktop: Opens system browser, waits for protocol callback via IPC
 * Web: Redirects to Steam and back
 */
export async function initiateSteamLogin() {
  if (isDesktopApp()) {
    return initiateDesktopSteamLogin();
  } else {
    return initiateWebSteamLogin();
  }
}

/**
 * Desktop Steam Login via system browser
 */
async function initiateDesktopSteamLogin() {
  try {
    // 1. Request login URL from backend
    const response = await fetchWithDesktopRetry(`/api/v1/auth/steam/login?returnUrl=${encodeURIComponent(DESKTOP_PROTOCOL)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = unwrapApiData(await response.json());
    
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to initiate Steam login');
    }
    
    // 2. Open system browser with Steam login URL via IPC
    // Use electronAPI to call main process, avoiding direct electron imports
    await window.electronAPI.openExternal(data.redirectUrl);

    // 3. Poll the local sidecar for the auth result. This is more reliable than
    // custom protocol callbacks in dev/release, where Windows protocol
    // registration can point to an old executable.
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        clearInterval(interval);
        reject(new Error('Login timeout - please try again'));
      }, 300000); // 5 minutes

      const interval = setInterval(async () => {
        try {
          const resultResponse = await fetchWithDesktopRetry(
            `/api/v1/auth/steam/result?state=${encodeURIComponent(data.state)}`,
            { method: 'GET', headers: { 'Content-Type': 'application/json' } }
          );
          const result = unwrapApiData(await resultResponse.json());

          if (result?.pending) {
            return;
          }

          if (result?.success && result.sessionToken) {
            clearTimeout(timeout);
            clearInterval(interval);

            await storeSession(result.sessionToken, result.user);
            resolve({ success: true, user: result.user, sessionToken: result.sessionToken });
            return;
          }

          if (result && result.pending !== true) {
            clearTimeout(timeout);
            clearInterval(interval);
            reject(new Error(result.error || 'Login failed'));
          }
        } catch {
          // The browser may still be in the Steam flow; keep polling until timeout.
        }
      }, 1000);

      const handler = async (event, result) => {
        if (result.success && result.sessionToken) {
          try {
            // Validate token with backend to get user data securely
            const validationResult = await validateSession(result.sessionToken);
            
            if (!validationResult || !validationResult.success) {
              clearTimeout(timeout);
              clearInterval(interval);
              reject(new Error('Session validation failed'));
              return;
            }
            
            // Store encrypted session with validated user data
            clearTimeout(timeout);
            clearInterval(interval);
            await storeSession(result.sessionToken, validationResult.user);
            resolve({ success: true, user: validationResult.user, sessionToken: result.sessionToken });
          } catch {
            clearTimeout(timeout);
            clearInterval(interval);
            reject(new Error('Failed to validate session'));
          }
        } else {
          clearTimeout(timeout);
          clearInterval(interval);
          reject(new Error(result.error || 'Login failed'));
        }
      };
      
      // Listen for auth callback from main process
      window.electronAPI.once('steam-auth-callback', handler);
    });
    
  } catch (error) {
    console.error('[auth] Desktop Steam login failed:', error);
    // Provide a more helpful error message when backend is unreachable
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('Cannot connect to authentication server. Please ensure the backend is running.');
    }
    throw error;
  }
}

/**
 * Web Steam Login via redirect
 */
function initiateWebSteamLogin() {
  // Store current URL to return after login
  sessionStorage.setItem('auth_return_url', window.location.href);

  // Request Steam redirect URL from backend, then navigate to Steam.
  // Use root callback target to avoid route-relative asset fetches like /auth/assets/*
  // behind strict reverse proxies / access gateways.
  const returnUrl = `${window.location.origin}/`;
  return resolveApiBase()
    .then((apiBase) =>
      fetch(`${apiBase}/api/v1/auth/steam/login?returnUrl=${encodeURIComponent(returnUrl)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    .then(async (response) => {
      const data = unwrapApiData(await response.json());
      if (!response.ok || !data?.success || !data?.redirectUrl) {
        throw new Error(data?.error || 'Failed to initiate Steam login');
      }
      window.location.href = data.redirectUrl;
    })
    .catch((error) => {
      console.error('[auth] Web Steam login failed:', error);
      throw error;
    });
}

/**
 * Handle Web callback after Steam login
 * Receives only the token from the backend redirect, then validates it
 */
export async function handleWebAuthCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
  const token = hashParams.get('token') || urlParams.get('token');
  
  if (!token) {
    return { success: false, error: 'Missing token in callback URL' };
  }
  
  try {
    // Validate token with backend to get user data securely
    const result = await validateSession(token);
    
    if (!result || !result.success) {
      return { success: false, error: 'Session validation failed' };
    }
    
    // Store session locally
    storeSession(token, result.user);
    
    // Return to original page
    const returnUrl = sessionStorage.getItem('auth_return_url') || '/';
    sessionStorage.removeItem('auth_return_url');
    window.location.href = returnUrl;
    
    return { success: true, user: result.user };
  } catch (error) {
    console.error('[auth] Failed to handle callback:', error);
    return { success: false, error: 'Failed to complete authentication' };
  }
}

/**
 * Store session securely
 */
function storeSession(token, user) {
  if (isDesktopApp()) {
    // Desktop: Store encrypted via IPC
    return window.electronAPI.storeSession(token, user);
  } else {
    // Web: Keep tab session + persistent session (re-login not needed on restart)
    sessionStorage.setItem(WEB_AUTH_TOKEN_KEY, token);
    sessionStorage.setItem(WEB_AUTH_USER_KEY, JSON.stringify(user));
    localStorage.setItem(WEB_AUTH_TOKEN_KEY, token);
    localStorage.setItem(WEB_AUTH_USER_KEY, JSON.stringify(user));
    setWebCookie(WEB_AUTH_COOKIE_KEY, token, WEB_AUTH_COOKIE_MAX_AGE_SECONDS);
    return true;
  }
}

/**
 * Get current session (async for Desktop IPC)
 */
export async function getSession() {
  if (isDesktopApp()) {
    try {
      const session = await window.electronAPI.getSession();
      if (!session || !session.token) {
        return null;
      }
      if (isLegacyDevUser(session.user)) {
        try {
          await window.electronAPI.clearSession();
        } catch {
          // ignore best-effort cleanup
        }
        return null;
      }

      // Some callback paths may persist token-only sessions first.
      // Hydrate missing user data once via backend validation and persist it.
      if (!session.user) {
        const validated = await validateSession(session.token);
        if (validated?.success && validated.user) {
          try {
            await storeSession(session.token, validated.user);
          } catch {
            // keep best-effort session enrichment silent
          }

          return {
            ...session,
            user: validated.user,
          };
        }
      }

      return session;
    } catch {
      return null;
    }
  } else {
    const tokenFromSession = sessionStorage.getItem(WEB_AUTH_TOKEN_KEY);
    const tokenFromLocal = localStorage.getItem(WEB_AUTH_TOKEN_KEY);
    const tokenFromCookie = getWebCookie(WEB_AUTH_COOKIE_KEY);
    const token = tokenFromSession || tokenFromLocal || tokenFromCookie;

    const userJsonFromSession = sessionStorage.getItem(WEB_AUTH_USER_KEY);
    const userJsonFromLocal = localStorage.getItem(WEB_AUTH_USER_KEY);
    const userJson = userJsonFromSession || userJsonFromLocal;

    if (!token || !userJson) {
      return null;
    }

    try {
      let user = JSON.parse(userJson);
      // Hydrate in-memory stores if we resumed from localStorage/cookie.
      if (!tokenFromSession) {
        sessionStorage.setItem(WEB_AUTH_TOKEN_KEY, token);
      }
      if (!userJsonFromSession) {
        sessionStorage.setItem(WEB_AUTH_USER_KEY, userJson);
      }
      if (!tokenFromLocal) {
        localStorage.setItem(WEB_AUTH_TOKEN_KEY, token);
      }
      if (!userJsonFromLocal) {
        localStorage.setItem(WEB_AUTH_USER_KEY, userJson);
      }
      if (!tokenFromCookie) {
        setWebCookie(WEB_AUTH_COOKIE_KEY, token, WEB_AUTH_COOKIE_MAX_AGE_SECONDS);
      }

      // Backfill missing animated avatar data for older persisted sessions.
      if (!hasAnimatedAvatarData(user)) {
        try {
          const validated = await validateSession(token);
          if (validated?.success && validated.user) {
            user = { ...user, ...validated.user };
            const mergedUserJson = JSON.stringify(user);
            sessionStorage.setItem(WEB_AUTH_USER_KEY, mergedUserJson);
            localStorage.setItem(WEB_AUTH_USER_KEY, mergedUserJson);
          }
        } catch {
          // Ignore enrichment errors and continue with current session data.
        }
      }

      if (isLegacyDevUser(user)) {
        sessionStorage.removeItem(WEB_AUTH_TOKEN_KEY);
        sessionStorage.removeItem(WEB_AUTH_USER_KEY);
        localStorage.removeItem(WEB_AUTH_TOKEN_KEY);
        localStorage.removeItem(WEB_AUTH_USER_KEY);
        clearWebCookie(WEB_AUTH_COOKIE_KEY);
        return null;
      }

      return { token, user };
    } catch {
      return null;
    }
  }
}

/**
 * Check if user is logged in (async)
 */
export async function isAuthenticated() {
  const session = await getSession();
  return session !== null;
}

/**
 * Get current user (async)
 */
export async function getCurrentUser() {
  const session = await getSession();
  return session?.user || null;
}

/**
 * Logout user
 */
export async function logout() {
  if (isDesktopApp()) {
    await window.electronAPI.clearSession();
  } else {
    sessionStorage.removeItem(WEB_AUTH_TOKEN_KEY);
    sessionStorage.removeItem(WEB_AUTH_USER_KEY);
    localStorage.removeItem(WEB_AUTH_TOKEN_KEY);
    localStorage.removeItem(WEB_AUTH_USER_KEY);
    clearWebCookie(WEB_AUTH_COOKIE_KEY);
  }
}

/**
 * Validate session token with backend and return user data
 * 
 * This is the secure way to get user data - the token is sent to the backend
 * and user data is returned, avoiding exposing user data in URLs.
 */
export async function validateSession(token) {
  try {
    const response = await fetchWithDesktopRetry("/api/v1/auth/session/validate", {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Auth-Token': token,
      },
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = unwrapApiData(await response.json());
    
    if (data.valid) {
      return { success: true, user: data.user };
    }
    
    return null;
  } catch (error) {
    console.error('[auth] Session validation failed:', error);
    return null;
  }
}

/**
 * Fetch CS2 inventory for current user
 */
export async function fetchCS2Inventory(steamId) {
  const response = await fetchWithDesktopRetry(`/api/v1/auth/steam/inventory?steamId=${steamId}`);
  return unwrapApiData(await response.json());
}

/**
 * Import CS2 inventory items as investments
 */
export async function importInventoryAsInvestments(items, userId, options = {}) {
  // Use local store if available (Desktop)
  if (isDesktopApp() && window.electronAPI.localStore) {
    const resolvedUserId = normalizeDesktopLocalUserId(userId, "1");
    let targetBucket = String(options?.bucket || "").trim().toLowerCase();
    if (!targetBucket && window.electronAPI.localStore.getPortfolioPreferences) {
      try {
        const preferences = unwrapLocalStoreResult(
          await window.electronAPI.localStore.getPortfolioPreferences(resolvedUserId),
          "local-store-get-portfolio-preferences",
        );
        targetBucket = String(preferences?.steamImportBucket || "").trim().toLowerCase();
      } catch (error) {
        console.warn("Failed to resolve steam import bucket preference", error);
      }
    }
    if (targetBucket !== "inventory" && targetBucket !== "investment") {
      targetBucket = "inventory";
    }

    const normalizedItems = (Array.isArray(items) ? items : []).map((item) => ({
      ...item,
      bucket: targetBucket,
    }));

    const result = unwrapLocalStoreResult(
      await window.electronAPI.localStore.syncSteamInventory(normalizedItems, resolvedUserId),
      "local-store-sync-steam-inventory",
    );

    return {
      success: true,
      imported: Number(result?.imported || 0),
      updated: Number(result?.updated || 0),
      missingMarked: Number(result?.missingMarked || 0),
      matchesSuggested: Number(result?.matchesSuggested || 0),
      totalIncoming: Number(result?.totalIncoming || 0),
      importedItems: Array.isArray(result?.importedItems) ? result.importedItems : [],
    };
  }
  
  // TODO: Implement server-side import for Web
  return { success: false, error: 'Import only available in Desktop app' };
}
