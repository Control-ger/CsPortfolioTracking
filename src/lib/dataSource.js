import {
  createWatchlistItem as createApiWatchlistItem,
  deleteWatchlistItem as deleteApiWatchlistItem,
  fetchPortfolioComposition as fetchApiPortfolioComposition,
  fetchPortfolioInvestmentHistory as fetchApiPortfolioInvestmentHistory,
  fetchPortfolioHistory as fetchApiPortfolioHistory,
  fetchPortfolioInvestments as fetchApiPortfolioInvestments,
  fetchPortfolioSummary as fetchApiPortfolioSummary,
  fetchWatchlist as fetchApiWatchlist,
  searchWatchlistItems as searchApiWatchlistItems,
} from "@shared/lib/apiClient.js";

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

function normalizeUserId(userId) {
  return String(userId || "local");
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

function resolveNumericValue(...values) {
  for (const value of values) {
    const nextValue = Number(value);
    if (Number.isFinite(nextValue)) {
      return nextValue;
    }
  }

  return 0;
}

function getEntityName(row) {
  return String(
    row?.name ||
      row?.marketHashName ||
      row?.market_hash_name ||
      row?.itemName ||
      row?.title ||
      "Unbekannt",
  );
}

function resolvePortfolioValue(row) {
  const quantity = resolveNumericValue(row?.quantity, row?.count, 1);
  const directValue = resolveNumericValue(
    row?.currentValue,
    row?.netPositionValue,
    row?.totalValue,
    row?.value,
  );

  if (directValue > 0) {
    return directValue;
  }

  const pricePerItem = resolveNumericValue(
    row?.displayPrice,
    row?.livePrice,
    row?.currentPrice,
    row?.buyPrice,
    row?.buyPriceUsd,
    row?.priceUsd,
  );

  return pricePerItem > 0 ? pricePerItem * quantity : 0;
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
    const quantity = resolveNumericValue(row.quantity, 0);
    const displayPrice = resolveNumericValue(
      row.displayPrice,
      row.livePrice,
      row.buyPrice,
      row.buyPriceUsd,
      row.priceUsd,
    );
    const buyPrice = resolveNumericValue(row.buyPrice, row.buyPriceUsd);
    const currentValue = resolveNumericValue(row.currentValue, displayPrice * quantity);
    const invested = resolveNumericValue(row.totalInvested, buyPrice * quantity);
    const netValue = resolveNumericValue(row.netPositionValue, currentValue);
    const costBasis = resolveNumericValue(row.costBasisTotal, invested);

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
  const totalRoiPercent = totalInvested > 0 ? (totalProfitEuro / totalInvested) * 100 : 0;
  const totalNetProfitEuro = totalNetValue - totalCostBasis;
  const totalNetRoiPercent = totalCostBasis > 0 ? (totalNetProfitEuro / totalCostBasis) * 100 : 0;
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

function buildCompositionFromRows(rows = []) {
  const groups = new Map();

  rows.forEach((row) => {
    const value = resolvePortfolioValue(row);
    if (value <= 0) {
      return;
    }

    const name = getEntityName(row);
    const key = name.toLowerCase();
    const quantity = resolveNumericValue(row?.quantity, 1);
    const current = groups.get(key) || { name, value: 0, count: 0 };
    current.value += value;
    current.count += quantity;
    groups.set(key, current);
  });

  const composition = Array.from(groups.values()).sort((left, right) => right.value - left.value);
  const totalValue = composition.reduce((sum, entry) => sum + entry.value, 0);

  return composition.map((entry) => ({
    ...entry,
    percentage: totalValue > 0 ? (entry.value / totalValue) * 100 : 0,
  }));
}

function mapSnapshot(row) {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.captured_at,
    wert: resolveNumericValue(row.total_value_usd),
    investedValue: resolveNumericValue(row.invested_value_usd),
    payload:
      row.payload && typeof row.payload === "object"
        ? row.payload
        : (() => {
            try {
              return row.payload ? JSON.parse(row.payload) : {};
            } catch (error) {
              console.warn("[dataSource] failed to parse portfolio snapshot payload", error);
              return {};
            }
          })(),
    capturedAt: row.captured_at,
  };
}

function buildHistoryFromRows(rows = []) {
  const totalValue = rows.reduce((sum, row) => sum + resolvePortfolioValue(row), 0);
  if (totalValue <= 0) {
    return [];
  }

  return [
    {
      id: "local-current",
      date: new Date().toISOString(),
      wert: totalValue,
      growthPercent: 0,
    },
  ];
}

function buildHistoryFromSnapshots(snapshots = []) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return [];
  }

  const orderedSnapshots = [...snapshots].sort((left, right) => {
    return new Date(left.capturedAt || left.date || 0).getTime() - new Date(right.capturedAt || right.date || 0).getTime();
  });

  const firstValue = resolveNumericValue(orderedSnapshots[0]?.wert, orderedSnapshots[0]?.value);

  return orderedSnapshots
    .map((snapshot) => {
      const value = resolveNumericValue(snapshot.wert, snapshot.value);
      const date = snapshot.date || snapshot.capturedAt || snapshot.updatedAt || "";

      if (!date || value <= 0) {
        return null;
      }

      return {
        id: snapshot.id || date,
        date,
        wert: value,
        growthPercent: firstValue > 0 ? ((value - firstValue) / firstValue) * 100 : 0,
      };
    })
    .filter(Boolean);
}

