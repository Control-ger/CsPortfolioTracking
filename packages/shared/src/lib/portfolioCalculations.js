import { translate } from "./i18n/index.js";
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

/**
 * Category *key* per importer-supplied `type`, for the mobile allocation bar.
 *
 * Keys, not labels: the label is looked up per language at render time, and the
 * singular form used to be keyed by the German plural ("Skins" → "Skin"), which
 * silently broke the moment the plural was translated.
 *
 * Fallback only — see `resolveItemCategoryKey`. `investments.type` is supplied
 * by whichever importer created the row and defaults to `"skin"`, so it says
 * "skin" for Fever Case and "case" for Kilowatt Case in the same portfolio.
 */
const ALLOCATION_KEYS = {
  skin: "skins",
  case: "cases",
  souvenir_package: "cases",
  container: "cases",
  sticker: "stickers",
  patch: "stickers",
  graffiti: "stickers",
  charm: "stickers",
  agent: "agents",
  sticker_capsule: "capsules",
};

/**
 * Label per `MarketItemClassifier` key (`catalogItemType`), the catalogue's own
 * authoritative kind. These are item kinds, not weapon classes: every weapon
 * skin is one category, because "Rifles / SMGs / Pistolen" splits the same kind
 * of asset into slices that answer no question the dashboard is asking.
 */
const CATALOG_TYPE_ALLOCATION_KEYS = {
  skin: "skins",
  case: "cases",
  container: "cases",
  sticker_capsule: "capsules",
  souvenir_package: "souvenirPackages",
  sticker: "stickers",
  patch: "patches",
  graffiti: "graffiti",
  agent: "agents",
  charm: "charms",
  music_kit: "musicKits",
  key: "keys",
  tool: "tools",
};

/**
 * Fallback kind, matched against the tail noun of `marketTypeLabel`
 * ("Base Grade Container", "Classified Sniper Rifle", "Exotic Sticker").
 *
 * Coarser than the catalogue key by necessity: Steam types cases, capsules and
 * souvenir packages all as "Container", so this path cannot tell them apart and
 * calls all three "Cases". Every weapon class collapses into "Skins".
 */
const MARKET_TYPE_ALLOCATION_RULES = [
  [/\b(container|case|capsule|package)\b/i, "cases"],
  [/\bsticker\b/i, "stickers"],
  [/\bpatch\b/i, "patches"],
  [/\bgraffiti\b/i, "graffiti"],
  [/\bagent\b/i, "agents"],
  [/\bcharm\b/i, "charms"],
  [/\bmusic kit\b/i, "musicKits"],
  [/\b(rifle|smg|pistol|shotgun|machinegun|knife|knives|bayonet|karambit|gloves|hand wraps|equipment)\b/i, "skins"],
];

/**
 * Catalogue category for a portfolio row — the allocation bar's grouping, the
 * inventory card's type chip and the inventory category filter all use this, so
 * the three cannot disagree about what an item is.
 *
 * Never `row.type`: that is importer-supplied and defaults to `"skin"`, so one
 * real portfolio carried `"skin"` for Fever Case and `"case"` for Kilowatt Case
 * and the bar rendered 94 % containers as "Skins · 100 %".
 *
 * Preference order is authority order — the catalogue's own classifier key
 * first, the Steam market type second, the importer's guess only as a last
 * resort. `catalogItemType` needs a server that returns it; until that ships,
 * the `marketTypeLabel` path produces the same labels except that cases,
 * capsules and souvenir packages all land in "Cases".
 */
export function resolveItemCategoryKey(row) {
  const catalogType = String(row?.catalogItemType || "").trim().toLowerCase();
  if (catalogType && CATALOG_TYPE_ALLOCATION_KEYS[catalogType]) {
    return CATALOG_TYPE_ALLOCATION_KEYS[catalogType];
  }

  const marketType = String(row?.marketTypeLabel || "").trim();
  if (marketType) {
    const rule = MARKET_TYPE_ALLOCATION_RULES.find(([pattern]) => pattern.test(marketType));
    if (rule) {
      return rule[1];
    }
  }

  return ALLOCATION_KEYS[String(row?.type || "").trim().toLowerCase()] || "other";
}

