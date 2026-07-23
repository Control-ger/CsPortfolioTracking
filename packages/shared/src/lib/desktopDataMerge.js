/**
 * Desktop data merge helpers extracted from dataSource.js.
 * Functions for merging local desktop data with upstream live data.
 */

import {
  calculatePortfolioSummary,
  clusterDesktopInvestments,
  enforceCsfloatOnlyRow,
  filterRowsByScope,
  isExcludedRow,
  buildPortfolioHistoryFromSnapshots,
  getInvestmentGroupKey,
  getInvestmentGroupKeyWithoutBucket,
  getInvestmentItemIdKey,
  getInvestmentItemIdKeyWithoutBucket,
  normalizeOverpayFloor,
  normalizePriceSource,
  toBooleanFlag,
  DEFAULT_STATS,
} from "./portfolioCalculations.js";

import { unwrapLocalStoreResult } from "./localStoreResult.js";

/** Desktop LocalStore accessor */
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

/** Check if an error is abort-related */
export function isAbortLikeError(error) {
  if (!error) {
    return false;
  }

  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    name === "aborterror" ||
    message.includes("aborted") ||
    message.includes("signal is aborted")
  );
}

/**
 * Enrich local desktop investment rows with upstream live pricing data.
 * Matches by item ID, group key, name, etc.
 */
