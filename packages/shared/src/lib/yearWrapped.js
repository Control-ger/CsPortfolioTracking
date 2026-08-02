/**
 * Year Wrapped statistics.
 *
 * Pure functions in the spirit of portfolioCalculations.js: no IO, no React.
 * Every stat block carries its own `available` flag so the story shell can drop
 * slides that have no data instead of rendering empty panels.
 *
 * Input contract (desktop only):
 * - `rawInvestments`: un-clustered local rows from localStore.listInvestments().
 *   Clustered rows (clusterDesktopInvestments / the server's name aggregation)
 *   must not be used here — they collapse rows by name and drop the per-purchase
 *   dates that every buy-related stat depends on.
 * - `portfolioHistory`: daily `{date, wert, invested, growthPercent}` entries (USD).
 * - `enrichedInvestments`: current valuation rows (clustered is fine here).
 * - `watchlistItems`: local watchlist rows with `createdAt`.
 */

import { isExcludedRow } from "./portfolioCalculations.js";
import { getItemNameKey } from "./portfolioHelpers.js";

export const WRAPPED_SEASON_START_MONTH = 11; // December
export const WRAPPED_SEASON_START_DAY = 15;

export const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
];

const PLATFORM_LABELS = {
  csfloat: "CSFloat",
  skinbaron: "SkinBaron",
  steam_inventory: "Steam Inventar",
  other: "Sonstige",
};

/**
 * Decide whether the seasonal entry point is live and which year it covers.
 *
 * Dec 15-31 -> the year that is about to end. January -> the year that just
 * ended. Outside the window `active` is false, but `year` still names the last
 * completed year so a direct URL without `?year=` has a sensible default.
 */
export function resolveWrappedSeason(now = new Date()) {
  const reference = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const month = reference.getMonth();
  const day = reference.getDate();
  const year = reference.getFullYear();

  if (month === WRAPPED_SEASON_START_MONTH && day >= WRAPPED_SEASON_START_DAY) {
    return { active: true, year };
  }

  if (month === 0) {
    return { active: true, year: year - 1 };
  }

  return { active: false, year: year - 1 };
}

/**
 * Resolve the timestamp a local investment row should be counted under.
 *
 * `purchasedAt` is set by the CSFloat/SkinBaron import paths. Steam inventory
 * rows and older entries only carry `importedAt` or the row's `created_at`, so
 * fall through instead of dropping them.
 */
export function resolveInvestmentDate(row) {
  const candidates = [row?.purchasedAt, row?.importedAt, row?.createdAt];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const timestamp = Date.parse(String(candidate));
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp);
    }
  }
  return null;
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolvePlatformKey(row) {
  const raw = String(row?.platform || row?.source || "")
    .trim()
    .toLowerCase();
  if (raw === "csfloat" || raw === "skinbaron" || raw === "steam_inventory") {
    return raw;
  }
  return "other";
}

function resolveRowSpendUsd(row) {
  const unitPrice = toFiniteNumber(row?.buyPriceUsd ?? row?.buyPrice, 0);
  const quantity = Math.max(1, toFiniteNumber(row?.quantity, 1));
  return unitPrice * quantity;
}

