import { useEffect, useMemo, useState } from "react";

import { useModal } from "@/ModalContext";
import { ApiWarnings } from "@/components/ApiWarnings";
import { InventoryTable } from "@/components/InventoryTable";
import { ItemDetailModal } from "@/components/ItemDetailModal";
import { PortfolioChart } from "@/components/PortfolioChart";
import { PortfolioCompositionChart } from "@/components/PortfolioCompositionChart";
import { StatCard } from "@/components/StatsCards";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { Watchlist } from "@/components/Watchlist";
import { WatchlistOverview } from "@/components/WatchlistOverview";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePortfolio } from "@/hooks/usePortfolio";
import { usePortfolioComposition } from "@/hooks/usePortfolioComposition";
import { fetchPortfolioInvestmentHistory } from "@/lib/apiClient";

function formatAge(seconds) {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) {
    return "-";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }

  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h`;
  }

  return `${Math.floor(seconds / 86400)}d`;
}

function freshnessBadgeClass(staleRatio) {
  if (staleRatio <= 0) {
    return "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900/60 dark:text-emerald-300";
  }
  if (staleRatio < 50) {
    return "border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-900/60 dark:text-amber-300";
  }

  return "border-red-200 bg-red-500/10 text-red-700 dark:border-red-900/60 dark:text-red-300";
}

export function PortfolioPage() {
  const { enrichedInvestments, stats, ***REMOVED***History, error, warnings } =
    usePortfolio();
  const { data: compositionData } = usePortfolioComposition();
  const { modals, openModal, closeModal } = useModal();
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemHistory, setSelectedItemHistory] = useState([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [watchlistFocusTarget, setWatchlistFocusTarget] = useState(null);

  const selectedItemWithLive = useMemo(() => {
    if (!selectedItem) {
      return null;
    }

    return enrichedInvestments.find((investment) => investment.id === selectedItem.id);
  }, [selectedItem, enrichedInvestments]);

  useEffect(() => {
    const loadItemHistory = async () => {
      if (!selectedItemWithLive) {
        setSelectedItemHistory([]);
        return;
      }

      try {
        const history = await fetchPortfolioInvestmentHistory(selectedItemWithLive.id);
        setSelectedItemHistory(history || []);
      } catch (historyError) {
        console.error("Fehler beim Laden der Positionshistorie:", historyError);
        setSelectedItemHistory([]);
      }
    };

    void loadItemHistory();
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

  const liveItems = Number(stats.liveItemsCount || 0);
  const staleItems = Number(stats.staleLiveItemsCount || 0);
  const staleRatio = Number(stats.staleLiveItemsRatioPercent || 0);

  return (
    <div className="min-h-screen bg-background p-8 font-sans text-foreground">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-primary">CS Investor Hub</h1>
            <p className="text-muted-foreground">Live Tracking via CSFloat and Currency API</p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <ApiWarnings warnings={warnings} />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {error && (
            <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <TabsList className="grid w-full max-w-[640px] grid-cols-3">
            <TabsTrigger value="overview">Uebersicht</TabsTrigger>
            <TabsTrigger value="inventory">Inventar und Details</TabsTrigger>
            <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatCard
                title="Portfolio Wert (Live)"
                value={`${(stats.totalValue || 0).toFixed(2)} EUR`}
                subValue={`Einsatz: ${(stats.totalInvested || 0).toFixed(2)} EUR`}
                isPositive={stats.isPositive}
              />
              <StatCard
                title="Gesamt Profit/Loss"
                value={`${stats.isPositive ? "+" : ""}${(stats.totalProfitEuro || 0).toFixed(2)} EUR`}
                subValue={`${stats.isPositive ? "+" : ""}${(stats.totalRoiPercent || 0).toFixed(2)}%`}
                isPositive={stats.isPositive}
              />
              <StatCard title="Items im Bestand" value={`${stats.totalQuantity} Stueck`} />
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
                    Data Freshness
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-2xl font-bold">
                    {formatAge(stats.freshestDataAgeSeconds)} - {formatAge(stats.oldestDataAgeSeconds)}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      Live: {liveItems} | Stale: {staleItems}
                    </span>
                    <Badge variant="outline" className={freshnessBadgeClass(staleRatio)}>
                      {staleRatio.toFixed(0)}% stale
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <PortfolioChart history={***REMOVED***History} color={stats.chartColor} />
              <WatchlistOverview maxItems={5} onOpenItem={handleOpenWatchlistItem} />
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-lg border bg-card p-6">
                <h3 className="mb-4 text-lg font-semibold">Portfolio Zusammensetzung</h3>
                <PortfolioCompositionChart data={compositionData} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="inventory" className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-lg border bg-card md:col-span-3">
              <InventoryTable
                investments={enrichedInvestments}
                onSelectItem={(item) => {
                  setSelectedItem(item);
                  openModal("itemDetail", { item, history: selectedItemHistory });
                }}
              />
            </div>

            {modals.map((modal) =>
              modal.type === "itemDetail" ? (
                <ItemDetailModal
                  key={modal.id}
                  isOpen={true}
                  onClose={() => closeModal(modal.id)}
                  item={modal.data.item}
                  history={selectedItemHistory}
                />
              ) : null,
            )}
          </TabsContent>

          <TabsContent value="watchlist" className="space-y-6">
            <Watchlist focusTarget={watchlistFocusTarget} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
