import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useModal } from "@shared/contexts";
import { ApiWarnings } from "@shared/components";
import { InventoryTable } from "@shared/components";
import { ItemDetailsModal } from "@shared/components";
import { ItemDetailPanel } from "@shared/components";
import { CsFloatTradeSyncModal } from "@shared/components";
import { PortfolioChart } from "@shared/components";
import { PortfolioCompositionChart } from "@shared/components";
import { PortfolioHeaderCard } from "@shared/components";
import { StatCard } from "@shared/components";
import { ThemeToggle } from "@shared/components";
import { UserMenu } from "@shared/components";
import { Watchlist } from "@shared/components";
import { WatchlistOverview } from "@shared/components";
import { Badge } from "@shared/components";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/components";
import { Button } from "@shared/components";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/components";
import { Skeleton } from "@shared/components";
import { usePortfolio } from "@shared/hooks";
import { usePortfolioComposition } from "@shared/hooks";
import { useCsUpdatesFeed } from "@shared/hooks";
import { fetchPortfolioInvestmentHistory } from "@shared/lib";
import { BREAKPOINTS, UI } from "@shared/lib";
import { useKeyboard } from "@shared/hooks";

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

const TABS = ["overview", "inventory", "watchlist"];
const SWIPE_THRESHOLD = UI.SWIPE_THRESHOLD;

