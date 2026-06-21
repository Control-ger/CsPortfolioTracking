import path from "path";
import { randomUUID } from "crypto";

export const SCHEMA_VERSION = 4;
export const CANONICAL_LOCAL_USER_ID = "1";
export const STEAM_ID_PATTERN = /^[1-9]\d{10,}$/;
export const DESKTOP_STEAM_USER_ID_PATTERN = /^steam-([1-9]\d{10,})$/i;

export const DEFAULT_PORTFOLIO_PREFERENCES = Object.freeze({
  steamImportBucket: "inventory",
  csfloatImportBucket: "investment",
  skinBaronImportBucket: "investment",
  metricsDisplayMode: "toggle_mode",
  metricsScopeDefault: "investments",
  csfloatWatchlistAutoImport: false,
  notifyBanWaveDesktop: true,
  notifyBanWaveDesktopMinLevel: "low",
  notifyCsUpdatesDesktop: true,
  notifyCsUpdatesDesktopMinLevel: "medium",
  notifySteamSyncDesktop: true,
  notifyBanWaveWebPush: false,
  notifyBanWaveWebPushMinLevel: "medium",
  notifyCsUpdatesWebPush: false,
  notifyCsUpdatesWebPushMinLevel: "high",
});

export function nowIso() {
  return new Date().toISOString();
}

export function serialize(value) {
  return JSON.stringify(value ?? {});
}

export function stableSerialize(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function deserialize(value, fallback = {}) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn("[local-store] failed to parse JSON payload", error);
    return fallback;
  }
}

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

export function normalizeMetricsDisplayMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "always_all") {
    return "always_all";
  }
  if (normalized === "investments_only") {
    return "investments_only";
  }
  return "toggle_mode";
}

export function normalizeMetricsScope(value, fallback = "investments") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "all") {
    return "all";
  }
  return fallback === "all" ? "all" : "investments";
}

const IMPACT_LEVELS = ["none", "low", "medium", "high"];

function normalizeImpactLevel(value, fallback = "medium") {
  const normalized = String(value || "").trim().toLowerCase();
  return IMPACT_LEVELS.includes(normalized) ? normalized : fallback;
}

// Preferences round-trip through the meta store as strings, so a stored "false"
// is truthy under Boolean(). Coerce explicitly via === "true".
export function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value).trim().toLowerCase() === "true";
}

export function normalizePortfolioPreferences(input = {}) {
  return {
    steamImportBucket: normalizeBucket(
      input.steamImportBucket,
      DEFAULT_PORTFOLIO_PREFERENCES.steamImportBucket,
    ),
    csfloatImportBucket: normalizeBucket(
      input.csfloatImportBucket,
      DEFAULT_PORTFOLIO_PREFERENCES.csfloatImportBucket,
    ),
    skinBaronImportBucket: normalizeBucket(
      input.skinBaronImportBucket,
      DEFAULT_PORTFOLIO_PREFERENCES.skinBaronImportBucket,
    ),
    metricsDisplayMode: normalizeMetricsDisplayMode(
      input.metricsDisplayMode ?? input.kpiDisplayMode,
    ),
    metricsScopeDefault: normalizeMetricsScope(
      input.metricsScopeDefault,
      DEFAULT_PORTFOLIO_PREFERENCES.metricsScopeDefault,
    ),
    csfloatWatchlistAutoImport: normalizeBoolean(
      input.csfloatWatchlistAutoImport,
      DEFAULT_PORTFOLIO_PREFERENCES.csfloatWatchlistAutoImport,
    ),
    notifyBanWaveDesktop: normalizeBoolean(input.notifyBanWaveDesktop, true),
    notifyBanWaveDesktopMinLevel: normalizeImpactLevel(input.notifyBanWaveDesktopMinLevel, "low"),
    notifyCsUpdatesDesktop: normalizeBoolean(input.notifyCsUpdatesDesktop, true),
    notifyCsUpdatesDesktopMinLevel: normalizeImpactLevel(input.notifyCsUpdatesDesktopMinLevel, "medium"),
    notifySteamSyncDesktop: normalizeBoolean(input.notifySteamSyncDesktop, true),
    notifyBanWaveWebPush: normalizeBoolean(input.notifyBanWaveWebPush, false),
    notifyBanWaveWebPushMinLevel: normalizeImpactLevel(input.notifyBanWaveWebPushMinLevel, "medium"),
    notifyCsUpdatesWebPush: normalizeBoolean(input.notifyCsUpdatesWebPush, false),
    notifyCsUpdatesWebPushMinLevel: normalizeImpactLevel(input.notifyCsUpdatesWebPushMinLevel, "high"),
  };
}

