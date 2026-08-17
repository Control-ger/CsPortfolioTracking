import { useState } from "react";
import { ArrowUpRight, Sparkles, X } from "lucide-react";

import { PortfolioChart } from "./PortfolioChart.jsx";
import { Badge } from "./ui/badge.jsx";
import { Skeleton } from "./ui/skeleton.jsx";
import { useCurrency } from "../contexts/CurrencyContext.jsx";
import { formatAge, formatRelativeHours } from "../lib/portfolioHelpers.js";
import { ItemName } from "./ui/item-name.jsx";
import { parseItemName } from "../lib/itemName.js";

/**
 * One hue, stepped down in opacity: the allocation categories are a ranking,
 * not unrelated series, so a colour scale would imply a distinction the data
 * does not carry. Shared by the mobile bar and the desktop legend so the two
 * cannot drift apart.
 *
 * The floor is 0.42, not the design's 0.22. The mock steps down over six evenly
 * sized categories; a real portfolio is top-heavy, so the tail categories are
 * already hairline slivers — at 0.22 both the sliver and its legend dot
 * disappeared into the background, which is exactly the rows that need a marker
 * to be findable at all.
 */
const ALLOCATION_OPACITIES = [1, 0.86, 0.72, 0.6, 0.5, 0.42];

function allocationOpacity(index) {
  return ALLOCATION_OPACITIES[index] ?? 0.42;
}

/** German signed percent, minus as U+2212 like every other figure on the page. */
function formatSignedPercent(value, decimals = 1) {
  const number = Number(value) || 0;
  return `${number >= 0 ? "+" : "−"}${Math.abs(number).toFixed(decimals).replace(".", ",")} %`;
}

/**
 * Share label for the allocation legend.
 *
 * Two rules, both there to stop the legend contradicting itself:
 * - a non-zero share never prints as "0,0 %" — it prints "<0,1 %", because a
 *   category that is listed at all is by definition not empty;
 * - a share only reads "100 %" when it really is the only category. Rounding
 *   99,6 % up while five more entries follow is what made the bar claim
 *   "Skins · 100 %" next to "Cases · 0,5 %".
 */