function parseHistoryDate(entry) {
  const timestamp = Date.parse(String(entry?.date || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function buildPurchaseStats(datedRows, undatedCount) {
  const count = datedRows.length;
  const totalSpentUsd = datedRows.reduce((sum, entry) => sum + entry.spendUsd, 0);
  const totalQuantity = datedRows.reduce((sum, entry) => sum + entry.quantity, 0);

  return {
    available: count > 0,
    count,
    totalQuantity,
    totalSpentUsd,
    avgBuyPriceUsd: totalQuantity > 0 ? totalSpentUsd / totalQuantity : 0,
    undatedCount,
  };
}

function buildMonthlyStats(datedRows) {
  const buckets = MONTH_LABELS.map((label, index) => ({
    month: index,
    label,
    count: 0,
    spentUsd: 0,
  }));

  datedRows.forEach((entry) => {
    const bucket = buckets[entry.date.getMonth()];
    bucket.count += 1;
    bucket.spentUsd += entry.spendUsd;
  });

  const peakMonth = buckets.reduce(
    (best, bucket) => (bucket.count > (best?.count || 0) ? bucket : best),
    null,
  );

  return {
    available: datedRows.length > 0 && Boolean(peakMonth) && peakMonth.count > 0,
    buckets,
    peakMonth,
  };
}

function buildHighlightStats(datedRows) {
  const byName = new Map();

  datedRows.forEach((entry) => {
    const key = getItemNameKey(entry.row) || String(entry.row?.id || "");
    if (!byName.has(key)) {
      byName.set(key, {
        name: entry.row?.name || entry.row?.marketHashName || "Unbekanntes Item",
        imageUrl: entry.row?.imageUrl || null,
        count: 0,
        spentUsd: 0,
      });
    }
    const group = byName.get(key);
    group.count += entry.quantity;
    group.spentUsd += entry.spendUsd;
    if (!group.imageUrl && entry.row?.imageUrl) {
      group.imageUrl = entry.row.imageUrl;
    }
  });

  const mostBoughtItem = Array.from(byName.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return b.spentUsd - a.spentUsd;
  })[0] || null;

  const mostExpensiveEntry = datedRows.reduce(
    (best, entry) => (entry.spendUsd > (best?.spendUsd ?? -Infinity) ? entry : best),
    null,
  );

  const mostExpensivePurchase = mostExpensiveEntry
    ? {
        name: mostExpensiveEntry.row?.name || mostExpensiveEntry.row?.marketHashName || "Unbekanntes Item",
        imageUrl: mostExpensiveEntry.row?.imageUrl || null,
        spentUsd: mostExpensiveEntry.spendUsd,
        quantity: mostExpensiveEntry.quantity,
        date: mostExpensiveEntry.date.toISOString(),
      }
    : null;

  return {
    available: Boolean(mostBoughtItem) || Boolean(mostExpensivePurchase),
    mostBoughtItem,
    mostExpensivePurchase,
  };
}

function buildPlatformStats(datedRows) {
  const groups = new Map();

  datedRows.forEach((entry) => {
    const key = resolvePlatformKey(entry.row);
    if (!groups.has(key)) {
      groups.set(key, { key, label: PLATFORM_LABELS[key], count: 0, spentUsd: 0 });
    }
    const group = groups.get(key);
    group.count += 1;
    group.spentUsd += entry.spendUsd;
  });

  const entries = Array.from(groups.values()).sort((a, b) => b.count - a.count);
  const totalCount = entries.reduce((sum, entry) => sum + entry.count, 0);

  return {
    available: entries.length > 0,
    entries: entries.map((entry) => ({
      ...entry,
      percentage: totalCount > 0 ? (entry.count / totalCount) * 100 : 0,
    })),
    totalCount,
  };
}

function buildCurveStats(portfolioHistory, year) {
  const points = (Array.isArray(portfolioHistory) ? portfolioHistory : [])
    .map((entry) => {
      const date = parseHistoryDate(entry);
      if (!date || date.getFullYear() !== year) {
        return null;
      }
      return {
        date: entry.date,
        timestamp: date.getTime(),
        wert: toFiniteNumber(entry.wert, 0),
        invested: toFiniteNumber(entry.invested, 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (points.length < 2) {
    return { available: false, points, firstValue: 0, lastValue: 0, deltaUsd: 0, deltaPercent: 0, coverageFrom: null, coverageTo: null };
  }

  const firstValue = points[0].wert;
  const lastValue = points[points.length - 1].wert;
  const deltaUsd = lastValue - firstValue;

  return {
    available: true,
    points,
    firstValue,
    lastValue,
    deltaUsd,
    deltaPercent: firstValue > 0 ? (deltaUsd / firstValue) * 100 : 0,
    coverageFrom: points[0].date,
    coverageTo: points[points.length - 1].date,
  };
}

function buildExtremeStats(curve) {
  if (!curve.available) {
    return { available: false, bestDay: null, worstDay: null };
  }

  let bestDay = null;
  let worstDay = null;

  for (let index = 1; index < curve.points.length; index += 1) {
    const previous = curve.points[index - 1];
    const current = curve.points[index];
    const deltaUsd = current.wert - previous.wert;
    const candidate = {
      date: current.date,
      deltaUsd,
      deltaPercent: previous.wert > 0 ? (deltaUsd / previous.wert) * 100 : 0,
      valueUsd: current.wert,
    };

    if (!bestDay || candidate.deltaUsd > bestDay.deltaUsd) {
      bestDay = candidate;
    }
    if (!worstDay || candidate.deltaUsd < worstDay.deltaUsd) {
      worstDay = candidate;
    }
  }

  return {
    available: Boolean(bestDay) && Boolean(worstDay),
    bestDay,
    worstDay,
  };
}

function buildPerformerStats(enrichedInvestments) {
  const rows = (Array.isArray(enrichedInvestments) ? enrichedInvestments : []).filter(
    (row) => !isExcludedRow(row) && Number.isFinite(Number(row?.roi)),
  );

  if (rows.length === 0) {
    return { available: false, best: null, worst: null };
  }

  const mapRow = (row) => ({
    name: row?.name || row?.marketHashName || "Unbekanntes Item",
    imageUrl: row?.imageUrl || null,
    roi: toFiniteNumber(row?.roi, 0),
    profitUsd: toFiniteNumber(row?.profitEuro, 0),
    currentValueUsd: toFiniteNumber(row?.currentValue, 0),
  });

  const sorted = [...rows].sort((a, b) => toFiniteNumber(b?.roi, 0) - toFiniteNumber(a?.roi, 0));
  const best = mapRow(sorted[0]);
  const worst = mapRow(sorted[sorted.length - 1]);

  return {
    available: sorted.length > 1 && best.roi !== worst.roi,
    best,
    worst,
  };
}

function buildWatchlistStats(watchlistItems, year) {
  const items = Array.isArray(watchlistItems) ? watchlistItems : [];
  const buckets = MONTH_LABELS.map((label, index) => ({ month: index, label, count: 0 }));
  let addedCount = 0;

  items.forEach((item) => {
    const timestamp = Date.parse(String(item?.createdAt || ""));
    if (!Number.isFinite(timestamp)) {
      return;
    }
    const date = new Date(timestamp);
    if (date.getFullYear() !== year) {
      return;
    }
    addedCount += 1;
    buckets[date.getMonth()].count += 1;
  });

  const peakMonth = buckets.reduce(
    (best, bucket) => (bucket.count > (best?.count || 0) ? bucket : best),
    null,
  );

  return {
    available: addedCount > 0,
    addedCount,
    totalCount: items.length,
    buckets,
    peakMonth: peakMonth && peakMonth.count > 0 ? peakMonth : null,
  };
}

export function buildYearWrappedStats({
  rawInvestments = [],
  portfolioHistory = [],
  enrichedInvestments = [],
  watchlistItems = [],
  year,
} = {}) {
  const targetYear = Number.isFinite(Number(year)) ? Number(year) : new Date().getFullYear();
  // Raw local rows still contain excluded positions (that is the price of not
  // going through the filtered view model), so drop them here. An excluded
  // position is one the user has taken out of the portfolio — counting it as a
  // purchase would inflate every spend figure and can hand "most expensive buy"
  // to an item the user no longer considers theirs.
  const rows = (Array.isArray(rawInvestments) ? rawInvestments : []).filter(
    (row) => !isExcludedRow(row),
  );

  let undatedCount = 0;
  const datedRows = [];

  rows.forEach((row) => {
    const date = resolveInvestmentDate(row);
    if (!date) {
      undatedCount += 1;
      return;
    }
    if (date.getFullYear() !== targetYear) {
      return;
    }
    datedRows.push({
      row,
      date,
      quantity: Math.max(1, toFiniteNumber(row?.quantity, 1)),
      spendUsd: resolveRowSpendUsd(row),
    });
  });

  const curve = buildCurveStats(portfolioHistory, targetYear);

  return {
    year: targetYear,
    purchases: buildPurchaseStats(datedRows, undatedCount),
    monthly: buildMonthlyStats(datedRows),
    highlights: buildHighlightStats(datedRows),
    platforms: buildPlatformStats(datedRows),
    curve,
    extremes: buildExtremeStats(curve),
    performers: buildPerformerStats(enrichedInvestments),
    watchlist: buildWatchlistStats(watchlistItems, targetYear),
  };
}