/** Plural label for the resolved category, in the active language. */
export function resolveItemCategory(row) {
  return translate(`inventory:category.${resolveItemCategoryKey(row)}`);
}

/** Categories shown before the tail is folded into one "Sonstige" slice. */
const ALLOCATION_MAX_CATEGORIES = 6;

/**
 * Value share per category, largest first, for the stacked allocation bar.
 *
 * Deliberately not `buildPortfolioComposition`: that one groups by item, which
 * is what the desktop donut wants but renders as thousands of hairline slivers
 * in an 11px bar.
 */
export function buildPortfolioAllocationByType(rows = [], options = {}) {
  const scopedRows = filterRowsByScope(Array.isArray(rows) ? rows : [], options.scope)
    .filter((row) => !isExcludedRow(row))
    .map(enforceCsfloatOnlyRow);

  const groups = new Map();
  let totalValue = 0;

  scopedRows.forEach((row) => {
    const quantity = Number(row.quantity || 0);
    const displayPrice = Number(row.displayPrice ?? row.livePrice ?? 0);
    const currentValue = Number(row.currentValue ?? displayPrice * quantity);
    if (!Number.isFinite(currentValue) || currentValue <= 0) {
      return;
    }
    totalValue += currentValue;
    const label = resolveItemCategory(row);
    groups.set(label, (groups.get(label) || 0) + currentValue);
  });

  if (totalValue <= 0) {
    return [];
  }

  const ranked = Array.from(groups.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // A real portfolio produces a long tail of sub-percent classes. Left alone
  // they render as invisible slivers with a legend entry each, which is the
  // clutter the "Sticker · 0,0 %" row came from. One "Sonstige" slice keeps the
  // shares honest without a legend that outgrows the bar.
  const head = ranked.slice(0, ALLOCATION_MAX_CATEGORIES);
  const tail = ranked.slice(ALLOCATION_MAX_CATEGORIES);
  if (tail.length > 0) {
    head.push({
      label: translate("inventory:category.other"),
      value: tail.reduce((sum, entry) => sum + entry.value, 0),
    });
  }

  return head.map((entry) => ({
    ...entry,
    percentage: Number(((entry.value / totalValue) * 100).toFixed(1)),
  }));
}

/**
 * Biggest 7-day movers among the held positions.
 *
 * `change7dPercent` rides in on every row from `PortfolioService`, so this is a
 * selection, not a calculation. Rows without one are dropped rather than
 * treated as flat — a missing history and a 0 % week are not the same thing,
 * and counting the former as the latter would bury real movers under ties.
 */
export function selectPortfolioMovers(rows = [], options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : 3;
  const scopedRows = filterRowsByScope(Array.isArray(rows) ? rows : [], options.scope)
    .filter((row) => !isExcludedRow(row));

  const withChange = scopedRows
    .map((row) => ({
      id: row.id ?? row.itemId ?? row.marketHashName ?? row.name,
      name: row.name || row.marketHashName || translate("inventory:detail.unknown"),
      changePercent: Number(row.change7dPercent),
    }))
    .filter((entry) => Number.isFinite(entry.changePercent) && entry.changePercent !== 0);

  const sorted = withChange.slice().sort((a, b) => b.changePercent - a.changePercent);
  return {
    gainers: sorted.filter((entry) => entry.changePercent > 0).slice(0, limit),
    losers: sorted
      .filter((entry) => entry.changePercent < 0)
      .slice(-limit)
      .reverse(),
    sourceCount: withChange.length,
  };
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

/**
 * Singular form, for a chip that labels one row rather than a bucket.
 *
 * Resolved from the same key as the plural. It used to be a map keyed by the
 * German plural label, which meant the singular silently fell back to the
 * plural for every language whose plural was not literally "Skins".
 */
export function resolveItemCategorySingular(row) {
  return translate(`inventory:categorySingular.${resolveItemCategoryKey(row)}`);
}