export function resolveDbPath(userDataPath) {
  return path.join(userDataPath, "cs-investor-hub.sqlite");
}

export function normalizeLocalUserId(value, fallback = CANONICAL_LOCAL_USER_ID) {
  const fallbackId = String(fallback || CANONICAL_LOCAL_USER_ID).trim() || CANONICAL_LOCAL_USER_ID;
  const raw = value === null || value === undefined ? "" : String(value).trim();
  if (!raw) {
    return fallbackId;
  }
  const lower = raw.toLowerCase();
  if (lower === "local") {
    return fallbackId;
  }
  const steamPrefixedMatch = raw.match(DESKTOP_STEAM_USER_ID_PATTERN);
  if (steamPrefixedMatch) {
    return `steam-${steamPrefixedMatch[1]}`;
  }
  if (STEAM_ID_PATTERN.test(raw)) {
    return `steam-${raw}`;
  }
  if (/^[1-9]\d*$/.test(raw) && raw.length <= 10) {
    return raw;
  }
  return fallbackId;
}

export function normalizeMarketName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function toFiniteNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function toTimestamp(value) {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function normalizeType(value) {
  const normalized = String(value || "skin").trim().toLowerCase();
  return normalized || "skin";
}

export function valuesEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (a === null || a === undefined) {
    return b === null || b === undefined;
  }
  if (b === null || b === undefined) {
    return false;
  }
  return String(a) === String(b);
}

export function toBooleanFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "on"].includes(normalized);
  }
  return false;
}

export function normalizeOverpayFloor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Number(numeric.toFixed(2));
}

