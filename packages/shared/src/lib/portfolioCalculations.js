/**
 * Portfolio calculation helpers extracted from dataSource.js.
 * Pure functions for summary, grouping, clustering, composition.
 */

export const DEFAULT_STATS = {
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

export function resolveRowBucket(row) {
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

export function filterRowsByScope(rows = [], scope = "investments") {
  const normalizedScope = String(scope || "").toLowerCase();
  if (normalizedScope === "all") {
    return rows;
  }

  return rows.filter((row) => resolveRowBucket(row) === "investment");
}

export function toBooleanFlag(value) {
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

export function normalizeOverpayFloor(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Number(parsed.toFixed(2));
}

export function normalizePriceSource(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function enforceCsfloatOnlyRow(row) {
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

export function calculatePortfolioSummary(rows = []) {
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

export function getInvestmentGroupKey(row) {
  const bucket = resolveRowBucket(row);
  const nameKey = String(row.marketHashName || row.name || row.itemName || row.id || "")
    .trim()
    .toLowerCase();
  return `${bucket}:${nameKey}`;
}

export function getInvestmentGroupKeyWithoutBucket(row) {
  return String(row.marketHashName || row.name || row.itemName || row.id || "")
    .trim()
    .toLowerCase();
}

export function getInvestmentItemIdKey(row) {
  const bucket = resolveRowBucket(row);
  const itemId = Number(row?.itemId ?? row?.item_id ?? 0);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return "";
  }
  return `${bucket}:item:${Math.floor(itemId)}`;
}

export function getInvestmentItemIdKeyWithoutBucket(row) {
  const itemId = Number(row?.itemId ?? row?.item_id ?? 0);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return "";
  }
  return `item:${Math.floor(itemId)}`;
}

export function clusterDesktopInvestments(rows = []) {
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

export function isExcludedRow(row) {
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

export function buildPortfolioHistoryFromSnapshots(snapshots = []) {
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
