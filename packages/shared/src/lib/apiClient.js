import {
  errorToContext,
  sendFrontendTelemetryEvent,
} from "./frontendTelemetry";
import { getCurrentUser } from "./auth.js";
import * as localCache from "./localCache.js";

const DEFAULT_API_BASE = `${window.location.origin}/api/index.php`;
const API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE);
let desktopApiBasePromise = null;

function normalizeApiBase(value) {
  return String(value || "")
    .replace(/\/+$/, "")
    .replace(/\/api\/v1$/i, "");
}

async function resolveApiBase() {
  if (
    typeof window !== "undefined" &&
    window.electronAPI?.backend?.getBaseUrl
  ) {
    desktopApiBasePromise ||= window.electronAPI.backend.getBaseUrl();
    const desktopBase = await desktopApiBasePromise;
    if (desktopBase) {
      return normalizeApiBase(desktopBase);
    }
  }

  return API_BASE;
}

function resetDesktopApiBase() {
  desktopApiBasePromise = null;
}

function getDesktopSecrets() {
  if (
    typeof window === "undefined" ||
    !window.electronAPI ||
    !window.electronAPI.secrets
  ) {
    return null;
  }

  return window.electronAPI.secrets;
}

// Deterministic cache keys for Phase 1 offline fallback. Only GET endpoints
// consumed by portfolio/watchlist UI are cached; mutations are never cached.
const GET_CACHE_KEYS = [
  {
    pattern: /^\/api\/v1\/portfolio\/investments(?:\?|$)/,
    key: "cache:portfolio:investments",
  },
  {
    pattern: /^\/api\/v1\/portfolio\/summary(?:\?|$)/,
    key: "cache:portfolio:summary",
  },
  {
    pattern: /^\/api\/v1\/portfolio\/history(?:\?|$)/,
    key: "cache:portfolio:history",
  },
  {
    pattern: /^\/api\/v1\/portfolio\/composition(?:\?|$)/,
    key: "cache:portfolio:composition",
  },
  { pattern: /^\/api\/v1\/watchlist(?:\?|$)/, key: "cache:watchlist:all" },
];

function getCacheKey(path, method) {
  if (method !== "GET") {
    return null;
  }

  return GET_CACHE_KEYS.find((entry) => entry.pattern.test(path))?.key || null;
}

function isRecoverableHttpStatus(status) {
  return [408, 502, 503, 504].includes(status);
}

async function readCachedPayload(cacheKey) {
  if (!cacheKey) {
    return null;
  }

  const cachedPayload = await localCache.get(cacheKey);
  if (!cachedPayload) {
    return null;
  }

  console.warn(`[apiClient] using cached response for ${cacheKey}`);
  return {
    ...cachedPayload,
    meta: {
      ...(cachedPayload.meta || {}),
      offline: true,
      cached: true,
    },
  };
}

function buildPath(path, query = {}) {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    params.set(key, String(value));
  });

  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function buildApiError(path, response, payload, apiBase = API_BASE) {
  const message =
    payload?.error?.message ||
    `API-Fehler (${response.status}) fuer ${apiBase}${path}`;
  const error = new Error(message);
  error.status = response.status;
  error.code = payload?.error?.code || "API_REQUEST_FAILED";
  error.details = payload?.error?.details || {};
  return error;
}

