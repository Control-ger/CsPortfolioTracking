import { getCurrentUser } from "./auth.js";
import { unwrapLocalStoreResult } from "./localStoreResult.js";
import { resolveDesktopLocalUserId as resolveDesktopRuntimeUserId } from "./userIdentity.js";

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

// Preferences round-trip through the desktop meta store as strings, so a stored
// "false" would be truthy under Boolean(). Coerce explicitly via === "true".
function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value).trim().toLowerCase() === "true";
}

function normalizeBucket(value, fallback = "investment") {
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

export const IMPACT_LEVELS = ["none", "low", "medium", "high"];

function normalizeImpactLevel(value, fallback = "medium") {
  const normalized = String(value || "").trim().toLowerCase();
  return IMPACT_LEVELS.includes(normalized) ? normalized : fallback;
}

function normalizeMetricsDisplayMode(value) {
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

function normalizeMetricsScope(value, fallback = "investments") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "all") {
    return "all";
  }
  return fallback === "all" ? "all" : "investments";
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
    metricsDisplayMode: normalizeMetricsDisplayMode(input.metricsDisplayMode),
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

export function resolveMetricsScopeFromPreferences(preferences = {}, selectedScope = null) {
  const normalized = normalizePortfolioPreferences(preferences);

  if (normalized.metricsDisplayMode === "always_all") {
    return "all";
  }
  if (normalized.metricsDisplayMode === "investments_only") {
    return "investments";
  }

  return normalizeMetricsScope(selectedScope ?? normalized.metricsScopeDefault, "investments");
}

export function isDesktopLocalStoreRuntime() {
  return typeof window !== "undefined" && Boolean(window.electronAPI?.localStore);
}

export async function getPortfolioPreferences() {
  if (!isDesktopLocalStoreRuntime() || !window.electronAPI?.localStore?.getPortfolioPreferences) {
    return { ...DEFAULT_PORTFOLIO_PREFERENCES };
  }

  const user = await getCurrentUser();
  const userId = resolveDesktopRuntimeUserId(user, 1);
  const raw = unwrapLocalStoreResult(
    await window.electronAPI.localStore.getPortfolioPreferences(userId),
    "local-store-get-portfolio-preferences",
  );
  return normalizePortfolioPreferences(raw || {});
}

export async function updatePortfolioPreferences(patch = {}) {
  if (!isDesktopLocalStoreRuntime() || !window.electronAPI?.localStore?.updatePortfolioPreferences) {
    return normalizePortfolioPreferences({
      ...DEFAULT_PORTFOLIO_PREFERENCES,
      ...(patch || {}),
    });
  }

  const user = await getCurrentUser();
  const userId = resolveDesktopRuntimeUserId(user, 1);
  const raw = unwrapLocalStoreResult(
    await window.electronAPI.localStore.updatePortfolioPreferences(userId, patch || {}),
    "local-store-update-portfolio-preferences",
  );
  return normalizePortfolioPreferences(raw || {});
}
