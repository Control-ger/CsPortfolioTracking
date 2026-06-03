import {
  createWatchlistItem as createApiWatchlistItem,
  createWatchlistItemsBatch as createApiWatchlistItemsBatch,
  deleteWatchlistItem as deleteApiWatchlistItem,
  fetchCsFloatBuyOrders as fetchApiCsFloatBuyOrders,
  fetchPortfolioComposition as fetchApiPortfolioComposition,
  fetchPortfolioHistory as fetchApiPortfolioHistory,
  fetchPortfolioInvestments as fetchApiPortfolioInvestments,
  refreshPortfolioStalePrices as refreshApiPortfolioStalePrices,
  fetchWatchlist as fetchApiWatchlist,
} from "./apiClient.js";

import { getCurrentUser, isAuthenticated } from "./auth.js";
import { runDesktopSyncNowIfDue } from "./desktopSync.js";
import * as localCache from "./localCache.js";
import { unwrapLocalStoreResult } from "./localStoreResult.js";
import { resolveDesktopLocalUserId as resolveDesktopUserId } from "./userIdentity.js";

const CSFLOAT_BUYORDERS_CACHE_KEY = "cache:csfloat:buyorders";

const DEFAULT_STATS = {
  totalValue: 0,
  totalInvested: 0,
  totalQuantity: 0,
  totalProfitEuro: 0,
  totalRoiPercent: 0,
  totalNetValue: 0,
  totalNetProfitEuro: 0,
  totalNetRoiPercent: 0,
  isPositive: true,
  chartColor: "#22c55e",
  liveItemsCount: 0,
  staleLiveItemsCount: 0,
  staleLiveItemsRatioPercent: 0,
  freshestDataAgeSeconds: null,
  oldestDataAgeSeconds: null,
};

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

function isAbortLikeError(error) {
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

function resolveRowBucket(row) {
  const directBucket = String(row?.bucket || "")
    .trim()
    .toLowerCase();
  if (directBucket === "inventory" || directBucket === "investment") {
    return directBucket;
  }

  const platform = String(row?.platform || row?.source || "")
    .trim()
    .toLowerCase();
  if (platform === "steam_inventory") {
    return "inventory";
  }
  return "investment";
}

function filterRowsByScope(rows = [], scope = "investments") {
  const normalizedScope = String(scope || "").toLowerCase();
  if (normalizedScope === "all") {
    return rows;
  }

  return rows.filter((row) => resolveRowBucket(row) === "investment");
}

function toBooleanFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "on"].includes(normalized);
  }
  return false;
}

function normalizeOverpayFloor(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Number(parsed.toFixed(2));
}

