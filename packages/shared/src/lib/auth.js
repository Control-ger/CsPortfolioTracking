/**
 * Steam Authentication Service
 * 
 * Handles Steam OpenID login flow for Desktop (Electron) and Web.
 * Desktop uses custom protocol handler (cs-portfolio://), Web uses normal redirect.
 */

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
let desktopApiBasePromise = null;

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
    desktopApiBasePromise ||= window.electronAPI.backend.getBaseUrl();
    const desktopBase = await desktopApiBasePromise;
    if (desktopBase) {
      return normalizeApiBase(desktopBase);
    }
  }

  return API_BASE;
}

// Custom protocol for desktop app callback
const DESKTOP_PROTOCOL = 'cs-portfolio://auth/steam/callback';

/**
 * Check if running in Electron Desktop environment
 */
function isDesktopApp() {
  return typeof window !== 'undefined' && 
         window.electronAPI !== undefined;
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
    const apiBase = await resolveApiBase();
    // 1. Request login URL from backend
    const response = await fetch(`${apiBase}/api/v1/auth/steam/login?returnUrl=${encodeURIComponent(DESKTOP_PROTOCOL)}`, {
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
          const resultResponse = await fetch(
            `${apiBase}/api/v1/auth/steam/result?state=${encodeURIComponent(data.state)}`,
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
          } catch (error) {
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
  
  // Redirect to backend login endpoint
  const returnUrl = `${window.location.origin}/auth/callback`;
  window.location.href = `${API_BASE}/api/v1/auth/steam/login?returnUrl=${encodeURIComponent(returnUrl)}`;
}

/**
 * Handle Web callback after Steam login
 * Receives only the token from the backend redirect, then validates it
 */
export async function handleWebAuthCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  
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
    // Web: Store in sessionStorage (cleared on tab close)
    sessionStorage.setItem('auth_token', token);
    sessionStorage.setItem('auth_user', JSON.stringify(user));
    return true;
  }
}

/**
 * Get current session (async for Desktop IPC)
 */
export async function getSession() {
  if (isDesktopApp()) {
    try {
      return await window.electronAPI.getSession();
    } catch {
      return null;
    }
  } else {
    const token = sessionStorage.getItem('auth_token');
    const userJson = sessionStorage.getItem('auth_user');
    
    if (!token || !userJson) return null;
    
    try {
      const user = JSON.parse(userJson);
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
export function logout() {
  if (isDesktopApp()) {
    window.electronAPI.clearSession();
  } else {
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_user');
  }
}

/**
 * Dev mode login - creates local session without server
 * For testing desktop app before server is deployed
 */
export async function devModeLogin() {
  const devUser = {
    id: 'dev-user-001',
    steamId: '76561198000000000',
    name: 'Dev User',
    avatar: null,
    isDevMode: true,
  };
  
  const devSession = {
    token: 'dev-token-' + Date.now(),
    user: devUser,
    isDevMode: true,
  };
  
    await storeSession(devSession.token, devSession.user);
  
  return {
    success: true,
    user: devUser,
    isDevMode: true,
  };
}

/**
 * Validate session token with backend and return user data
 * 
 * This is the secure way to get user data - the token is sent to the backend
 * and user data is returned, avoiding exposing user data in URLs.
 */
export async function validateSession(token) {
  try {
    const apiBase = await resolveApiBase();
    const response = await fetch(`${apiBase}/api/v1/auth/session/validate?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
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
 * Check if running in dev mode (no server)
 */
export async function isDevMode() {
  const session = await getSession();
  return session?.user?.id?.startsWith('dev-user-') || false;
}

/**
 * Fetch CS2 inventory for current user
 */
export async function fetchCS2Inventory(steamId) {
  const apiBase = await resolveApiBase();
  const response = await fetch(`${apiBase}/api/v1/auth/steam/inventory?steamId=${steamId}`);
  return unwrapApiData(await response.json());
}

/**
 * Import CS2 inventory items as investments
 */
export async function importInventoryAsInvestments(items, userId) {
  // Use local store if available (Desktop)
  if (isDesktopApp() && window.electronAPI.localStore) {
    const investments = items.map(item => ({
      id: item.assetId || item.id || undefined,
      name: item.marketHashName || item.name,
      type: item.type || 'skin',
      marketHashName: item.marketHashName || item.name,
      imageUrl: item.iconUrl ? `https://community.cloudflare.steamstatic.com/economy/image/${item.iconUrl}` : null,
      quantity: 1,
      buyPrice: 0, // User needs to set price
      buyPriceUsd: 0,
      buyDate: new Date().toISOString(),
      notes: `Imported from CS2 inventory: ${item.marketHashName || item.name}`,
      userId: userId
    }));
    
    for (const investment of investments) {
      await window.electronAPI.localStore.upsertInvestment(investment);
    }
    
    return { success: true, imported: investments.length };
  }
  
  // TODO: Implement server-side import for Web
  return { success: false, error: 'Import only available in Desktop app' };
}
