import { useState, useEffect, useCallback, useRef } from "react";
import { fetchPortfolioData, refreshPortfolioStalePricesData } from "@shared/lib/dataSource.js";

const portfolioViewCache = new Map();
const PORTFOLIO_CACHE_TTL_MS = 2 * 60 * 1000;
const PORTFOLIO_STALE_REFRESH_COOLDOWN_MS = 2 * 60 * 1000;

function resolveCacheKey(options = {}) {
  const scope = String(options.scope || "default");
  const rowScope = String(options.rowScope || "default");
  return `${scope}::${rowScope}`;
}

function getValidPortfolioSnapshot(cacheKey) {
  const snapshot = portfolioViewCache.get(cacheKey) || null;
  if (!snapshot) {
    return null;
  }
  const updatedAt = Number(snapshot.updatedAt || 0);
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > PORTFOLIO_CACHE_TTL_MS) {
    portfolioViewCache.delete(cacheKey);
    return null;
  }
  return snapshot;
}

function mergeWarnings(...warningGroups) {
  const warningsByKey = new Map();

  warningGroups.flat().forEach((warning) => {
    if (!warning) {
      return;
    }

    const key = `${warning.code || "warning"}-${warning.statusCode || "na"}`;
    if (!warningsByKey.has(key)) {
      warningsByKey.set(key, {
        ...warning,
        occurrences: Number(warning.occurrences || 0),
        items: Array.isArray(warning.items) ? [...warning.items] : [],
      });
      return;
    }

    const existingWarning = warningsByKey.get(key);
    existingWarning.occurrences += Number(warning.occurrences || 0);
    if (Array.isArray(warning.items)) {
      warning.items.forEach((itemName) => {
        if (
          itemName &&
          !existingWarning.items.includes(itemName) &&
          existingWarning.items.length < 3
        ) {
          existingWarning.items.push(itemName);
        }
      });
    }
  });

  return Array.from(warningsByKey.values());
}

export function usePortfolio(options = {}) {
  const abortControllerRef = useRef(null);
  const staleRefreshInFlightRef = useRef(false);
  const staleRefreshCooldownUntilRef = useRef(0);
  const cacheKey = resolveCacheKey(options);
  const cachedSnapshot = getValidPortfolioSnapshot(cacheKey);

  const [investments, setInvestments] = useState([]);
  const [authRequired, setAuthRequired] = useState(true); // Default to auth required until checked
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
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
  });
  const [portfolioHistory, setPortfolioHistory] = useState([]);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);

  useEffect(() => {
    if (!cachedSnapshot) {
      return;
    }

    setInvestments(cachedSnapshot.investments || []);
    setAuthRequired(Boolean(cachedSnapshot.authRequired));
    setStats(cachedSnapshot.stats || {});
    setPortfolioHistory(cachedSnapshot.portfolioHistory || []);
    setWarnings(cachedSnapshot.warnings || []);
    setError("");
    setIsLoading(false);
  }, [cacheKey, cachedSnapshot]);

  const loadData = useCallback(async ({ showLoading = true } = {}) => {
    // Abort previous request if still pending
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    if (showLoading) {
      setIsLoading(true);
    }
    try {
      const { rows: rowsResponse, summary: summaryResponse, history, requiresAuth } =
        await fetchPortfolioData({
          signal,
          scope: options.scope,
          rowScope: options.rowScope,
        });

      // Don't update state if request was aborted
      if (signal.aborted) return;

      // Update auth state from data source
      setAuthRequired(requiresAuth || false);
      setInvestments(rowsResponse?.data || []);
      setStats(summaryResponse?.data || {});
      setPortfolioHistory(history || []);
      const nextWarnings = mergeWarnings(
        rowsResponse?.meta?.warnings || [],
        summaryResponse?.meta?.warnings || []
      );
      setWarnings(nextWarnings);
      setError("");

      portfolioViewCache.set(cacheKey, {
        investments: rowsResponse?.data || [],
        authRequired: requiresAuth || false,
        stats: summaryResponse?.data || {},
        portfolioHistory: history || [],
        warnings: nextWarnings,
        updatedAt: Date.now(),
      });
    } catch (err) {
      // Don't update state for abort errors
      if (err.name === 'AbortError') return;
      setError(err.message || "Fehler beim Laden der Portfolio-Daten.");
      setWarnings([]);
    } finally {
      setIsLoading(false);
    }
  }, [cacheKey, options.rowScope, options.scope]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const removeInvestmentFromView = useCallback((investmentId) => {
    setInvestments((currentInvestments) => {
      const nextInvestments = currentInvestments.filter((investment) => investment.id !== investmentId);
      const currentCache = portfolioViewCache.get(cacheKey);
      if (currentCache) {
        portfolioViewCache.set(cacheKey, {
          ...currentCache,
          investments: nextInvestments,
          updatedAt: Date.now(),
        });
      }
      return nextInvestments;
    });
  }, [cacheKey]);

  useEffect(() => {
    void Promise.resolve().then(() => loadData({ showLoading: !cachedSnapshot }));
  }, [cachedSnapshot, loadData]);

  useEffect(() => {
    if (authRequired) {
      return;
    }

    const staleItems = Number(stats?.staleLiveItemsCount || 0);
    if (!Number.isFinite(staleItems) || staleItems <= 0) {
      return;
    }

    const now = Date.now();
    if (
      staleRefreshInFlightRef.current ||
      now < staleRefreshCooldownUntilRef.current
    ) {
      return;
    }

    staleRefreshInFlightRef.current = true;
    staleRefreshCooldownUntilRef.current = now + PORTFOLIO_STALE_REFRESH_COOLDOWN_MS;

    void (async () => {
      try {
        const response = await refreshPortfolioStalePricesData({
          scope: options.scope,
          limit: 500,
        });
        const updated = Number(response?.data?.updated || 0);
        if (Number.isFinite(updated) && updated > 0) {
          await loadData({ showLoading: false });
        }
      } catch (refreshError) {
        console.warn("[portfolio-stale-refresh] failed", refreshError);
      } finally {
        staleRefreshInFlightRef.current = false;
      }
    })();
  }, [authRequired, loadData, options.scope, stats?.staleLiveItemsCount]);

  return {
    enrichedInvestments: investments,
    authRequired,
    isLoading,
    stats,
    portfolioHistory,
    error,
    warnings,
    refreshPortfolio: loadData,
    removeInvestmentFromView,
  };
}
