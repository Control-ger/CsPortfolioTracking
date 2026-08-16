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
  fetchCsFloatWatchlist as fetchApiCsFloatWatchlist,
  fetchPortfolioHistory as fetchApiPortfolioHistory,
  fetchPortfolioInvestments as fetchApiPortfolioInvestments,
  fetchWatchlist as fetchApiWatchlist,
  searchWatchlistItems as searchApiWatchlistItems,
  updateWatchlistItemTarget as updateApiWatchlistItemTarget,
} from "./apiClient.js";

import { getCurrentUser, isAuthenticated } from "./auth.js";
import { runDesktopSyncNowIfDue } from "./desktopSync.js";
import { notifyWatchlistMutated } from "./watchlistMutationBus.js";
import * as localCache from "./localCache.js";
import { unwrapLocalStoreResult } from "./localStoreResult.js";
import { resolveDesktopLocalUserId as resolveDesktopUserId } from "./userIdentity.js";
import {
  evaluateWatchlistTargetAlerts,
  normalizeTargetDirection,
  normalizeTargetPriceUsd,
} from "./watchlistTargets.js";

import {
  calculatePortfolioSummary,
  enforceCsfloatOnlyRow,
  filterRowsByScope,
  DEFAULT_STATS,
} from "./portfolioCalculations.js";

import {
  getDesktopLocalStore,
  isAbortLikeError,
  enrichDesktopWatchlistWithUpstreamMetrics,
  fetchDesktopPortfolioData,
  CSFLOAT_BUYORDERS_CACHE_KEY,
} from "./desktopDataMerge.js";

// ──────────────────────────────────────────────
// Web (API-only) portfolio data
// ──────────────────────────────────────────────