export function enrichDesktopRowsWithUpstreamLiveData(localRows = [], upstreamRows = []) {
  if (!Array.isArray(localRows) || localRows.length === 0) {
    return [];
  }
  if (!Array.isArray(upstreamRows) || upstreamRows.length === 0) {
    return localRows;
  }

  const upstreamByKey = new Map();
  const upstreamByItemId = new Map();
  const upstreamByKeyWithoutBucket = new Map();
  const upstreamByItemIdWithoutBucket = new Map();
  upstreamRows.forEach((row) => {
    const key = getInvestmentGroupKey(row);
    if (!key) {
      return;
    }
    upstreamByKey.set(key, row);

    const itemIdKey = getInvestmentItemIdKey(row);
    if (itemIdKey && !upstreamByItemId.has(itemIdKey)) {
      upstreamByItemId.set(itemIdKey, row);
    }

    const keyWithoutBucket = getInvestmentGroupKeyWithoutBucket(row);
    if (keyWithoutBucket && !upstreamByKeyWithoutBucket.has(keyWithoutBucket)) {
      upstreamByKeyWithoutBucket.set(keyWithoutBucket, row);
    }

    const itemIdKeyWithoutBucket = getInvestmentItemIdKeyWithoutBucket(row);
    if (
      itemIdKeyWithoutBucket &&
      !upstreamByItemIdWithoutBucket.has(itemIdKeyWithoutBucket)
    ) {
      upstreamByItemIdWithoutBucket.set(itemIdKeyWithoutBucket, row);
    }
  });

  return localRows.map((row) => {
    const key = getInvestmentGroupKey(row);
    const itemIdKey = getInvestmentItemIdKey(row);
    const keyWithoutBucket = getInvestmentGroupKeyWithoutBucket(row);
    const itemIdKeyWithoutBucket = getInvestmentItemIdKeyWithoutBucket(row);
    const exactItemIdMatch = itemIdKey ? upstreamByItemId.get(itemIdKey) : null;
    const exactKeyMatch = key ? upstreamByKey.get(key) : null;
    const looseItemIdMatch = itemIdKeyWithoutBucket
      ? upstreamByItemIdWithoutBucket.get(itemIdKeyWithoutBucket)
      : null;
    const looseKeyMatch = keyWithoutBucket
      ? upstreamByKeyWithoutBucket.get(keyWithoutBucket)
      : null;
    const upstream = exactItemIdMatch || exactKeyMatch || looseItemIdMatch || looseKeyMatch;
    const isLooseMatch = !exactItemIdMatch && !exactKeyMatch && Boolean(looseItemIdMatch || looseKeyMatch);

    if (!upstream) {
      return row;
    }
    const quantity = Number(row.quantity || 0);
    const fallbackDisplayPrice = Number(row.displayPrice ?? row.livePrice ?? 0);
    const fallbackCurrentValue = Number(row.currentValue ?? fallbackDisplayPrice * quantity);
    const fallbackTotalInvested = Number(
      row.totalInvested ?? Number(row.buyPrice ?? row.buyPriceUsd ?? 0) * quantity,
    );
    const mergedPriceSource = upstream.priceSource ?? row.priceSource ?? null;
    const sourceIsCsfloat =
      normalizePriceSource(mergedPriceSource) === "" ||
      normalizePriceSource(mergedPriceSource) === "csfloat";
    const liveDisplayPrice = Number(upstream.displayPrice ?? upstream.livePrice);
    const hasLiveDisplayPrice = Number.isFinite(liveDisplayPrice) && liveDisplayPrice > 0;
    const mergedDisplayPrice = hasLiveDisplayPrice ? liveDisplayPrice : fallbackDisplayPrice;

    // The upstream row is the SERVER's aggregate for this item (grouped by `bucket:name`
    // in PortfolioService::aggregateInvestmentsByName). That aggregate can cover MORE
    // pieces than this local row whenever the server still holds an orphaned duplicate for
    // the same item — e.g. a legacy Steam-sync investment that a marketplace import
    // (CSFloat/SkinBaron) already represents but that was never pulled into the local DB,
    // so the Steam↔CSFloat matcher never excluded it. Desktop is the write owner, so the
    // LOCAL quantity is authoritative: keep only per-unit values (price, unit cost, ROI %,
    // break-even) from upstream and re-derive every quantity-scaled TOTAL against the local
    // quantity. When the quantities already agree (the common case) scale === 1 and the
    // merged totals are identical to before — no regression for normal rows.
    const upstreamQuantity = Number(upstream.quantity);
    const quantityScale =
      Number.isFinite(upstreamQuantity) && upstreamQuantity > 0 ? quantity / upstreamQuantity : 1;
    const scaleUpstreamTotal = (value) =>
      Number.isFinite(Number(value)) ? Number(value) * quantityScale : null;

    const mergedCurrentValue =
      scaleUpstreamTotal(upstream.currentValue) ?? mergedDisplayPrice * quantity;
    const computedProfitEuro = mergedCurrentValue - fallbackTotalInvested;
    const computedRoi = fallbackTotalInvested > 0
      ? (computedProfitEuro / fallbackTotalInvested) * 100
      : 0;
    const mergedProfitEuro =
      !isLooseMatch && scaleUpstreamTotal(upstream.profitEuro) !== null
        ? scaleUpstreamTotal(upstream.profitEuro)
        : computedProfitEuro;

    return {
      ...row,
      livePrice: sourceIsCsfloat ? (upstream.livePrice ?? row.livePrice ?? null) : null,
      displayPrice: sourceIsCsfloat ? mergedDisplayPrice : null,
      currentValue: sourceIsCsfloat
        ? (Number.isFinite(mergedCurrentValue) ? mergedCurrentValue : fallbackCurrentValue)
        : 0,
      totalInvested:
        !isLooseMatch && scaleUpstreamTotal(upstream.totalInvested) !== null
          ? scaleUpstreamTotal(upstream.totalInvested)
          : fallbackTotalInvested,
      isLive: sourceIsCsfloat && (upstream.isLive === true || row.isLive === true),
      pricingStatus: sourceIsCsfloat
        ? (upstream.pricingStatus ?? row.pricingStatus ?? "no_price")
        : "no_price",
      priceSource: sourceIsCsfloat ? mergedPriceSource : null,
      roi: sourceIsCsfloat
        ? (!isLooseMatch && Number.isFinite(Number(upstream.roi))
            ? Number(upstream.roi)
            : computedRoi)
        : null,
      profitEuro: sourceIsCsfloat ? mergedProfitEuro : null,
      isProfitPositive: sourceIsCsfloat ? mergedProfitEuro >= 0 : null,
      change24hEuro: upstream.change24hEuro ?? row.change24hEuro,
      change24hPercent: upstream.change24hPercent ?? row.change24hPercent,
      change7dEuro: upstream.change7dEuro ?? row.change7dEuro,
      change7dPercent: upstream.change7dPercent ?? row.change7dPercent,
      change30dEuro: upstream.change30dEuro ?? row.change30dEuro,
      change30dPercent: upstream.change30dPercent ?? row.change30dPercent,
      changes: upstream.changes ?? row.changes,
      lastPriceUpdateAt: upstream.lastPriceUpdateAt ?? row.lastPriceUpdateAt,
      priceAgeSeconds: upstream.priceAgeSeconds ?? row.priceAgeSeconds,
      freshnessStatus: upstream.freshnessStatus ?? row.freshnessStatus,
      freshnessLabel: upstream.freshnessLabel ?? row.freshnessLabel,
      marketTypeLabel: upstream.marketTypeLabel ?? row.marketTypeLabel,
      wearName: upstream.wearName ?? row.wearName,
      priceScope: upstream.priceScope ?? row.priceScope ?? "item",
      priceStrategy: upstream.priceStrategy ?? row.priceStrategy ?? null,
      priceConfidence: upstream.priceConfidence ?? row.priceConfidence ?? null,
      sampleSize: upstream.sampleSize ?? row.sampleSize ?? null,
      breakEvenPrice: upstream.breakEvenPrice ?? row.breakEvenPrice,
      breakEvenDeltaEuro: upstream.breakEvenDeltaEuro ?? row.breakEvenDeltaEuro,
      breakEvenDeltaPercent: upstream.breakEvenDeltaPercent ?? row.breakEvenDeltaPercent,
      baseLivePrice: upstream.baseLivePrice ?? row.baseLivePrice ?? row.livePrice ?? null,
      overpayEnabled: toBooleanFlag(
        upstream.overpayEnabled ?? upstream.isOverpayCandidate ?? row.overpayEnabled ?? row.isOverpayCandidate,
      ),
      isOverpayCandidate: toBooleanFlag(
        upstream.isOverpayCandidate ?? upstream.overpayEnabled ?? row.isOverpayCandidate ?? row.overpayEnabled,
      ),
      overpayFloorEur:
        normalizeOverpayFloor(upstream.overpayFloorEur) ??
        normalizeOverpayFloor(row.overpayFloorEur) ??
        null,
      overpayApplied: toBooleanFlag(upstream.overpayApplied ?? row.overpayApplied ?? false),
      overpayNote: String(upstream.overpayNote ?? row.overpayNote ?? "").trim() || null,
      costBasisTotal: scaleUpstreamTotal(upstream.costBasisTotal) ?? row.costBasisTotal,
      costBasisUnit: upstream.costBasisUnit ?? row.costBasisUnit,
      netPositionValue: scaleUpstreamTotal(upstream.netPositionValue) ?? row.netPositionValue,
      netProfitEuro: scaleUpstreamTotal(upstream.netProfitEuro) ?? row.netProfitEuro,
      netRoiPercent: upstream.netRoiPercent ?? row.netRoiPercent,
      breakEvenPriceNet: upstream.breakEvenPriceNet ?? row.breakEvenPriceNet,
      appliedFees: upstream.appliedFees ?? row.appliedFees,
    };
  });
}

