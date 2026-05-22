import {
  errorToContext,
  sendFrontendTelemetryEvent,
} from "./frontendTelemetry";
import { getCurrentUser } from "./auth.js";
import { runDesktopSyncNowIfDue } from "./desktopSync.js";
import * as localCache from "./localCache.js";
import { unwrapLocalStoreResult } from "./localStoreResult.js";
import { getPortfolioPreferences } from "./portfolioPreferences.js";
import { resolveDesktopLocalUserId } from "./userIdentity.js";

const DEFAULT_API_BASE = `${window.location.origin}/api/index.php`;
const API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE);

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
    const desktopBase = await window.electronAPI.backend.getBaseUrl();
    if (desktopBase) {
      return normalizeApiBase(desktopBase);
    }
  }

  return API_BASE;
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
  let apiBase = await resolveApiBase();
  let response;

  try {
    response = await fetch(`${apiBase}${path}`, options);
  } catch (fetchError) {
    const isDesktop = typeof window !== "undefined" && Boolean(window.electronAPI?.backend?.getBaseUrl);
    const shouldRetry =
      isDesktop &&
      fetchError instanceof TypeError &&
      String(fetchError?.message || "").toLowerCase().includes("fetch");

    if (shouldRetry) {
      try {
        const refreshedBase = await window.electronAPI.backend.getBaseUrl();
        if (refreshedBase) {
          apiBase = normalizeApiBase(refreshedBase);
          response = await fetch(`${apiBase}${path}`, options);
        } else {
          throw fetchError;
        }
      } catch {
        // ignore and continue with normal fallback + error path
      }
    }

    if (response) {
      // Retry succeeded, continue regular response parsing path.
    } else {
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

  const upstreamHint = normalizedPayload?.meta?.upstreamHint;
  const proxyAttempts = Array.isArray(normalizedPayload?.meta?.proxyAttempts)
    ? normalizedPayload.meta.proxyAttempts
    : [];
  const proxyAttemptPreview = proxyAttempts.slice(0, 3).map((attempt) => {
    const status = Number(attempt?.httpCode || 0);
    const url = String(attempt?.url || "");
    return {
      status: Number.isFinite(status) && status > 0 ? status : null,
      url,
    };
  });
  if (upstreamHint?.code) {
    console.warn("[apiClient] upstream hint", {
      ...upstreamHint,
      request: {
        method,
        path,
      },
      proxyAttempts: proxyAttemptPreview,
    });
    void sendFrontendTelemetryEvent({
      level: "warning",
      event: "frontend.upstream_fallback_hint",
      message: "Upstream fallback hint reported by sidecar",
      context: {
        method,
        path,
        hintCode: String(upstreamHint.code || "UNKNOWN"),
        hintMessage: String(upstreamHint.message || ""),
        hintEndpointPath: String(upstreamHint.endpointPath || ""),
        hintAttemptCount: proxyAttempts.length,
      },
    });
  }

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

function stableHash(value) {
  const input = String(value || "");
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function mapCsFloatPreviewTradeToInvestment(trade) {
  const name = trade?.marketHashName || trade?.name || "Unknown Item";
  const buyPriceUsd = Number(trade?.buyPriceUsd ?? trade?.buyPrice ?? 0);
  const fallbackKey = `fallback-${stableHash(
    `${name}|${trade?.purchasedAt || ""}|${buyPriceUsd}|${Number(trade?.quantity || 1)}`,
  )}`;
  const stableTradeKey = String(
    trade?.externalTradeId ||
      trade?.id ||
      trade?.tradeId ||
      fallbackKey,
  );

  return {
    id: `csfloat-${stableTradeKey}`,
    name,
    marketHashName: name,
    type: trade?.type || "skin",
    quantity: Number(trade?.quantity || 1),
    buyPrice: buyPriceUsd,
    buyPriceUsd,
    fundingMode: trade?.fundingMode || "wallet_funded",
    imageUrl: trade?.imageUrl || null,
    platform: "csfloat",
    externalTradeId: trade?.externalTradeId || stableTradeKey,
    purchasedAt: trade?.purchasedAt || null,
    floatValue: trade?.floatValue ?? trade?.float ?? null,
    paintSeed: trade?.paintSeed ?? trade?.patternSeed ?? null,
    notes: `Imported from CSFloat trade ${trade?.externalTradeId || stableTradeKey}`.trim(),
  };
}

async function applyDesktopCsFloatPreviewDeduplication(previewResponse) {
  const localStore = getDesktopLocalStore();
  if (!localStore) {
    return previewResponse;
  }

  const previewData = previewResponse?.data;
  if (!previewData || typeof previewData !== "object") {
    return previewResponse;
  }

  const importTrades = Array.isArray(previewData.importTrades)
    ? previewData.importTrades
    : [];
  if (importTrades.length === 0) {
    return previewResponse;
  }

  try {
    const currentUser = await getCurrentUser();
    const userId = resolveDesktopLocalUserId(currentUser);
    const investments = unwrapLocalStoreResult(
      await localStore.listInvestments(userId),
      "local-store-list-investments",
    );
    const existingInvestmentIds = new Set(
      (Array.isArray(investments) ? investments : []).map((entry) =>
        String(entry?.id || "").trim(),
      ),
    );

    const enrichedImportTrades = importTrades.map((trade) => {
      const mapped = mapCsFloatPreviewTradeToInvestment(trade);
      const candidateIds = [String(mapped.id || "").trim()];
      const legacyExternalTradeId = String(trade?.legacyExternalTradeId || "").trim();
      if (legacyExternalTradeId) {
        candidateIds.push(`csfloat-${legacyExternalTradeId}`);
      }

      const isDuplicate = candidateIds.some(
        (candidateId) => candidateId !== "" && existingInvestmentIds.has(candidateId),
      );
      return {
        ...trade,
        status: isDuplicate ? "duplicate" : "new",
      };
    });

    const localDuplicates = enrichedImportTrades.filter(
      (trade) => String(trade?.status || "") === "duplicate",
    ).length;
    const localInsertable = Math.max(0, enrichedImportTrades.length - localDuplicates);

    return {
      ...previewResponse,
      data: {
        ...previewData,
        insertable: localInsertable,
        duplicates: localDuplicates,
        sampleTrades: enrichedImportTrades.slice(0, 20),
        importTrades: enrichedImportTrades,
      },
    };
  } catch (error) {
    console.warn("[csfloat-preview] local deduplication failed", error);
    return previewResponse;
  }
}

export async function fetchPortfolioInvestments(options = {}) {
  return requestWithMeta(buildPath("/api/v1/portfolio/investments", {
    scope: options.scope,
  }), {
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

export async function fetchItemPriceHistory(itemId, options = {}) {
  return request(buildPath(`/api/v1/items/${itemId}/price-history`, {
    fromDate: options.fromDate,
    itemName: options.itemName,
  }), {
    signal: options.signal,
  });
}

export async function fetchPortfolioSummary(options = {}) {
  return requestWithMeta(buildPath("/api/v1/portfolio/summary", {
    scope: options.scope,
  }), {
    signal: options.signal,
  });
}

export async function fetchPortfolioHistory(options = {}) {
  return request(buildPath("/api/v1/portfolio/history", {
    scope: options.scope,
  }), {
    signal: options.signal,
  });
}

export async function fetchPortfolioComposition(options = {}) {
  return request(buildPath("/api/v1/portfolio/composition", {
    scope: options.scope,
  }));
}

export async function fetchExchangeRate() {
  return request("/api/v1/exchange-rate");
}

export async function savePortfolioDailyValue(totalValue) {
  return request("/api/v1/portfolio/daily-value", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalValue }),
  });
}

export async function fetchCsFloatTradeSyncPreview(payload = {}) {
  const previewResponse = await requestWithMeta("/api/v1/portfolio/sync/csfloat/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: payload.type || "buy",
      limit: payload.limit || 1000,
      maxPages: payload.maxPages || 10,
    }),
  });
  return applyDesktopCsFloatPreviewDeduplication(previewResponse);
}