async function requestPayload(path, options = {}) {
  const method = String(options?.method || "GET").toUpperCase();
  const cacheKey = getCacheKey(path, method);
  const apiBase = await resolveApiBase();
  let response;

  try {
    response = await fetch(`${apiBase}${path}`, options);
  } catch (fetchError) {
    // Don't report abort errors as they're intentional
    if (fetchError.name === "AbortError") {
      throw fetchError;
    }
    void sendFrontendTelemetryEvent({
      level: "error",
      event: "frontend.fetch_error",
      message: "Fetch request failed",
      context: {
        method,
        path,
        apiBase,
        ...errorToContext(fetchError),
      },
    });

    const cachedPayload = await readCachedPayload(cacheKey);
    if (cachedPayload) {
      return cachedPayload;
    }

    throw fetchError;
  }

  const contentType = response.headers.get("content-type") || "";
  let payload = null;

  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch (jsonError) {
      void sendFrontendTelemetryEvent({
        level: "error",
        event: "frontend.fetch_error",
        message: "API response JSON parsing failed",
        context: {
          method,
          path,
          statusCode: response.status,
          ...errorToContext(jsonError),
        },
      });
      throw jsonError;
    }
  }

  if (!response.ok) {
    const apiError = buildApiError(path, response, payload, apiBase);
    void sendFrontendTelemetryEvent({
      level: "error",
      event: "frontend.fetch_error",
      message: "API request returned an error response",
      context: {
        method,
        path,
        statusCode: response.status,
        errorCode: apiError.code || "API_REQUEST_FAILED",
        requestId: response.headers.get("x-request-id") || undefined,
      },
    });
    if (isRecoverableHttpStatus(response.status)) {
      const cachedPayload = await readCachedPayload(cacheKey);
      if (cachedPayload) {
        return cachedPayload;
      }
    }
    throw apiError;
  }

  const normalizedPayload = payload || { data: null, meta: {} };

  if (cacheKey) {
    void localCache.set(cacheKey, normalizedPayload);
  }

  return normalizedPayload;
}

async function request(path, options = {}) {
  const payload = await requestPayload(path, options);
  return payload?.data;
}

async function requestWithMeta(path, options = {}) {
  const payload = await requestPayload(path, options);
  return {
    data: payload?.data,
    meta: payload?.meta || {},
  };
}

function getDesktopLocalStore() {
  if (
    typeof window === "undefined" ||
    !window.electronAPI ||
    !window.electronAPI.localStore
  ) {
    return null;
  }

  return window.electronAPI.localStore;
}

function mapCsFloatPreviewTradeToInvestment(trade) {
  const name = trade?.marketHashName || trade?.name || "Unknown Item";
  const buyPriceUsd = Number(trade?.buyPriceUsd ?? trade?.buyPrice ?? 0);

  return {
    id: trade?.externalTradeId ? `csfloat-${trade.externalTradeId}` : undefined,
    name,
    marketHashName: name,
    type: trade?.type || "skin",
    quantity: Number(trade?.quantity || 1),
    buyPrice: buyPriceUsd,
    buyPriceUsd,
    fundingMode: trade?.fundingMode || "wallet_funded",
    imageUrl: trade?.imageUrl || null,
    platform: "csfloat",
    externalTradeId: trade?.externalTradeId || null,
    purchasedAt: trade?.purchasedAt || null,
    notes: `Imported from CSFloat trade ${trade?.externalTradeId || ""}`.trim(),
  };
}

export async function fetchPortfolioInvestments(options = {}) {
  return requestWithMeta("/api/v1/portfolio/investments", {
    signal: options.signal,
  });
}

export async function fetchPortfolioInvestmentHistory(id, options = {}) {
  return request(
    buildPath(`/api/v1/portfolio/investments/${id}/history`, {
      itemName: options.itemName,
    }),
  );
}

export async function fetchPortfolioSummary(options = {}) {
  return requestWithMeta("/api/v1/portfolio/summary", {
    signal: options.signal,
  });
}

export async function fetchPortfolioHistory(options = {}) {
  return request("/api/v1/portfolio/history", {
    signal: options.signal,
  });
}

export async function fetchPortfolioComposition() {
  return request("/api/v1/portfolio/composition");
}

export async function savePortfolioDailyValue(totalValue) {
  return request("/api/v1/portfolio/daily-value", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalValue }),
  });
}

export async function fetchCsFloatTradeSyncPreview(payload = {}) {
  return requestWithMeta("/api/v1/portfolio/sync/csfloat/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: payload.type || "buy",
      limit: payload.limit || 1000,
      maxPages: payload.maxPages || 10,
    }),
  });
}