function getWatchlistGroupKey(item) {
  const numericItemId = Number(item?.itemId ?? item?.item_id ?? 0);
  if (Number.isFinite(numericItemId) && numericItemId > 0) {
    return `item:${Math.floor(numericItemId)}`;
  }

  const normalizedName = String(item?.name || item?.marketHashName || "")
    .trim()
    .toLowerCase();
  return normalizedName ? `name:${normalizedName}` : "";
}

/**
 * Enrich local desktop watchlist items with upstream metrics.
 */
export function enrichDesktopWatchlistWithUpstreamMetrics(localItems = [], upstreamItems = []) {
  if (!Array.isArray(localItems) || localItems.length === 0) {
    return [];
  }
  if (!Array.isArray(upstreamItems) || upstreamItems.length === 0) {
    return localItems;
  }

  const upstreamByKey = new Map();
  const upstreamByItemId = new Map();
  const upstreamByName = new Map();
  upstreamItems.forEach((item) => {
    const key = getWatchlistGroupKey(item);
    if (!key) {
      const nameOnlyKey = String(item?.name || item?.marketHashName || "")
        .trim()
        .toLowerCase();
      if (nameOnlyKey && !upstreamByName.has(nameOnlyKey)) {
        upstreamByName.set(nameOnlyKey, item);
      }
      return;
    }
    upstreamByKey.set(key, item);

    const itemIdKey = (() => {
      const numericItemId = Number(item?.itemId ?? item?.item_id ?? 0);
      if (Number.isFinite(numericItemId) && numericItemId > 0) {
        return `item:${Math.floor(numericItemId)}`;
      }
      return "";
    })();
    if (itemIdKey && !upstreamByItemId.has(itemIdKey)) {
      upstreamByItemId.set(itemIdKey, item);
    }

    const nameKey = String(item?.name || item?.marketHashName || "")
      .trim()
      .toLowerCase();
    if (nameKey && !upstreamByName.has(nameKey)) {
      upstreamByName.set(nameKey, item);
    }
  });

  const debugWatchlistMerge =
    typeof window !== "undefined" && Boolean(window.__DEBUG_WATCHLIST_MERGE__);
  let matchedByItemIdCount = 0;
  let matchedByNameCount = 0;
  let unmatchedCount = 0;

  const mergedItems = localItems.map((localItem) => {
    const key = getWatchlistGroupKey(localItem);
    const localItemIdKey = (() => {
      const numericItemId = Number(localItem?.itemId ?? localItem?.item_id ?? 0);
      if (Number.isFinite(numericItemId) && numericItemId > 0) {
        return `item:${Math.floor(numericItemId)}`;
      }
      return "";
    })();
    const localNameKey = String(localItem?.name || localItem?.marketHashName || "")
      .trim()
      .toLowerCase();

    const itemIdMatch = localItemIdKey ? upstreamByItemId.get(localItemIdKey) : null;
    const keyMatch = key ? upstreamByKey.get(key) : null;
    const nameMatch = localNameKey ? upstreamByName.get(localNameKey) : null;
    const upstreamItem = itemIdMatch || keyMatch || nameMatch || null;

    if (!upstreamItem) {
      unmatchedCount += 1;
      if (debugWatchlistMerge) {
        console.debug("[watchlist-merge] unmatched local item", {
          localId: localItem.id,
          localName: localItem.name || null,
          localItemId: localItem.itemId ?? null,
        });
      }
      return localItem;
    }

    if (itemIdMatch || keyMatch) {
      matchedByItemIdCount += 1;
    } else if (nameMatch) {
      matchedByNameCount += 1;
    }

    return {
      ...localItem,
      ...upstreamItem,
      id: localItem.id,
      serverId: localItem.serverId ?? upstreamItem.serverId ?? upstreamItem.id ?? null,
      userId: localItem.userId,
      itemId: localItem.itemId ?? upstreamItem.itemId ?? null,
      imageUrl: localItem.imageUrl || upstreamItem.imageUrl || null,
    };
  });

  if (debugWatchlistMerge) {
    console.debug("[watchlist-merge] merge summary", {
      localCount: localItems.length,
      upstreamCount: upstreamItems.length,
      matchedByItemIdOrKey: matchedByItemIdCount,
      matchedByName: matchedByNameCount,
      unmatched: unmatchedCount,
    });
  }

  return mergedItems;
}

