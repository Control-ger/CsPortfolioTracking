import {
  createWatchlistItem as createApiWatchlistItem,
  deleteWatchlistItem as deleteApiWatchlistItem,
  fetchPortfolioHistory as fetchApiPortfolioHistory,
  fetchPortfolioInvestments as fetchApiPortfolioInvestments,
  fetchPortfolioSummary as fetchApiPortfolioSummary,
  fetchWatchlist as fetchApiWatchlist,
} from "./apiClient.js";

import { getCurrentUser, isAuthenticated } from "./auth.js";

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
        buyPrice,
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

async function fetchDesktopPortfolioData(options = {}) {
  const localStore = getDesktopLocalStore();
  const rawRows = await localStore.listInvestments(options.userId);
  let rows = clusterDesktopInvestments(rawRows);
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

  // History is only available from server - skip for now
  let history = [];

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

  let items = await localStore.listWatchlist(userId);
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

  return localStore.upsertWatchlistItem({
    name,
    type,
  });
}

export async function deleteWatchlistItemData(id) {
  const localStore = getDesktopLocalStore();

  if (!localStore) {
    return deleteApiWatchlistItem(id);
  }

  return localStore.deleteWatchlistItem(id);
}