function buildItemHistoryFromSnapshots(snapshots = [], investmentId, itemName) {
  const targetId = String(investmentId || "");
  const targetName = String(itemName || "");
  const points = [];

  snapshots.forEach((snapshot) => {
    const payloadRows = Array.isArray(snapshot?.payload?.rows) ? snapshot.payload.rows : [];
    const matchingRow = payloadRows.find((row) => {
      const rowId = String(row?.id || row?.serverId || row?.itemId || "");
      const rowName = getEntityName(row);
      return (
        rowId === targetId ||
        rowName === targetName ||
        String(row?.marketHashName || "") === targetName ||
        String(row?.market_hash_name || "") === targetName
      );
    });

    if (!matchingRow) {
      return;
    }

    const value = resolvePortfolioValue(matchingRow);
    if (value <= 0) {
      return;
    }

    points.push({
      id: snapshot.id || snapshot.capturedAt || snapshot.date,
      date: snapshot.capturedAt || snapshot.date || snapshot.updatedAt || "",
      wert: value,
    });
  });

  if (points.length === 0) {
    return [];
  }

  const firstValue = points[0].wert;
  return points.map((point) => ({
    ...point,
    growthPercent: firstValue > 0 ? ((point.wert - firstValue) / firstValue) * 100 : 0,
  }));
}

async function loadDesktopInvestments(localStore, userId, options = {}) {
  const normalizedUserId = normalizeUserId(userId);
  let rows = await localStore.listInvestments(normalizedUserId);
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
      await localStore.importInvestments(networkRows, normalizedUserId);
      rows = await localStore.listInvestments(normalizedUserId);
    }

    meta = {
      ...(networkResponse?.meta || {}),
      source: "desktop-seeded",
      seeded: networkRows.length,
    };
  }

  return { rows, meta };
}

async function persistPortfolioSnapshot(localStore, userId, rows, summary) {
  if (!localStore?.upsertPortfolioSnapshot) {
    return null;
  }

  return localStore.upsertPortfolioSnapshot({
    userId: normalizeUserId(userId),
    totalValueUsd: summary.totalValue,
    investedValueUsd: summary.totalInvested,
    payload: {
      rows,
      summary,
    },
  });
}

async function fetchDesktopPortfolioData(options = {}) {
  const localStore = getDesktopLocalStore();
  const { rows, meta } = await loadDesktopInvestments(localStore, options.userId, options);
  const summary = calculatePortfolioSummary(rows);

  await persistPortfolioSnapshot(localStore, options.userId, rows, summary);

  let history = [];
  const localSnapshots = await localStore.listPortfolioSnapshots(normalizeUserId(options.userId));

  if (localSnapshots.length > 0) {
    history = buildHistoryFromSnapshots(localSnapshots.map(mapSnapshot));
  } else {
    try {
      history = await fetchApiPortfolioHistory({ signal: options.signal });
    } catch (error) {
      console.warn("[dataSource] portfolio history unavailable", error);
      history = buildHistoryFromRows(rows);
    }
  }

  return {
    rows: {
      data: rows,
      meta,
    },
    summary: {
      data: summary,
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

export async function fetchPortfolioComposition(options = {}) {
  if (getDesktopLocalStore()) {
    const localStore = getDesktopLocalStore();
    const { rows } = await loadDesktopInvestments(localStore, options.userId, options);
    return buildCompositionFromRows(rows);
  }

  try {
    const response = await fetchApiPortfolioComposition({ signal: options.signal });
    return response || [];
  } catch (error) {
    console.warn("[dataSource] portfolio composition unavailable", error);
    return [];
  }
}

export async function fetchPortfolioInvestmentHistory(id, options = {}) {
  const localStore = getDesktopLocalStore();

  if (localStore) {
    const normalizedUserId = normalizeUserId(options.userId);
    const snapshots = (await localStore.listPortfolioSnapshots(normalizedUserId)).map(mapSnapshot);
    const localHistory = buildItemHistoryFromSnapshots(snapshots, id, options.itemName);

    if (localHistory.length > 0) {
      return localHistory;
    }

    if (typeof localStore.getInvestment === "function") {
      const localInvestment = await localStore.getInvestment(id);
      if (localInvestment) {
        const syntheticValue = resolvePortfolioValue(localInvestment);
        if (syntheticValue > 0) {
          return [
            {
              id: localInvestment.id,
              date: localInvestment.updatedAt || new Date().toISOString(),
              wert: syntheticValue,
              growthPercent: 0,
            },
          ];
        }
      }
    }
  }

  try {
    return await fetchApiPortfolioInvestmentHistory(id, options);
  } catch (error) {
    console.warn("[dataSource] portfolio investment history unavailable", error);
    return [];
  }
}

export async function fetchWatchlistData(options = {}) {
  const localStore = getDesktopLocalStore();

  if (!localStore) {
    return fetchApiWatchlist(options);
  }

  const normalizedUserId = normalizeUserId(options.userId);
  let items = await localStore.listWatchlist(normalizedUserId);
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
      await localStore.importWatchlist(networkItems, normalizedUserId);
      items = await localStore.listWatchlist(normalizedUserId);
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

export async function searchWatchlistItemsData(query, filters = {}, limit = 6, page = 1) {
  return searchApiWatchlistItems(query, filters, limit, page);
}


