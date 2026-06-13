import {
  errorToContext,
  sendFrontendTelemetryEvent,
} from "../frontendTelemetry";
import { getCurrentUser, getSession } from "../auth.js";
import * as localCache from "../localCache.js";
import { unwrapLocalStoreResult } from "../localStoreResult.js";
import { resolveDesktopLocalUserId } from "../userIdentity.js";

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
    const raw = await window.electronAPI.backend.getBaseUrl();
    const desktopBase = raw !== null && typeof raw === "object" ? raw?.url : raw;
    if (desktopBase && typeof desktopBase === "string") {
      return normalizeApiBase(desktopBase);
    }
  }

  return API_BASE;
}

export function getDesktopSecrets() {
  if (
    typeof window === "undefined" ||
    !window.electronAPI ||
    !window.electronAPI.secrets
  ) {
    return null;
  }

  return window.electronAPI.secrets;
}

// When the desktop sidecar proxy reports that the upstream is behind a
// Cloudflare Access challenge (cookie missing/expired), prompt the user to sign
// in again via the existing CF login window, then retry the request once. The
// main process dedupes concurrent login windows; we also coalesce here so a
// burst of parallel reads triggers only one re-auth.
let cfAccessReauthInFlight = null;
function tryCloudflareAccessReauth() {
  if (typeof window === "undefined" || !window.electronAPI?.cloudflareAccess?.login) {
    return Promise.resolve(false);
  }
  if (cfAccessReauthInFlight) {
    return cfAccessReauthInFlight;
  }
  cfAccessReauthInFlight = (async () => {
    try {
      const cfg = await window.electronAPI.serverConfig?.get?.();
      const rawServerUrl = String(cfg?.serverUrl || cfg?.url || "").trim().replace(/\/+$/, "");
      if (!rawServerUrl) {
        return false;
      }
      const serverUrl = /^https?:\/\//i.test(rawServerUrl) ? rawServerUrl : `https://${rawServerUrl}`;
      const result = await window.electronAPI.cloudflareAccess.login(serverUrl);
      return Boolean(result?.ok);
    } catch (error) {
      console.warn("[apiClient] Cloudflare Access re-login failed", error);
      return false;
    } finally {
      cfAccessReauthInFlight = null;
    }
  })();
  return cfAccessReauthInFlight;
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

  const matchedKey = GET_CACHE_KEYS.find((entry) => entry.pattern.test(path))?.key || null;
  return matchedKey ? `${matchedKey}:${path}` : null;
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

export function buildPath(path, query = {}) {
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

function resolveSteamIdFromUser(user) {
  const idCandidates = [
    user?.steamId,
    user?.steam_id,
    String(user?.id || "").startsWith("steam-") ? String(user.id).slice("steam-".length) : null,
    String(user?.userId || "").startsWith("steam-") ? String(user.userId).slice("steam-".length) : null,
  ];

  for (const candidate of idCandidates) {
    const value = String(candidate || "").trim();
    if (/^[1-9]\d{10,}$/.test(value)) {
      return value;
    }
  }

  return null;
}

export async function resolveCurrentUserQuery(options = {}) {
  const explicitUserId = options.userId ?? options.user_id;
  if (explicitUserId !== undefined && explicitUserId !== null && String(explicitUserId).trim() !== "") {
    const explicitRaw = String(explicitUserId).trim();
    if (/^[1-9]\d{0,9}$/.test(explicitRaw)) {
      return { userId: explicitRaw };
    }
    if (/^steam-[1-9]\d{10,}$/i.test(explicitRaw)) {
      return { steamId: explicitRaw.slice("steam-".length) };
    }
    if (/^[1-9]\d{10,}$/.test(explicitRaw)) {
      return { steamId: explicitRaw };
    }
  }

  try {
    const currentUser = await getCurrentUser();
    const userId = currentUser?.userId ?? currentUser?.id;
    const rawUserId = String(userId || "").trim();
    if (/^[1-9]\d{0,9}$/.test(rawUserId)) {
      return { userId: rawUserId };
    }

    const steamId = resolveSteamIdFromUser(currentUser);
    if (steamId) {
      return { steamId };
    }
  } catch (error) {
    console.warn("[apiClient] failed to resolve current user for request scope", error);
  }

  return {};
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
  try {
    const session = await getSession();
    const token = String(session?.token || "").trim();
    if (token !== "" && !requestHeaders.has("Authorization")) {
      requestHeaders.set("Authorization", `Bearer ${token}`);
    }
  } catch (sessionError) {
    console.warn("[apiClient] failed to resolve session token for request", sessionError);
  }
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
  if (
    upstreamHint?.code === "CLOUDFLARE_ACCESS_LOGIN_REQUIRED" &&
    options._cfAccessRetried !== true
  ) {
    // The CF Access cookie is missing/expired, so the proxy got the login HTML
    // instead of data. Unlike the generic best-effort fallback, this is
    // actionable: prompt the user to re-authenticate, then retry once.
    console.warn("[apiClient] Cloudflare Access login required — prompting re-authentication", {
      method,
      path,
    });
    const reauthed = await tryCloudflareAccessReauth();
    if (reauthed) {
      return requestPayload(path, { ...options, _cfAccessRetried: true });
    }
  }

  if (upstreamHint?.code) {
    // Desktop is local-first: the sidecar's upstream proxy to the server is
    // best-effort, so UPSTREAM_UNAVAILABLE is an expected fallback (local data
    // still serves). Log at debug level so it stays available under Verbose
    // without spamming the default console. Telemetry below is unchanged.
    console.debug("[apiClient] upstream hint", {
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

export async function request(path, options = {}) {
  const payload = await requestPayload(path, options);
  return payload?.data;
}

export async function requestWithMeta(path, options = {}) {
  const payload = await requestPayload(path, options);
  return {
    data: payload?.data,
    meta: payload?.meta || {},
  };
}

export function getDesktopLocalStore() {
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

export function mapCsFloatPreviewTradeToInvestment(trade) {
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

export function mapSkinBaronPreviewSaleToInvestment(sale) {
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
    skinBaronTransferId: sale?.skinBaronTransferId || sale?.skinBaronSaleId || null,
    skinBaronSaleId: sale?.skinBaronSaleId || sale?.skinBaronTransferId || null,
    skinBaronOfferLink: sale?.skinBaronOfferLink || sale?.offerLink || null,
    purchasedAt: sale?.purchasedAt || null,
    notes: `Imported from SkinBaron sale ${stableSaleKey}`.trim(),
  };
}

export function normalizeImportIdentifier(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  return normalized.toLowerCase();
}

function normalizePreviewStatus(value, fallback = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
}

export function resolveInvestmentPlatform(entry) {
  return String(entry?.platform || entry?.source || "").trim().toLowerCase();
}

export function buildExistingInvestmentLookup(rows = [], platformFilter = null) {
  const byId = new Map();
  const byExternalTradeId = new Map();
  const bySkinBaronTransferOffer = new Map();

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

    if (platformFilter === "skinbaron") {
      const skinBaronTransferId = normalizeImportIdentifier(
        entry?.skinBaronTransferId || entry?.skinBaronSaleId,
      );
      const skinBaronOfferLink = normalizeImportIdentifier(entry?.skinBaronOfferLink || entry?.offerLink);
      if (skinBaronTransferId && skinBaronOfferLink) {
        const key = `${skinBaronTransferId}::${skinBaronOfferLink}`;
        if (!bySkinBaronTransferOffer.has(key)) {
          bySkinBaronTransferOffer.set(key, entry);
        }
      }
    }
  });

  return { byId, byExternalTradeId, bySkinBaronTransferOffer };
}

export function resolveExistingCsFloatInvestmentMatch(lookup, mappedTrade, previewTrade) {
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

export function resolveExistingSkinBaronInvestmentMatch(lookup, mappedTrade, previewTrade) {
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

  const transferCandidates = [
    mappedTrade?.skinBaronTransferId,
    mappedTrade?.skinBaronSaleId,
    previewTrade?.skinBaronTransferId,
    previewTrade?.skinBaronSaleId,
  ];
  const offerLinkCandidates = [
    mappedTrade?.skinBaronOfferLink,
    previewTrade?.skinBaronOfferLink,
    previewTrade?.offerLink,
  ];
  for (const transferCandidate of transferCandidates) {
    const normalizedTransfer = normalizeImportIdentifier(transferCandidate);
    if (!normalizedTransfer) {
      continue;
    }
    for (const offerCandidate of offerLinkCandidates) {
      const normalizedOffer = normalizeImportIdentifier(offerCandidate);
      if (!normalizedOffer) {
        continue;
      }
      const key = `${normalizedTransfer}::${normalizedOffer}`;
      const existingByTransferOffer = lookup?.bySkinBaronTransferOffer?.get(key);
      if (existingByTransferOffer) {
        return existingByTransferOffer;
      }
    }
  }

  return null;
}

export async function applyDesktopCsFloatPreviewDeduplication(previewResponse) {
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
      (trade) => normalizePreviewStatus(trade?.status) === "duplicate",
    ).length;
    const localInsertable = enrichedImportTrades.filter((trade) => {
      const status = normalizePreviewStatus(trade?.status, "new");
      return status !== "duplicate" && status !== "excluded";
    }).length;
    const localUpdated = enrichedImportTrades.filter(
      (trade) => normalizePreviewStatus(trade?.status) === "updated",
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

export async function applyDesktopSkinBaronPreviewDeduplication(previewResponse) {
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
      (trade) => normalizePreviewStatus(trade?.status) === "duplicate",
    ).length;
    const localInsertable = enrichedImportTrades.filter((trade) => {
      const status = normalizePreviewStatus(trade?.status, "new");
      return status !== "duplicate" && status !== "excluded";
    }).length;
    const localUpdated = enrichedImportTrades.filter(
      (trade) => normalizePreviewStatus(trade?.status) === "updated",
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
