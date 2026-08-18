import { getActiveIntlLocale, translate } from "./i18n/index.js";

/**
 * Shared utility functions extracted from PortfolioPage.jsx
 * for use across PortfolioPage section components.
 */

/**
 * Signed percentage, with the minus as U+2212 like every other figure on the
 * dashboard.
 *
 * The decimal separator comes from `Intl`, not from a `.replace(".", ",")` —
 * that swap was applied unconditionally in eight places and printed German
 * commas into an English UI.
 */
export function formatSignedPercent(value, decimals = 1) {
  const number = Number(value) || 0;
  const magnitude = new Intl.NumberFormat(getActiveIntlLocale(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(number));
  return `${number >= 0 ? "+" : "−"}${magnitude} %`;
}

/**
 * Plain number in the active locale's format. Use instead of `toFixed`, which
 * always emits a `.` decimal point regardless of locale.
 */
export function formatNumber(value, decimals = 1) {
  return new Intl.NumberFormat(getActiveIntlLocale(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value) || 0);
}

/** Unsigned percentage in the active locale's number format. */
export function formatPercent(value, decimals = 1) {
  return `${new Intl.NumberFormat(getActiveIntlLocale(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value) || 0)} %`;
}

/**
 * Format seconds into a human-readable age string (e.g., "5m", "2h", "3d").
 */
export function formatAge(seconds) {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) {
    return translate("common:units.notAvailable");
  }

  if (seconds < 60) {
    return translate("common:units.secondsShort", { count: seconds });
  }

  if (seconds < 3600) {
    return translate("common:units.minutesShort", { count: Math.floor(seconds / 60) });
  }

  if (seconds < 86400) {
    return translate("common:units.hoursShort", { count: Math.floor(seconds / 3600) });
  }

  // The day suffix is the one unit that actually differs: "d" in English,
  // "T" in German.
  return translate("common:units.daysShort", { count: Math.floor(seconds / 86400) });
}

/**
 * Return a Tailwind class string for the sync health badge based on oldest data age.
 */
export function syncHealthBadgeClass(oldestAgeSeconds, liveItemsCount) {
  if (!Number.isFinite(liveItemsCount) || liveItemsCount <= 0) {
    return "border-slate-500/35 bg-slate-500/12 text-slate-300";
  }

  if (!Number.isFinite(oldestAgeSeconds)) {
    return "border-slate-500/35 bg-slate-500/12 text-slate-300";
  }

  if (oldestAgeSeconds <= 90 * 60) {
    return "border-emerald-400/35 bg-emerald-500/12 text-emerald-300";
  }

  if (oldestAgeSeconds <= 3 * 60 * 60) {
    return "border-amber-400/35 bg-amber-500/12 text-amber-300";
  }

  return "border-red-400/35 bg-red-500/12 text-red-300";
}

/**
 * Compute the most recent update timestamp across all positions in a cluster.
 */
export function getClusterUpdatedAt(cluster) {
  return cluster.positions.reduce((latest, position) => {
    const timestamp = Date.parse(String(position.updatedAt || position.purchasedAt || ""));
    if (!Number.isFinite(timestamp)) {
      return latest;
    }
    return Math.max(latest, timestamp);
  }, 0);
}

/**
 * Return a human-readable label for the sync health state.
 */
export function syncHealthLabel(oldestAgeSeconds, liveItemsCount) {
  if (!Number.isFinite(liveItemsCount) || liveItemsCount <= 0) {
    return translate("common:syncHealth.noLiveQuotes");
  }

  if (!Number.isFinite(oldestAgeSeconds)) {
    return translate("common:syncHealth.unknown");
  }

  if (oldestAgeSeconds <= 90 * 60) {
    return translate("common:syncHealth.onSchedule");
  }

  if (oldestAgeSeconds <= 3 * 60 * 60) {
    return translate("common:syncHealth.delayed");
  }

  return translate("common:syncHealth.lagging");
}

/**
 * Format a number of hours into a short relative time string (e.g., "<1h", "5h").
 */
