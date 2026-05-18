import { getCurrentUser } from "./auth.js";
import { unwrapLocalStoreResult } from "./localStoreResult.js";
import { resolveDesktopLocalUserId as resolveDesktopRuntimeUserId } from "./userIdentity.js";

export const DEFAULT_PORTFOLIO_PREFERENCES = Object.freeze({
  steamImportBucket: "inventory",
  csfloatImportBucket: "investment",
  metricsDisplayMode: "toggle_mode",
  metricsScopeDefault: "investments",
});

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
    metricsDisplayMode: normalizeMetricsDisplayMode(input.metricsDisplayMode),
    metricsScopeDefault: normalizeMetricsScope(
      input.metricsScopeDefault,
      DEFAULT_PORTFOLIO_PREFERENCES.metricsScopeDefault,
    ),
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
