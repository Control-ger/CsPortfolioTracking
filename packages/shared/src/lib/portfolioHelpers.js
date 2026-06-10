/**
 * Shared utility functions extracted from PortfolioPage.jsx
 * for use across PortfolioPage section components.
 */

/**
 * Format seconds into a human-readable age string (e.g., "5m", "2h", "3d").
 */
export function formatAge(seconds) {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) {
    return "-";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }

  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h`;
  }

  return `${Math.floor(seconds / 86400)}d`;
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
    return "keine live quotes";
  }

  if (!Number.isFinite(oldestAgeSeconds)) {
    return "status unbekannt";
  }

  if (oldestAgeSeconds <= 90 * 60) {
    return "im plan";
  }

  if (oldestAgeSeconds <= 3 * 60 * 60) {
    return "verzoegert";
  }

  return "nachlauf";
}

/**
 * Format a number of hours into a short relative time string (e.g., "<1h", "5h").
 */
export function formatRelativeHours(hours) {
  if (!Number.isFinite(hours)) {
    return "unbekannt";
  }

  if (hours < 1) {
    return "<1h";
  }

  return `${Math.max(1, Math.round(hours))}h`;
}

/**
 * Format a date value into a short German locale date string.
 */
export function formatDateSafe(value) {
  if (!value) {
    return "-";
  }
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) {
    return String(value);
  }
  return new Date(timestamp).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
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
export function normalizeBuyOrderNameKey(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Fuzzy-normalize a buy order name key with NFKC normalization and stop-word removal.
 */
export function normalizeBuyOrderNameKeyFuzzy(value) {
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
export function resolveBuyOrderSummaryForItem(item, summaryRows = []) {
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
      badgeClass: "border-slate-500/30 bg-slate-500/10 text-slate-300",
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
      badgeClass: "border-cyan-500/30 bg-cyan-500/12 text-cyan-300",
    };
  }

  if (aiStatus === "rated" && ["none", "low", "medium", "high"].includes(aiImpactLevel)) {
    const aiMap = {
      none: {
        label: "Impact none",
        actionLabel: "Kein akuter Handlungsbedarf",
        badgeClass: "border-slate-500/30 bg-slate-500/10 text-slate-300",
      },
      low: {
        label: "Impact niedrig",
        actionLabel: "Beobachten",
        badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
      },
      medium: {
        label: "Impact mittel",
        actionLabel: "Heute pruefen",
        badgeClass: "border-amber-500/35 bg-amber-500/12 text-amber-300",
      },
      high: {
        label: "Impact hoch",
        actionLabel: "Schnell pruefen",
        badgeClass: "border-red-500/35 bg-red-500/12 text-red-300",
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
      badgeClass: "border-red-500/30 bg-red-500/10 text-red-300",
    };
  }
  return {
    level: "unrated",
    label: "KI Rating ausstehend",
    actionLabel: "Noch keine Bewertung verfuegbar",
    badgeClass: "border-slate-500/30 bg-slate-500/10 text-slate-300",
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

  return {
    id: `group-${group?.id || "unknown"}`,
    itemId: 0,
    item_id: 0,
    __detailKind: "group",
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
    bucket: "investment",
    type: "group",
  };
}

/**
 * Build a detail selection object for a cluster within a portfolio group.
 */
export function buildGroupClusterDetailSelection(group, cluster) {
  const totalQuantity = Number(cluster?.totalQuantity || cluster?.itemCount || 0);
  const weightedBuyUnitPrice = Number(cluster?.weightedBuyUnitPrice || 0);
  const weightedCurrentUnitPrice = Number(cluster?.weightedCurrentUnitPrice || 0);
  const totalValue = Number(cluster?.totalValue || 0);
  const totalProfit = Number(cluster?.totalProfit || 0);
  const roiPercent = Number(cluster?.roiPercent || 0);
  const totalInvested = Number(cluster?.totalInvested || 0);

  return {
    id: `group-cluster-${group?.id || "unknown"}-${cluster?.id || cluster?.name || "unknown"}`,
    itemId: 0,
    item_id: 0,
    __detailKind: "group-cluster",
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