/**
 * Build a local portfolio snapshot from desktop SQLite data.
 */
export async function buildDesktopPortfolioLocalSnapshot(options = {}) {
  const localStore = getDesktopLocalStore();
  const [rawRowsResult, snapshotsResult] = await Promise.all([
    localStore.listInvestments(options.userId),
    localStore.listPortfolioSnapshots(options.userId, 365),
  ]);
  const rawRows = unwrapLocalStoreResult(
    rawRowsResult,
    "local-store-list-investments",
  );
  const snapshots = unwrapLocalStoreResult(
    snapshotsResult,
    "local-store-list-portfolio-snapshots",
  );
  const displayScope = options.rowScope || "all";
  const scopedRows = filterRowsByScope(rawRows, displayScope);
  const activeRows = scopedRows.filter((row) => !isExcludedRow(row));
  const rows = clusterDesktopInvestments(activeRows).map(enforceCsfloatOnlyRow);
  const meta = {
    source: "desktop-local",
    rawInvestmentCount: rawRows.length,
    scopedInvestmentCount: scopedRows.length,
    warnings: [],
  };
  let history = buildPortfolioHistoryFromSnapshots(snapshots);

  if (history.length === 0 && rows.length > 0) {
    const summary = calculatePortfolioSummary(rows);
    history = [
      {
        date: new Date().toISOString(),
        wert: Number(summary.totalValue || 0),
        invested: Number(summary.totalInvested || 0),
        growthPercent: Number(summary.totalRoiPercent || 0),
      },
    ];
  }

  const nextMeta = rows.length === 0
    ? {
        ...meta,
        emptyReason: "no-items-imported",
        message: "Import items from your CS2 inventory to get started",
      }
    : meta;

  return {
    rows: {
      data: rows,
      meta: nextMeta,
    },
    summary: {
      data: calculatePortfolioSummary(filterRowsByScope(rows, options.scope)),
      meta: {
        ...nextMeta,
        scope: String(options.scope || "investments"),
      },
    },
    history,
  };
}

