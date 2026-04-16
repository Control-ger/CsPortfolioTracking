import { useState, useEffect } from "react";
import {
  fetchPortfolioHistory,
  fetchPortfolioInvestments,
  fetchPortfolioSummary,
  savePortfolioDailyValue,
} from "@/lib/apiClient.js";

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
  const [investments, setInvestments] = useState([]);
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
  const [***REMOVED***History, setPortfolioHistory] = useState([]);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [rowsResponse, summaryResponse, history] = await Promise.all([
          fetchPortfolioInvestments(),
          fetchPortfolioSummary(),
          fetchPortfolioHistory(),
        ]);

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

        if ((summaryResponse?.data?.totalValue || 0) > 0) {
          await savePortfolioDailyValue(summaryResponse.data.totalValue);
        }
      } catch (err) {
        setError(err.message || "Fehler beim Laden der Portfolio-Daten.");
        setWarnings([]);
      }
    };

    loadData();
  }, []);

  return {
    enrichedInvestments: investments,
    stats,
    ***REMOVED***History,
    error,
    warnings,
  };
}
