import { useState, useEffect } from "react";
import {
  fetchPortfolioHistory,
  fetchPortfolioInvestments,
  fetchPortfolioSummary,
  savePortfolioDailyValue,
} from "@/lib/apiClient.js";

export function usePortfolio() {
  const [investments, setInvestments] = useState([]);
  const [stats, setStats] = useState({
    totalValue: 0,
    totalInvested: 0,
    totalQuantity: 0,
    totalProfitEuro: 0,
    totalRoiPercent: 0,
    isPositive: true,
    chartColor: "#22c55e",
  });
  const [***REMOVED***History, setPortfolioHistory] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadData = async () => {
      try {
        const [rows, summary, history] = await Promise.all([
          fetchPortfolioInvestments(),
          fetchPortfolioSummary(),
          fetchPortfolioHistory(),
        ]);

        setInvestments(rows || []);
        setStats(summary || {});
        setPortfolioHistory(history || []);
        setError("");

        if ((summary?.totalValue || 0) > 0) {
          await savePortfolioDailyValue(summary.totalValue);
        }
      } catch (err) {
        setError(err.message || "Fehler beim Laden der Portfolio-Daten.");
      }
    };

    loadData();
  }, []);

  return {
    enrichedInvestments: investments,
    stats,
    ***REMOVED***History,
    error,
  };
}
