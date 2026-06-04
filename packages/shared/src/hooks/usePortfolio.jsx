import { useState, useEffect, useCallback, useRef } from "react";
import { fetchPortfolioData } from "@shared/lib/dataSource.js";
import { getCurrentUser } from "@shared/lib/auth.js";

const portfolioViewCache = new Map();
const PORTFOLIO_CACHE_TTL_MS = 2 * 60 * 1000;

function resolveCacheKey(options = {}) {
  const scope = String(options.scope || "default");
  const rowScope = String(options.rowScope || "default");
  const user = String(options.userCacheSegment || "user:resolving");
  return `${user}::${scope}::${rowScope}`;
}

function resolveUserCacheSegment(user) {
  const steamId = String(user?.steamId || user?.steam_id || "").trim();
  if (/^[1-9]\d{10,}$/.test(steamId)) {
    return `steam:${steamId}`;
  }

  const id = String(user?.id || user?.userId || "").trim();
  if (/^steam-[1-9]\d{10,}$/i.test(id)) {
    return `steam:${id.slice("steam-".length)}`;
  }
  if (/^[1-9]\d*$/.test(id)) {
    return `user:${id}`;
  }

  return "user:none";
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

function hasDesktopLocalStore() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.electronAPI?.localStore)
  );
}

export function usePortfolio(options = {}) {
  const abortControllerRef = useRef(null);
  const initialLoadKeyRef = useRef("");
  const [userCacheSegment, setUserCacheSegment] = useState("user:resolving");
  const cacheKey = resolveCacheKey({ ...options, userCacheSegment });

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
    let isActive = true;

    getCurrentUser()
      .then((user) => {
        if (isActive) {
          setUserCacheSegment(resolveUserCacheSegment(user));
        }
      })
      .catch(() => {
        if (isActive) {
          setUserCacheSegment("user:none");
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (userCacheSegment === "user:resolving") {
      return;
    }

    const snapshot = getValidPortfolioSnapshot(cacheKey);
    if (!snapshot) {
      return;
    }

    setInvestments(snapshot.investments || []);
    setAuthRequired(Boolean(snapshot.authRequired));
    setStats(snapshot.stats || {});
    setPortfolioHistory(snapshot.portfolioHistory || []);
    setWarnings(snapshot.warnings || []);
    setError("");
    setIsLoading(false);
  }, [cacheKey, userCacheSegment]);

  const applyPortfolioPayload = useCallback((payload, { cachePayload = true, targetCacheKey = cacheKey } = {}) => {
    const { rows: rowsResponse, summary: summaryResponse, history, requiresAuth } = payload || {};
    const nextWarnings = mergeWarnings(
      rowsResponse?.meta?.warnings || [],
      summaryResponse?.meta?.warnings || []
    );

    setAuthRequired(requiresAuth || false);
    setInvestments(rowsResponse?.data || []);
    setStats(summaryResponse?.data || {});
    setPortfolioHistory(history || []);
    setWarnings(nextWarnings);
    setError("");

    if (cachePayload) {
      portfolioViewCache.set(targetCacheKey, {
        investments: rowsResponse?.data || [],
        authRequired: requiresAuth || false,
        stats: summaryResponse?.data || {},
        portfolioHistory: history || [],
        warnings: nextWarnings,
        updatedAt: Date.now(),
      });
    }
  }, [cacheKey]);

  const loadData = useCallback(async ({ showLoading = true, preferImmediateLocal = false } = {}) => {
    // Abort previous request if still pending
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    let localSnapshotApplied = false;

    if (showLoading) {
      setIsLoading(true);
    }
    try {
      const activeUser = await getCurrentUser().catch(() => null);
      const activeUserCacheSegment = resolveUserCacheSegment(activeUser);
      const activeCacheKey = resolveCacheKey({
        scope: options.scope,
        rowScope: options.rowScope,
        userCacheSegment: activeUserCacheSegment,
      });
      if (activeUserCacheSegment !== userCacheSegment) {
        setUserCacheSegment(activeUserCacheSegment);
      }

      if (preferImmediateLocal && hasDesktopLocalStore()) {
        const localSnapshot = await fetchPortfolioData({
          signal,
          scope: options.scope,
          rowScope: options.rowScope,
          localOnly: true,
        });

        if (signal.aborted) return;

        applyPortfolioPayload(localSnapshot, {
          cachePayload: false,
          targetCacheKey: activeCacheKey,
        });
        localSnapshotApplied = true;
        setIsLoading(false);
      }

      const payload = await fetchPortfolioData({
        signal,
        scope: options.scope,
        rowScope: options.rowScope,
      });

      // Don't update state if request was aborted
      if (signal.aborted) return;

      applyPortfolioPayload(payload, { targetCacheKey: activeCacheKey });
    } catch (err) {
      // Don't update state for abort errors
      if (err.name === 'AbortError') return;
      setError(err.message || "Fehler beim Laden der Portfolio-Daten.");
      if (!localSnapshotApplied) {
        setWarnings([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [applyPortfolioPayload, options.rowScope, options.scope, userCacheSegment]);

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
    if (userCacheSegment === "user:resolving") {
      return;
    }

    if (initialLoadKeyRef.current === cacheKey) {
      return;
    }
    initialLoadKeyRef.current = cacheKey;
    const hasSnapshot = getValidPortfolioSnapshot(cacheKey) !== null;
    void Promise.resolve().then(() => loadData({
      showLoading: !hasSnapshot,
      preferImmediateLocal: !hasSnapshot,
    }));
  }, [cacheKey, loadData, userCacheSegment]);

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
