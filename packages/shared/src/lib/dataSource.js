import {
  createWatchlistItem as createApiWatchlistItem,
  deleteWatchlistItem as deleteApiWatchlistItem,
  fetchPortfolioHistory as fetchApiPortfolioHistory,
  fetchPortfolioInvestments as fetchApiPortfolioInvestments,
  fetchPortfolioSummary as fetchApiPortfolioSummary,
  fetchWatchlist as fetchApiWatchlist,
} from "./apiClient.js";

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

async function fetchDesktopPortfolioData(options = {}) {
  const localStore = getDesktopLocalStore();
  let rows = await localStore.listInvestments(options.userId);
  let meta = {
    source: "desktop-local",
    warnings: [],
  };

  if (rows.length === 0) {
    const networkResponse = await fetchApiPortfolioInvestments({
      signal: options.signal,
    });
    const networkRows = networkResponse?.data || [];

    if (networkRows.length > 0) {
      await localStore.importInvestments(networkRows, options.userId);
      rows = await localStore.listInvestments(options.userId);
    }

    meta = {
      ...(networkResponse?.meta || {}),
      source: "desktop-seeded",
      seeded: networkRows.length,
    };
  }

  let history = [];
  try {
    history = await fetchApiPortfolioHistory({ signal: options.signal });
  } catch (error) {
    console.warn("[dataSource] portfolio history unavailable", error);
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
  if (getDesktopLocalStore()) {
    return fetchDesktopPortfolioData(options);
  }

  return fetchApiPortfolioData(options);
}

export async function fetchWatchlistData(options = {}) {
  const localStore = getDesktopLocalStore();

  if (!localStore) {
    return fetchApiWatchlist(options);
  }

  let items = await localStore.listWatchlist(options.userId);
  let meta = {
    source: "desktop-local",
    warnings: [],
  };

  if (items.length === 0) {
    const networkResponse = await fetchApiWatchlist({
      syncLive: options.syncLive,
    });
    const networkItems = networkResponse?.data || [];

    if (networkItems.length > 0) {
      await localStore.importWatchlist(networkItems, options.userId);
      items = await localStore.listWatchlist(options.userId);
    }

    meta = {
      ...(networkResponse?.meta || {}),
      source: "desktop-seeded",
      seeded: networkItems.length,
    };
  }

  return {
    data: items,
    meta,
  };
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
