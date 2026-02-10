import React, { useState, useMemo, useEffect } from "react";
import data from "./data.json";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { StatCard } from "./components/StatsCards";
import { InventoryTable } from "./components/InventoryTable";
import { ItemDetailPanel } from "./components/ItemDetailPanel";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { getLivePrice } from "@/components/csfloatService.js";
import { getExchangeRate } from "@/components/currencyService.js";

export default function Dashboard() {
  const [selectedItem, setSelectedItem] = useState(null);

  // State für die Live-Preise: { "Fracture Case": 0.75, ... }
  const [livePrices, setLivePrices] = useState({});

  // Effekt: Preise beim Starten nacheinander laden
  // In Dashboard.jsx

  useEffect(() => {
    const fetchAllPrices = async () => {
      // 1. Kurs NUR EINMAL am Anfang abrufen
      console.log("Hole aktuellen Wechselkurs USD -> EUR...");
      const rate = await getExchangeRate();

      // 2. Jetzt die Items nacheinander abarbeiten
      for (const item of data.investments) {
        // Falls wir den Preis schon in dieser Session haben, überspringen
        if (livePrices[item.name]) continue;

        const priceInUsd = await getLivePrice(item.name);

        if (priceInUsd) {
          // Umrechnung direkt hier vor dem Speichern in den State
          const priceInEur = priceInUsd * rate;

          setLivePrices((prev) => ({
            ...prev,
            [item.name]: priceInEur,
          }));
        }

        // Kurze Pause für die CSFloat API
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    };

    fetchAllPrices();
  }, []); // Leeres Array [] sorgt dafür, dass dieser Effekt nur beim ersten Laden der Seite läuft

  // 1. Die "angereicherten" Daten berechnen
  const enrichedInvestments = useMemo(() => {
    return data.investments.map((item) => {
      const livePrice = livePrices[item.name];

      // Wir nehmen den Live-Preis, wenn er da ist.
      // Wenn nicht, ist die App ehrlich und zeigt den Kaufpreis als Basis an,
      // kennzeichnet aber, dass es noch kein Live-Update gab.
      const currentVal = livePrice !== undefined ? livePrice : item.buyPrice;
      const isLive = livePrice !== undefined;

      const roi = ((currentVal - item.buyPrice) / item.buyPrice) * 100;

      return {
        ...item,
        livePrice: isLive ? livePrice : null,
        displayPrice: currentVal,
        roi: roi,
        isLive: isLive,
      };
    });
  }, [livePrices]);

  // 2. Die Gesamt-Statistiken
  const stats = useMemo(() => {
    // Aktueller Gesamtwert
    const totalValue = enrichedInvestments.reduce(
      (acc, i) => acc + i.displayPrice * i.quantity,
      0,
    );

    // Summe der Einkaufspreise
    const totalInvested = data.investments.reduce(
      (acc, i) => acc + i.buyPrice * i.quantity,
      0,
    );

    // NEU/GEFIXED: Summe der Items (die Zeile hat gefehlt)
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
      totalQuantity, // Jetzt ist es wieder im Objekt enthalten!
      totalProfitEuro,
      totalRoiPercent,
      isPositive: totalProfitEuro >= 0,
      chartColor: totalProfitEuro >= 0 ? "#22c55e" : "#ef4444",
    };
  }, [enrichedInvestments]);

  // Das aktuell ausgewählte Item mit Live-Daten updaten
  const selectedItemWithLive = useMemo(() => {
    if (!selectedItem) return null;
    return enrichedInvestments.find((i) => i.id === selectedItem.id);
  }, [selectedItem, enrichedInvestments]);

  return (
    <div className="min-h-screen bg-background text-foreground p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">
            Counter Strike Investment Tracking
          </h1>
          <p className="text-muted-foreground">
            Live Portfolio-Tracking mit den CSFloat API Daten und den Aktuellen
            Currency Exchange Raten von open.er-api.com
          </p>
        </header>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full max-w-100 grid-cols-2">
            <TabsTrigger value="overview">Übersicht</TabsTrigger>
            <TabsTrigger value="inventory">Inventar & Details</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {/* Karte 1: Was ist es aktuell wert? */}
              <StatCard
                title="Portfolio Wert (Live)"
                value={`${stats.totalValue.toFixed(2)}€`}
                subValue={`Einsatz: ${stats.totalInvested.toFixed(2)}€`}
                isPositive={stats.isPositive} // <--- Das färbt den Wert/Pfeil basierend auf Gewinn/Verlust
              />

              {/* Karte 2: Wie viel Gewinn/Verlust insgesamt? */}
              <StatCard
                title="Gesamt Profit/Loss"
                value={`${stats.isPositive ? "+" : ""}${stats.totalProfitEuro.toFixed(2)}€`}
                subValue={`${stats.isPositive ? "+" : ""}${stats.totalRoiPercent.toFixed(2)}%`}
                isPositive={stats.isPositive}
              />

              {/* Karte 3: Inventar-Größe */}
              <StatCard
                title="Items im Bestand"
                value={`${stats.totalQuantity} Stück`}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Portfolio Entwicklung (wip)</CardTitle>
              </CardHeader>
              <CardContent className="h-87.5 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.***REMOVED***History}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="hsl(var(--border))"
                    />
                    <XAxis dataKey="date" hide />
                    <YAxis hide />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="wert"
                      stroke={stats.chartColor}
                      strokeWidth={2}
                      dot={{ r: 4, fill: stats.chartColor }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="inventory"
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Deine Investments</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Wir geben die enrichedInvestments weiter! */}
                <InventoryTable
                  investments={enrichedInvestments}
                  onSelectItem={setSelectedItem}
                />
              </CardContent>
            </Card>
            <ItemDetailPanel item={selectedItemWithLive} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
