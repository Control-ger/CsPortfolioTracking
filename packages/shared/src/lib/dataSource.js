/**
 * Runtime Data Source — Gateway
 *
 * Selects runtime (desktop vs web) and merges local + upstream data.
 * Calculation helpers extracted to ./portfolioCalculations.js
 * Desktop merge helpers extracted to ./desktopDataMerge.js
 */

import {
  createWatchlistItem as createApiWatchlistItem,
  createWatchlistItemsBatch as createApiWatchlistItemsBatch,
  deleteWatchlistItem as deleteApiWatchlistItem,
  fetchCsFloatBuyOrders as fetchApiCsFloatBuyOrders,
  fetchPortfolioComposition as fetchApiPortfolioComposition,
  fetchPortfolioHistory as fetchApiPortfolioHistory,
  fetchPortfolioInvestments as fetchApiPortfolioInvestments,
  fetchWatchlist as fetchApiWatchlist,
} from "./apiClient.js";

import { getCurrentUser, isAuthenticated } from "./auth.js";
import { runDesktopSyncNowIfDue } from "./desktopSync.js";
import * as localCache from "./localCache.js";
import { unwrapLocalStoreResult } from "./localStoreResult.js";
import { resolveDesktopLocalUserId as resolveDesktopUserId } from "./userIdentity.js";

import {
  calculatePortfolioSummary,
  clusterDesktopInvestments,
  enforceCsfloatOnlyRow,
  filterRowsByScope,
  isExcludedRow,
  buildPortfolioCompositionFromRows,
  DEFAULT_STATS,
} from "./portfolioCalculations.js";

import {
  getDesktopLocalStore,
  isAbortLikeError,
  enrichDesktopRowsWithUpstreamLiveData,
  enrichDesktopWatchlistWithUpstreamMetrics,
  fetchDesktopPortfolioData,
  CSFLOAT_BUYORDERS_CACHE_KEY,
} from "./desktopDataMerge.js";

// ──────────────────────────────────────────────
// Web (API-only) portfolio data
// ──────────────────────────────────────────────

async function fetchApiPortfolioData(options = {}) {
  const [rows, history] = await Promise.all([
    fetchApiPortfolioInvestments({
      signal: options.signal,
      scope: options.rowScope || options.scope,
    }),
    fetchApiPortfolioHistory({ signal: options.signal, scope: options.scope }),
  ]);

  const sanitizedRows = {
    ...rows,
    data: Array.isArray(rows?.data) ? rows.data.map(enforceCsfloatOnlyRow) : [],
  };
  const recomputedSummary = {
    data: calculatePortfolioSummary(
      filterRowsByScope(sanitizedRows.data, options.scope),
    ),
    meta: {
      ...(rows?.meta || {}),
      scope: String(options.scope || "investments"),
    },
  };

  return {
    rows: sanitizedRows,
    summary: recomputedSummary,
    history,
  };
}

// ──────────────────────────────────────────────
// Exported Data Source Gateway Functions
// ──────────────────────────────────────────────

export async function fetchPortfolioData(options = {}) {
  // Auth-First: Check if user is authenticated (async for Desktop IPC)
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return {
      rows: { data: [], meta: { source: "auth-required", requiresLogin: true } },
      summary: { data: DEFAULT_STATS, meta: { source: "auth-required", requiresLogin: true } },
      history: null,
      requiresAuth: true,
    };
  }

  const user = await getCurrentUser();
  const userId = getDesktopLocalStore()
    ? resolveDesktopUserId(user, options.userId || 1)
    : user?.id || options.userId;

  if (getDesktopLocalStore()) {
    return fetchDesktopPortfolioData(
      { ...options, userId },
      fetchApiPortfolioInvestments,
      fetchApiPortfolioHistory,
      runDesktopSyncNowIfDue,
    );
  }

  return fetchApiPortfolioData({ ...options });
}

export async function fetchPortfolioCompositionData(options = {}) {
  const localStore = getDesktopLocalStore();
  if (!localStore) {
    return fetchApiPortfolioComposition({ scope: options.scope });
  }

  const user = await getCurrentUser();
  const userId = resolveDesktopUserId(user, 1);
  const rawRows = unwrapLocalStoreResult(
    await localStore.listInvestments(userId),
    "local-store-list-investments",
  );
  const scopedRows = filterRowsByScope(rawRows, options.scope);
  const activeRows = scopedRows.filter((row) => !isExcludedRow(row));
  let clusteredRows = clusterDesktopInvestments(activeRows);

  try {
    const upstreamRowsResponse = await fetchApiPortfolioInvestments({
      signal: options.signal,
      scope: options.scope,
    });
    const upstreamRows = Array.isArray(upstreamRowsResponse?.data)
      ? upstreamRowsResponse.data
      : [];

    if (upstreamRows.length > 0) {
      clusteredRows = enrichDesktopRowsWithUpstreamLiveData(clusteredRows, upstreamRows);
    }
  } catch (error) {
    if (!isAbortLikeError(error)) {
      console.warn("[desktop-composition] upstream investments unavailable", error);
    }
  }

  return buildPortfolioCompositionFromRows(clusteredRows.map(enforceCsfloatOnlyRow));
}