function normalizePriceSource(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function enforceCsfloatOnlyRow(row) {
  const priceSource = normalizePriceSource(row?.priceSource);
  if (priceSource !== "steam") {
    return row;
  }

  return {
    ...row,
    isLive: false,
    livePrice: null,
    baseLivePrice: null,
    displayPrice: null,
    currentValue: 0,
    roi: null,
    profitEuro: null,
    isProfitPositive: null,
    pricingStatus: "no_price",
    priceSource: null,
    overpayApplied: false,
  };
}

function calculatePortfolioSummary(rows = []) {
  let totalValue = 0;
  let totalInvested = 0;
  let totalQuantity = 0;
  let totalNetValue = 0;
  let comparableValue = 0;
  let comparableInvested = 0;
  let comparableNetValue = 0;
  let comparableCostBasis = 0;
  let liveItemsCount = 0;
  let staleLiveItemsCount = 0;
  let freshestDataAgeSeconds = null;
  let oldestDataAgeSeconds = null;

  rows.forEach((row) => {
    const quantity = Number(row.quantity || 0);
    const displayPrice = Number(row.displayPrice ?? row.livePrice ?? 0);
    const buyPrice = Number(row.buyPrice ?? 0);
    const currentValue = Number(row.currentValue ?? displayPrice * quantity);
    const invested = Number(row.totalInvested ?? buyPrice * quantity);
    const netValue = Number(row.netPositionValue ?? currentValue);
    const costBasis = Number(row.costBasisTotal ?? invested);

    totalValue += currentValue;
    totalInvested += invested;
    totalQuantity += quantity;
    totalNetValue += netValue;

    // Relative growth should only include positions with known cost basis.
    if (invested > 0 || costBasis > 0) {
      comparableValue += currentValue;
      comparableInvested += invested;
      comparableNetValue += netValue;
      comparableCostBasis += costBasis;
    }

    if (row.isLive === true) {
      liveItemsCount += 1;

      if (row.freshnessStatus === "stale") {
        staleLiveItemsCount += 1;
      }

      if (Number.isFinite(Number(row.priceAgeSeconds))) {
        const age = Number(row.priceAgeSeconds);
        freshestDataAgeSeconds =
          freshestDataAgeSeconds === null ? age : Math.min(freshestDataAgeSeconds, age);
        oldestDataAgeSeconds =
          oldestDataAgeSeconds === null ? age : Math.max(oldestDataAgeSeconds, age);
      }
    }
  });

  const totalProfitEuro = comparableValue - comparableInvested;
  const totalRoiPercent =
    comparableInvested > 0 ? (totalProfitEuro / comparableInvested) * 100 : 0;
  const totalNetProfitEuro = comparableNetValue - comparableCostBasis;
  const totalNetRoiPercent =
    comparableCostBasis > 0 ? (totalNetProfitEuro / comparableCostBasis) * 100 : 0;
  const isPositive = totalProfitEuro >= 0;

  return {
    ...DEFAULT_STATS,
    totalValue,
    totalInvested,
    totalQuantity,
    totalProfitEuro,
    totalRoiPercent,
    totalNetValue,
    totalNetProfitEuro,
    totalNetRoiPercent,
    isPositive,
    chartColor: isPositive ? "#22c55e" : "#ef4444",
    liveItemsCount,
    staleLiveItemsCount,
    staleLiveItemsRatioPercent:
      liveItemsCount > 0 ? (staleLiveItemsCount / liveItemsCount) * 100 : 0,
    freshestDataAgeSeconds,
    oldestDataAgeSeconds,
  };
}

function getInvestmentGroupKey(row) {
  const bucket = resolveRowBucket(row);
  const nameKey = String(row.marketHashName || row.name || row.itemName || row.id || "")
    .trim()
    .toLowerCase();
  return `${bucket}:${nameKey}`;
}

function getInvestmentGroupKeyWithoutBucket(row) {
  return String(row.marketHashName || row.name || row.itemName || row.id || "")
    .trim()
    .toLowerCase();
}

function getInvestmentItemIdKey(row) {
  const bucket = resolveRowBucket(row);
  const itemId = Number(row?.itemId ?? row?.item_id ?? 0);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return "";
  }
  return `${bucket}:item:${Math.floor(itemId)}`;
}

function getInvestmentItemIdKeyWithoutBucket(row) {
  const itemId = Number(row?.itemId ?? row?.item_id ?? 0);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return "";
  }
  return `item:${Math.floor(itemId)}`;
}

function enrichDesktopRowsWithUpstreamLiveData(localRows = [], upstreamRows = []) {
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
    const mergedCurrentValue = Number.isFinite(Number(upstream.currentValue))
      ? Number(upstream.currentValue)
      : mergedDisplayPrice * quantity;
    const computedProfitEuro = mergedCurrentValue - fallbackTotalInvested;
    const computedRoi = fallbackTotalInvested > 0
      ? (computedProfitEuro / fallbackTotalInvested) * 100
      : 0;

    return {
      ...row,
      livePrice: sourceIsCsfloat ? (upstream.livePrice ?? row.livePrice ?? null) : null,
      displayPrice: sourceIsCsfloat ? mergedDisplayPrice : null,
      currentValue: sourceIsCsfloat
        ? (Number.isFinite(mergedCurrentValue) ? mergedCurrentValue : fallbackCurrentValue)
        : 0,
      totalInvested:
        !isLooseMatch && Number.isFinite(Number(upstream.totalInvested))
          ? Number(upstream.totalInvested)
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
      profitEuro: sourceIsCsfloat
        ? (!isLooseMatch && Number.isFinite(Number(upstream.profitEuro))
            ? Number(upstream.profitEuro)
            : computedProfitEuro)
        : null,
      isProfitPositive: sourceIsCsfloat
        ? (!isLooseMatch && typeof upstream.isProfitPositive === "boolean"
            ? upstream.isProfitPositive
            : computedProfitEuro >= 0)
        : null,
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
      costBasisTotal: upstream.costBasisTotal ?? row.costBasisTotal,
      costBasisUnit: upstream.costBasisUnit ?? row.costBasisUnit,
      netPositionValue: upstream.netPositionValue ?? row.netPositionValue,
      netProfitEuro: upstream.netProfitEuro ?? row.netProfitEuro,
      netRoiPercent: upstream.netRoiPercent ?? row.netRoiPercent,
      breakEvenPriceNet: upstream.breakEvenPriceNet ?? row.breakEvenPriceNet,
      appliedFees: upstream.appliedFees ?? row.appliedFees,
    };
  });
}

