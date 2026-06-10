import { TrendingUp, TrendingDown } from "lucide-react";

import { PortfolioChart } from "./PortfolioChart.jsx";
import { PortfolioCompositionChart } from "./PortfolioCompositionChart.jsx";
import { PortfolioHeaderCard } from "./PortfolioHeaderCard.jsx";
import { StatCard } from "./StatsCards.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "./Card.jsx";
import { Badge } from "./Badge.jsx";
import { Skeleton } from "./ui/skeleton.jsx";
import { Button } from "./Button.jsx";
import { useCurrency } from "../contexts/CurrencyContext.js";
import {
  formatAge,
  syncHealthBadgeClass,
  syncHealthLabel,
  formatRelativeHours,
} from "../lib/portfolioHelpers.js";

export function PortfolioOverviewSection({
  forceMount,
  stats,
  portfolioLoading,
  metricsScope,
  portfolioPreferences,
  headerPortfolioValue,
  headerPortfolioPercent,
  headerPortfolioPositive,
  headerPortfolioValueLabel,
  headerProfitEuro,
  headerProfitPercent,
  headerProfitSubLabel,
  headerProfitPositive,
  liveItems,
  staleItems,
  showCsUpdateBanner,
  latestCsUpdate,
  latestCsUpdateAgeHours,
  latestCsUpdateImpact,
  latestCsUpdateBannerTone,
  latestCsUpdateAiModelLabel,
  hasUnreadCsUpdate,
  handleOpenLatestCsUpdateFeed,
  scopedPortfolioHistory,
  portfolioChartCardRef,
  onChartHoverChange,
  onChartTrendChange,
  handleMetricsScopeChange,
  watchlistTopMovers,
  watchlistMoverPanelHeight,
  setWatchlistFocusTarget,
  handleTabSelect,
  compositionData,
  compositionLoading,
  compositionError,
  portfolioTotalValueForDisplay,
  portfolioValueLabel,
}) {
  const { formatPrice } = useCurrency();

  return (
    <div forceMount={forceMount} className="space-y-5 sm:space-y-5 lg:space-y-4 lg:pb-6">
      {/* Mobile: PortfolioHeaderCard oben */}
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

      {showCsUpdateBanner && latestCsUpdate ? (
        <div
          role="button"
          tabIndex={0}
          onClick={handleOpenLatestCsUpdateFeed}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleOpenLatestCsUpdateFeed();
            }
          }}
          className={`rounded-2xl border px-4 py-4 sm:px-5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${latestCsUpdateBannerTone.wrapper}`}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${latestCsUpdateBannerTone.eyebrow}`}>
                  CS Update Alert
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground sm:text-base">
                  Neues CS Update seit {formatRelativeHours(latestCsUpdateAgeHours)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={latestCsUpdateImpact.badgeClass}>
                  {latestCsUpdateImpact.label}
                </Badge>
                <Badge variant="outline" className="border-violet-400/30 bg-violet-500/10 text-violet-200">
                  KI generiert
                </Badge>
              </div>
            </div>

            <div className={`rounded-xl border p-3 ${latestCsUpdateBannerTone.panel}`}>
              <p className="line-clamp-2 text-sm font-semibold text-foreground">{latestCsUpdate.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                KI Aktion: <span className="text-foreground">{latestCsUpdateImpact.actionLabel}</span>
              </p>
              {latestCsUpdate?.aiReasoning ? (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  KI Begruendung: {latestCsUpdate.aiReasoning}
                </p>
              ) : null}
              {latestCsUpdateAiModelLabel ? (
                <p className="mt-1 text-[11px] text-muted-foreground">Modell: {latestCsUpdateAiModelLabel}</p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {latestCsUpdate?.url ? (
                <Button asChild size="sm" onClick={(event) => event.stopPropagation()}>
                  <a href={latestCsUpdate.url} target="_blank" rel="noreferrer">
                    Original Update oeffnen
                  </a>
                </Button>
              ) : null}
              {hasUnreadCsUpdate ? (
                <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-300">
                  neu
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Desktop: Stats-Cards */}
      <div className="hidden sm:grid gap-2 sm:gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
        <StatCard
          title="Portfolio Wert (Live)"
          value={headerPortfolioValueLabel}
          isPositive={headerPortfolioPositive}
        />
        <StatCard
          title="Gesamt Zuwachs"
          value={`${headerProfitEuro >= 0 ? "+" : "-"}${formatPrice(Math.abs(headerProfitEuro))}`}
          subValue={`${headerProfitPercent >= 0 ? "+" : ""}${headerProfitPercent.toFixed(2)}% | ${headerProfitSubLabel}`}
          isPositive={headerProfitPositive}
        />
        <StatCard title="Items im Bestand" value={`${stats.totalQuantity} Stueck`} />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
              Price Sync
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-bold">
              {formatAge(stats.freshestDataAgeSeconds)} zuletzt
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                Live Quotes: {liveItems} | Aeltestes Cache-Alter: {formatAge(stats.oldestDataAgeSeconds)}
              </span>
              <Badge variant="outline" className={syncHealthBadgeClass(Number(stats.oldestDataAgeSeconds), liveItems)}>
                {syncHealthLabel(Number(stats.oldestDataAgeSeconds), liveItems)}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-stretch">
        <div className="min-w-0">
          <PortfolioChart
            cardRef={portfolioChartCardRef}
            history={scopedPortfolioHistory}
            isLoading={portfolioLoading && scopedPortfolioHistory.length === 0}
            onHoverChange={onChartHoverChange}
            onTrendChange={onChartTrendChange}
            metricsScope={metricsScope}
            onMetricsScopeChange={
              portfolioPreferences.metricsDisplayMode === "toggle_mode"
                ? (nextScope) => void handleMetricsScopeChange(nextScope)
                : null
            }
          />
        </div>
        <Card
          className="flex min-h-[340px] flex-col border-border/70 bg-card/70 lg:min-h-0 lg:overflow-hidden"
          style={watchlistMoverPanelHeight ? { height: `${watchlistMoverPanelHeight}px` } : undefined}
        >
          <CardHeader className="space-y-2 pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Watchlist Mover</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleTabSelect("watchlist")}
              >
                Zur Watchlist
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Basis: Watchlist 7-Tage-Verlauf. Bei wenigen Gewinnern/Verlierern werden weitere Mover gezeigt.
            </p>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {watchlistTopMovers.hasAny ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
                {watchlistTopMovers.gainers.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-400">
                      <TrendingUp className="h-4 w-4" />
                      Top Gewinner
                    </div>
                    <div className="space-y-2">
                      {watchlistTopMovers.gainers.map((item) => {
                        const currentPrice = Number(item?.currentPrice);
                        const currentPriceUsd = Number(item?.currentPriceUsd);
                        const hasUsdPrice = Number.isFinite(currentPriceUsd);
                        const hasCurrentPrice = hasUsdPrice || Number.isFinite(currentPrice);
                        const priceLabel = hasUsdPrice
                          ? formatPrice(currentPriceUsd, { useUsd: true, buyPriceUsd: currentPriceUsd })
                          : hasCurrentPrice
                            ? formatPrice(currentPrice)
                            : null;
                        const imageUrl = String(item?.imageUrl || item?.iconUrl || "").trim() || null;
                        return (
                          <button
                            key={`gainer-${item.moverId}`}
                            type="button"
                            onClick={() => {
                              setWatchlistFocusTarget({ id: item.id });
                              handleTabSelect("watchlist");
                            }}
                            className="flex w-full items-center justify-between gap-2 rounded-md border border-emerald-400/30 bg-transparent p-2 text-left transition-colors hover:bg-emerald-500/10"
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/25 p-1">
                                {imageUrl ? (
                                  <img
                                    src={imageUrl}
                                    alt={item.name}
                                    className="h-full w-full object-contain"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">N/A</div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-semibold">{item.name}</p>
                                {priceLabel ? <p className="truncate text-[11px] text-muted-foreground">{priceLabel}</p> : null}
                              </div>
                            </div>
                            <span className="text-xs font-semibold text-emerald-400">
                              +{item.changePercentValue.toFixed(2)}%
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Keine Gewinner im 7-Tage-Vergleich gefunden.</p>
                )}

                {watchlistTopMovers.losers.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-400">
                      <TrendingDown className="h-4 w-4" />
                      Top Verlierer
                    </div>
                    <div className="space-y-2">
                      {watchlistTopMovers.losers.map((item) => {
                        const currentPrice = Number(item?.currentPrice);
                        const currentPriceUsd = Number(item?.currentPriceUsd);
                        const hasUsdPrice = Number.isFinite(currentPriceUsd);
                        const hasCurrentPrice = hasUsdPrice || Number.isFinite(currentPrice);
                        const priceLabel = hasUsdPrice
                          ? formatPrice(currentPriceUsd, { useUsd: true, buyPriceUsd: currentPriceUsd })
                          : hasCurrentPrice
                            ? formatPrice(currentPrice)
                            : null;
                        const imageUrl = String(item?.imageUrl || item?.iconUrl || "").trim() || null;
                        return (
                          <button
                            key={`loser-${item.moverId}`}
                            type="button"
                            onClick={() => {
                              setWatchlistFocusTarget({ id: item.id });
                              handleTabSelect("watchlist");
                            }}
                            className="flex w-full items-center justify-between gap-2 rounded-md border border-red-400/30 bg-transparent p-2 text-left transition-colors hover:bg-red-500/10"
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/25 p-1">
                                {imageUrl ? (
                                  <img
                                    src={imageUrl}
                                    alt={item.name}
                                    className="h-full w-full object-contain"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">N/A</div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-semibold">{item.name}</p>
                                {priceLabel ? <p className="truncate text-[11px] text-muted-foreground">{priceLabel}</p> : null}
                              </div>
                            </div>
                            <span className="text-xs font-semibold text-red-400">
                              {item.changePercentValue.toFixed(2)}%
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {watchlistTopMovers.extras.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Weitere Mover
                    </div>
                    <div className="space-y-2">
                      {watchlistTopMovers.extras.map((item) => {
                        const currentPrice = Number(item?.currentPrice);
                        const currentPriceUsd = Number(item?.currentPriceUsd);
                        const hasUsdPrice = Number.isFinite(currentPriceUsd);
                        const hasCurrentPrice = hasUsdPrice || Number.isFinite(currentPrice);
                        const priceLabel = hasUsdPrice
                          ? formatPrice(currentPriceUsd, { useUsd: true, buyPriceUsd: currentPriceUsd })
                          : hasCurrentPrice
                            ? formatPrice(currentPrice)
                            : null;
                        const imageUrl = String(item?.imageUrl || item?.iconUrl || "").trim() || null;
                        const isPositive = item.changePercentValue >= 0;
                        return (
                          <button
                            key={`extra-${item.moverId}`}
                            type="button"
                            onClick={() => {
                              setWatchlistFocusTarget({ id: item.id });
                              handleTabSelect("watchlist");
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-md border bg-transparent p-2 text-left transition-colors ${
                              isPositive
                                ? "border-emerald-400/25 hover:bg-emerald-500/8"
                                : "border-red-400/25 hover:bg-red-500/8"
                            }`}
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/25 p-1">
                                {imageUrl ? (
                                  <img
                                    src={imageUrl}
                                    alt={item.name}
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">N/A</div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{item.name}</p>
                                {priceLabel ? <p className="truncate text-[11px] text-muted-foreground">{priceLabel}</p> : null}
                              </div>
                            </div>
                            <span className={`text-xs font-semibold ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
                              {item.changePercentValue >= 0 ? "+" : ""}{item.changePercentValue.toFixed(2)}%
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <p className="pt-1 text-[11px] text-muted-foreground">
                  Datensaetze mit 7-Tage-Move: {watchlistTopMovers.sourceCount}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Keine eindeutigen Gewinner/Verlierer verfuegbar.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5">
        <div className="sm:pt-1">
          <h3 className="mb-4 text-lg font-semibold">Portfolio Zusammensetzung</h3>
          {compositionLoading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="flex justify-center lg:col-span-2">
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
            <PortfolioCompositionChart
              data={compositionData}
              totalValueOverride={portfolioTotalValueForDisplay}
              totalValueLabel={portfolioValueLabel}
            />
          )}
        </div>
      </div>
    </div>
  );
}
