import { useState, useEffect, useCallback, useRef } from "react";
import { fetchPortfolioData } from "@shared/lib/dataSource.js";
import { getCurrentUser } from "@shared/lib/auth.js";

const portfolioViewCache = new Map();
// Paint window (stale-while-revalidate): how long a cached payload may be shown
// while the background refresh runs. A dashboard remount (route change to
// /cs-updates or /settings unmounts PortfolioPage) must not fall back to zeros
// just because the user read the update feed for three minutes.
const PORTFOLIO_CACHE_TTL_MS = 15 * 60 * 1000;
// Cross-restart survival for the value-bearing fields only. Kept much shorter
// than the in-memory window because the restored stats carry their own (frozen)
// price-age fields, so an old snapshot would misreport its freshness for the
// seconds until the refresh lands.
const PORTFOLIO_PERSISTED_TTL_MS = 60 * 60 * 1000;
const PORTFOLIO_PERSIST_KEY_PREFIX = "portfolio-view-snapshot:";

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

/**
 * Does this payload carry live pricing, or is it the local-only desktop snapshot
 * whose value fields are all zero? The desktop data source states it explicitly
 * (`meta.livePricing`); the web path always serves server-priced rows.
 */
function isPricedPayload(payload) {
  const meta = payload?.rows?.meta || {};
  if (payload?.requiresAuth) {
    return false;
  }
  return meta.livePricing !== false;
}

function readPersistedStats(cacheKey) {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(`${PORTFOLIO_PERSIST_KEY_PREFIX}${cacheKey}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const updatedAt = Number(parsed?.updatedAt || 0);
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > PORTFOLIO_PERSISTED_TTL_MS) {
      window.localStorage.removeItem(`${PORTFOLIO_PERSIST_KEY_PREFIX}${cacheKey}`);
      return null;
    }
    return {
      stats: parsed?.stats && typeof parsed.stats === "object" ? parsed.stats : null,
      portfolioHistory: Array.isArray(parsed?.portfolioHistory) ? parsed.portfolioHistory : [],
    };
  } catch {
    return null;
  }
}

/**
 * Persist only the value-bearing fields (stats + history). The investment rows
 * are rebuilt from local SQLite within milliseconds on the next mount, so
 * storing them would cost quota without buying a faster paint.
 */
function persistStats(cacheKey, stats, portfolioHistory) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(
      `${PORTFOLIO_PERSIST_KEY_PREFIX}${cacheKey}`,
      JSON.stringify({
        stats: stats || {},
        portfolioHistory: Array.isArray(portfolioHistory) ? portfolioHistory : [],
        updatedAt: Date.now(),
      }),
    );
  } catch {
    // Quota or private-mode failures must never break the dashboard.
  }
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
  // Whether the currently displayed stats came from a priced payload. Read from
  // a ref inside applyPortfolioPayload so an unpriced (local-only) payload can
  // decide synchronously whether it may overwrite known values with zeros.
  const [statsArePriced, setStatsArePriced] = useState(false);
  const statsArePricedRef = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const markStatsPriced = useCallback((priced) => {
    statsArePricedRef.current = priced;
    setStatsArePriced(priced);
  }, []);

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
    if (snapshot) {
      setInvestments(snapshot.investments || []);
      setAuthRequired(Boolean(snapshot.authRequired));
      setStats(snapshot.stats || {});
      setPortfolioHistory(snapshot.portfolioHistory || []);
      setWarnings(snapshot.warnings || []);
      markStatsPriced(true);
      setError("");
      setIsLoading(false);
      return;
    }

    // No in-memory snapshot (fresh app start, or the paint window elapsed):
    // restore the last known values so the KPI cards and the chart do not fall
    // back to zeros while the local rows and the upstream refresh are on their
    // way. Rows stay empty — they are rebuilt from local SQLite immediately.
    const persisted = readPersistedStats(cacheKey);
    if (persisted?.stats) {
      setStats(persisted.stats);
      setPortfolioHistory(persisted.portfolioHistory);
      markStatsPriced(true);
    }
  }, [cacheKey, markStatsPriced, userCacheSegment]);

  const applyPortfolioPayload = useCallback((payload, { cachePayload = true, targetCacheKey = cacheKey } = {}) => {
    const { rows: rowsResponse, summary: summaryResponse, history, requiresAuth } = payload || {};
    const nextWarnings = mergeWarnings(
      rowsResponse?.meta?.warnings || [],
      summaryResponse?.meta?.warnings || []
    );
    const priced = isPricedPayload(payload);
    // An unpriced payload carries real rows but all-zero values. It may fill in
    // what we do not have yet, but it must never overwrite known values.
    const keepKnownValues = !priced && statsArePricedRef.current;

    setAuthRequired(requiresAuth || false);
    setInvestments(rowsResponse?.data || []);
    setWarnings(nextWarnings);
    setError("");

    if (!keepKnownValues) {
      setStats(summaryResponse?.data || {});
      setPortfolioHistory(history || []);
      markStatsPriced(priced);
    }

    if (cachePayload && priced) {
      portfolioViewCache.set(targetCacheKey, {
        investments: rowsResponse?.data || [],
        authRequired: requiresAuth || false,
        stats: summaryResponse?.data || {},
        portfolioHistory: history || [],
        warnings: nextWarnings,
        updatedAt: Date.now(),
      });
      persistStats(targetCacheKey, summaryResponse?.data || {}, history || []);
    }
  }, [cacheKey, markStatsPriced]);

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
    setIsRefreshing(true);
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
      // A superseded run (scope flip, account switch) must not clear the loading
      // state of the run that replaced it — its abort resolves after the new run
      // has already set the flags.
      if (!signal.aborted) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
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
    // True while no priced values are available yet and a load is still running.
    // Value-bearing UI must render a skeleton instead of the zeros in `stats` —
    // on desktop those zeros are "price unknown", not "portfolio is worth 0".
    // Flips to false once the load settles, so an upstream that never returns
    // prices shows the real (zero) numbers plus the warning rather than an
    // eternal skeleton.
    statsPending: !statsArePriced && (isLoading || isRefreshing),
    stats,
    portfolioHistory,
    error,
    warnings,
    refreshPortfolio: loadData,
    removeInvestmentFromView,
  };
}