function clusterDesktopInvestments(rows = []) {
  const groups = new Map();

  rows.forEach((row) => {
    const key = getInvestmentGroupKey(row);
    if (!key) {
      return;
    }

    const quantity = Math.max(1, Number(row.quantity || 1));
    const buyPriceUsd = Number(row.buyPriceUsd ?? row.buyPrice ?? 0);
    const totalCostUsd = buyPriceUsd * quantity;

    if (!groups.has(key)) {
      groups.set(key, {
        ...row,
        id: `cluster-${key}`,
        sourceInvestmentIds: [],
        purchaseClusters: [],
        quantity: 0,
        buyPriceUsd: 0,
        buyPrice: 0,
        totalInvestedUsd: 0,
        totalInvested: 0,
        overpayEnabled: false,
        isOverpayCandidate: false,
        overpayFloorEur: null,
        overpayApplied: false,
        overpayNote: null,
      });
    }

    const group = groups.get(key);
    group.sourceInvestmentIds.push(row.id);
    group.quantity += quantity;
    group.totalInvestedUsd += totalCostUsd;
    group.totalInvested = group.totalInvestedUsd;

    const rowItemId = Number(row.itemId ?? row.item_id ?? 0);
    const groupItemId = Number(group.itemId ?? group.item_id ?? 0);
    if (rowItemId > 0 && groupItemId <= 0) {
      group.itemId = rowItemId;
      group.item_id = rowItemId;
    }

    if (!group.imageUrl && row.imageUrl) {
      group.imageUrl = row.imageUrl;
    }

    const rowOverpayEnabled = toBooleanFlag(row?.overpayEnabled ?? row?.isOverpayCandidate);
    const rowOverpayApplied = toBooleanFlag(row?.overpayApplied);
    const rowOverpayFloor = normalizeOverpayFloor(row?.overpayFloorEur);
    const rowOverpayNote = String(row?.overpayNote || "").trim();
    if (rowOverpayEnabled) {
      group.overpayEnabled = true;
      group.isOverpayCandidate = true;
    }
    if (rowOverpayApplied) {
      group.overpayApplied = true;
    }
    if (rowOverpayFloor !== null) {
      group.overpayFloorEur =
        group.overpayFloorEur === null
          ? rowOverpayFloor
          : Math.max(Number(group.overpayFloorEur || 0), rowOverpayFloor);
    }
    if (!group.overpayNote && rowOverpayNote) {
      group.overpayNote = rowOverpayNote;
    }

    const priceKey = buyPriceUsd.toFixed(4);
    const existingCluster = group.purchaseClusters.find((entry) => entry.priceKey === priceKey);
    if (existingCluster) {
      existingCluster.quantity += quantity;
      existingCluster.totalCostUsd += totalCostUsd;
    } else {
      group.purchaseClusters.push({
        priceKey,
        buyPriceUsd,
        buyPrice: buyPriceUsd,
        quantity,
        totalCostUsd,
      });
    }
  });

  return Array.from(groups.values()).map((group) => {
    const weightedBuyPriceUsd =
      group.quantity > 0 ? group.totalInvestedUsd / group.quantity : 0;

    return {
      ...group,
      buyPriceUsd: weightedBuyPriceUsd,
      buyPrice: weightedBuyPriceUsd,
      marketHashName: group.marketHashName || group.name,
      overpayEnabled: Boolean(group.overpayEnabled),
      isOverpayCandidate: Boolean(group.overpayEnabled),
      overpayApplied: Boolean(group.overpayApplied),
      overpayFloorEur: normalizeOverpayFloor(group.overpayFloorEur),
      overpayNote: String(group.overpayNote || "").trim() || null,
      purchaseClusters: group.purchaseClusters
        .map((entry) => ({
          ...entry,
          averageBuyPriceUsd: entry.quantity > 0 ? entry.totalCostUsd / entry.quantity : 0,
        }))
        .sort((a, b) => a.buyPriceUsd - b.buyPriceUsd),
    };
  });
}