export async function fetchWatchlistData(options = {}) {
  // Auth-First: Check if user is authenticated (async for Desktop IPC)
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return {
      data: [],
      meta: { source: "auth-required", requiresLogin: true },
      requiresAuth: true,
    };
  }

  const user = await getCurrentUser();
  const userId = getDesktopLocalStore()
    ? resolveDesktopUserId(user, options.userId || 1)
    : user?.id || options.userId;
  const localStore = getDesktopLocalStore();

  if (!localStore) {
    return fetchApiWatchlist(options);
  }

  if (options.skipDesktopSync !== true) {
    try {
      await runDesktopSyncNowIfDue();
    } catch (error) {
      console.warn("[desktop-sync] watchlist sync failed", error);
    }
  }

  let items = unwrapLocalStoreResult(
    await localStore.listWatchlist(userId),
    "local-store-list-watchlist",
  );
  let meta = {
    source: "desktop-local",
    warnings: [],
  };

  try {
    const upstreamResponse = await fetchApiWatchlist(options);
    let upstreamItems = Array.isArray(upstreamResponse?.data)
      ? upstreamResponse.data
      : [];
    const upstreamMeta = upstreamResponse?.meta || {};
    const upstreamSource = String(upstreamMeta?.source || "").trim().toLowerCase();
    const upstreamLooksLikeProxyFallback =
      upstreamSource === "desktop-local-fallback" ||
      (Array.isArray(upstreamMeta?.proxyAttempts) && upstreamMeta.proxyAttempts.length > 0);

    // If syncLive times out in the desktop sidecar proxy, the endpoint can return a
    // successful fallback payload without metrics/history. In that case, retry once
    // without syncLive to get the persisted watchlist metrics/history from upstream.
    if (
      upstreamItems.length === 0 &&
      upstreamLooksLikeProxyFallback &&
      options?.syncLive === true
    ) {
      try {
        const upstreamReadResponse = await fetchApiWatchlist({
          ...options,
          syncLive: false,
        });
        const upstreamReadItems = Array.isArray(upstreamReadResponse?.data)
          ? upstreamReadResponse.data
          : [];
        if (upstreamReadItems.length > 0) {
          upstreamItems = upstreamReadItems;
          meta.warnings = [
            ...(Array.isArray(upstreamMeta?.warnings) ? upstreamMeta.warnings : []),
            {
              code: "WATCHLIST_SYNC_LIVE_TIMEOUT_FALLBACK",
              message: "Live-Sync war langsam. Es wurden gespeicherte Watchlist-Preisdaten geladen.",
            },
          ];
        }
      } catch (readFallbackError) {
        if (!isAbortLikeError(readFallbackError)) {
          console.warn("[desktop-watchlist] upstream read fallback failed", readFallbackError);
        }
      }
    }

    if (upstreamItems.length > 0) {
      items = enrichDesktopWatchlistWithUpstreamMetrics(items, upstreamItems);
      meta = {
        ...meta,
        livePricingSource: "upstream",
      };
    }

    if (Array.isArray(upstreamMeta?.warnings)) {
      meta.warnings = meta.warnings.length > 0
        ? meta.warnings
        : upstreamMeta.warnings;
    }
  } catch (error) {
    if (!isAbortLikeError(error)) {
      console.warn("[desktop-watchlist] upstream watchlist metrics unavailable", error);
    }
  }

  // No server seeding - user must be logged in to have data
  // If empty, just return empty list (user can add items manually)
  if (items.length === 0) {
    meta.emptyReason = "no-items-yet";
    meta.message = "Add CS2 items from your inventory to get started";
  }

  return {
    data: items,
    meta,
  };
}

