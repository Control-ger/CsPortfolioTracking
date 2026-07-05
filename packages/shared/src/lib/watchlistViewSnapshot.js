/**
 * Module-level snapshot for the Watchlist view, shared between the Watchlist
 * component (paint + refresh decisions) and the startup prefetch scheduled by
 * PortfolioPage. Lives outside the component file so non-component exports
 * don't break fast refresh.
 */

import {
  fetchCsFloatBuyOrdersData,
  fetchWatchlistData,
} from "./dataSource.js";

// Watchlist prices are cron-owned (hourly server updates), so a long freshness
// horizon is safe: within it the tab serves the snapshot without any network
// round-trip. Mutations (add/remove) bypass this via the watchlist mutation bus.
const WATCHLIST_CACHE_TTL_MS = 60 * 60 * 1000;

let watchlistViewSnapshot = {
  loaded: false,
  items: [],
  buyOrderSummary: [],
  buyOrderOrders: [],
  buyOrderDebug: null,
  warnings: [],
  updatedAt: 0,
};

// Must run on logout/account switch: the snapshot is module-global (not
// user-scoped like localCache), so without a reset the next account would
// briefly see the previous account's watchlist.
export function resetWatchlistViewSnapshot() {
  watchlistViewSnapshot = {
    loaded: false,
    items: [],
    buyOrderSummary: [],
    buyOrderOrders: [],
    buyOrderDebug: null,
    warnings: [],
    updatedAt: 0,
  };
}

export function setWatchlistViewSnapshot(next) {
  watchlistViewSnapshot = {
    loaded: true,
    items: Array.isArray(next?.items) ? next.items : [],
    buyOrderSummary: Array.isArray(next?.buyOrderSummary) ? next.buyOrderSummary : [],
    buyOrderOrders: Array.isArray(next?.buyOrderOrders) ? next.buyOrderOrders : [],
    buyOrderDebug: next?.buyOrderDebug ?? null,
    warnings: Array.isArray(next?.warnings) ? next.warnings : [],
    updatedAt: Number(next?.updatedAt) || Date.now(),
  };
}

// A loaded snapshot is always usable for painting (stale-while-revalidate);
// freshness only decides whether a background refresh is needed.
export function getLoadedWatchlistSnapshot() {
  if (!watchlistViewSnapshot.loaded) {
    return null;
  }
  return watchlistViewSnapshot;
}

export function isWatchlistSnapshotFresh() {
  const updatedAt = Number(watchlistViewSnapshot.updatedAt || 0);
  if (!watchlistViewSnapshot.loaded || !Number.isFinite(updatedAt) || updatedAt <= 0) {
    return false;
  }
  return Date.now() - updatedAt <= WATCHLIST_CACHE_TTL_MS;
}

export function normalizeNameKey(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeNameKeyForBuyOrderMatch(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\bstattrak(?:™)?\b/gi, "")
    .replace(/\bsouvenir\b/gi, "")
    .replace(/[★]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function applyBuyOrdersToWatchlistItems(items = [], summaryRows = []) {
  const summaryByName = new Map();
  (Array.isArray(summaryRows) ? summaryRows : []).forEach((row) => {
    const exactKey = normalizeNameKey(row?.marketHashName);
    const fuzzyKey = normalizeNameKeyForBuyOrderMatch(row?.marketHashName);
    if (!exactKey && !fuzzyKey) {
      return;
    }
    if (exactKey) {
      summaryByName.set(exactKey, row);
    }
    if (fuzzyKey) {
      summaryByName.set(fuzzyKey, row);
    }
  });

  return (Array.isArray(items) ? items : []).map((item) => {
    const rawName = item?.marketHashName || item?.name;
    const key = normalizeNameKey(rawName);
    const fuzzyKey = normalizeNameKeyForBuyOrderMatch(rawName);
    let summary = key ? summaryByName.get(key) : null;

    if (!summary && fuzzyKey) {
      summary = summaryByName.get(fuzzyKey) || null;
    }

    if (!summary && fuzzyKey) {
      summary =
        (Array.isArray(summaryRows) ? summaryRows : []).find((row) => {
          const rowKey = normalizeNameKeyForBuyOrderMatch(row?.marketHashName);
          return (
            rowKey &&
            (rowKey.includes(fuzzyKey) || fuzzyKey.includes(rowKey))
          );
        }) || null;
    }

    const buyOrderCount = Number(summary?.orders || 0);
    const buyOrderQuantity = Number(summary?.quantity || 0);
    const buyOrderBestPriceUsd = Number(summary?.bestPriceUsd || 0);

    return {
      ...item,
      hasBuyOrder: buyOrderCount > 0 && buyOrderBestPriceUsd > 0,
      buyOrderCount: buyOrderCount > 0 ? buyOrderCount : 0,
      buyOrderQuantity: buyOrderQuantity > 0 ? buyOrderQuantity : 0,
      buyOrderBestPriceUsd: buyOrderBestPriceUsd > 0 ? buyOrderBestPriceUsd : null,
    };
  });
}

let watchlistPrefetchPromise = null;

/**
 * Fill the snapshot ahead of the first tab visit (called from PortfolioPage
 * during browser idle after the initial dashboard load). When the user later
 * opens the Watchlist tab, it paints instantly from this snapshot and skips
 * the network entirely while the snapshot is fresh.
 */
export function prefetchWatchlistViewData() {
  if (isWatchlistSnapshotFresh()) {
    return Promise.resolve();
  }
  if (watchlistPrefetchPromise) {
    return watchlistPrefetchPromise;
  }

  watchlistPrefetchPromise = (async () => {
    try {
      // syncLive stays off: the homeserver is the single source of truth and its
      // cron owns price freshness. A live sync would make the server call CSFloat
      // per item (plus a 200ms sleep each) on every prefetch.
      const response = await fetchWatchlistData({ syncLive: false });
      const items = Array.isArray(response?.data) ? response.data : [];

      let buyOrderSummary = [];
      let buyOrderOrders = [];
      if (typeof window !== "undefined" && window.electronAPI?.localStore) {
        try {
          const buyOrderResponse = await fetchCsFloatBuyOrdersData();
          buyOrderSummary = Array.isArray(buyOrderResponse?.data?.summaryByMarketHashName)
            ? buyOrderResponse.data.summaryByMarketHashName
            : [];
          buyOrderOrders = Array.isArray(buyOrderResponse?.data?.orders)
            ? buyOrderResponse.data.orders
            : [];
        } catch (buyOrderError) {
          console.warn("[watchlist-prefetch] buyorders unavailable", buyOrderError);
        }
      }

      setWatchlistViewSnapshot({
        items: applyBuyOrdersToWatchlistItems(items, buyOrderSummary),
        buyOrderSummary,
        buyOrderOrders,
        buyOrderDebug: null,
        warnings: response?.meta?.warnings || [],
      });
    } catch (error) {
      console.warn("[watchlist-prefetch] failed", error);
    } finally {
      watchlistPrefetchPromise = null;
    }
  })();

  return watchlistPrefetchPromise;
}
