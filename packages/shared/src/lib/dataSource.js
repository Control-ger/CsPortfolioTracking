import {
  createWatchlistItem as createApiWatchlistItem,
  deleteWatchlistItem as deleteApiWatchlistItem,
  fetchPortfolioComposition as fetchApiPortfolioComposition,
  fetchPortfolioHistory as fetchApiPortfolioHistory,
  fetchPortfolioInvestments as fetchApiPortfolioInvestments,
  fetchPortfolioSummary as fetchApiPortfolioSummary,
  fetchWatchlist as fetchApiWatchlist,
} from "./apiClient.js";

import { getCurrentUser, isAuthenticated } from "./auth.js";
import { unwrapLocalStoreResult } from "./localStoreResult.js";

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

function calculatePortfolioSummary(rows = []) {
  let totalValue = 0;
  let totalInvested = 0;
  let totalQuantity = 0;
  let totalNetValue = 0;
  let totalCostBasis = 0;
  let liveItemsCount = 0;
  let staleLiveItemsCount = 0;
  let freshestDataAgeSeconds = null;
  let oldestDataAgeSeconds = null;

  rows.forEach((row) => {
    const quantity = Number(row.quantity || 0);
    const displayPrice = Number(row.displayPrice ?? row.livePrice ?? row.buyPrice ?? 0);
    const buyPrice = Number(row.buyPrice ?? 0);
    const currentValue = Number(row.currentValue ?? displayPrice * quantity);
    const invested = Number(row.totalInvested ?? buyPrice * quantity);
    const netValue = Number(row.netPositionValue ?? currentValue);
    const costBasis = Number(row.costBasisTotal ?? invested);

    totalValue += currentValue;
    totalInvested += invested;
    totalQuantity += quantity;
    totalNetValue += netValue;
    totalCostBasis += costBasis;

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

  const totalProfitEuro = totalValue - totalInvested;
  const totalRoiPercent =
    totalInvested > 0 ? (totalProfitEuro / totalInvested) * 100 : 0;
  const totalNetProfitEuro = totalNetValue - totalCostBasis;
  const totalNetRoiPercent =
    totalCostBasis > 0 ? (totalNetProfitEuro / totalCostBasis) * 100 : 0;
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
  return String(row.marketHashName || row.name || row.itemName || row.id || "")
    .trim()
    .toLowerCase();
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
      });
    }

    const group = groups.get(key);
    group.sourceInvestmentIds.push(row.id);
    group.quantity += quantity;
    group.totalInvestedUsd += totalCostUsd;
    group.totalInvested = group.totalInvestedUsd;

    if (!group.imageUrl && row.imageUrl) {
      group.imageUrl = row.imageUrl;
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
      purchaseClusters: group.purchaseClusters
        .map((entry) => ({
          ...entry,
          averageBuyPriceUsd: entry.quantity > 0 ? entry.totalCostUsd / entry.quantity : 0,
        }))
        .sort((a, b) => a.buyPriceUsd - b.buyPriceUsd),
    };
  });
}

function buildPortfolioComposition(rows = []) {
  const groups = new Map();
  let totalValue = 0;

  rows.forEach((row) => {
    const quantity = Number(row.quantity || 0);
    const displayPrice = Number(row.displayPrice ?? row.livePrice ?? row.buyPrice ?? 0);
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

async function fetchDesktopPortfolioData(options = {}) {
  const localStore = getDesktopLocalStore();
  const rawRows = unwrapLocalStoreResult(
    await localStore.listInvestments(options.userId),
    "local-store-list-investments",
  );
  const activeRows = rawRows.filter((row) => row?.excluded !== true);
  let rows = clusterDesktopInvestments(activeRows);
  let meta = {
    source: "desktop-local",
    rawInvestmentCount: rawRows.length,
    warnings: [],
  };

  // No server seeding - user must import from CS2 inventory first
  // Empty local DB means user hasn't imported items yet
  if (rows.length === 0) {
    meta.emptyReason = "no-items-imported";
    meta.message = "Import items from your CS2 inventory to get started";
  }

  const snapshots = unwrapLocalStoreResult(
    await localStore.listPortfolioSnapshots(options.userId, 365),
    "local-store-list-portfolio-snapshots",
  );
  let history = (Array.isArray(snapshots) ? snapshots : []).map((snapshot) => {
    const investedValue = Number(snapshot.investedValue || 0);
    const totalValue = Number(snapshot.wert || 0);
    return {
      date: snapshot.date,
      wert: totalValue,
      invested: investedValue,
      growthPercent: investedValue > 0 ? ((totalValue - investedValue) / investedValue) * 100 : 0,
    };
  });

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

  return {
    rows: {
      data: rows,
      meta,
    },
    summary: {
      data: calculatePortfolioSummary(rows),
      meta,
    },
    history,
  };
}

async function fetchApiPortfolioData(options = {}) {
  const [rows, summary, history] = await Promise.all([
    fetchApiPortfolioInvestments({ signal: options.signal }),
    fetchApiPortfolioSummary({ signal: options.signal }),
    fetchApiPortfolioHistory({ signal: options.signal }),
  ]);

  return {
    rows,
    summary,
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
  const userId = user?.id || options.userId;
  
  if (getDesktopLocalStore()) {
    return fetchDesktopPortfolioData({ ...options, userId });
  }

  return fetchApiPortfolioData(options);
}

export async function fetchPortfolioCompositionData() {
  const localStore = getDesktopLocalStore();
  if (!localStore) {
    return fetchApiPortfolioComposition();
  }

  const user = await getCurrentUser();
  const userId = user?.id || "local";
  const rawRows = unwrapLocalStoreResult(
    await localStore.listInvestments(userId),
    "local-store-list-investments",
  );
  const activeRows = rawRows.filter((row) => row?.excluded !== true);
  const clusteredRows = clusterDesktopInvestments(activeRows);
  return buildPortfolioComposition(clusteredRows);
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
  const userId = user?.id || options.userId;
  const localStore = getDesktopLocalStore();

  if (!localStore) {
    return fetchApiWatchlist(options);
  }

  let items = unwrapLocalStoreResult(
    await localStore.listWatchlist(userId),
    "local-store-list-watchlist",
  );
  let meta = {
    source: "desktop-local",
    warnings: [],
  };

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

  return unwrapLocalStoreResult(
    await localStore.upsertWatchlistItem({
      name,
      type,
    }),
    "local-store-upsert-watchlist-item",
  );
}

export async function deleteWatchlistItemData(id) {
  const localStore = getDesktopLocalStore();

  if (!localStore) {
    return deleteApiWatchlistItem(id);
  }

  return unwrapLocalStoreResult(
    await localStore.deleteWatchlistItem(id),
    "local-store-delete-watchlist-item",
  );
}