export async function fetchCsFloatBuyOrdersData(options = {}) {
  const syncNow = options.syncNow === true;
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return {
      data: {
        orders: [],
        summaryByMarketHashName: [],
      },
      meta: { source: "auth-required", requiresLogin: true },
      requiresAuth: true,
    };
  }

  if (!syncNow) {
    const cached = await localCache.get(CSFLOAT_BUYORDERS_CACHE_KEY);
    const cachedOrders = Array.isArray(cached?.orders) ? cached.orders : [];
    const cachedSummary = Array.isArray(cached?.summaryByMarketHashName)
      ? cached.summaryByMarketHashName
      : [];

    return {
      data: {
        orders: cachedOrders,
        summaryByMarketHashName: cachedSummary,
      },
      meta: {
        source: "desktop-cache",
        fromCache: true,
        hasCachedSnapshot: Boolean(cached),
        cachedAt: cached?.cachedAt || null,
      },
    };
  }

  const localStore = getDesktopLocalStore();
  if (!localStore) {
    return {
      data: {
        orders: [],
        summaryByMarketHashName: [],
      },
      meta: {
        source: "web-runtime",
        unavailable: true,
      },
    };
  }

  try {
    const response = await fetchApiCsFloatBuyOrders(options);
    const snapshot = {
      orders: Array.isArray(response?.data?.orders) ? response.data.orders : [],
      summaryByMarketHashName: Array.isArray(response?.data?.summaryByMarketHashName)
        ? response.data.summaryByMarketHashName
        : [],
      cachedAt: new Date().toISOString(),
    };

    await localCache.set(CSFLOAT_BUYORDERS_CACHE_KEY, snapshot);

    return {
      data: {
        orders: snapshot.orders,
        summaryByMarketHashName: snapshot.summaryByMarketHashName,
      },
      meta: {
        ...(response?.meta || {}),
        upstreamSource: response?.meta?.source || null,
        source: "desktop-sync",
        fromCache: false,
        cachedAt: snapshot.cachedAt,
      },
    };
  } catch (error) {
    const cached = await localCache.get(CSFLOAT_BUYORDERS_CACHE_KEY);
    if (cached) {
      return {
        data: {
          orders: Array.isArray(cached?.orders) ? cached.orders : [],
          summaryByMarketHashName: Array.isArray(cached?.summaryByMarketHashName)
            ? cached.summaryByMarketHashName
            : [],
        },
        meta: {
          source: "desktop-cache-fallback",
          fromCache: true,
          cachedAt: cached?.cachedAt || null,
          syncError: String(error?.message || "unknown"),
        },
      };
    }
    throw error;
  }
}

/**
 * Check if authentication is required to view data (async for Desktop IPC)
 */
export async function isAuthRequired() {
  const authenticated = await isAuthenticated();
  return !authenticated;
}

export async function createWatchlistItemData(name, type = "skin") {
  const localStore = getDesktopLocalStore();

  if (!localStore) {
    return createApiWatchlistItem(name, type);
  }

  const currentUser = await getCurrentUser();
  const userId = resolveDesktopUserId(currentUser, 1);

  const created = unwrapLocalStoreResult(
    await localStore.upsertWatchlistItem({
      name,
      type,
      userId,
    }),
    "local-store-upsert-watchlist-item",
  );

  try {
    await runDesktopSyncNowIfDue({ force: true });
  } catch (error) {
    console.warn("[desktop-sync] watchlist create sync failed", error);
  }

  return created;
}

export async function createWatchlistItemsBatchData(items = []) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const localStore = getDesktopLocalStore();

  if (!localStore) {
    return createApiWatchlistItemsBatch(normalizedItems);
  }

  const currentUser = await getCurrentUser();
  const userId = resolveDesktopUserId(currentUser, 1);
  const created = [];

  for (const item of normalizedItems) {
    const name = String(item?.marketHashName || item?.name || "").trim();
    if (!name) {
      continue;
    }
    const type = String(item?.itemType || item?.type || "skin");
    const row = unwrapLocalStoreResult(
      await localStore.upsertWatchlistItem({ name, type, userId }),
      "local-store-upsert-watchlist-item",
    );
    created.push(row);
  }

  try {
    await runDesktopSyncNowIfDue({ force: true });
  } catch (error) {
    console.warn("[desktop-sync] watchlist batch create sync failed", error);
  }

  return {
    created,
    createdCount: created.length,
    duplicateCount: 0,
    duplicates: [],
    errorCount: 0,
    errors: [],
  };
}

export async function deleteWatchlistItemData(id) {
  const localStore = getDesktopLocalStore();

  if (!localStore) {
    return deleteApiWatchlistItem(id);
  }

  const deleted = unwrapLocalStoreResult(
    await localStore.deleteWatchlistItem(id),
    "local-store-delete-watchlist-item",
  );

  try {
    await runDesktopSyncNowIfDue({ force: true });
  } catch (error) {
    console.warn("[desktop-sync] watchlist delete sync failed", error);
  }

  return deleted;
}