function formatAllocationShare(percentage, categoryCount) {
  const value = Number(percentage) || 0;
  if (value > 0 && value < 0.1) {
    return "<0,1 %";
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(".", ",")} %`;
  }
  const rounded = Math.round(value);
  if (rounded >= 100 && categoryCount > 1) {
    return ">99 %";
  }
  return `${rounded} %`;
}

const ACTIVITY_ENTITY_LABELS = {
  investment: "Investment",
  watchlist_item: "Watchlist-Item",
};

function describeActivityEntity(entityType) {
  return ACTIVITY_ENTITY_LABELS[entityType] || "Eintrag";
}

/**
 * Wording for one operations_log row.
 *
 * `upsert` covers both creating and editing — the log keeps no before/after
 * state — so the label stays deliberately vague instead of claiming which of
 * the two happened.
 */
function describeActivityAction(entry) {
  const entity = describeActivityEntity(entry?.entityType);
  if (entry?.opType === "delete") {
    return `${entity} entfernt`;
  }
  return `${entity} hinzugefügt oder bearbeitet`;
}

/** `formatAge` counts in seconds; the log stores ISO timestamps. */
function activityAgeSeconds(createdAt) {
  const parsed = Date.parse(String(createdAt || ""));
  if (Number.isNaN(parsed)) {
    return Number.NaN;
  }
  return Math.max(0, Math.floor((Date.now() - parsed) / 1000));
}

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
  headerProfitSubLabel,
  headerProfitPositive,
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
  recentActivity = [],
  recentActivityLoading = false,
  scopedPortfolioHistory,
  onChartHoverChange,
  onChartTrendChange,
  handleMetricsScopeChange,
  watchlistAlerts = { rows: [], activeCount: 0 },
  handleTabSelect,
  allocationByType = [],
  portfolioMovers = { gainers: [], losers: [], sourceCount: 0 },
  chartTrendData,
}) {
  const { formatPrice } = useCurrency();
  const [moverTab, setMoverTab] = useState("gainers");
  const [activityExpanded, setActivityExpanded] = useState(false);

  /**
   * Every money figure on this page is USD internally — `stats.totalValue`,
   * `stats.totalInvested`, `stats.totalProfitEuro` (the name lies) and the
   * allocation's summed `currentValue` all come from the same rows the hero's
   * value comes from. Formatting any of them without `useUsd` skips the
   * conversion and prints the USD number under a euro sign: the allocation
   * legend summed to 1.538 € beside a 1.329 € hero, on the same screen.
   */
  const formatUsd = (value) =>
    formatPrice(Number(value) || 0, { useUsd: true, buyPriceUsd: Number(value) || 0 });

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
  const bestItemChange = portfolioMovers.gainers[0]?.changePercent;

  // The mobile hero and the desktop hero print the same figure; one formatter so
  // a fix to the currency handling cannot land on only one of them.
  const rangeDeltaLabel = hasRangeDelta
    ? `${rangeDeltaPositive ? "+" : "−"}${formatUsd(Math.abs(rangeDeltaValue))} · ${formatSignedPercent(rangeDeltaPercent)}${
        chartTrendData?.rangeLabel ? ` · ${chartTrendData.rangeLabel}` : ""
      }`
    : null;

  const priceAgeSeconds = Number(stats.freshestDataAgeSeconds);
  const priceAgeLabel = Number.isFinite(priceAgeSeconds)
    ? `Preise vor ${formatAge(priceAgeSeconds)} aktualisiert`
    : "Preisalter unbekannt";

  const scopeOptions = [
    { value: "all", label: "Alle Positionen" },
    { value: "investments", label: "Investments" },
  ];

  // The design's hero sits in the chart card's header row so the range pills
  // stay on the label line, next to the value they re-scale.
  const desktopHero = (
    <div className="hidden min-w-0 flex-col sm:flex">
      <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
        Portfolio-Wert
      </span>
      {statsPending ? (
        <Skeleton className="mt-2 h-12 w-72" />
      ) : (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          {/* The design's 58px only fits the mock's 1520px frame; the app runs
              from ~1180px up, so the hero scales with the viewport instead of
              pushing the range pills onto their own row. */}
          <span className="text-[clamp(32px,3.2vw,58px)] font-extrabold leading-none tracking-[-0.03em] tabular-nums">
            {headerPortfolioValueLabel}
          </span>
          {rangeDeltaLabel ? (
            <span
              className={`text-[15px] font-bold tabular-nums ${
                rangeDeltaPositive ? "text-success" : "text-danger"
              }`}
            >
              {rangeDeltaLabel}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );

  // The design's "Tages-P&L" has no source: the app tracks no intraday
  // baseline. The chart's range delta is the honest stand-in and carries its
  // own range label, so the tile never claims a window it is not showing.
  const desktopKpis = [
    {
      label: "Gesamt-ROI",
      value: formatSignedPercent(headerPortfolioPercent),
      sub: headerProfitSubLabel,
      positive: headerPortfolioPositive,
    },
    {
      label: "Gesamt Zuwachs",
      value: `${headerProfitEuro >= 0 ? "+" : "−"}${formatUsd(Math.abs(headerProfitEuro))}`,
      // Not the ROI percent again — the tile beside it already is that number.
      sub: Number.isFinite(Number(stats.totalInvested))
        ? `auf ${formatUsd(stats.totalInvested)} investiert`
        : headerProfitSubLabel,
      positive: headerProfitPositive,
    },
    {
      // `totalQuantity` counts pieces, not positions — a stack of 400 cases is
      // one position. The design's "Positionen 42" has no equivalent field, so
      // the tile is labelled for what it actually shows.
      label: "Items im Bestand",
      value: String(stats.totalQuantity ?? 0),
      sub: "Stueck insgesamt",
    },
    {
      label: "Bestes Item",
      value: bestItemName ? parseItemName(bestItemName).short : "—",
      title: bestItemName || undefined,
      sub: Number.isFinite(Number(bestItemChange))
        ? `${formatSignedPercent(bestItemChange)} · 7 Tage`
        : "Keine 7-Tage-Bewegung",
      truncate: true,
    },
  ];

  const alertRows = Array.isArray(watchlistAlerts?.rows) ? watchlistAlerts.rows : [];
  const alertActiveCount = Number(watchlistAlerts?.activeCount) || 0;

  // 4 → 8, as the design has it. The loader fetches 12; showing all of them
  // would let one busy afternoon's edits run past the composition chart below.
  const visibleActivity = recentActivity.slice(0, activityExpanded ? 8 : 4);

  return (
    <div className="space-y-5 sm:space-y-5 lg:space-y-4 lg:pb-6">
      {/* Mobile hero: scope switch, portfolio value, delta over the chart range.
          The design labels the delta "heute"; the app's figure follows the
          chart's own range selector, so it is labelled with that range instead
          of hard-coding a day the number does not describe. */}
      <div className="space-y-3 sm:hidden">
        {scopeSwitchable ? (
          <div className="flex gap-1.5 rounded-[10px] border border-border-soft bg-surface-1 p-[3px]">
            {scopeOptions.map((option) => {
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
          {rangeDeltaLabel ? (
            <span
              className={`mt-1.5 block text-[13px] font-bold tabular-nums ${
                rangeDeltaPositive ? "text-success" : "text-danger"
              }`}
            >
              {rangeDeltaLabel}
            </span>
          ) : null}
        </div>
      </div>

      {/* Desktop head row: scope segment left, price freshness right. The chart
          card no longer carries its own scope switch — one control per
          breakpoint, or the two disagree about which is authoritative. */}
      <div className="hidden items-center justify-between gap-5 sm:flex">
        {scopeSwitchable ? (
          <div className="flex gap-1 rounded-[10px] border border-border-soft bg-surface-1 p-[3px]">
            {scopeOptions.map((option) => {
              const active = metricsScope === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => void handleMetricsScopeChange(option.value)}
                  aria-pressed={active}
                  className={`h-[30px] rounded-lg px-4 text-xs transition-colors ${
                    active
                      ? "bg-primary font-extrabold text-primary-foreground"
                      : "font-bold text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : (
          <span />
        )}
        <span className="text-xs text-muted-foreground">{priceAgeLabel}</span>
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

      {/* Hero + chart. The hero rides in the chart card's header slot so the
          range pills sit on the label line beside the value they re-scale. */}
      <div className="min-w-0">
        <PortfolioChart
          // The design has no card around the hero and chart — they sit
          // directly on the page background.
          flat
          // Shorter than the 340px default: at that height the KPI band pushed
          // the whole lower half (allocation, movers, activity, alarms) below
          // the fold, so the dashboard opened on a chart and nothing else.
          chartHeightClassName="h-[260px] sm:h-[240px] xl:h-[270px]"
          history={scopedPortfolioHistory}
          isLoading={portfolioLoading && scopedPortfolioHistory.length === 0}
          onHoverChange={onChartHoverChange}
          onTrendChange={onChartTrendChange}
          metricsScope={metricsScope}
          headerSlot={desktopHero}
        />
      </div>

      {/* Desktop KPI bar. Replaces the former stat-card row: the same four
          figures, but as one band under the chart instead of four boxes that
          repeated the hero's portfolio value. Price freshness moved to the head
          row above, which is why the Price-Sync card is gone. */}
      <div className="hidden grid-cols-4 border-t border-border-soft sm:grid">
        {desktopKpis.map((kpi, index) => (
          <div
            key={kpi.label}
            className={`min-w-0 px-5 pt-[18px] ${index === 0 ? "pl-0" : "border-l border-border-soft"}`}
          >
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
              {kpi.label}
            </p>
            {statsPending ? (
              <Skeleton className="mt-1.5 h-6 w-24" />
            ) : (
              <p
                className={`mt-1.5 truncate text-[22px] font-extrabold tracking-[-0.01em] tabular-nums ${
                  kpi.positive === undefined ? "" : kpi.positive ? "text-success" : "text-danger"
                } ${kpi.truncate ? "text-[17px]" : ""}`}
                title={kpi.title}
              >
                {kpi.value}
              </p>
            )}
            <p className="mt-1 truncate text-[11.5px] text-muted-foreground">{kpi.sub}</p>
          </div>
        ))}
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
          // Real item names run far past the design's "Kilowatt" and this tile
          // is a third of a phone wide, so it shows the parsed short name —
          // the variant prefix and the wear are what push "Sawed-Off | Parched"
          // out of view, and neither is what the tile is answering. The full
          // canonical name stays on the title attribute.
          {
            label: "Bestes Item",
            value: bestItemName ? parseItemName(bestItemName).short : "—",
            title: bestItemName || undefined,
            tone: "",
            small: true,
          },
        ].map((kpi) => (
          <div key={kpi.label} className="min-w-0 rounded-2xl border border-border bg-card px-3 py-[11px]">
            <p className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
              {kpi.label}
            </p>
            <p
              className={`mt-1 font-extrabold ${kpi.tone} ${
                kpi.small ? "line-clamp-2 text-[12px] leading-tight" : "truncate text-[19px]"
              }`}
              title={kpi.title}
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
                  // Proportional grow rather than a percentage basis: the
                  // rounded shares can sum past 100, and a fixed basis with no
                  // shrink then overflows and clips the last slice off the bar.
                  flex: `${entry.value} 1 0`,
                  opacity: allocationOpacity(index),
                }}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {allocationByType.map((entry, index) => (
              <span key={entry.label} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <span
                  className="size-2 rounded-full bg-foreground"
                  style={{ opacity: allocationOpacity(index) }}
                />
                {entry.label} · {formatAllocationShare(entry.percentage, allocationByType.length)}
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
                <ItemName name={mover.name} nameClassName="text-[12.5px] font-semibold" />
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

      {/* Activity timeline. Fed by the desktop-local `operations_log`; the web
          runtime has no equivalent, so the block is absent there rather than
          rendered empty. Bulk imports and sync-apply deliberately write no
          operations, so this shows manual edits only. */}
      {recentActivityLoading || recentActivity.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card px-[15px] py-3.5 sm:hidden">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
            Letzte Aktivität
          </p>
          {recentActivityLoading ? (
            <div className="mt-3 space-y-3">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-4 w-full" />
              ))}
            </div>
          ) : (
            <div className="mt-3 space-y-2.5">
              {recentActivity.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3">
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${
                      entry.appliedAt ? "bg-muted-foreground" : "bg-primary"
                    }`}
                    title={entry.appliedAt ? undefined : "Noch nicht synchronisiert"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-foreground">
                      {entry.name || describeActivityEntity(entry.entityType)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {describeActivityAction(entry)} · vor {formatAge(activityAgeSeconds(entry.createdAt))}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* ── Desktop two-column band ──────────────────────────────────────── */}
      <div className="hidden gap-8 pt-2 sm:grid lg:grid-cols-[1.3fr_1fr] lg:gap-12">
        <div className="min-w-0">
          {allocationByType.length > 0 ? (
            <>
              <p className="text-[13px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Allokation nach Kategorie
              </p>
              <div className="mt-[18px] flex h-3 overflow-hidden rounded-full bg-surface-2">
                {allocationByType.map((entry, index) => (
                  <span
                    key={entry.label}
                    className="bg-foreground"
                    style={{
                      // Proportional grow rather than a percentage basis: the
                      // rounded shares can sum past 100, and a fixed basis with
                      // no shrink then overflows and clips the last slice.
                      flex: `${entry.value} 1 0`,
                      opacity: allocationOpacity(index),
                    }}
                  />
                ))}
              </div>
              <div className="mt-5 flex flex-col gap-3.5">
                {allocationByType.map((entry, index) => (
                  <div key={entry.label} className="flex items-center gap-3">
                    <span
                      className="size-[9px] shrink-0 rounded-full bg-foreground"
                      style={{ opacity: allocationOpacity(index) }}
                    />
                    <span className="flex-1 truncate text-[13px] font-bold">{entry.label}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatUsd(entry.value)} ·{" "}
                      {formatAllocationShare(entry.percentage, allocationByType.length)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {portfolioMovers.sourceCount > 0 ? (
            <>
              <p className="mt-8 text-[13px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Top Bewegungen · 7 Tage
              </p>
              {/* Desktop shows both sides at once — the mobile tab switch only
                  exists because two columns do not fit a phone. */}
              <div className="mt-3.5 grid gap-8 md:grid-cols-2">
                {[
                  { key: "gainers", label: "Gewinner", rows: portfolioMovers.gainers },
                  { key: "losers", label: "Verlierer", rows: portfolioMovers.losers },
                ].map((column) => (
                  <div key={column.key} className="flex min-w-0 flex-col">
                    <span className="pb-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
                      {column.label}
                    </span>
                    {column.rows.length > 0 ? (
                      column.rows.slice(0, 3).map((mover) => (
                        <div
                          key={mover.id}
                          className="flex items-center justify-between gap-4 border-b border-border-soft py-[11px]"
                        >
                          <ItemName name={mover.name} nameClassName="text-[13px] font-bold" />
                          <span
                            className={`shrink-0 whitespace-nowrap text-[13px] font-extrabold tabular-nums ${
                              mover.changePercent >= 0 ? "text-success" : "text-danger"
                            }`}
                          >
                            {formatSignedPercent(mover.changePercent)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="py-[11px] text-[11.5px] text-muted-foreground">
                        Keine {column.label.toLowerCase()} im 7-Tage-Vergleich.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="min-w-0">
          {recentActivityLoading || recentActivity.length > 0 ? (
            <>
              <p className="mb-[18px] text-[13px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Letzte Aktivität
              </p>
              {recentActivityLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2, 3].map((row) => (
                    <Skeleton key={row} className="h-4 w-full" />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col">
                  {visibleActivity.map((entry, index) => (
                    <div key={entry.id} className="flex gap-3.5 pb-[18px]">
                      <span className="flex flex-none flex-col items-center">
                        <span
                          className={`size-2 rounded-full ${
                            entry.appliedAt ? "bg-foreground" : "bg-primary"
                          }`}
                          title={entry.appliedAt ? undefined : "Noch nicht synchronisiert"}
                        />
                        {index < visibleActivity.length - 1 ? (
                          <span className="mt-1 w-px flex-1 bg-border-soft" />
                        ) : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-bold">
                          {entry.name || describeActivityEntity(entry.entityType)}
                        </span>
                        <span className="block pt-[3px] text-[11.5px] text-muted-foreground">
                          {describeActivityAction(entry)}
                        </span>
                        <span className="block pt-0.5 text-[11px] text-muted-foreground">
                          vor {formatAge(activityAgeSeconds(entry.createdAt))}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {recentActivity.length > 4 ? (
                <button
                  type="button"
                  onClick={() => setActivityExpanded((current) => !current)}
                  className="h-[34px] w-full rounded-[10px] border border-border text-xs font-bold text-foreground transition-colors hover:bg-surface-1"
                >
                  {activityExpanded ? "Weniger anzeigen" : "Alle Aktivitäten anzeigen"}
                </button>
              ) : null}
            </>
          ) : null}

          {/* Watchlist alarms. Only rows that actually carry a target price are
              listed; a watchlist without targets renders no widget rather than
              an empty box promising alerts nobody set. */}
          {/* Section, not a card. The design draws this as a filled box, but in
              the mock it is the only block in a short column; here it would be
              the third framed panel under a borderless timeline and read as
              pasted on. Same head + bordered rows as the movers list. */}
          {alertRows.length > 0 ? (
            <div className="mt-8">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  Watchlist-Alarme
                </p>
                <button
                  type="button"
                  onClick={() => handleTabSelect("watchlist")}
                  className="shrink-0 rounded-full border border-warn/30 bg-warn/10 px-2 py-0.5 text-[10.5px] font-bold text-warn transition-colors hover:bg-warn/20"
                >
                  {alertActiveCount} aktiv
                </button>
              </div>
              <div className="mt-3.5">
                {alertRows.map((alert, index) => (
                  <div
                    key={`${alert.id}-${index}`}
                    className="flex items-center justify-between gap-4 border-b border-border-soft py-[11px]"
                  >
                    <span className="truncate text-[13px] font-bold">{alert.name}</span>
                    <span
                      className={`shrink-0 whitespace-nowrap text-[11.5px] tabular-nums ${
                        alert.reached ? "font-bold text-warn" : "text-muted-foreground"
                      }`}
                    >
                      {alert.note}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