async function fetchApiPortfolioData(options = {}) {
  const [rows, historyResponse] = await Promise.all([
    fetchApiPortfolioInvestments({
      signal: options.signal,
      scope: options.rowScope || options.scope,
    }),
    fetchApiPortfolioHistory({ signal: options.signal, scope: options.scope }),
  ]);

  // The history API returns an envelope ({ data, meta }); consumers (usePortfolio /
  // PortfolioPage) expect a bare array, matching the desktop data path.
  const history = Array.isArray(historyResponse?.data)
    ? historyResponse.data
    : Array.isArray(historyResponse)
      ? historyResponse
      : [];

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

/**
 * File a notification for every target the price just crossed, and disarm the
 * ones that fell back.
 *
 * Runs after the upstream merge, because only then do the rows carry prices.
 * The decision of *what* crossed lives in `watchlistTargets.js` — this function
 * only persists the outcome, so the gateway keeps holding no business logic.
 *
 * Writes are strictly per transition: `upsertWatchlistItem` flips `dirty=1` and
 * appends to `operations_log`, so writing on every load would generate sync
 * traffic for a portfolio that has not changed.
 */
async function applyWatchlistTargetAlerts(items, { localStore, userId }) {
  const { triggered, cleared } = evaluateWatchlistTargetAlerts(items);
  if (triggered.length === 0 && cleared.length === 0) {
    return items;
  }

  const triggeredAt = new Date().toISOString();
  const patchedById = new Map();

  for (const { item, target } of triggered) {
    try {
      await localStore.upsertWatchlistItem({
        id: item.id,
        userId,
        alertTriggeredAt: triggeredAt,
      });
      patchedById.set(item.id, triggeredAt);

      if (typeof localStore.createNotification === "function") {
        await localStore.createNotification({
          userId,
          category: "price_target",
          title: "Zielpreis erreicht",
          message:
            target.direction === "above"
              ? `${item.name} liegt bei oder über deinem Zielpreis.`
              : `${item.name} liegt bei oder unter deinem Zielpreis.`,
          payload: {
            watchlistItemId: item.id,
            itemName: item.name || null,
            targetPriceUsd: target.targetPriceUsd,
            livePriceUsd: target.livePriceUsd,
            direction: target.direction,
          },
        });
      }
    } catch (error) {
      console.warn("[watchlist-target] could not persist reached target", error);
    }
  }

  for (const { item } of cleared) {
    try {
      await localStore.upsertWatchlistItem({
        id: item.id,
        userId,
        alertTriggeredAt: null,
      });
      patchedById.set(item.id, null);
    } catch (error) {
      console.warn("[watchlist-target] could not disarm target", error);
    }
  }

  if (patchedById.size === 0) {
    return items;
  }

  // Reflect the new arm state in the returned rows rather than re-reading the
  // store: the caller renders from this array, and a stale `alertTriggeredAt`
  // would make the very next load fire the same notification again.
  return items.map((item) =>
    patchedById.has(item.id)
      ? { ...item, alertTriggeredAt: patchedById.get(item.id) }
      : item,
  );
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

  items = await applyWatchlistTargetAlerts(items, { localStore, userId });

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

let lastCsFloatWatchlistImportAtMs = 0;
const CSFLOAT_WATCHLIST_IMPORT_MIN_INTERVAL_MS = 60_000;

/**
 * Resolve a list of market hash names against the server item catalog (via the
 * watchlist search endpoint) so imported items can carry a real item_id, image
 * and price.
 *
 * Desktop is not allowed to invent catalog items, and the server sync rejects
 * (throws on) a watchlist change whose name is not in the catalog. So we only
 * add names the catalog actually knows; the exact catalog match also yields the
 * canonical name (so server-side sync resolves item_id by name) and the icon.
 *
 * Returns:
 *  - matched:   [{ marketHashName (canonical), type, imageUrl }] — exact catalog hit
 *  - fallback:  [{ marketHashName, type }] — search threw OR returned no rows at
 *               all (e.g. no server configured / a CF Access lapse that yields an
 *               empty result set instead of an error); kept as name-only so the
 *               import does not silently become a no-op
 *  - notInCatalog: string[] — catalog returned rows but none is this exact name →
 *               genuinely absent, skipped (can never carry price data)
 */
async function resolveWatchlistCandidatesFromCatalog(names = []) {
  const cleaned = names.map((name) => String(name || "").trim()).filter(Boolean);

  const classify = async (name) => {
    try {
      const res = await searchApiWatchlistItems(name, {}, 5, 1);
      const items = Array.isArray(res?.data?.items) ? res.data.items : [];
      if (items.length === 0) {
        // Reachable-but-empty is indistinguishable from "search unavailable"
        // here (a CF Access lapse returns an empty set, not an error), so keep
        // the item as a name-only add rather than dropping every candidate.
        return { kind: "fallback", value: { marketHashName: name, type: "skin" } };
      }
      const key = name.toLowerCase();
      const candidate = items.find(
        (c) => String(c?.marketHashName || "").trim().toLowerCase() === key,
      );
      if (candidate) {
        return {
          kind: "matched",
          value: {
            marketHashName: String(candidate.marketHashName).trim(),
            type: String(candidate.itemType || "skin"),
            imageUrl: candidate.iconUrl || null,
          },
        };
      }
      // Catalog answered with rows but not this exact name — genuinely absent.
      return { kind: "notInCatalog", value: name };
    } catch {
      // Search threw (no server configured / upstream down): keep as name-only.
      return { kind: "fallback", value: { marketHashName: name, type: "skin" } };
    }
  };

  const matched = [];
  const fallback = [];
  const notInCatalog = [];

  // Bounded concurrency: a large first import would otherwise serialize one
  // search round-trip per name on the watchlist-load path.
  const CONCURRENCY = 6;
  for (let i = 0; i < cleaned.length; i += CONCURRENCY) {
    const results = await Promise.all(cleaned.slice(i, i + CONCURRENCY).map(classify));
    for (const result of results) {
      if (result.kind === "matched") {
        matched.push(result.value);
      } else if (result.kind === "fallback") {
        fallback.push(result.value);
      } else {
        notInCatalog.push(result.value);
      }
    }
  }

  return { matched, fallback, notInCatalog };
}

/**
 * Import the user's CSFloat watchlist into the local (Electron) watchlist.
 * One-way add-only: items already present locally (matched by name) are skipped,
 * and nothing is removed. Reuses createWatchlistItemsBatchData so the items go
 * through the proven add-by-name + sync path. Self-throttled so the auto-trigger
 * (per watchlist load) does not refetch/force-sync on every render.
 */
export async function importCsFloatWatchlistData(options = {}) {
  const force = options.force === true;
  const localStore = getDesktopLocalStore();
  if (!localStore) {
    return { skipped: true, reason: "not-desktop", fetched: 0, added: 0 };
  }

  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return { skipped: true, reason: "auth-required", fetched: 0, added: 0 };
  }

  const now = Date.now();
  if (!force && now - lastCsFloatWatchlistImportAtMs < CSFLOAT_WATCHLIST_IMPORT_MIN_INTERVAL_MS) {
    return { skipped: true, reason: "cooldown", fetched: 0, added: 0 };
  }
  lastCsFloatWatchlistImportAtMs = Date.now();

  const response = await fetchApiCsFloatWatchlist(options);
  const items = Array.isArray(response?.data?.items) ? response.data.items : [];
  const upstreamErrors = Array.isArray(response?.meta?.errors) ? response.meta.errors : [];

  // An empty result paired with an upstream error (e.g. /me/watchlist 500s like
  // /me/buy-orders did) must not look like "already up to date". Surface it.
  if (items.length === 0 && upstreamErrors.length > 0) {
    return {
      skipped: true,
      reason: "upstream-error",
      fetched: 0,
      added: 0,
      error: upstreamErrors[0],
    };
  }

  const currentUser = await getCurrentUser();
  const userId = resolveDesktopUserId(currentUser, 1);
  const existing = unwrapLocalStoreResult(
    await localStore.listWatchlist(userId),
    "local-store-list-watchlist",
  );
  const existingNames = new Set(
    (Array.isArray(existing) ? existing : [])
      .map((row) => String(row?.name || row?.marketHashName || "").trim().toLowerCase())
      .filter(Boolean),
  );

  const candidateNames = [];
  const seen = new Set();
  for (const item of items) {
    const name = String(item?.marketHashName || item?.name || "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key) || existingNames.has(key)) {
      continue;
    }
    seen.add(key);
    candidateNames.push(name);
  }

  if (candidateNames.length === 0) {
    return { skipped: false, reason: "no-new-items", fetched: items.length, added: 0, notInCatalog: 0 };
  }

  const { matched, fallback, notInCatalog } = await resolveWatchlistCandidatesFromCatalog(candidateNames);
  const newItems = [...matched, ...fallback];

  if (newItems.length === 0) {
    return {
      skipped: false,
      reason: "no-new-items",
      fetched: items.length,
      added: 0,
      notInCatalog: notInCatalog.length,
    };
  }

  await createWatchlistItemsBatchData(newItems);
  return {
    skipped: false,
    reason: "ok",
    fetched: items.length,
    added: newItems.length,
    notInCatalog: notInCatalog.length,
  };
}

let lastCsFloatBuyOrderWatchlistImportAtMs = 0;
const CSFLOAT_BUY_ORDER_WATCHLIST_IMPORT_MIN_INTERVAL_MS = 60_000;

export async function importCsFloatBuyOrdersAsWatchlistData(options = {}) {
  const force = options.force === true;
  const localStore = getDesktopLocalStore();
  if (!localStore) {
    return { skipped: true, reason: "not-desktop", fetched: 0, added: 0 };
  }

  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return { skipped: true, reason: "auth-required", fetched: 0, added: 0 };
  }

  const now = Date.now();
  if (!force && now - lastCsFloatBuyOrderWatchlistImportAtMs < CSFLOAT_BUY_ORDER_WATCHLIST_IMPORT_MIN_INTERVAL_MS) {
    return { skipped: true, reason: "cooldown", fetched: 0, added: 0 };
  }
  lastCsFloatBuyOrderWatchlistImportAtMs = Date.now();

  const response = await fetchApiCsFloatBuyOrders();
  const summary = Array.isArray(response?.data?.summaryByMarketHashName)
    ? response.data.summaryByMarketHashName
    : [];
  const upstreamErrors = Array.isArray(response?.meta?.errors) ? response.meta.errors : [];

  if (summary.length === 0 && upstreamErrors.length > 0) {
    return {
      skipped: true,
      reason: "upstream-error",
      fetched: 0,
      added: 0,
      error: upstreamErrors[0],
    };
  }

  const currentUser = await getCurrentUser();
  const userId = resolveDesktopUserId(currentUser, 1);
  const existing = unwrapLocalStoreResult(
    await localStore.listWatchlist(userId),
    "local-store-list-watchlist",
  );
  const existingNames = new Set(
    (Array.isArray(existing) ? existing : [])
      .map((row) => String(row?.name || row?.marketHashName || "").trim().toLowerCase())
      .filter(Boolean),
  );

  const candidateNames = [];
  const seen = new Set();
  for (const row of summary) {
    const name = String(row?.marketHashName || "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key) || existingNames.has(key)) {
      continue;
    }
    seen.add(key);
    candidateNames.push(name);
  }

  if (candidateNames.length === 0) {
    return { skipped: false, reason: "no-new-items", fetched: summary.length, added: 0, notInCatalog: 0 };
  }

  const { matched, fallback, notInCatalog } = await resolveWatchlistCandidatesFromCatalog(candidateNames);
  const newItems = [...matched, ...fallback];

  if (newItems.length === 0) {
    return {
      skipped: false,
      reason: "no-new-items",
      fetched: summary.length,
      added: 0,
      notInCatalog: notInCatalog.length,
    };
  }

  await createWatchlistItemsBatchData(newItems);
  return {
    skipped: false,
    reason: "ok",
    fetched: summary.length,
    added: newItems.length,
    notInCatalog: notInCatalog.length,
  };
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
    const created = await createApiWatchlistItem(name, type);
    notifyWatchlistMutated();
    return created;
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

  notifyWatchlistMutated();
  return created;
}