export function PortfolioPage({ initialTab = "overview" }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resolvedInitialTab = searchParams.get("tab") || initialTab;
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
  const [activeTab, setActiveTab] = useState(resolvedInitialTab);
  const [watchlistFocusTarget, setWatchlistFocusTarget] = useState(null);
  const [isCsFloatSyncOpen, setIsCsFloatSyncOpen] = useState(false);
  const [hoveredChartData, setHoveredChartData] = useState(null);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const touchEndX = useRef(null);
  const touchEndY = useRef(null);
  const searchInputRef = useRef(null);

  // Keyboard shortcuts for tab navigation and search
  useKeyboard({
    onArrowLeft: () => {
      const currentIndex = TABS.indexOf(activeTab);
      if (currentIndex > 0) {
        const newTab = TABS[currentIndex - 1];
        setActiveTab(newTab);
        navigate(`/?tab=${newTab}`, { replace: true });
      }
    },
    onArrowRight: () => {
      const currentIndex = TABS.indexOf(activeTab);
      if (currentIndex < TABS.length - 1) {
        const newTab = TABS[currentIndex + 1];
        setActiveTab(newTab);
        navigate(`/?tab=${newTab}`, { replace: true });
      }
    },
    onSearch: () => {
      // Focus search input if on watchlist tab, otherwise navigate to watchlist
      if (activeTab === 'watchlist' && searchInputRef.current) {
        searchInputRef.current.focus();
      } else {
        setActiveTab('watchlist');
        navigate('/?tab=watchlist', { replace: true });
        // Focus after navigation
        setTimeout(() => searchInputRef.current?.focus(), 100);
      }
    }
  }, true);

  useEffect(() => {
    setActiveTab(resolvedInitialTab);
  }, [resolvedInitialTab]);

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
        const history = await fetchPortfolioInvestmentHistory(selectedItemWithLive.id, {
          itemName: selectedItemWithLive.name,
        });
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

  const handleSwipeNavigation = (direction) => {
    const currentIndex = TABS.indexOf(activeTab);
    if (currentIndex === -1) return;

    let nextIndex;
    if (direction === "left") {
      nextIndex = Math.min(currentIndex + 1, TABS.length - 1);
    } else {
      nextIndex = Math.max(currentIndex - 1, 0);
    }

    if (nextIndex !== currentIndex) {
      const nextTab = TABS[nextIndex];
      const path = nextTab === "overview" ? "/" : `/${nextTab}`;
      navigate(path);
      setActiveTab(nextTab);
    }
  };

  const onTouchStart = (e) => {
    touchStartX.current = e.changedTouches[0].screenX;
    touchStartY.current = e.changedTouches[0].screenY;
    touchEndX.current = null;
    touchEndY.current = null;
  };

  const onTouchMove = (e) => {
    touchEndX.current = e.changedTouches[0].screenX;
    touchEndY.current = e.changedTouches[0].screenY;
  };

  const onTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;
    if (touchStartY.current === null || touchEndY.current === null) return;

    const distanceX = touchEndX.current - touchStartX.current;
    const distanceY = touchEndY.current - touchStartY.current;
    const isMobileView = window.innerWidth < BREAKPOINTS.MOBILE;

    // Only trigger if horizontal movement is greater than vertical
    const isHorizontalSwipe = Math.abs(distanceX) > Math.abs(distanceY);

    if (isMobileView && isHorizontalSwipe && Math.abs(distanceX) > SWIPE_THRESHOLD) {
      if (distanceX < 0) {
        handleSwipeNavigation("left");
      } else {
        handleSwipeNavigation("right");
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
    touchEndX.current = null;
    touchEndY.current = null;
  };

  const loadItemHistory = async (itemId, itemName) => {
    setSelectedItemHistoryLoading(true);
    try {
      const history = await fetchPortfolioInvestmentHistory(itemId, { itemName });
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
  const headerPortfolioValue = hoveredChartData?.wert ?? (stats.totalValue || 0);
  const headerPortfolioPercent = hoveredChartData?.growthPercent ?? (stats.totalRoiPercent || 0);
  const headerPortfolioPositive = hoveredChartData
    ? Number(hoveredChartData.growthPercent) >= 0
    : Boolean(stats.isPositive);
  const showCsUpdateBanner =
    !csUpdatesLoading &&
    Boolean(latestCsUpdate) &&
    Number.isFinite(latestCsUpdateAgeHours) &&
    latestCsUpdateAgeHours <= 12;

  return (
    <div
      className="min-h-screen bg-background font-sans text-foreground pb-20 touch-pan-y"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="mx-auto max-w-7xl space-y-6 sm:space-y-8 p-4 sm:p-6 md:p-8">
        {/* Mobile Header - nur auf Mobile sichtbar */}
        <header className="flex sm:hidden items-center justify-between">
          <h1 className="text-lg font-bold tracking-tight text-primary">CS Investor Hub</h1>
          <ThemeToggle />
        </header>

        {/* Header - nur auf Desktop sichtbar */}
        <header className="hidden sm:flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-primary md:text-3xl">CS Investor Hub</h1>
            <p className="text-sm text-muted-foreground md:text-base">Live Tracking via CSFloat and Currency API</p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <ApiWarnings warnings={warnings} />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* Tab Navigation - nur auf Desktop sichtbar */}
          <div className="hidden sm:block">
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
          </div>

          <TabsContent value="overview" className="space-y-4 sm:space-y-6">
            {/* Mobile: PortfolioHeaderCard oben, Desktop: Alte Stats-Cards */}
            <div className="sm:hidden">
              <PortfolioHeaderCard
                totalValue={headerPortfolioValue}
                totalRoiPercent={headerPortfolioPercent}
                isPositive={headerPortfolioPositive}
                totalQuantity={stats.totalQuantity}
                liveItemsCount={liveItems}
                staleItemsCount={staleItems}
                freshestDataAgeSeconds={stats.freshestDataAgeSeconds}
                oldestDataAgeSeconds={stats.oldestDataAgeSeconds}
              />
            </div>

            {/* Desktop: Alte Stats-Cards */}
            <div className="hidden sm:grid gap-2 sm:gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
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
              <PortfolioChart
                history={portfolioHistory}
                isLoading={portfolioLoading}
                onHoverChange={setHoveredChartData}
              />
              <div className="hidden md:block">
                <WatchlistOverview maxItems={5} onOpenItem={handleOpenWatchlistItem} />
              </div>
            </div>

            {/* Mobile: Watchlist full-width */}
            <div className="sm:hidden">
              <WatchlistOverview maxItems={5} onOpenItem={handleOpenWatchlistItem} />
            </div>

            <div className="grid gap-4 sm:gap-6 grid-cols-1">
              <div>
                <h3 className="mb-4 text-lg font-semibold">Portfolio Zusammensetzung</h3>
                {compositionLoading ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <div className="lg:col-span-2 flex justify-center">
                          <Skeleton className="h-55 w-full max-w-sm sm:h-80" />
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
            <div className="md:col-span-2 flex items-center justify-between gap-3 p-3 sm:p-4 sm:rounded-lg sm:border sm:bg-card">
              <div>
                <h3 className="text-base font-semibold">Inventar importieren</h3>
                <p className="text-xs text-muted-foreground">
                  Manueller CSFloat-Sync: zuerst Preview prüfen, dann Import starten.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => setIsCsFloatSyncOpen(true)}>
                CSFloat Sync
              </Button>
            </div>

            <div className="overflow-x-auto md:col-span-1 sm:rounded-lg sm:border sm:bg-card">
              <InventoryTable
                investments={enrichedInvestments}
                onSelectItem={(item) => {
                  setSelectedItem(item);
                  const historyItem = enrichedInvestments.find((inv) => inv.id === item.id);
                  if (historyItem) {
                    loadItemHistory(historyItem.id, historyItem.name).then(() => {
                      // Auf Mobile: Modal öffnen (nach Geschichtsdaten geladen)
                      if (window.innerWidth < BREAKPOINTS.MOBILE) {
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
                  onToggleExclude={handleExcludeChange}
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
            setActiveTab("inventory");
            setIsCsFloatSyncOpen(false);
          }}
        />
      </div>
    </div>
  );
}