function isExcludedRow(row) {
  return toBooleanFlag(row?.excluded ?? row?.isExcluded);
}

function buildPortfolioComposition(rows = []) {
  const groups = new Map();
  let totalValue = 0;

  rows.forEach((row) => {
    const quantity = Number(row.quantity || 0);
    const displayPrice = Number(row.displayPrice ?? row.livePrice ?? 0);
    const currentValue = Number(row.currentValue ?? displayPrice * quantity);
    totalValue += currentValue;

    const key = String(row.marketHashName || row.name || row.itemName || row.id || "");
    if (!groups.has(key)) {
      groups.set(key, {
        name: row.name || row.marketHashName || "Unknown Item",
        type: row.type || "skin",
        count: 0,
        value: 0,
      });
    }

    const entry = groups.get(key);
    entry.count += quantity;
    entry.value += currentValue;
  });

  const palette = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#f97316"];
  return Array.from(groups.values())
    .sort((a, b) => b.value - a.value)
    .map((entry, index) => ({
      ...entry,
      value: Number(entry.value.toFixed(2)),
      percentage: totalValue > 0 ? Number(((entry.value / totalValue) * 100).toFixed(1)) : 0,
      color: palette[index % palette.length],
    }));
}

export function buildPortfolioCompositionFromRows(rows = [], options = {}) {
  const scopedRows = filterRowsByScope(
    Array.isArray(rows) ? rows : [],
    options.scope,
  );
  return buildPortfolioComposition(scopedRows.map(enforceCsfloatOnlyRow));
}

function buildPortfolioHistoryFromSnapshots(snapshots = []) {
  return (Array.isArray(snapshots) ? snapshots : []).map((snapshot) => {
    const investedValue = Number(snapshot.investedValue || 0);
    const totalValue = Number(snapshot.wert || 0);
    return {
      date: snapshot.date,
      wert: totalValue,
      invested: investedValue,
      growthPercent: investedValue > 0 ? ((totalValue - investedValue) / investedValue) * 100 : 0,
    };
  });
}

async function buildDesktopPortfolioLocalSnapshot(options = {}) {
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

function enrichDesktopWatchlistWithUpstreamMetrics(localItems = [], upstreamItems = []) {
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

async function fetchDesktopPortfolioData(options = {}) {
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

  const [upstreamRowsResponse, upstreamHistory] = await Promise.all([
    upstreamRowsPromise,
    upstreamHistoryPromise,
  ]);

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
    return fetchDesktopPortfolioData({ ...options, userId });
  }

  return fetchApiPortfolioData({ ...options });
}

export async function refreshPortfolioStalePricesData(options = {}) {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return {
      data: {
        scope: String(options.scope || "investments"),
        limit: Number(options.limit || 200),
        staleItemsFound: 0,
        requested: 0,
        updated: 0,
      },
      meta: {
        source: "auth-required",
        requiresLogin: true,
      },
      requiresAuth: true,
    };
  }

  return refreshApiPortfolioStalePrices({
    signal: options.signal,
    scope: options.scope,
    limit: options.limit,
  });
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

  return buildPortfolioComposition(clusteredRows.map(enforceCsfloatOnlyRow));
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
