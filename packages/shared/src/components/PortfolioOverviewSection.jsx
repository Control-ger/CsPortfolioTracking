import { useState } from "react";
import { ArrowUpRight, Sparkles, TrendingUp, TrendingDown, X } from "lucide-react";

import { PortfolioChart } from "./PortfolioChart.jsx";
import { PortfolioCompositionChart } from "./PortfolioCompositionChart.jsx";
import { StatCard } from "./StatsCards.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.jsx";
import { Badge } from "./ui/badge.jsx";
import { Skeleton } from "./ui/skeleton.jsx";
import { Button } from "./ui/button.jsx";
import { SoonBadge } from "./ui/filter-sidebar.jsx";
import { useCurrency } from "../contexts/CurrencyContext.jsx";
import {
  formatAge,
  syncHealthBadgeClass,
  syncHealthLabel,
  formatRelativeHours,
} from "../lib/portfolioHelpers.js";

export function PortfolioOverviewSection({
  stats,
  portfolioLoading,
  statsPending,
  metricsScope,
  portfolioPreferences,
  headerPortfolioPercent,
  headerPortfolioPositive,
  headerPortfolioValueLabel,
  headerProfitEuro,
  headerProfitPercent,
  headerProfitSubLabel,
  headerProfitPositive,
  liveItems,
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
  showYearWrappedBanner,
  yearWrappedYear,
  handleOpenYearWrapped,
  handleDismissYearWrapped,
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
  portfolioTotalValueForDisplay,
  portfolioValueLabel,
  allocationByType = [],
  portfolioMovers = { gainers: [], losers: [], sourceCount: 0 },
  chartTrendData,
}) {
  const { formatPrice } = useCurrency();
  const [moverTab, setMoverTab] = useState("gainers");

  const scopeSwitchable = portfolioPreferences.metricsDisplayMode === "toggle_mode";
  // roiGainEuro, not deltaValue: deltaPercent is a growth-percent difference,
  // and roiGainEuro is the euro figure that matches it. Deposits during the
  // period move value and invested in lockstep and cancel out there, so a
  // deposit does not read as a gain. Same pairing the chart footer uses.
  const rangeDeltaValue = Number(chartTrendData?.roiGainEuro);
  const rangeDeltaPercent = Number(chartTrendData?.deltaPercent);
  const hasRangeDelta = Number.isFinite(rangeDeltaValue) && Number.isFinite(rangeDeltaPercent);
  const rangeDeltaPositive = hasRangeDelta && rangeDeltaValue >= 0;
  const shownMovers = moverTab === "gainers" ? portfolioMovers.gainers : portfolioMovers.losers;
  const bestItemName = portfolioMovers.gainers[0]?.name || null;

  return (
    <div className="space-y-5 sm:space-y-5 lg:space-y-4 lg:pb-6">
      {/* Mobile hero: scope switch, portfolio value, delta over the chart range.
          The design labels the delta "heute"; the app's figure follows the
          chart's own range selector, so it is labelled with that range instead
          of hard-coding a day the number does not describe. */}
      <div className="space-y-3 sm:hidden">
        {scopeSwitchable ? (
          <div className="flex gap-1.5 rounded-[10px] border border-border-soft bg-surface-1 p-[3px]">
            {[
              { value: "all", label: "Alle Positionen" },
              { value: "investments", label: "Investments" },
            ].map((option) => {
              const active = metricsScope === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => void handleMetricsScopeChange(option.value)}
                  aria-pressed={active}
                  className={`h-[30px] flex-1 rounded-lg text-[11.5px] transition-colors ${
                    active
                      ? "bg-primary font-extrabold text-primary-foreground"
                      : "font-semibold text-muted-foreground"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : null}

        <div>
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
            Portfolio-Wert
          </span>
          {statsPending ? (
            <Skeleton className="mt-1.5 h-9 w-48" />
          ) : (
            <p className="mt-1.5 text-[34px] font-extrabold leading-none tracking-[-0.02em] tabular-nums">
              {headerPortfolioValueLabel}
            </p>
          )}
          {hasRangeDelta ? (
            <span
              className={`mt-1.5 block text-[13px] font-bold tabular-nums ${
                rangeDeltaPositive ? "text-success" : "text-danger"
              }`}
            >
              {rangeDeltaPositive ? "+" : "−"}
              {formatPrice(Math.abs(rangeDeltaValue), {
                // The trend delta rides in as USD, like every price on this
                // page. Formatting it without `useUsd` skips the conversion
                // and prints a USD figure under a euro sign.
                useUsd: true,
                buyPriceUsd: Math.abs(rangeDeltaValue),
              })}{" "}
              · {rangeDeltaPositive ? "+" : "−"}
              {Math.abs(rangeDeltaPercent).toFixed(1).replace(".", ",")} %
              {chartTrendData?.rangeLabel ? ` · ${chartTrendData.rangeLabel}` : ""}
            </span>
          ) : null}
        </div>
      </div>

      {showYearWrappedBanner ? (
        <div
          role="button"
          tabIndex={0}
          onClick={handleOpenYearWrapped}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleOpenYearWrapped();
            }
          }}
          className="steam-avatar-gradient-banner group relative rounded-2xl border border-border/70 px-5 py-4 cursor-pointer transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <button
            type="button"
            aria-label="Jahresrueckblick ausblenden"
            onClick={(event) => {
              event.stopPropagation();
              handleDismissYearWrapped();
            }}
            className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex flex-col gap-3 pr-8">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Jahresrueckblick {yearWrappedYear}
              </span>
            </div>
            <p className="text-base font-semibold text-foreground sm:text-lg">
              Dein CS-Investment-Jahr {yearWrappedYear}
            </p>
            <p className="text-sm text-muted-foreground">
              Kaeufe, Ausgaben, Plattformen und die Kurve deines Portfolios — jetzt ansehen.
            </p>
          </div>
        </div>
      ) : null}

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
                <span className="h-2 w-2 shrink-0 rounded-full bg-warn" />
                <span className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  VAC Ban-Welle
                </span>
              </div>
              <Badge variant="outline" className="shrink-0 border-warn/30 bg-warn/10 text-warn">
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
          isLoading={statsPending}
        />
        <StatCard
          title="Gesamt Zuwachs"
          value={`${headerProfitEuro >= 0 ? "+" : "-"}${formatPrice(Math.abs(headerProfitEuro))}`}
          subValue={`${headerProfitPercent >= 0 ? "+" : ""}${headerProfitPercent.toFixed(2)}% | ${headerProfitSubLabel}`}
          isPositive={headerProfitPositive}
          isLoading={statsPending}
        />
        <StatCard
          title="Items im Bestand"
          value={`${stats.totalQuantity} Stueck`}
          isLoading={statsPending}
        />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
              Price Sync
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {statsPending ? (
              <>
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-3 w-40" />
              </>
            ) : (
              <>
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
              </>
            )}
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
        {/* The mobile dashboard shows portfolio movers instead (below), so this
            watchlist panel would be a second, differently-sourced mover list. */}
        <Card
          className="hidden min-h-[340px] flex-col border-border/70 bg-card/70 sm:flex lg:min-h-0 lg:overflow-hidden"
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
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-success">
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
                            className="flex w-full items-center justify-between gap-2 rounded-md border border-success/30 bg-transparent p-2 text-left transition-colors hover:bg-success/15"
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
                            <span className="text-xs font-semibold text-success">
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
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-danger">
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
                            className="flex w-full items-center justify-between gap-2 rounded-md border border-danger/30 bg-transparent p-2 text-left transition-colors hover:bg-danger/10"
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
                            <span className="text-xs font-semibold text-danger">
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
                                ? "border-success/30 hover:bg-success/8"
                                : "border-danger/30 hover:bg-danger/8"
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
                            <span className={`text-xs font-semibold ${isPositive ? "text-success" : "text-danger"}`}>
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

      {/* ── Mobile-only dashboard blocks ─────────────────────────────────── */}

      <div className="grid grid-cols-3 gap-[9px] sm:hidden">
        {[
          {
            label: "Gesamt-ROI",
            value: `${headerPortfolioPercent >= 0 ? "+" : "−"}${Math.abs(headerPortfolioPercent).toFixed(1).replace(".", ",")} %`,
            tone: headerPortfolioPositive ? "text-success" : "text-danger",
          },
          { label: "Positionen", value: String(stats.totalQuantity ?? 0), tone: "" },
          // Real item names run far past the design's "Kilowatt", so this one
          // wraps at a smaller size instead of ellipsing to "Souve…".
          { label: "Bestes Item", value: bestItemName || "—", tone: "", small: true },
        ].map((kpi) => (
          <div key={kpi.label} className="min-w-0 rounded-2xl border border-border bg-card px-3 py-[11px]">
            <p className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
              {kpi.label}
            </p>
            <p
              className={`mt-1 font-extrabold ${kpi.tone} ${
                kpi.small ? "line-clamp-2 text-[12px] leading-tight" : "truncate text-[19px]"
              }`}
              title={kpi.small ? kpi.value : undefined}
            >
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {allocationByType.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card px-[15px] py-3.5 sm:hidden">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
            Allokation
          </p>
          <div className="flex h-[11px] overflow-hidden rounded-full bg-surface-2">
            {allocationByType.map((entry, index) => (
              <span
                key={entry.label}
                className="bg-foreground"
                style={{
                  flex: `0 0 ${entry.percentage}%`,
                  // One hue, stepped down in opacity: the categories are a
                  // ranking, not unrelated series, so a colour scale would
                  // imply a distinction the data does not carry.
                  opacity: [1, 0.82, 0.64, 0.48, 0.34, 0.22][index] ?? 0.22,
                }}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {allocationByType.map((entry, index) => (
              <span key={entry.label} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <span
                  className="size-2 rounded-full bg-foreground"
                  style={{ opacity: [1, 0.82, 0.64, 0.48, 0.34, 0.22][index] ?? 0.22 }}
                />
                {/* One decimal below 10 %: a portfolio dominated by a few
                    expensive skins rounds every other category to "0 %",
                    which reads as an error rather than a small share. */}
                {entry.label} ·{" "}
                {entry.percentage
                  .toFixed(entry.percentage < 10 ? 1 : 0)
                  .replace(".", ",")}{" "}
                %
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {portfolioMovers.sourceCount > 0 ? (
        <div className="rounded-2xl border border-border bg-card px-[15px] py-3.5 sm:hidden">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <p className="text-[12.5px] font-bold">Top Bewegungen · 7 Tage</p>
            <div className="inline-flex gap-0.5 rounded-lg bg-surface-1 p-0.5">
              {[
                { value: "gainers", label: "Gewinner" },
                { value: "losers", label: "Verlierer" },
              ].map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setMoverTab(tab.value)}
                  aria-pressed={moverTab === tab.value}
                  className={`h-[23px] rounded-[7px] px-2 text-[10.5px] font-bold transition-colors ${
                    moverTab === tab.value
                      ? "bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
                      : "text-muted-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          {shownMovers.length > 0 ? (
            shownMovers.map((mover) => (
              <div key={mover.id} className="flex items-center justify-between gap-2.5 py-1.5">
                <span className="min-w-0 truncate text-[12.5px] font-semibold">{mover.name}</span>
                <span
                  className={`shrink-0 whitespace-nowrap text-[12.5px] font-extrabold tabular-nums ${
                    mover.changePercent >= 0 ? "text-success" : "text-danger"
                  }`}
                >
                  {mover.changePercent >= 0 ? "+" : "−"}
                  {Math.abs(mover.changePercent).toFixed(1).replace(".", ",")} %
                </span>
              </div>
            ))
          ) : (
            <p className="py-1.5 text-[11.5px] text-muted-foreground">
              Keine {moverTab === "gainers" ? "Gewinner" : "Verlierer"} im 7-Tage-Vergleich.
            </p>
          )}
        </div>
      ) : null}

      {/* Activity timeline, rendered inert on purpose: the design places it
          here, but `operations_log` has no read path (no listOperations in
          localStore/preload/dataSource), so there is no feed to render. Kept
          visible and marked rather than dropped, so the planned shape of the
          screen stays legible — the same call the watchlist's Zielpreis row
          and the `soon` sidebar rows make. */}
      <div
        aria-hidden="true"
        className="rounded-2xl border border-border bg-card px-[15px] py-3.5 opacity-45 sm:hidden"
      >
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Letzte Aktivität
          <SoonBadge />
        </p>
        <div className="mt-3 space-y-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex gap-3">
              <span className="mt-1 size-2 shrink-0 rounded-full bg-muted-foreground" />
              <span className="h-2.5 flex-1 rounded-full bg-surface-2" style={{ maxWidth: `${75 - row * 12}%` }} />
            </div>
          ))}
        </div>
      </div>

      <div className="hidden grid-cols-1 gap-4 sm:grid sm:gap-5">
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
