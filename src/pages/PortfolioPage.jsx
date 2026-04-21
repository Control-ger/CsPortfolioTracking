import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useModal } from "@/ModalContext";
import { ApiWarnings } from "@/components/ApiWarnings";
import { InventoryTable } from "@/components/InventoryTable";
import { ItemDetailsModal } from "@/components/ItemDetailsModal";
import { ItemDetailPanel } from "@/components/ItemDetailPanel";
import { CsFloatTradeSyncModal } from "@/components/CsFloatTradeSyncModal";
import { PortfolioChart } from "@/components/PortfolioChart";
import { PortfolioCompositionChart } from "@/components/PortfolioCompositionChart";
import { StatCard } from "@/components/StatsCards";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { Watchlist } from "@/components/Watchlist";
import { WatchlistOverview } from "@/components/WatchlistOverview";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortfolio } from "@/hooks/usePortfolio";
import { usePortfolioComposition } from "@/hooks/usePortfolioComposition";
import { useCsUpdatesFeed } from "@/hooks/useCsUpdatesFeed";
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

function formatRelativeHours(hours) {
  if (!Number.isFinite(hours)) {
    return "unbekannt";
  }

  if (hours < 1) {
    return "<1h";
  }

  return `${Math.max(1, Math.round(hours))}h`;
}