export async function executeCsFloatTradeSync(payload = {}) {
  const localStore = getDesktopLocalStore();
  if (localStore) {
    const preview = await fetchCsFloatTradeSyncPreview(payload);
    const preferences = await getPortfolioPreferences();
    const targetBucket = preferences.csfloatImportBucket === "inventory" ? "inventory" : "investment";
    const currentUser = await getCurrentUser();
    const userId = resolveDesktopLocalUserId(currentUser);
    const trades = Array.isArray(preview?.data?.importTrades)
      ? preview.data.importTrades
      : Array.isArray(preview?.data?.sampleTrades)
        ? preview.data.sampleTrades
      : [];
    const rows = trades.map((trade) => ({
      ...mapCsFloatPreviewTradeToInvestment(trade),
      bucket: targetBucket,
    }));
    let inserted = 0;
    let duplicates = 0;

    for (const row of rows) {
      const investmentId = String(row?.id || "");
      const existing = investmentId
        ? unwrapLocalStoreResult(
            await localStore.getInvestment(investmentId),
            "local-store-get-investment",
          )
        : null;

      unwrapLocalStoreResult(
        await localStore.upsertInvestment({
          ...(existing || {}),
          ...row,
          userId,
          excluded: Boolean(existing?.excluded),
        }),
        "local-store-upsert-investment",
      );

      if (existing) {
        duplicates += 1;
      } else {
        inserted += 1;
      }
    }

    try {
      await runDesktopSyncNowIfDue({ force: true });
    } catch (syncError) {
      console.warn("[desktop-sync] csfloat execute sync failed", syncError);
    }

    return {
      data: {
        ...(preview?.data || {}),
        mode: "execute",
        status: "success",
        inserted,
        duplicates,
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

export async function createWatchlistItemsBatch(items = []) {
  return request("/api/v1/watchlist/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
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

export async function fetchPriceSourcePreference() {
  return requestWithMeta("/api/v1/settings/price-source");
}

export async function updatePriceSourcePreference(mode) {
  return requestWithMeta("/api/v1/settings/price-source", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
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

    return {
      data: result?.status || result,
      meta: {
        source: "desktop-safe-storage",
      },
    };
  }

  throw new Error("CSFloat API Key updates are only supported in the Desktop app.");
}

export async function toggleExcludeInvestment(id, exclude, sourceInvestmentIds = []) {
  const localStore = getDesktopLocalStore();
  if (localStore) {
    const candidateIdsRaw = Array.isArray(sourceInvestmentIds) && sourceInvestmentIds.length > 0
      ? sourceInvestmentIds
      : [id];
    const candidateIds = Array.from(
      new Set(candidateIdsRaw.map((candidateId) => String(candidateId || "").trim()).filter(Boolean)),
    );
    let updatedCount = 0;

    for (const candidateId of candidateIds) {
      const existing = unwrapLocalStoreResult(
        await localStore.getInvestment(candidateId),
        "local-store-get-investment",
      );

      if (!existing) {
        continue;
      }

      unwrapLocalStoreResult(
        await localStore.upsertInvestment({
          ...existing,
          excluded: Boolean(exclude),
          isExcluded: Boolean(exclude),
        }),
        "local-store-upsert-investment",
      );
      updatedCount += 1;
    }

    if (updatedCount === 0) {
      throw new Error(
        `Exclude toggle skipped: no local investment found for id=${String(id)}`,
      );
    }

    let syncResult;
    try {
      syncResult = await runDesktopSyncNowIfDue({ force: true });
    } catch (syncError) {
      console.warn("[desktop-sync] exclude sync failed", syncError);
      throw new Error(
        `Exclude was updated locally, but sync to server failed: ${syncError?.message || String(syncError)}`,
      );
    }

    if (syncResult?.skipped) {
      throw new Error(
        `Exclude was updated locally, but sync was skipped (${String(syncResult.reason || "unknown")}).`,
      );
    }

    return {
      data: {
        success: true,
        investmentId: id,
        excluded: Boolean(exclude),
      },
      meta: {
        source: "desktop-local",
      },
    };
  }

  return requestWithMeta(`/api/v1/portfolio/investments/${id}/exclude`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exclude }),
  });
}

export async function updateInvestmentBucket(id, bucket, sourceInvestmentIds = []) {
  const normalizedBucket = String(bucket || "").trim().toLowerCase() === "inventory"
    ? "inventory"
    : "investment";
  const localStore = getDesktopLocalStore();
  if (localStore) {
    const requestedId = String(id || "").trim();
    const attemptedIds = new Set();
    const candidateIds = (Array.isArray(sourceInvestmentIds) && sourceInvestmentIds.length > 0
      ? sourceInvestmentIds
      : [id]).map((candidateId) => String(candidateId || "").trim()).filter(Boolean);
    let updatedCount = 0;

    for (const candidateId of candidateIds) {
      if (attemptedIds.has(candidateId)) {
        continue;
      }
      attemptedIds.add(candidateId);
      const existing = unwrapLocalStoreResult(
        await localStore.getInvestment(candidateId),
        "local-store-get-investment",
      );

      if (!existing) {
        continue;
      }

      unwrapLocalStoreResult(
        await localStore.upsertInvestment({
          ...existing,
          bucket: normalizedBucket,
        }),
        "local-store-upsert-investment",
      );
      updatedCount += 1;
    }

    if (updatedCount === 0) {
      try {
        const currentUser = await getCurrentUser();
        const userId = resolveDesktopLocalUserId(currentUser);
        const localRows = unwrapLocalStoreResult(
          await localStore.listInvestments(userId),
          "local-store-list-investments",
        );
        const investments = Array.isArray(localRows) ? localRows : [];
        const fallbackIds = [];

        if (requestedId.startsWith("cluster-")) {
          const clusterKey = requestedId.slice("cluster-".length).trim().toLowerCase();
          if (clusterKey) {
            investments.forEach((row) => {
              const rowKey = String(row?.marketHashName || row?.name || row?.itemName || row?.id || "")
                .trim()
                .toLowerCase();
              if (rowKey === clusterKey) {
                fallbackIds.push(String(row?.id || "").trim());
              }
            });
          }
        }

        for (const fallbackId of fallbackIds) {
          if (!fallbackId || attemptedIds.has(fallbackId)) {
            continue;
          }
          attemptedIds.add(fallbackId);
          const existing = unwrapLocalStoreResult(
            await localStore.getInvestment(fallbackId),
            "local-store-get-investment",
          );
          if (!existing) {
            continue;
          }
          unwrapLocalStoreResult(
            await localStore.upsertInvestment({
              ...existing,
              bucket: normalizedBucket,
            }),
            "local-store-upsert-investment",
          );
          updatedCount += 1;
        }
      } catch (fallbackError) {
        console.warn("[desktop-sync] bucket fallback resolution failed", fallbackError);
      }
    }

    if (updatedCount === 0) {
      throw new Error(
        `Bucket update skipped: no local investment found for id=${String(id)}`,
      );
    }

    try {
      await runDesktopSyncNowIfDue({ force: true });
    } catch (syncError) {
      console.warn("[desktop-sync] bucket update sync failed", syncError);
    }

    return {
      data: {
        success: true,
        investmentId: id,
        bucket: normalizedBucket,
      },
      meta: {
        source: "desktop-local",
      },
    };
  }

  return requestWithMeta(`/api/v1/portfolio/investments/${id}/bucket`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket: normalizedBucket }),
  });
}