export function normalizeNameForMatching(value) {
  const normalized = normalizeMarketName(value)
    .replace(/\bstattrak\u2122?\b/g, " ")
    .replace(/\bsouvenir\b/g, " ")
    .replace(/\b(factory new|minimal wear|field-tested|well-worn|battle-scarred)\b/g, " ")
    .replace(/[^a-z0-9|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized;
}

export function extractWearKey(value) {
  const normalized = normalizeMarketName(value);
  if (normalized.includes("factory new")) return "fn";
  if (normalized.includes("minimal wear")) return "mw";
  if (normalized.includes("field-tested")) return "ft";
  if (normalized.includes("well-worn")) return "ww";
  if (normalized.includes("battle-scarred")) return "bs";
  return null;
}

export function splitNameTokens(value) {
  const normalized = normalizeNameForMatching(value);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

export function buildTokenSet(tokens = []) {
  return new Set(tokens);
}

export function calculateTokenOverlap(aTokens = [], bTokens = []) {
  if (aTokens.length === 0 || bTokens.length === 0) {
    return 0;
  }
  const aSet = buildTokenSet(aTokens);
  const bSet = buildTokenSet(bTokens);
  let intersection = 0;
  aSet.forEach((token) => {
    if (bSet.has(token)) {
      intersection += 1;
    }
  });
  const union = new Set([...aSet, ...bSet]).size;
  if (union <= 0) {
    return 0;
  }
  return intersection / union;
}

export function calculateSteamCsfloatMatch(steamItem, csfloatItem) {
  const reasons = [];
  // breakdown captures, per signal, the points awarded AND the actual measured
  // values/deviations that earned them (e.g. the float delta, the price gap %),
  // so the persisted match can be retraced down to the raw numbers — not just the
  // categorical bucket. `metrics` carries the bare numbers for downstream formatting.
  const breakdown = [];
  let score = 0;
  const record = (code, points, metrics = null) => {
    score += points;
    reasons.push(code);
    breakdown.push({ code, points, metrics });
  };

  const steamType = normalizeType(steamItem.type);
  const csfloatType = normalizeType(csfloatItem.type);
  if (steamType !== csfloatType) {
    return null;
  }
  record("same_type", 12, { type: steamType });

  const steamName = normalizeMarketName(steamItem.marketHashName || steamItem.name);
  const csfloatName = normalizeMarketName(csfloatItem.marketHashName || csfloatItem.name);
  const steamCoreName = normalizeNameForMatching(steamName);
  const csfloatCoreName = normalizeNameForMatching(csfloatName);
  if (steamCoreName && csfloatCoreName && steamCoreName === csfloatCoreName) {
    record("exact_core_name", 50, { overlap: 1 });
  } else {
    const overlap = calculateTokenOverlap(
      splitNameTokens(steamCoreName),
      splitNameTokens(csfloatCoreName),
    );
    if (overlap >= 0.8) {
      record("token_overlap_high", 36, { overlap });
    } else if (overlap >= 0.6) {
      record("token_overlap_medium", 24, { overlap });
    } else if (overlap >= 0.4) {
      record("token_overlap_low", 12, { overlap });
    } else {
      return null;
    }
  }

  const steamWear = extractWearKey(steamName);
  const csfloatWear = extractWearKey(csfloatName);
  if (steamWear && csfloatWear) {
    if (steamWear !== csfloatWear) {
      return null;
    }
    record("wear_exact", 8, { wear: steamWear });
  }

  const steamFloat = toFiniteNumber(steamItem.floatValue ?? steamItem.float ?? steamItem.wearFloat);
  const csfloatFloat = toFiniteNumber(csfloatItem.floatValue ?? csfloatItem.float ?? csfloatItem.wearFloat);
  let hasFloatMatch = false;
  if (steamFloat !== null && csfloatFloat !== null) {
    const floatDiff = Math.abs(steamFloat - csfloatFloat);
    if (floatDiff > 0.03) {
      return null;
    }
    const floatMetrics = { steamFloat, csfloatFloat, floatDiff };
    if (floatDiff <= 0.00001) {
      hasFloatMatch = true;
      record("float_exact", 22, floatMetrics);
    } else if (floatDiff <= 0.0005) {
      record("float_near", 14, floatMetrics);
    } else {
      record("float_loose", 6, floatMetrics);
    }
  }

  const steamSeed = toFiniteNumber(steamItem.paintSeed ?? steamItem.patternSeed);
  const csfloatSeed = toFiniteNumber(csfloatItem.paintSeed ?? csfloatItem.patternSeed);
  let hasSeedMatch = false;
  if (steamSeed !== null && csfloatSeed !== null) {
    if (steamSeed !== csfloatSeed) {
      return null;
    }
    hasSeedMatch = true;
    record("seed_exact", 20, { seed: steamSeed });
  }

  const steamPrice = toFiniteNumber(steamItem.buyPriceUsd);
  const csfloatPrice = toFiniteNumber(csfloatItem.buyPriceUsd);
  if (steamPrice !== null && csfloatPrice !== null && steamPrice > 0 && csfloatPrice > 0) {
    const avgPrice = (steamPrice + csfloatPrice) / 2;
    const priceDiffRatio = avgPrice > 0 ? Math.abs(steamPrice - csfloatPrice) / avgPrice : 1;
    const priceMetrics = { steamPrice, csfloatPrice, priceDiffRatio };
    if (priceDiffRatio <= 0.03) {
      record("price_near", 10, priceMetrics);
    } else if (priceDiffRatio <= 0.1) {
      record("price_loose", 5, priceMetrics);
    }
  }

  const steamTime = toTimestamp(steamItem.firstSeenAt ?? steamItem.lastSeenAt ?? steamItem.purchasedAt);
  const csfloatTime = toTimestamp(csfloatItem.purchasedAt ?? csfloatItem.createdAt);
  if (steamTime !== null && csfloatTime !== null) {
    const dayDiff = Math.abs(steamTime - csfloatTime) / (24 * 60 * 60 * 1000);
    const timeMetrics = { dayDiff };
    if (dayDiff <= 2) {
      record("time_near", 12, timeMetrics);
    } else if (dayDiff <= 7) {
      record("time_medium", 7, timeMetrics);
    } else if (dayDiff <= 14) {
      record("time_loose", 5, timeMetrics);
    }
  }

  let confidence = "low";
  if ((hasFloatMatch && hasSeedMatch) || score >= 88) {
    confidence = "high";
  } else if (score >= 68) {
    confidence = "medium";
  }

  return {
    score,
    confidence,
    reasons,
    breakdown,
  };
}

export function appendOperation(db, opType, entityType, entityId, payload) {
  const createdAt = nowIso();
  const idempotencyKey = `${entityType}:${entityId}:${opType}:${createdAt}`;
  db.prepare(
    `INSERT INTO operations_log
      (id, op_type, entity_type, entity_id, payload, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    opType,
    entityType,
    entityId,
    serialize(payload),
    idempotencyKey,
    createdAt,
  );
}