export function formatRelativeHours(hours) {
  if (!Number.isFinite(hours)) {
    return translate("common:units.unknown");
  }

  if (hours < 1) {
    return translate("common:units.underOneHour");
  }

  return translate("common:units.hoursShort", { count: Math.max(1, Math.round(hours)) });
}

/**
 * Format a date value into a short date string in the active locale.
 */
export function formatDateSafe(value) {
  if (!value) {
    return translate("common:units.notAvailable");
  }
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) {
    return String(value);
  }
  return new Date(timestamp).toLocaleDateString(getActiveIntlLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * USD value of a price-history entry.
 *
 * The same series reaches the frontend under several key spellings depending on
 * the path it took (server DTO, desktop merge, sidecar proxy). Internal unit is
 * USD — `priceEur` is deliberately NOT a fallback, because silently mixing
 * currencies on one axis is worse than a gap.
 *
 * Shared by PortfolioChart and the watchlist sparkline so the two cannot
 * disagree about whether a row has history.
 */
export function resolveHistoryValueUsd(entry) {
  return (
    entry?.priceUsd ?? entry?.price_usd ?? entry?.valueUsd ?? entry?.wert ?? entry?.value
  );
}

/**
 * Timestamp of a price-history entry's `date`.
 *
 * A bare `YYYY-MM-DD` is pinned to local midnight rather than parsed as UTC, so
 * a day bucket lands on the day the user sees. `YYYY-MM-DD HH:MM:SS` (the MySQL
 * spelling) is normalised to ISO first, because Safari rejects the space form.
 */
export function parseHistoryTimestamp(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const localTimestamp = new Date(`${value}T00:00:00`).getTime();
    return Number.isNaN(localTimestamp) ? null : localTimestamp;
  }

  const normalizedValue =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(value)
      ? value.replace(" ", "T")
      : value;

  const timestamp = new Date(normalizedValue).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

/**
 * Percent change of a price series over the trailing `days` window.
 *
 * The watchlist API only ships a 7-day change (`priceChangePercent`), but the
 * design's table wants 24h / 7T / 30T. All three are derived here from the one
 * `priceHistory` the row already carries, so the three columns are guaranteed
 * mutually consistent rather than mixing a server number with local ones.
 *
 * Returns `null` when the series cannot honestly answer for that window: fewer
 * than two samples, a non-positive baseline, or a series that does not reach
 * far enough back (a "30T" computed over 9 days of data is a wrong number, not
 * an approximate one). The 20% slack absorbs a missing cron run at the edge.
 */
export function resolveHistoryChangePercent(history, days) {
  const rows = (Array.isArray(history) ? history : [])
    .map((entry) => ({
      ts: parseHistoryTimestamp(entry?.date),
      value: Number(resolveHistoryValueUsd(entry)),
    }))
    .filter((row) => Number.isFinite(row.ts) && Number.isFinite(row.value))
    .sort((left, right) => left.ts - right.ts);

  if (rows.length < 2) {
    return null;
  }

  const latest = rows[rows.length - 1];
  const targetTs = latest.ts - days * 24 * 60 * 60 * 1000;

  // Newest sample at or before the window start.
  let baseline = null;
  for (const row of rows) {
    if (row.ts > targetTs) {
      break;
    }
    baseline = row;
  }

  if (!baseline) {
    const spanDays = (latest.ts - rows[0].ts) / (24 * 60 * 60 * 1000);
    if (spanDays < days * 0.8) {
      return null;
    }
    baseline = rows[0];
  }

  if (!(baseline.value > 0)) {
    return null;
  }

  return ((latest.value - baseline.value) / baseline.value) * 100;
}

/** Trailing slice of a price series, used for the range-scoped sparkline. */
export function sliceHistoryByDays(history, days) {
  const rows = Array.isArray(history) ? history : [];
  if (rows.length === 0 || !Number.isFinite(days)) {
    return rows;
  }

  const timestamps = rows
    .map((entry) => parseHistoryTimestamp(entry?.date))
    .filter((ts) => Number.isFinite(ts));
  if (timestamps.length === 0) {
    return rows;
  }

  const cutoff = Math.max(...timestamps) - days * 24 * 60 * 60 * 1000;
  const scoped = rows.filter((entry) => {
    const ts = parseHistoryTimestamp(entry?.date);
    return Number.isFinite(ts) && ts >= cutoff;
  });

  // A window with almost nothing in it plots worse than the full series.
  return scoped.length >= 2 ? scoped : rows;
}

/**
 * Resolve the watchlist change percent from an item object, trying multiple field names.
 */
export function resolveWatchlistChangePercent(item) {
  const candidates = [item?.priceChangePercent, item?.changePercent, item?.roi];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

/**
 * Normalize text for search comparison: trim + lowercase.
 */
export function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Normalize a buy order name key: trim + lowercase.
 */
function normalizeBuyOrderNameKey(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Fuzzy-normalize a buy order name key with NFKC normalization and stop-word removal.
 */
function normalizeBuyOrderNameKeyFuzzy(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\bstattrak(?:™)?\b/gi, "")
    .replace(/\bsouvenir\b/gi, "")
    .replace(/[★]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find a matching buy order summary entry for a given item.
 */
function resolveBuyOrderSummaryForItem(item, summaryRows = []) {
  const rows = Array.isArray(summaryRows) ? summaryRows : [];
  if (!item || rows.length === 0) {
    return null;
  }

  const summaryByName = new Map();
  rows.forEach((row) => {
    const exactKey = normalizeBuyOrderNameKey(row?.marketHashName);
    const fuzzyKey = normalizeBuyOrderNameKeyFuzzy(row?.marketHashName);
    if (!exactKey && !fuzzyKey) {
      return;
    }
    if (exactKey) {
      summaryByName.set(exactKey, row);
    }
    if (fuzzyKey) {
      summaryByName.set(fuzzyKey, row);
    }
  });

  const rawName = item?.marketHashName || item?.name;
  const key = normalizeBuyOrderNameKey(rawName);
  const fuzzyKey = normalizeBuyOrderNameKeyFuzzy(rawName);
  let summary = key ? summaryByName.get(key) : null;

  if (!summary && fuzzyKey) {
    summary = summaryByName.get(fuzzyKey) || null;
  }

  if (!summary && fuzzyKey) {
    summary = rows.find((row) => {
      const rowKey = normalizeBuyOrderNameKeyFuzzy(row?.marketHashName);
      return rowKey && (rowKey.includes(fuzzyKey) || fuzzyKey.includes(rowKey));
    }) || null;
  }

  return summary || null;
}

/**
 * Augment an item with buy order fields if a matching summary entry is found.
 */
export function withBuyOrderFields(item, summaryRows = []) {
  if (!item || item.__detailKind === "group" || item.__detailKind === "group-cluster") {
    return item;
  }

  const summary = resolveBuyOrderSummaryForItem(item, summaryRows);
  const buyOrderCount = Number(summary?.orders || 0);
  const buyOrderQuantity = Number(summary?.quantity || 0);
  const buyOrderBestPriceUsd = Number(summary?.bestPriceUsd || 0);

  return {
    ...item,
    hasBuyOrder: buyOrderCount > 0 && buyOrderBestPriceUsd > 0,
    buyOrderCount: buyOrderCount > 0 ? buyOrderCount : 0,
    buyOrderQuantity: buyOrderQuantity > 0 ? buyOrderQuantity : 0,
    buyOrderBestPriceUsd: buyOrderBestPriceUsd > 0 ? buyOrderBestPriceUsd : null,
  };
}

/**
 * Derive the CS update impact object (label, badgeClass, actionLabel) from the update item.
 */
export function deriveCsUpdateImpact(item) {
  if (!item || typeof item !== "object") {
    return {
      level: "unrated",
      label: "KI Rating ausstehend",
      actionLabel: "Noch keine Bewertung verfuegbar",
      badgeClass: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
    };
  }

  const aiStatus = String(item.aiRatingStatus || "").toLowerCase();
  const aiImpactLevel = String(item.aiImpactLevel || "").toLowerCase();
  const aiAction = String(item.aiRecommendedAction || "").trim();

  if (aiStatus === "pending") {
    return {
      level: "pending",
      label: "KI Rating laeuft",
      actionLabel: "Eilmeldung jetzt pruefen",
      badgeClass: "border-cyan-500/30 bg-cyan-500/12 text-cyan-600 dark:text-cyan-300",
    };
  }

  if (aiStatus === "rated" && ["none", "low", "medium", "high"].includes(aiImpactLevel)) {
    const aiMap = {
      none: {
        label: "Impact none",
        actionLabel: "Kein akuter Handlungsbedarf",
        badgeClass: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
      },
      low: {
        label: "Impact niedrig",
        actionLabel: "Beobachten",
        badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
      },
      medium: {
        label: "Impact mittel",
        actionLabel: "Heute pruefen",
        badgeClass: "border-amber-500/35 bg-amber-500/12 text-amber-600 dark:text-amber-300",
      },
      high: {
        label: "Impact hoch",
        actionLabel: "Schnell pruefen",
        badgeClass: "border-red-500/35 bg-red-500/12 text-red-600 dark:text-red-300",
      },
    };
    const mapped = aiMap[aiImpactLevel];
    return {
      level: aiImpactLevel,
      label: mapped.label,
      actionLabel: aiAction !== "" ? aiAction : mapped.actionLabel,
      badgeClass: mapped.badgeClass,
    };
  }
  if (aiStatus === "failed") {
    return {
      level: "failed",
      label: "KI Rating fehlgeschlagen",
      actionLabel: "Manuell pruefen",
      badgeClass: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
    };
  }
  return {
    level: "unrated",
    label: "KI Rating ausstehend",
    actionLabel: "Noch keine Bewertung verfuegbar",
    badgeClass: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
  };
}

/**
 * Normalize a bucket value ("inventory" / "investment") with a fallback.
 */
export function normalizeBucket(value, fallback = "investment") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "inventory") {
    return "inventory";
  }
  if (normalized === "investment") {
    return "investment";
  }
  return fallback === "inventory" ? "inventory" : "investment";
}

/**
 * Resolve a live cluster item by matching it against a list of enriched investments.
 */
export function resolveLiveClusterItem(baseItem, rows = []) {
  if (!baseItem || !Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const exactMatch = rows.find((row) => row.id === baseItem.id);
  if (exactMatch) {
    return exactMatch;
  }

  const baseSourceIds = Array.isArray(baseItem.sourceInvestmentIds)
    ? baseItem.sourceInvestmentIds
    : [];
  if (baseSourceIds.length > 0) {
    const sourceMatch = rows.find((row) =>
      hasSourceIdOverlap(baseSourceIds, Array.isArray(row?.sourceInvestmentIds) ? row.sourceInvestmentIds : []),
    );
    if (sourceMatch) {
      return sourceMatch;
    }
  }

  return null;
}

function hasSourceIdOverlap(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) {
    return false;
  }
  const left = new Set(a.map((entry) => String(entry || "").trim()).filter(Boolean));
  return b.some((entry) => left.has(String(entry || "").trim()));
}

/**
 * Build a detail selection object for a portfolio group.
 */
export function buildGroupDetailSelection(group) {
  const totalQuantity = Number(group?.totalQuantity || 0);
  const weightedBuyUnitPrice = Number(group?.weightedBuyUnitPrice || 0);
  const weightedCurrentUnitPrice = Number(group?.weightedCurrentUnitPrice || 0);
  const totalValue = Number(group?.totalValue || 0);
  const totalProfit = Number(group?.totalProfit || 0);
  const roiPercent = Number(group?.roiPercent || 0);
  const totalInvested = Number(group?.totalInvested || 0);

  const liveClusterCount = Number(group?.liveClusterCount || 0);
  const clusterCount = Number(group?.clusterCount || (Array.isArray(group?.clusters) ? group.clusters.length : 0));
  const isLive = liveClusterCount > 0;

  return {
    id: `group-${group?.id || "unknown"}`,
    itemId: 0,
    item_id: 0,
    __detailKind: "group",
    topVisuals: Array.isArray(group?.topVisuals) ? group.topVisuals : [],
    // Cluster aggregates power the composition donut in the detail panel.
    clusters: Array.isArray(group?.clusters) ? group.clusters : [],
    // Member ids let the detail panel's bucket toggle move the WHOLE group via
    // updateInvestmentBucket's batch path.
    sourceInvestmentIds: Array.isArray(group?.memberInvestmentIds)
      ? [...group.memberInvestmentIds]
      : [],
    name: group?.name || "Gruppe",
    marketHashName: group?.name || "Gruppe",
    displayName: group?.name || "Gruppe",
    itemCount: totalQuantity,
    totalValue,
    totalInvested,
    totalProfit,
    totalRoi: roiPercent,
    buyPriceUsd: weightedBuyUnitPrice,
    currentPriceUsd: weightedCurrentUnitPrice,
    buyPrice: weightedBuyUnitPrice,
    currentPrice: weightedCurrentUnitPrice,
    quantity: totalQuantity,
    // Aliases mapping the group's aggregates onto the field names the shared
    // ItemDetailPanel reads, so grouped selections fill the same stat tiles as a
    // single item instead of rendering N/A. Values follow the display-currency
    // convention InventoryTable already uses for these aggregates (plain formatPrice).
    currentValue: totalValue,
    displayPrice: weightedCurrentUnitPrice,
    livePrice: weightedCurrentUnitPrice,
    isLive,
    costBasisTotal: totalInvested,
    profitEuro: totalProfit,
    isProfitPositive: totalProfit >= 0,
    roi: roiPercent,
    freshnessLabel:
      clusterCount > 0 ? `${liveClusterCount}/${clusterCount} Cluster live` : null,
    bucket: String(group?.bucket || "").toLowerCase() === "inventory" ? "inventory" : "investment",
    type: "group",
  };
}

/**
 * Build a detail selection object for a cluster within a portfolio group.
 */
export function buildGroupClusterDetailSelection(group, cluster) {
  // finalizeClusterAggregate exposes quantity/buyUnitPrice/currentUnitPrice — the
  // earlier weighted*/totalQuantity names never existed on the cluster and read as 0.
  const totalQuantity = Number(cluster?.quantity || cluster?.itemCount || 0);
  const weightedBuyUnitPrice = Number(cluster?.buyUnitPrice || 0);
  const weightedCurrentUnitPrice = Number(cluster?.currentUnitPrice || 0);
  const totalValue = Number(cluster?.totalValue || 0);
  const totalInvested = Number(cluster?.totalInvested || 0);
  const totalProfit = Number(
    cluster?.totalProfit != null ? cluster.totalProfit : totalValue - totalInvested,
  );
  const roiPercent = Number(cluster?.roiPercent || 0);
  const isLive = Boolean(cluster?.isLive);

  const clusterItemId = Number(cluster?.itemId || 0) || 0;

  return {
    id: `group-cluster-${group?.id || "unknown"}-${cluster?.id || cluster?.name || "unknown"}`,
    // Real catalog id (when known) so the cluster detail can load its price history.
    itemId: clusterItemId,
    item_id: clusterItemId,
    __detailKind: "group-cluster",
    imageUrl: cluster?.imageUrl || null,
    name: `${group?.name || "Gruppe"} > ${cluster?.name || "Cluster"}`,
    marketHashName: cluster?.name || "Cluster",
    displayName: cluster?.name || "Cluster",
    itemCount: totalQuantity,
    totalValue,
    totalInvested,
    totalProfit,
    totalRoi: roiPercent,
    buyPriceUsd: weightedBuyUnitPrice,
    currentPriceUsd: weightedCurrentUnitPrice,
    buyPrice: weightedBuyUnitPrice,
    currentPrice: weightedCurrentUnitPrice,
    quantity: totalQuantity,
    // Aliases onto the shared ItemDetailPanel field names (see buildGroupDetailSelection).
    currentValue: totalValue,
    displayPrice: weightedCurrentUnitPrice,
    livePrice: weightedCurrentUnitPrice,
    isLive,
    costBasisTotal: totalInvested,
    profitEuro: totalProfit,
    isProfitPositive: totalProfit >= 0,
    roi: roiPercent,
    freshnessLabel: cluster?.freshnessLabel || null,
    bucket: "investment",
    type: "group-cluster",
  };
}

/**
 * Get the item name key from an item object, trying multiple field names.
 */
export function getItemNameKey(item) {
  return String(item?.marketHashName || item?.name || item?.itemName || "")
    .trim()
    .toLowerCase();
}

// Vocabulary of the manual-investment "Typ" select. The item catalog uses a
// different one (skin, case, sticker_capsule, …), and a catalog "skin" covers
// weapons, knives and gloves alike — so a catalog type is only adopted when it
// happens to be one of these. Otherwise the user's own choice stands, rather
// than the browser silently falling back to the first option.
export const MANUAL_ITEM_TYPES = [
  "other", "weapon", "knife", "gloves", "sticker", "agent", "collectible",
  "container", "key", "music", "patch", "pin", "graffiti", "tool",
];

/**
 * Bundle a cluster's raw investment rows into the positions a user actually
 * thinks in.
 *
 * A Steam sync writes one row per physical item, so 55 cases acquired in one
 * go arrive as 55 rows. Presenting those as 55 "positions" is noise: they were
 * one acquisition and share one buy-in. Rows are therefore bundled by
 * acquisition day plus source, which is exactly what distinguishes two real
 * acquisitions of the same item.
 *
 * This is a view-level bundling only — the underlying rows are untouched, and a
 * bundle can be expanded to reach them individually.
 *
 * @param {Array} positions raw investment rows of one cluster
 * @param {(row: any) => Date|null} resolveDate acquisition-date resolver
 * @returns {Array} lots, newest acquisition first
 */
export function buildPositionLots(positions = [], resolveDate) {
  const lots = new Map();

  (Array.isArray(positions) ? positions : []).forEach((position) => {
    const date = typeof resolveDate === "function" ? resolveDate(position) : null;
    const dayKey = date ? date.toISOString().slice(0, 10) : "unbekannt";
    const source = String(position?.platform || position?.source || "").toLowerCase();
    const key = `${dayKey}|${source}`;

    if (!lots.has(key)) {
      lots.set(key, {
        key,
        dayKey,
        date,
        source,
        positions: [],
        quantity: 0,
      });
    }

    const lot = lots.get(key);
    lot.positions.push(position);
    lot.quantity += Math.max(1, Number(position?.quantity || 1));
  });

  return Array.from(lots.values())
    .map((lot) => {
      const priced = lot.positions.filter(
        (position) => Number(position?.buyPriceUsd ?? position?.buyPrice ?? 0) > 0,
      );
      const prices = priced.map((position) =>
        Number(position.buyPriceUsd ?? position.buyPrice ?? 0),
      );
      const uniquePrices = new Set(prices.map((price) => price.toFixed(2)));
      return {
        ...lot,
        // A lot only reports one price when every row in it agrees; mixed rows
        // must not silently show one of them as if it applied to all.
        buyPriceUsd: uniquePrices.size === 1 ? prices[0] : null,
        mixedPrices: uniquePrices.size > 1,
        missingCount: lot.positions.length - priced.length,
        excluded: lot.positions.every((position) => Boolean(position?.excluded)),
        partiallyExcluded:
          lot.positions.some((position) => Boolean(position?.excluded)) &&
          !lot.positions.every((position) => Boolean(position?.excluded)),
      };
    })
    .sort((a, b) => {
      const at = a.date ? a.date.getTime() : 0;
      const bt = b.date ? b.date.getTime() : 0;
      return bt - at;
    });
}
