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
  const requestHeaders = new Headers(options?.headers || {});
  const isDesktopSidecarBase = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/i.test(apiBase);
  if (
    isDesktopSidecarBase &&
    typeof window !== "undefined" &&
    window.electronAPI?.backend?.getAuthHeaders
  ) {
    try {
      const authHeaders = await window.electronAPI.backend.getAuthHeaders();
      if (authHeaders && typeof authHeaders === "object") {
        Object.entries(authHeaders).forEach(([key, value]) => {
          if (value !== undefined && value !== null && String(value).trim() !== "") {
            requestHeaders.set(String(key), String(value));
          }
        });
      }
    } catch (headerError) {
      console.warn("[apiClient] failed to resolve desktop sidecar auth headers", headerError);
    }
  }
  const requestOptions = {
    ...options,
    headers: requestHeaders,
  };
  let response;

  try {
    response = await fetch(`${apiBase}${path}`, requestOptions);
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
          response = await fetch(`${apiBase}${path}`, requestOptions);
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

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isSameIsoDate(left, right) {
  const leftValue = String(left || "").trim();
  const rightValue = String(right || "").trim();
  if (!leftValue && !rightValue) {
    return true;
  }
  if (!leftValue || !rightValue) {
    return false;
  }
  const leftTimestamp = Date.parse(leftValue);
  const rightTimestamp = Date.parse(rightValue);
  if (!Number.isFinite(leftTimestamp) || !Number.isFinite(rightTimestamp)) {
    return leftValue === rightValue;
  }
  return leftTimestamp === rightTimestamp;
}

function determineDesktopPreviewTradeStatus(trade, mappedTrade, existingInvestment) {
  if (!existingInvestment) {
    return {
      status: "new",
      quantityDelta: Number(mappedTrade?.quantity || 0),
    };
  }

  const existingExcluded = Boolean(
    existingInvestment?.excluded ?? existingInvestment?.isExcluded ?? false,
  );
  if (existingExcluded) {
    return {
      status: "excluded",
      quantityDelta: 0,
    };
  }

  const incomingQuantity = Math.max(0, Number(mappedTrade?.quantity || 0));
  const existingQuantity = Math.max(0, Number(existingInvestment?.quantity || 0));
  const quantityDelta = incomingQuantity - existingQuantity;
  const incomingPrice = toFiniteNumber(mappedTrade?.buyPriceUsd ?? mappedTrade?.buyPrice);
  const existingPrice = toFiniteNumber(existingInvestment?.buyPriceUsd ?? existingInvestment?.buyPrice);
  const incomingFundingMode = String(mappedTrade?.fundingMode || "").trim();
  const existingFundingMode = String(existingInvestment?.fundingMode || "").trim();
  const incomingPurchasedAt = mappedTrade?.purchasedAt || null;
  const existingPurchasedAt = existingInvestment?.purchasedAt || null;

  const quantityChanged = incomingQuantity !== existingQuantity;
  const priceChanged = incomingPrice !== null && existingPrice !== null
    ? Math.abs(incomingPrice - existingPrice) > 0.00001
    : incomingPrice !== existingPrice;
  const fundingModeChanged = incomingFundingMode !== existingFundingMode;
  const purchasedAtChanged = !isSameIsoDate(incomingPurchasedAt, existingPurchasedAt);
  const hasClusterDelta = Boolean(trade?.isClustered) && (quantityChanged || priceChanged || purchasedAtChanged);

  if (hasClusterDelta || quantityChanged || priceChanged || fundingModeChanged || purchasedAtChanged) {
    return {
      status: "updated",
      quantityDelta,
    };
  }

  return {
    status: "duplicate",
    quantityDelta: 0,
  };
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

function mapSkinBaronPreviewSaleToInvestment(sale) {
  const name = sale?.marketHashName || sale?.name || "Unknown Item";
  const buyPriceUsd = Number(sale?.buyPriceUsd ?? sale?.buyPrice ?? sale?.price ?? 0);
  const fallbackKey = `fallback-${stableHash(
    `${name}|${sale?.purchasedAt || ""}|${buyPriceUsd}|${Number(sale?.quantity || 1)}`,
  )}`;
  const stableSaleKey = String(
    sale?.externalTradeId ||
      sale?.skinBaronSaleId ||
      sale?.id ||
      fallbackKey,
  );

  return {
    id: `skinbaron-${stableSaleKey}`,
    name,
    marketHashName: name,
    type: sale?.type || "skin",
    quantity: Number(sale?.quantity || 1),
    buyPrice: buyPriceUsd,
    buyPriceUsd,
    fundingMode: sale?.fundingMode || "wallet_funded",
    imageUrl: sale?.imageUrl || null,
    platform: "skinbaron",
    source: "skinbaron",
    externalTradeId: stableSaleKey,
    purchasedAt: sale?.purchasedAt || null,
    notes: `Imported from SkinBaron sale ${stableSaleKey}`.trim(),
  };
}

function normalizeImportIdentifier(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  return normalized.toLowerCase();
}

function resolveInvestmentPlatform(entry) {
  return String(entry?.platform || entry?.source || "").trim().toLowerCase();
}

function buildExistingInvestmentLookup(rows = [], platformFilter = null) {
  const byId = new Map();
  const byExternalTradeId = new Map();

  (Array.isArray(rows) ? rows : []).forEach((entry) => {
    const investmentId = String(entry?.id || "").trim();
    if (investmentId) {
      byId.set(investmentId, entry);
    }

    if (!platformFilter) {
      return;
    }

    if (resolveInvestmentPlatform(entry) !== platformFilter) {
      return;
    }

    const externalTradeId = normalizeImportIdentifier(entry?.externalTradeId);
    if (externalTradeId && !byExternalTradeId.has(externalTradeId)) {
      byExternalTradeId.set(externalTradeId, entry);
    }
  });

  return { byId, byExternalTradeId };
}

function resolveExistingCsFloatInvestmentMatch(lookup, mappedTrade, previewTrade) {
  const candidateIds = [String(mappedTrade?.id || "").trim()];
  const legacyExternalTradeId = String(previewTrade?.legacyExternalTradeId || "").trim();
  if (legacyExternalTradeId) {
    candidateIds.push(`csfloat-${legacyExternalTradeId}`);
  }

  for (const candidateId of candidateIds) {
    if (!candidateId) {
      continue;
    }
    const existingById = lookup?.byId?.get(candidateId);
    if (existingById) {
      return existingById;
    }
  }

  const candidateExternalTradeIds = [
    mappedTrade?.externalTradeId,
    previewTrade?.externalTradeId,
    previewTrade?.legacyExternalTradeId,
  ];
  for (const candidateExternalTradeId of candidateExternalTradeIds) {
    const normalizedExternalTradeId = normalizeImportIdentifier(candidateExternalTradeId);
    if (!normalizedExternalTradeId) {
      continue;
    }
    const existingByTradeId = lookup?.byExternalTradeId?.get(normalizedExternalTradeId);
    if (existingByTradeId) {
      return existingByTradeId;
    }
  }

  return null;
}

function resolveExistingSkinBaronInvestmentMatch(lookup, mappedTrade, previewTrade) {
  const candidateIds = [String(mappedTrade?.id || "").trim()];
  const legacyExternalTradeId = String(previewTrade?.legacyExternalTradeId || "").trim();
  if (legacyExternalTradeId) {
    candidateIds.push(`skinbaron-${legacyExternalTradeId}`);
  }

  for (const candidateId of candidateIds) {
    if (!candidateId) {
      continue;
    }
    const existingById = lookup?.byId?.get(candidateId);
    if (existingById) {
      return existingById;
    }
  }

  const candidateExternalTradeIds = [
    mappedTrade?.externalTradeId,
    previewTrade?.externalTradeId,
    previewTrade?.legacyExternalTradeId,
  ];
  for (const candidateExternalTradeId of candidateExternalTradeIds) {
    const normalizedExternalTradeId = normalizeImportIdentifier(candidateExternalTradeId);
    if (!normalizedExternalTradeId) {
      continue;
    }
    const existingByTradeId = lookup?.byExternalTradeId?.get(normalizedExternalTradeId);
    if (existingByTradeId) {
      return existingByTradeId;
    }
  }

  return null;
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
    const existingLookup = buildExistingInvestmentLookup(investments, "csfloat");

    const enrichedImportTrades = importTrades.map((trade) => {
      const mapped = mapCsFloatPreviewTradeToInvestment(trade);
      const existingMatch = resolveExistingCsFloatInvestmentMatch(existingLookup, mapped, trade);
      const { status, quantityDelta } = determineDesktopPreviewTradeStatus(trade, mapped, existingMatch || null);

      return {
        ...trade,
        status,
        quantityDelta,
      };
    });

    const localDuplicates = enrichedImportTrades.filter(
      (trade) => String(trade?.status || "") === "duplicate",
    ).length;
    const localInsertable = enrichedImportTrades.filter((trade) =>
      String(trade?.status || "") !== "duplicate",
    ).length;
    const localUpdated = enrichedImportTrades.filter(
      (trade) => String(trade?.status || "") === "updated",
    ).length;

    return {
      ...previewResponse,
      data: {
        ...previewData,
        insertable: localInsertable,
        duplicates: localDuplicates,
        updated: localUpdated,
        sampleTrades: enrichedImportTrades.slice(0, 20),
        importTrades: enrichedImportTrades,
      },
    };
  } catch (error) {
    console.warn("[csfloat-preview] local deduplication failed", error);
    return previewResponse;
  }
}

async function applyDesktopSkinBaronPreviewDeduplication(previewResponse) {
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
    const existingLookup = buildExistingInvestmentLookup(investments, "skinbaron");

    const enrichedImportTrades = importTrades.map((trade) => {
      const mapped = mapSkinBaronPreviewSaleToInvestment(trade);
      const existingMatch = resolveExistingSkinBaronInvestmentMatch(existingLookup, mapped, trade);
      const { status, quantityDelta } = determineDesktopPreviewTradeStatus(trade, mapped, existingMatch || null);

      return {
        ...trade,
        status,
        quantityDelta,
      };
    });

    const localDuplicates = enrichedImportTrades.filter(
      (trade) => String(trade?.status || "") === "duplicate",
    ).length;
    const localInsertable = enrichedImportTrades.filter((trade) =>
      String(trade?.status || "") !== "duplicate",
    ).length;
    const localUpdated = enrichedImportTrades.filter(
      (trade) => String(trade?.status || "") === "updated",
    ).length;

    return {
      ...previewResponse,
      data: {
        ...previewData,
        insertable: localInsertable,
        duplicates: localDuplicates,
        updated: localUpdated,
        sampleTrades: enrichedImportTrades.slice(0, 20),
        importTrades: enrichedImportTrades,
      },
    };
  } catch (error) {
    console.warn("[skinbaron-preview] local deduplication failed", error);
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

export async function refreshPortfolioStalePrices(options = {}) {
  const scope = String(options.scope || "investments").toLowerCase() === "all"
    ? "all"
    : "investments";
  const rawLimit = Number(options.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(Math.trunc(rawLimit), 2000))
    : 200;

  return requestWithMeta("/api/v1/portfolio/prices/refresh-stale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, limit }),
    signal: options.signal,
  });
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
    const investments = unwrapLocalStoreResult(
      await localStore.listInvestments(userId),
      "local-store-list-investments",
    );
    const existingLookup = buildExistingInvestmentLookup(investments, "csfloat");
    let inserted = 0;
    let duplicates = 0;

    for (const trade of trades) {
      if (String(trade?.status || "").toLowerCase() === "excluded") {
        continue;
      }

      const row = {
        ...mapCsFloatPreviewTradeToInvestment(trade),
        bucket: targetBucket,
      };
      const existing = resolveExistingCsFloatInvestmentMatch(existingLookup, row, trade);

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

      const rowId = String(row?.id || "").trim();
      if (rowId) {
        existingLookup.byId.set(rowId, row);
      }
      const externalTradeId = normalizeImportIdentifier(row?.externalTradeId);
      if (externalTradeId) {
        existingLookup.byExternalTradeId.set(externalTradeId, row);
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

async function triggerDesktopSteamMatchingRefresh(localStore, userId) {
  try {
    const rows = unwrapLocalStoreResult(
      await localStore.listInvestments(userId),
      "local-store-list-investments",
    );
    const activeSteamRows = (Array.isArray(rows) ? rows : []).filter((row) => {
      const platform = String(row?.platform || row?.source || "").toLowerCase();
      if (platform !== "steam_inventory") {
        return false;
      }
      if (row?.inSteamInventory === false) {
        return false;
      }
      return String(row?.inventoryStatus || "").toLowerCase() !== "missing";
    });

    if (activeSteamRows.length === 0) {
      return;
    }

    const snapshotItems = activeSteamRows.map((row) => ({
      id: row?.steamAssetId || row?.id,
      assetId: row?.steamAssetId || row?.id,
      marketHashName: row?.marketHashName || row?.name || "Unknown Item",
      name: row?.name || row?.marketHashName || "Unknown Item",
      type: row?.type || "skin",
      imageUrl: row?.imageUrl || null,
      classId: row?.classId || null,
      instanceId: row?.instanceId || null,
      inspectLink: row?.inspectLink || null,
      floatValue: row?.floatValue ?? row?.float ?? row?.wearFloat ?? null,
      paintSeed: row?.paintSeed ?? row?.patternSeed ?? null,
      tradable: row?.tradable !== false,
      marketable: row?.marketable !== false,
    }));

    unwrapLocalStoreResult(
      await localStore.syncSteamInventory(snapshotItems, userId),
      "local-store-sync-steam-inventory",
    );
  } catch (error) {
    console.warn("[desktop-sync] external matching refresh failed", error);
  }
}

export async function fetchSkinBaronTradeSyncPreview(payload = {}) {
  const previewResponse = await requestWithMeta("/api/v1/portfolio/sync/skinbaron/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      limit: payload.limit || 100,
      maxPages: payload.maxPages || 10,
    }),
  });
  return applyDesktopSkinBaronPreviewDeduplication(previewResponse);
}

export async function executeSkinBaronTradeSync(payload = {}) {
  const localStore = getDesktopLocalStore();
  if (localStore) {
    const preview = await fetchSkinBaronTradeSyncPreview(payload);
    const preferences = await getPortfolioPreferences();
    const targetBucket = preferences.csfloatImportBucket === "inventory" ? "inventory" : "investment";
    const currentUser = await getCurrentUser();
    const userId = resolveDesktopLocalUserId(currentUser);
    const trades = Array.isArray(preview?.data?.importTrades)
      ? preview.data.importTrades
      : Array.isArray(preview?.data?.sampleTrades)
        ? preview.data.sampleTrades
        : [];
    const investments = unwrapLocalStoreResult(
      await localStore.listInvestments(userId),
      "local-store-list-investments",
    );
    const existingLookup = buildExistingInvestmentLookup(investments, "skinbaron");
    let inserted = 0;
    let duplicates = 0;

    for (const trade of trades) {
      if (String(trade?.status || "").toLowerCase() === "excluded") {
        continue;
      }

      const row = {
        ...mapSkinBaronPreviewSaleToInvestment(trade),
        bucket: targetBucket,
      };
      const existing = resolveExistingSkinBaronInvestmentMatch(existingLookup, row, trade);

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

      const rowId = String(row?.id || "").trim();
      if (rowId) {
        existingLookup.byId.set(rowId, row);
      }
      const externalTradeId = normalizeImportIdentifier(row?.externalTradeId);
      if (externalTradeId) {
        existingLookup.byExternalTradeId.set(externalTradeId, row);
      }
    }

    await triggerDesktopSteamMatchingRefresh(localStore, userId);

    try {
      await runDesktopSyncNowIfDue({ force: true });
    } catch (syncError) {
      console.warn("[desktop-sync] skinbaron execute sync failed", syncError);
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

  return requestWithMeta("/api/v1/portfolio/sync/skinbaron/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      limit: payload.limit || 100,
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

export async function fetchCsFloatBuyOrders(options = {}) {
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Math.min(Math.trunc(Number(options.limit)), 500))
    : 200;
  const maxPages = Number.isFinite(Number(options.maxPages))
    ? Math.max(1, Math.min(Math.trunc(Number(options.maxPages)), 20))
    : 8;

  return requestWithMeta(
    buildPath("/api/v1/csfloat/buy-orders", {
      limit,
      maxPages,
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

export async function fetchWatchlistSearchStats(options = {}) {
  return request(
    buildPath("/api/v1/debug/watchlist-search-stats", {
      hours: Number.isFinite(options.hours) ? options.hours : 24,
      limit: Number.isFinite(options.limit) ? options.limit : 3000,
      top: Number.isFinite(options.top) ? options.top : 10,
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

export async function fetchCurrencyPreference() {
  return requestWithMeta("/api/v1/settings/currency");
}

export async function updateCurrencyPreference(currency) {
  return requestWithMeta("/api/v1/settings/currency", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currency }),
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

export async function fetchSkinBaronApiKeyStatus() {
  const desktopSecrets = getDesktopSecrets();
  if (desktopSecrets?.getSkinBaronApiKeyStatus) {
    return {
      data: await desktopSecrets.getSkinBaronApiKeyStatus(),
      meta: {
        source: "desktop-local",
      },
    };
  }

  return requestWithMeta("/api/v1/settings/skinbaron-api-key");
}

export async function updateSkinBaronApiKey(apiKeyOrEncryptedKey) {
  const desktopSecrets = getDesktopSecrets();
  if (desktopSecrets?.setSkinBaronApiKey) {
    const result = await desktopSecrets.setSkinBaronApiKey(apiKeyOrEncryptedKey);

    return {
      data: result?.status || result,
      meta: {
        source: "desktop-safe-storage",
      },
    };
  }

  throw new Error("SkinBaron API Key updates are only supported in the Desktop app.");
}

export async function updateSkinBaronSessionCookie(sessionCookie) {
  const desktopSecrets = getDesktopSecrets();
  if (desktopSecrets?.setSkinBaronSessionCookie) {
    const result = await desktopSecrets.setSkinBaronSessionCookie(sessionCookie);

    return {
      data: result?.status || result,
      meta: {
        source: "desktop-safe-storage",
      },
    };
  }

  throw new Error("SkinBaron Session-Cookie updates are only supported in the Desktop app.");
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
  const since = typeof options.since === "string" ? options.since : undefined;

  return requestWithMeta(
    buildPath("/api/v1/cs-updates", {
      limit,
      before,
      since,
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
