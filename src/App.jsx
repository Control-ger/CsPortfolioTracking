import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { StatCard } from "./components/StatsCards";
import { InventoryTable } from "./components/InventoryTable";
import { ItemDetailPanel } from "./components/ItemDetailPanel";
import { PortfolioChart } from "./components/PortfolioChart";
import { Watchlist } from "./components/Watchlist";
import { WatchlistOverview } from "./components/WatchlistOverview";
import { ApiWarnings } from "./components/ApiWarnings";
import { usePortfolio } from "./hooks/usePortfolio";
import { fetchPortfolioInvestmentHistory } from "./lib/apiClient";

export default function Dashboard() {
  const { enrichedInvestments, stats, ***REMOVED***History, error, warnings } =
    usePortfolio();
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemHistory, setSelectedItemHistory] = useState([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [watchlistFocusTarget, setWatchlistFocusTarget] = useState(null);

  const selectedItemWithLive = useMemo(() => {
    if (!selectedItem) return null;
    return enrichedInvestments.find((i) => i.id === selectedItem.id);
  }, [selectedItem, enrichedInvestments]);

  useEffect(() => {
    const loadItemHistory = async () => {
      if (!selectedItemWithLive) {
        setSelectedItemHistory([]);
        return;
      }

      try {
        const history = await fetchPortfolioInvestmentHistory(
          selectedItemWithLive.id
        );
        setSelectedItemHistory(history || []);
      } catch (historyError) {
        console.error("Fehler beim Laden der Positionshistorie:", historyError);
        setSelectedItemHistory([]);
      }
    };

    loadItemHistory();
  }, [selectedItemWithLive]);

  const handleOpenWatchlistItem = (item) => {
    if (!item?.id) {
      return;
    }

    setWatchlistFocusTarget({
      id: item.id,
      requestedAt: Date.now(),
    });
    setActiveTab("watchlist");
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-primary">
            CS Investor Hub
          </h1>
          <p className="text-muted-foreground">
            Live Tracking via CSFloat & Currency API
          </p>
        </header>

        <ApiWarnings warnings={warnings} />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {error && (
            <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <TabsList className="grid w-full max-w-100 grid-cols-3">
            <TabsTrigger value="overview">Übersicht</TabsTrigger>
            <TabsTrigger value="inventory">Inventar & Details</TabsTrigger>
            <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <StatCard
                title="Portfolio Wert (Live)"
                value={`${stats.totalValue.toFixed(2)}€`}
                subValue={`Einsatz: ${stats.totalInvested.toFixed(2)}€`}
                isPositive={stats.isPositive}
              />
              <StatCard
                title="Gesamt Profit/Loss"
                value={`${stats.isPositive ? "+" : ""}${stats.totalProfitEuro.toFixed(2)}€`}
                subValue={`${stats.isPositive ? "+" : ""}${stats.totalRoiPercent.toFixed(2)}%`}
                isPositive={stats.isPositive}
              />
              <StatCard
                title="Items im Bestand"
                value={`${stats.totalQuantity} Stück`}
              />
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <PortfolioChart
                history={***REMOVED***History}
                color={stats.chartColor}
              />
              <WatchlistOverview
                maxItems={5}
                onOpenItem={handleOpenWatchlistItem}
              />
            </div>
          </TabsContent>

          <TabsContent
            value="inventory"
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            <div className="md:col-span-2 bg-card rounded-lg border">
              <InventoryTable
                investments={enrichedInvestments}
                onSelectItem={setSelectedItem}
              />
            </div>
            <ItemDetailPanel
              item={selectedItemWithLive}
              history={selectedItemHistory}
            />
          </TabsContent>

          <TabsContent value="watchlist" className="space-y-6">
            <Watchlist focusTarget={watchlistFocusTarget} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