/**
 * Fetch portfolio data for desktop mode, merging local + upstream.
 */
export async function fetchDesktopPortfolioData(options = {}, fetchApiPortfolioInvestments, fetchApiPortfolioHistory, runDesktopSyncNowIfDue) {
  if (options.localOnly) {
    return buildDesktopPortfolioLocalSnapshot(options);
  }

  try {
    await runDesktopSyncNowIfDue();
  } catch (error) {
    console.warn("[desktop-sync] portfolio sync failed", error);
  }

  const localSnapshot = await buildDesktopPortfolioLocalSnapshot(options);

  let rows = Array.isArray(localSnapshot?.rows?.data) ? localSnapshot.rows.data : [];
  let meta = {
    ...(localSnapshot?.rows?.meta || {}),
  };
  let history = Array.isArray(localSnapshot?.history) ? localSnapshot.history : [];

  const upstreamRowsPromise = (async () => {
    try {
      return await fetchApiPortfolioInvestments({
        signal: options.signal,
        scope: options.rowScope || options.scope,
      });
    } catch (error) {
      if (!isAbortLikeError(error)) {
        console.warn("[desktop-live-pricing] upstream investments unavailable", error);
      }
      return null;
    }
  })();

  const upstreamHistoryPromise = history.length <= 1
    ? (async () => {
        try {
          return await fetchApiPortfolioHistory({
            signal: options.signal,
            scope: options.scope,
          });
        } catch (error) {
          if (!isAbortLikeError(error)) {
            console.warn("[desktop-history] upstream portfolio history unavailable", error);
          }
          return null;
        }
      })()
    : Promise.resolve(null);

  const [upstreamRowsResponse, upstreamHistoryResponse] = await Promise.all([
    upstreamRowsPromise,
    upstreamHistoryPromise,
  ]);

  // fetchApiPortfolioHistory resolves to the API envelope ({ data, meta }), not a
  // bare array. Unwrap to the array form the consumer (PortfolioPage) expects;
  // without this the server-side portfolio history was always silently discarded.
  const upstreamHistory = Array.isArray(upstreamHistoryResponse?.data)
    ? upstreamHistoryResponse.data
    : Array.isArray(upstreamHistoryResponse)
      ? upstreamHistoryResponse
      : [];

  const upstreamRows = Array.isArray(upstreamRowsResponse?.data)
    ? upstreamRowsResponse.data
    : [];
  const upstreamMeta = upstreamRowsResponse?.meta || {};
  const upstreamSource = String(upstreamMeta?.source || "").trim().toLowerCase();

  if (upstreamRows.length > 0) {
    rows = enrichDesktopRowsWithUpstreamLiveData(rows, upstreamRows).map(enforceCsfloatOnlyRow);
    meta = {
      ...meta,
      livePricingSource: "upstream",
    };
  } else if (upstreamSource === "desktop-local-fallback") {
    const upstreamHint = upstreamMeta?.upstreamHint || {};
    const hintCode = String(upstreamHint?.code || "UPSTREAM_UNAVAILABLE");
    const hintMessage = String(
      upstreamHint?.message || "Upstream-Portfolio konnte nicht geladen werden. Lokale Daten ohne Livepreise aktiv.",
    );
    const nextWarnings = Array.isArray(meta.warnings) ? [...meta.warnings] : [];
    nextWarnings.push({
      code: hintCode,
      message: hintMessage,
      statusCode: Number(Array.isArray(upstreamHint?.attemptStatuses) ? upstreamHint.attemptStatuses[0] : 0) || undefined,
    });
    meta = {
      ...meta,
      livePricingSource: "upstream-fallback",
      warnings: nextWarnings,
      upstreamHint,
      proxyAttempts: Array.isArray(upstreamMeta?.proxyAttempts) ? upstreamMeta.proxyAttempts : [],
    };
  }

  if (Array.isArray(upstreamHistory) && upstreamHistory.length > history.length) {
    history = upstreamHistory;
    meta = {
      ...meta,
      historySource: "upstream",
    };
  }

  return {
    rows: {
      data: rows,
      meta,
    },
    summary: {
      data: calculatePortfolioSummary(filterRowsByScope(rows, options.scope)),
      meta: {
        ...meta,
        scope: String(options.scope || "investments"),
      },
    },
    history,
  };
}

export const CSFLOAT_BUYORDERS_CACHE_KEY = "cache:csfloat:buyorders";