export async function updateInvestmentOverpay(
  id,
  payload = {},
  sourceInvestmentIds = [],
) {
  const normalizedOverpayEnabled = Boolean(
    payload?.overpayEnabled ?? payload?.isOverpayCandidate ?? false,
  );
  const parsedFloor = Number(payload?.overpayFloorEur);
  const normalizedFloor =
    Number.isFinite(parsedFloor) && parsedFloor > 0
      ? Number(parsedFloor.toFixed(2))
      : null;
  const normalizedNote = String(payload?.overpayNote || "").trim();
  const localStore = getDesktopLocalStore();

  if (localStore) {
    const candidateIdsRaw = Array.isArray(sourceInvestmentIds) && sourceInvestmentIds.length > 0
      ? sourceInvestmentIds
      : [id];
    const candidateIds = Array.from(
      new Set(candidateIdsRaw.map((candidateId) => String(candidateId || "").trim()).filter(Boolean)),
    );
    let updatedCount = 0;

    for (const candidateId of candidateIds) {
      const existing = unwrapLocalStoreResult(
        await localStore.getInvestment(candidateId),
        "local-store-get-investment",
      );

      if (!existing) {
        continue;
      }

      unwrapLocalStoreResult(
        await localStore.upsertInvestment({
          ...existing,
          overpayEnabled: normalizedOverpayEnabled,
          isOverpayCandidate: normalizedOverpayEnabled,
          overpayFloorEur: normalizedFloor,
          overpayNote: normalizedNote || null,
        }),
        "local-store-upsert-investment",
      );
      updatedCount += 1;
    }

    if (updatedCount === 0) {
      throw new Error(
        `Overpay update skipped: no local investment found for id=${String(id)}`,
      );
    }

    let syncResult;
    try {
      syncResult = await runDesktopSyncNowIfDue({ force: true });
    } catch (syncError) {
      console.warn("[desktop-sync] overpay sync failed", syncError);
      throw new Error(
        `Overpay profile updated locally, but sync to server failed: ${syncError?.message || String(syncError)}`,
      );
    }

    if (syncResult?.skipped) {
      throw new Error(
        `Overpay profile updated locally, but sync was skipped (${String(syncResult.reason || "unknown")}).`,
      );
    }

    return {
      data: {
        success: true,
        investmentId: id,
        overpayEnabled: normalizedOverpayEnabled,
        overpayFloorEur: normalizedFloor,
        overpayNote: normalizedNote || null,
      },
      meta: {
        source: "desktop-local",
      },
    };
  }

  return requestWithMeta(`/api/v1/portfolio/investments/${id}/overpay`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      overpayEnabled: normalizedOverpayEnabled,
      overpayFloorEur: normalizedFloor,
      overpayNote: normalizedNote || null,
    }),
  });
}

export async function fetchCacheMaintenanceStats() {
  return requestWithMeta("/api/v1/debug/cache/stats");
}

export async function fetchCsUpdatesFeed(options = {}) {
  const limit = Number.isFinite(options.limit) ? Number(options.limit) : undefined;
  const before = typeof options.before === "string" ? options.before : undefined;

  return requestWithMeta(
    buildPath("/api/v1/cs-updates", {
      limit,
      before,
    }),
    {
      signal: options.signal,
    },
  );
}

export async function fetchWebPushPublicKey() {
  return requestWithMeta("/api/v1/push/public-key");
}

export async function subscribeWebPush(subscription, userId = 1) {
  return requestWithMeta("/api/v1/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      subscription,
    }),
  });
}

export async function unsubscribeWebPush(endpoint, userId = 1) {
  return requestWithMeta("/api/v1/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      endpoint,
    }),
  });
}