export async function executeCsFloatTradeSync(payload = {}) {
  const localStore = getDesktopLocalStore();
  if (localStore) {
    const preview = await fetchCsFloatTradeSyncPreview(payload);
    const currentUser = await getCurrentUser();
    const userId = currentUser?.id || currentUser?.steamId || "local";
    const trades = Array.isArray(preview?.data?.importTrades)
      ? preview.data.importTrades
      : Array.isArray(preview?.data?.sampleTrades)
        ? preview.data.sampleTrades
      : [];
    const rows = trades.map(mapCsFloatPreviewTradeToInvestment);
    const result = await localStore.importInvestments(rows, userId);

    return {
      data: {
        ...(preview?.data || {}),
        mode: "execute",
        status: "success",
        inserted: result?.imported || rows.length,
        duplicates: 0,
        skippedDuringInsert: 0,
        errors: [],
        desktopLocal: true,
      },
      meta: {
        source: "desktop-local",
      },
    };
  }

  return requestWithMeta("/api/v1/portfolio/sync/csfloat/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: payload.type || "buy",
      limit: payload.limit || 1000,
      maxPages: payload.maxPages || 10,
      backupConfirmed: Boolean(payload.backupConfirmed),
    }),
  });
}

export async function fetchWatchlist(options = {}) {
  return requestWithMeta(
    buildPath("/api/v1/watchlist", {
      syncLive: options.syncLive ? 1 : undefined,
    }),
  );
}

export async function createWatchlistItem(name, type = "skin") {
  return request("/api/v1/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, type }),
  });
}

export async function deleteWatchlistItem(id) {
  return request(`/api/v1/watchlist/${id}`, { method: "DELETE" });
}

export async function searchWatchlistItems(
  query,
  filters = {},
  limit = 6,
  page = 1,
) {
  return requestWithMeta(
    buildPath("/api/v1/watchlist/search", {
      query,
      itemType: filters.itemType,
      wear: filters.wear,
      sortBy: filters.sortBy,
      limit,
      page,
    }),
  );
}

export async function fetchDebugLogs(options = {}) {
  return request(
    buildPath("/api/v1/debug/logs", {
      type: options.type || "app",
      limit: options.limit || 100,
      event: options.event,
      level: options.level,
      requestId: options.requestId,
    }),
  );
}

export async function fetchFeeSettings() {
  return requestWithMeta("/api/v1/settings/fees");
}

export async function updateFeeSettings(payload) {
  return requestWithMeta("/api/v1/settings/fees", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchCsFloatApiKeyStatus() {
  const desktopSecrets = getDesktopSecrets();
  if (desktopSecrets?.getCsFloatApiKeyStatus) {
    return {
      data: await desktopSecrets.getCsFloatApiKeyStatus(),
      meta: {
        source: "desktop-local",
      },
    };
  }

  return requestWithMeta("/api/v1/settings/csfloat-api-key");
}

export async function updateCsFloatApiKey(apiKeyOrEncryptedKey) {
  const desktopSecrets = getDesktopSecrets();
  if (desktopSecrets?.setCsFloatApiKey) {
    const result = await desktopSecrets.setCsFloatApiKey(apiKeyOrEncryptedKey);
    resetDesktopApiBase();

    return {
      data: result?.status || result,
      meta: {
        source: "desktop-safe-storage",
      },
    };
  }

  return requestWithMeta("/api/v1/settings/csfloat-api-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encryptedKey: apiKeyOrEncryptedKey }),
  });
}

export async function toggleExcludeInvestment(id, exclude) {
  return requestWithMeta(`/api/v1/portfolio/investments/${id}/exclude`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exclude }),
  });
}

export async function fetchCacheMaintenanceStats() {
  return requestWithMeta("/api/v1/debug/cache/stats");
}
