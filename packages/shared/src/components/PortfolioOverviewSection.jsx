import { ArrowUpRight, TrendingUp, TrendingDown } from "lucide-react";

import { PortfolioChart } from "./PortfolioChart.jsx";
import { PortfolioCompositionChart } from "./PortfolioCompositionChart.jsx";
import { PortfolioHeaderCard } from "./PortfolioHeaderCard.jsx";
import { StatCard } from "./StatsCards.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.jsx";
import { Badge } from "./ui/badge.jsx";
import { Skeleton } from "./ui/skeleton.jsx";
import { Button } from "./ui/button.jsx";
import { useCurrency } from "../contexts/CurrencyContext.jsx";
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
  showBanWaveBanner,
  freshBanWaveItem,
  handleOpenBanWaveFeed,
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

      {showBanWaveBanner && freshBanWaveItem ? (
        <div
          role="button"
          tabIndex={0}
          onClick={handleOpenBanWaveFeed}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleOpenBanWaveFeed();
            }
          }}
          className="group rounded-2xl border border-border/70 bg-card px-5 py-4 cursor-pointer transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                <span className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  VAC Ban-Welle
                </span>
              </div>
              <Badge variant="outline" className="shrink-0 border-amber-500/35 bg-amber-500/12 text-amber-600 dark:text-amber-300">
                aktuell
              </Badge>
            </div>
            <p className="line-clamp-2 text-base font-semibold text-foreground sm:text-lg">{freshBanWaveItem.title}</p>
            <p className="text-sm text-muted-foreground">
              Erhöhte Ban-Aktivität erkannt — Marktbewegungen bei Skins und Cases möglich.
            </p>
          </div>
        </div>
      ) : null}

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
          className="group rounded-2xl border border-border/70 bg-card px-5 py-4 cursor-pointer transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${latestCsUpdateBannerTone.dot}`} />
                <span className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  CS Update · seit {formatRelativeHours(latestCsUpdateAgeHours)}
                </span>
                {hasUnreadCsUpdate ? (
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    neu
                  </span>
                ) : null}
              </div>
              <Badge variant="outline" className={`shrink-0 ${latestCsUpdateImpact.badgeClass}`}>
                {latestCsUpdateImpact.label}
              </Badge>
            </div>

            <p className="line-clamp-2 text-base font-semibold text-foreground sm:text-lg">
              {latestCsUpdate.title}
            </p>

            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">Aktion</span>
              <span className="text-foreground">{latestCsUpdateImpact.actionLabel}</span>
              {latestCsUpdate?.aiReasoning ? (
                <>
                  <span className="text-muted-foreground">Grund</span>
                  <span className="line-clamp-2 text-muted-foreground">{latestCsUpdate.aiReasoning}</span>
                </>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs text-muted-foreground">
              {latestCsUpdate?.url ? (
                <a
                  href={latestCsUpdate.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                >
                  Original Update öffnen
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              ) : null}
              <span className="inline-flex items-center gap-1">
                {latestCsUpdate?.url ? <span className="text-muted-foreground/50">·</span> : null}
                KI generiert{latestCsUpdateAiModelLabel ? ` · ${latestCsUpdateAiModelLabel}` : ""}
              </span>
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

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-stretch xl:grid-cols-[minmax(0,1fr)_460px]">
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
            <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
              <div className="flex flex-col items-center gap-3">
                <Skeleton className="h-55 w-full max-w-sm sm:h-80" />
                <Skeleton className="h-16 w-full max-w-sm" />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((entry) => (
                  <Skeleton key={entry} className="h-14 w-full" />
                ))}
              </div>
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
