import { useState, useEffect, useCallback, useRef } from "react";
import { fetchPortfolioData } from "@shared/lib/dataSource.js";

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

export function usePortfolio() {
  const abortControllerRef = useRef(null);
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

  const loadData = useCallback(async () => {
    // Abort previous request if still pending
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setIsLoading(true);
    try {
      const { rows: rowsResponse, summary: summaryResponse, history, requiresAuth } =
        await fetchPortfolioData({ signal });

      // Don't update state if request was aborted
      if (signal.aborted) return;

      // Update auth state from data source
      setAuthRequired(requiresAuth || false);
      setInvestments(rowsResponse?.data || []);
      setStats(summaryResponse?.data || {});
      setPortfolioHistory(history || []);
      setWarnings(
        mergeWarnings(
          rowsResponse?.meta?.warnings || [],
          summaryResponse?.meta?.warnings || []
        )
      );
      setError("");
    } catch (err) {
      // Don't update state for abort errors
      if (err.name === 'AbortError') return;
      setError(err.message || "Fehler beim Laden der Portfolio-Daten.");
      setWarnings([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const removeInvestmentFromView = useCallback((investmentId) => {
    setInvestments((currentInvestments) =>
      currentInvestments.filter((investment) => investment.id !== investmentId)
    );
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadData);
  }, [loadData]);

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