export function PortfolioPage() {
  const {
    enrichedInvestments,
    isLoading: portfolioLoading,
    stats,
    portfolioHistory,
    error,
    warnings,
    refreshPortfolio,
    removeInvestmentFromView,
  } =
    usePortfolio();
  const {
    latestItem: latestCsUpdate,
    latestItemAgeHours: latestCsUpdateAgeHours,
    isLoading: csUpdatesLoading,
  } = useCsUpdatesFeed();
  const {
    data: compositionData,
    loading: compositionLoading,
    error: compositionError,
  } = usePortfolioComposition();
  const { modals, openModal, closeModal } = useModal();
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemHistory, setSelectedItemHistory] = useState([]);
  const [selectedItemHistoryLoading, setSelectedItemHistoryLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [watchlistFocusTarget, setWatchlistFocusTarget] = useState(null);
  const [isCsFloatSyncOpen, setIsCsFloatSyncOpen] = useState(false);

  const handleExcludeChange = async (itemId, excluded) => {
    if (excluded) {
      setSelectedItem((currentItem) => (currentItem?.id === itemId ? null : currentItem));
      setSelectedItemHistory([]);
      removeInvestmentFromView(itemId);
    }

    await refreshPortfolio();
  };

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
        setSelectedItemHistoryLoading(false);
        return;
      }

      setSelectedItemHistoryLoading(true);
      try {
        const history = await fetchPortfolioInvestmentHistory(selectedItemWithLive.id);
        setSelectedItemHistory(history || []);
      } catch (historyError) {
        console.error("Fehler beim Laden der Positionshistorie:", historyError);
        setSelectedItemHistory([]);
      } finally {
        setSelectedItemHistoryLoading(false);
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

  const loadItemHistory = async (itemId) => {
    setSelectedItemHistoryLoading(true);
    try {
      const history = await fetchPortfolioInvestmentHistory(itemId);
      setSelectedItemHistory(history || []);
    } catch (historyError) {
      console.error("Fehler beim Laden der Positionshistorie:", historyError);
      setSelectedItemHistory([]);
    } finally {
      setSelectedItemHistoryLoading(false);
    }
  };

  const liveItems = Number(stats.liveItemsCount || 0);
  const staleItems = Number(stats.staleLiveItemsCount || 0);
  const staleRatio = Number(stats.staleLiveItemsRatioPercent || 0);
  const showCsUpdateBanner =
    !csUpdatesLoading &&
    Boolean(latestCsUpdate) &&
    Number.isFinite(latestCsUpdateAgeHours) &&
    latestCsUpdateAgeHours <= 12;

  return (
    <div className="min-h-screen bg-background p-4 font-sans text-foreground sm:p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6 sm:space-y-8">
        <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">CS Investor Hub</h1>
            <p className="text-sm text-muted-foreground sm:text-base">Live Tracking via CSFloat and Currency API</p>
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
          <TabsList className="grid w-full grid-cols-3 gap-1 sm:max-w-160">
            <TabsTrigger value="overview" className="text-xs sm:text-sm">Uebersicht</TabsTrigger>
            <TabsTrigger value="inventory" className="text-xs sm:text-sm">Inventar</TabsTrigger>
            <TabsTrigger value="watchlist" className="text-xs sm:text-sm">Watchlist</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 sm:space-y-6">
            <div className="grid gap-2 sm:gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
              <StatCard
                title="Portfolio Wert (Live)"
                value={`${(stats.totalValue || 0).toFixed(2)} EUR`}
                isPositive={stats.isPositive}
              />
              <StatCard
                title="Gesamt Zuwachs"
                value={`${stats.isPositive ? "+" : ""}${(stats.totalProfitEuro || 0).toFixed(2)} EUR`}
                subValue={`${(stats.totalRoiPercent || 0) >= 0 ? "+" : ""}${(stats.totalRoiPercent || 0).toFixed(2)}%`}
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

            <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2">
              <PortfolioChart history={portfolioHistory} isLoading={portfolioLoading} />
              <WatchlistOverview maxItems={5} onOpenItem={handleOpenWatchlistItem} />
            </div>

            <div className="grid gap-4 sm:gap-6 grid-cols-1">
              <div className="rounded-lg border bg-card p-4 sm:p-6">
                <h3 className="mb-4 text-lg font-semibold">Portfolio Zusammensetzung</h3>
                {compositionLoading ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                      <div className="lg:col-span-2 flex justify-center">
                        <Skeleton className="h-[220px] w-full max-w-sm sm:h-[320px]" />
                      </div>
                      <div className="space-y-2">
                        {[1, 2, 3, 4].map((entry) => (
                          <Skeleton key={entry} className="h-14 w-full" />
                        ))}
                      </div>
                    </div>
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : compositionError ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {compositionError}
                  </div>
                ) : (
                  <PortfolioCompositionChart data={compositionData} />
                )}
              </div>
            </div>

            {showCsUpdateBanner && latestCsUpdate ? (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-4 py-3 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">
                      CS Update
                    </p>
                    <p className="truncate text-sm font-semibold text-foreground sm:text-base">
                      Neues Update seit {formatRelativeHours(latestCsUpdateAgeHours)}: {latestCsUpdate.title}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Feed oeffnen
                    </span>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/cs-updates">Fullscreen</Link>
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="inventory" className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
            <div className="md:col-span-2 flex items-center justify-between gap-3 rounded-lg border bg-card p-3 sm:p-4">
              <div>
                <h3 className="text-base font-semibold">Inventar importieren</h3>
                <p className="text-xs text-muted-foreground">
                  Manueller CSFloat-Sync: zuerst Preview, dann nach Backup-Bestaetigung importieren.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => setIsCsFloatSyncOpen(true)}>
                CSFloat Sync
              </Button>
            </div>

            <div className="rounded-lg border bg-card overflow-x-auto md:col-span-1">
              <InventoryTable
                investments={enrichedInvestments}
                onSelectItem={(item) => {
                  setSelectedItem(item);
                  const historyItem = enrichedInvestments.find((inv) => inv.id === item.id);
                  if (historyItem) {
                    loadItemHistory(historyItem.id).then(() => {
                      // Auf Mobile: Modal öffnen (nach Geschichtsdaten geladen)
                      if (window.innerWidth < 768) {
                        openModal("itemDetail", { item });
                      }
                    });
                  }
                }}
              />
            </div>

            <div className="hidden md:block md:col-span-1">
              <ItemDetailPanel
                item={selectedItem}
                history={selectedItemHistory}
                historyLoading={selectedItemHistoryLoading}
                onExcludeChange={handleExcludeChange}
              />
            </div>

            {modals.map((modal) =>
              modal.type === "itemDetail" ? (
                <ItemDetailsModal
                  key={modal.id}
                  isOpen={true}
                  onClose={() => closeModal(modal.id)}
                  item={modal.data.item}
                  history={selectedItemHistory}
                  historyLoading={selectedItemHistoryLoading}
                />
              ) : null,
            )}
          </TabsContent>

          <TabsContent value="watchlist" className="space-y-4 sm:space-y-6">
            <Watchlist focusTarget={watchlistFocusTarget} />
          </TabsContent>
        </Tabs>

        <CsFloatTradeSyncModal
          isOpen={isCsFloatSyncOpen}
          onClose={() => setIsCsFloatSyncOpen(false)}
          onSynced={async () => {
            await refreshPortfolio();
          }}
        />
      </div>
    </div>
  );
}