/**
 * Set or clear a watchlist item's target price.
 *
 * `alertPriceUsd: null` clears it. The anchor is the live price at the moment of
 * saving and is supplied by the caller (the UI knows it); it is the denominator
 * of the progress bar, so it is captured once here rather than re-derived later.
 */
export async function updateWatchlistItemTargetData(id, patch = {}) {
  const alertPriceUsd = normalizeTargetPriceUsd(patch.alertPriceUsd);
  const alertAnchorPriceUsd = alertPriceUsd === null
    ? null
    : normalizeTargetPriceUsd(patch.alertAnchorPriceUsd);
  const alertDirection = normalizeTargetDirection(patch.alertDirection);
  const localStore = getDesktopLocalStore();

  if (!localStore) {
    const updated = await updateApiWatchlistItemTarget(id, {
      alertPriceUsd,
      alertDirection,
      alertAnchorPriceUsd,
    });
    notifyWatchlistMutated();
    return updated;
  }

  const currentUser = await getCurrentUser();
  const userId = resolveDesktopUserId(currentUser, 1);

  const updated = unwrapLocalStoreResult(
    await localStore.upsertWatchlistItem({
      id,
      userId,
      alertPriceUsd,
      alertDirection,
      alertAnchorPriceUsd,
      // Saving a target always re-arms it: the user is stating a new intent, and
      // a carried-over timestamp would swallow the first crossing of it.
      alertTriggeredAt: null,
    }),
    "local-store-upsert-watchlist-item",
  );

  try {
    await runDesktopSyncNowIfDue({ force: true });
  } catch (error) {
    console.warn("[desktop-sync] watchlist target sync failed", error);
  }

  notifyWatchlistMutated();
  return updated;
}

export async function createWatchlistItemsBatchData(items = []) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const localStore = getDesktopLocalStore();

  if (!localStore) {
    const result = await createApiWatchlistItemsBatch(normalizedItems);
    notifyWatchlistMutated();
    return result;
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
    const imageUrl = item?.imageUrl || item?.iconUrl || null;
    const row = unwrapLocalStoreResult(
      await localStore.upsertWatchlistItem({
        name,
        type,
        userId,
        ...(imageUrl ? { imageUrl } : {}),
      }),
      "local-store-upsert-watchlist-item",
    );
    created.push(row);
  }

  try {
    await runDesktopSyncNowIfDue({ force: true });
  } catch (error) {
    console.warn("[desktop-sync] watchlist batch create sync failed", error);
  }

  notifyWatchlistMutated();
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
