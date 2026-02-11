import { useState, useEffect, useMemo } from "react";
// import data from "../data.json"; // GELÖSCHT
import { getLivePrice } from "@/components/csfloatService.js";
import { getExchangeRate } from "@/components/currencyService.js";

export function usePortfolio() {
  const [investments, setInvestments] = useState([]); // Neuer State für DB-Daten
  const [livePrices, setLivePrices] = useState({});

  // 1. Daten aus der PHP-API laden
  useEffect(() => {
    fetch("http://localhost/cs-api/getPortfolioData.php")
      .then((res) => res.json())
      // In deinem useEffect im usePortfolio Hook
      .then((***REMOVED***Data) => {
        const formatted = ***REMOVED***Data.map((item) => ({
          ...item,
          // Konvertierung von DB (snake_case) zu React (camelCase)
          buyPrice: parseFloat(item.buy_price || 0),
          quantity: parseInt(item.quantity || 0),
        }));
        setInvestments(formatted); // Das füllt deine Tabelle
      })
      .catch((err) => console.error("Fehler beim Laden der API:", err));
  }, []);

  // 2. Live-Preise abrufen (angepasst auf investments-State)
  useEffect(() => {
    const fetchAllPrices = async () => {
      if (investments.length === 0) return;
      const rate = await getExchangeRate();
      for (const item of investments) {
        if (livePrices[item.name]) continue;
        const priceInUsd = await getLivePrice(item.name);
        if (priceInUsd) {
          const priceInEur = priceInUsd * rate;
          setLivePrices((prev) => ({ ...prev, [item.name]: priceInEur }));
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    };
    fetchAllPrices();
  }, [investments]); // Triggert, sobald die DB-Daten da sind

  const enrichedInvestments = useMemo(() => {
    return investments.map((item) => {
      const livePrice = livePrices[item.name];
      const currentVal = livePrice !== undefined ? livePrice : item.buyPrice;
      const isLive = livePrice !== undefined;
      const roi = ((currentVal - item.buyPrice) / item.buyPrice) * 100;

      return {
        ...item,
        livePrice: isLive ? livePrice : null,
        displayPrice: currentVal,
        roi,
        isLive,
      };
    });
  }, [investments, livePrices]);

  const stats = useMemo(() => {
    const totalValue = enrichedInvestments.reduce(
      (acc, i) => acc + i.displayPrice * i.quantity,
      0,
    );
    const totalInvested = investments.reduce(
      (acc, i) => acc + i.buyPrice * i.quantity,
      0,
    );
    const totalQuantity = enrichedInvestments.reduce(
      (acc, i) => acc + i.quantity,
      0,
    );
    const totalProfitEuro = totalValue - totalInvested;
    const totalRoiPercent =
      totalInvested !== 0 ? (totalProfitEuro / totalInvested) * 100 : 0;

    return {
      totalValue,
      totalInvested,
      totalQuantity,
      totalProfitEuro,
      totalRoiPercent,
      isPositive: totalProfitEuro >= 0,
      chartColor: totalProfitEuro >= 0 ? "#22c55e" : "#ef4444",
    };
  }, [enrichedInvestments, investments]);

  return {
    enrichedInvestments,
    stats,
    ***REMOVED***History: [], // Hier müsstest du später eine weitere DB-Tabelle für die Historie anlegen
  };
}
