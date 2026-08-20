import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Area, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";
import { Skeleton } from "./ui/skeleton";
import { toneForDelta, toneText } from "./ui/tone.js";
import { useCurrency } from "@shared/contexts/CurrencyContext";
import { parseHistoryTimestamp, resolveHistoryValueUsd } from "@shared/lib/portfolioHelpers";

import { getActiveIntlLocale } from "@shared/lib/i18n/index.js";
import { useTranslation } from "react-i18next";
import { translate } from "../lib/i18n/index.js";
// `key` is the stable internal identifier and must not be localised — it is the
// state value and is emitted through onTrendChange. Only `labelKey` is shown.
const RANGE_OPTIONS = [
  { key: "7T", labelKey: "chart.range.d7", days: 7 },
  { key: "30T", labelKey: "chart.range.d30", days: 30 },
  { key: "1J", labelKey: "chart.range.y1", days: 365 },
  { key: "MAX", labelKey: "chart.range.max", days: null },
];


const DAY_MS = 24 * 60 * 60 * 1000;
// Above this visible span the X axis switches from day labels to month labels.
const MONTH_TICKS_THRESHOLD_DAYS = 130;

// Recharts' automatic tick generation on numeric time axes produces very few,
// oddly placed labels (e.g. 3 ticks on a 30-day range). Build explicit ticks
// aligned to local midnight (short spans) or the 1st of the month (long spans),
// targeting ~6-7 labels regardless of range.
function buildXAxisTicks(minTimestamp, maxTimestamp) {
  if (
    !Number.isFinite(minTimestamp) ||
    !Number.isFinite(maxTimestamp) ||
    maxTimestamp <= minTimestamp
  ) {
    return undefined;
  }

  const spanDays = (maxTimestamp - minTimestamp) / DAY_MS;
  const ticks = [];

  if (spanDays <= MONTH_TICKS_THRESHOLD_DAYS) {
    const stepDays = Math.max(1, Math.ceil(spanDays / 7));
    const cursor = new Date(minTimestamp);
    cursor.setHours(0, 0, 0, 0);
    if (cursor.getTime() < minTimestamp) {
      cursor.setDate(cursor.getDate() + 1);
    }
    while (cursor.getTime() <= maxTimestamp) {
      ticks.push(cursor.getTime());
      cursor.setDate(cursor.getDate() + stepDays);
    }
  } else {
    const stepMonths = Math.max(1, Math.ceil(spanDays / 30 / 7));
    const cursor = new Date(minTimestamp);
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(1);
    if (cursor.getTime() < minTimestamp) {
      cursor.setMonth(cursor.getMonth() + 1);
    }
    while (cursor.getTime() <= maxTimestamp) {
      ticks.push(cursor.getTime());
      cursor.setMonth(cursor.getMonth() + stepMonths);
    }
  }

  return ticks.length >= 2 ? ticks : undefined;
}

function formatTickDate(timestamp, spanDays) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  if (Number.isFinite(spanDays) && spanDays > MONTH_TICKS_THRESHOLD_DAYS) {
    return date.toLocaleDateString(getActiveIntlLocale(), { month: "short", year: "2-digit" });
  }

  return date.toLocaleDateString(getActiveIntlLocale(), { day: "2-digit", month: "2-digit" });
}

function formatTooltipDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return translate("common:units.unknownLower");
  }

  const dateLabel = date.toLocaleDateString(getActiveIntlLocale(), {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  // Day-bucketed points sit at local midnight — appending "00:00" is noise.
  if (date.getHours() === 0 && date.getMinutes() === 0) {
    return dateLabel;
  }

  return `${dateLabel}, ${date.toLocaleTimeString(getActiveIntlLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatAxisPercent(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

// Absolute axis domain is computed in USD (the chart's internal unit); tick labels
// are converted to the user's display currency by the component (see formatUsdTick).
// The buy-in level is deliberately NOT folded into the domain: the axis fits the
// actual price data only, so a large gain/loss keeps full vertical resolution. When
// the buy-in falls outside this range the dashed line is clipped (ifOverflow="hidden")
// and an edge label marks its direction instead.
function buildAbsoluteAxisConfig(chartData = []) {
  const values = chartData
    .map((entry) => Number(entry?.displayValue))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  let range = maxValue - minValue;
  let pad;

  if (range <= Number.EPSILON) {
    const scalePad = Math.max(Math.abs(maxValue) * 0.02, 0.01);
    pad = scalePad;
    range = scalePad * 2;
  } else {
    pad = Math.max(range * 0.12, 0.01);
  }

  return {
    domain: [minValue - pad, maxValue + pad],
    tickCount: 6,
  };
}

function getRangeDays(rangeKey) {
  const range = RANGE_OPTIONS.find((entry) => entry.key === rangeKey);
  return range?.days ?? null;
}

/** Localised label for a range key, falling back to the raw key if unknown. */
function rangeLabelFor(rangeKey, t) {
  const range = RANGE_OPTIONS.find((entry) => entry.key === rangeKey);
  return range ? t(range.labelKey) : rangeKey;
}

function deriveInvestedFromGrowth(value, growthPercent) {
  if (!Number.isFinite(value) || !Number.isFinite(growthPercent)) {
    return null;
  }

  const denominator = 1 + growthPercent / 100;
  if (Math.abs(denominator) <= Number.EPSILON) {
    return null;
  }

  const invested = value / denominator;
  return Number.isFinite(invested) ? invested : null;
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map((entry, index) => {
      const timestamp = parseHistoryTimestamp(entry?.date);
      const wert = Number(resolveHistoryValueUsd(entry));
      const investedValue = Number(
        entry?.invested ??
          entry?.investedValue ??
          entry?.invested_value ??
          entry?.totalInvested ??
          entry?.total_invested,
      );

      if (timestamp === null || !Number.isFinite(wert)) {
        return null;
      }

      return {
        id: entry?.id ?? index,
        date: entry?.date ?? "",
        timestamp,
        wert,
        invested: Number.isFinite(investedValue) ? investedValue : null,
        growthPercent:
          entry?.growthPercent ??
          entry?.growth_percent ??
          entry?.percentChange ??
          entry?.percent_change,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.timestamp - right.timestamp);
}

function filterHistoryByRange(history, rangeKey) {
  if (history.length === 0) {
    return [];
  }

  const days = getRangeDays(rangeKey);
  if (days === null) {
    return history;
  }

  const latestTimestamp = history[history.length - 1].timestamp;
  const minTimestamp = latestTimestamp - days * 24 * 60 * 60 * 1000;
  const filtered = history.filter((entry) => entry.timestamp >= minTimestamp);

  return filtered.length > 0 ? filtered : history;
}

export const PortfolioChart = ({
  history,
  // Null defaults resolved in the body: a parameter default cannot call the
  // hook, and a module constant cannot see the active language.
  title = null,
  emptyLabel = null,
  valueLabel = null,
  isLoading = false,
  onHoverChange = null,
  onTrendChange = null,
  showAbsolute = false,
  referenceLineValue = null,
  referenceLineLabel = null,
  referenceLineTimestamp = null,
  disableDarkGlass = false,
  metricsScope = null,
  onMetricsScopeChange = null,
  flat = false,
  cardRef = null,
  // Replaces the card title on the left of the header row. The desktop
  // dashboard puts its hero (label, portfolio value, range delta) there so the
  // range pills sit on the hero's own label line, as the design has them —
  // rendering the hero above the card instead would push the pills a row down
  // and detach them from the value they re-scale.
  headerSlot = null,
  // The dashboard's chart is one block among several on a scrolling page, so it
  // runs shorter than the design-system default — the handoff draws it at 220px
  // and everything below it has to stay reachable without a long scroll.
  chartHeightClassName = "h-[300px] sm:h-[340px]",
}) => {
  const { t } = useTranslation("inventory");
  const { formatPrice, currency } = useCurrency();
  const resolvedTitle = title ?? t("chart.title");
  const resolvedEmptyLabel = emptyLabel ?? t("chart.noHistory");
  const resolvedValueLabel = valueLabel ?? t("chart.valueLabel");
  const resolvedReferenceLineLabel = referenceLineLabel ?? t("chart.buyIn");
  // Several PortfolioCharts can be mounted at once; a shared SVG gradient id would
  // make every instance pick up the first one's trend color.
  const fillGradientId = `portfolio-chart-fill-${useId()}`;
  const [rangeKey, setRangeKey] = useState("30T");
  const hoverAnimationFrameRef = useRef(null);
  const lastHoveredIndexRef = useRef(null);
  const lastHoverSignatureRef = useRef("");

  // Internal chart values are USD; convert to the user's display currency here.
  const formatUsdTick = useCallback(
    (usd) =>
      Number.isFinite(Number(usd))
        ? formatPrice(Number(usd), { useUsd: true, buyPriceUsd: Number(usd) })
        : "-",
    [formatPrice],
  );
  const formatSignedUsd = useCallback(
    (usd) => {
      if (!Number.isFinite(Number(usd))) {
        return "-";
      }
      const sign = Number(usd) >= 0 ? "+" : "";
      return `${sign}${formatPrice(Number(usd), { useUsd: true, buyPriceUsd: Number(usd) })}`;
    },
    [formatPrice],
  );

  const normalizedHistory = useMemo(() => normalizeHistory(history), [history]);
  const visibleHistory = useMemo(
    () => filterHistoryByRange(normalizedHistory, rangeKey),
    [normalizedHistory, rangeKey],
  );
  const chartData = useMemo(() => {
    if (visibleHistory.length === 0) {
      return [];
    }

    const baseValue = visibleHistory[0]?.wert;
    const hasValidBaseValue = Number.isFinite(baseValue) && Math.abs(baseValue) > Number.EPSILON;

    return visibleHistory.map((entry) => {
      const providedGrowthPercent = Number(entry?.growthPercent);
      const growthPercent = Number.isFinite(providedGrowthPercent)
        ? providedGrowthPercent
        : hasValidBaseValue
          ? ((entry.wert - baseValue) / baseValue) * 100
          : 0;
      const invested = Number.isFinite(Number(entry?.invested))
        ? Number(entry.invested)
        : deriveInvestedFromGrowth(entry.wert, growthPercent);
      const profitEuro = Number.isFinite(invested) ? entry.wert - invested : null;

      return {
        ...entry,
        growthPercent,
        invested,
        profitEuro,
        displayValue: showAbsolute ? entry.wert : growthPercent,
      };
    });
  }, [visibleHistory, showAbsolute]);
  // Number(null) is 0, and 0 is finite — with the bare Number() every caller that
  // passes no buy-in (the dashboard) claimed one at 0, i.e. a line at −100 %. It
  // stayed invisible only because the stroke was an invalid paint; guard the
  // absent value here so fixing the colour does not paint a phantom line.
  const normalizedReferenceLineValue =
    referenceLineValue === null || referenceLineValue === undefined || referenceLineValue === ""
      ? Number.NaN
      : Number(referenceLineValue);
  const normalizedReferenceLineTimestamp = Number(referenceLineTimestamp);
  // Number(null) is 0, so a missing timestamp must be detected via > 0.
  const hasReferenceTimestamp =
    Number.isFinite(normalizedReferenceLineTimestamp) && normalizedReferenceLineTimestamp > 0;
  const visibleMinTimestamp = visibleHistory[0]?.timestamp ?? null;
  const visibleMaxTimestamp = visibleHistory[visibleHistory.length - 1]?.timestamp ?? null;
  // The buy-in level is relevant in every range the position already existed in
  // (purchase at/before the window end) — not only when the purchase date itself
  // falls inside the window. Without a timestamp (groups) it is always relevant.
  const referenceActiveInRange =
    !hasReferenceTimestamp ||
    (Number.isFinite(Number(visibleMaxTimestamp)) &&
      normalizedReferenceLineTimestamp <= Number(visibleMaxTimestamp));
  // Percent mode plots growth relative to the first visible point; the buy-in level
  // is converted onto that same relative scale so the line works in both modes.
  const referenceBaseValue = visibleHistory[0]?.wert;
  const referenceDisplayValue = showAbsolute
    ? normalizedReferenceLineValue
    : Number.isFinite(referenceBaseValue) && Math.abs(referenceBaseValue) > Number.EPSILON
      ? ((normalizedReferenceLineValue - referenceBaseValue) / referenceBaseValue) * 100
      : null;
  const showReferenceLine =
    Number.isFinite(normalizedReferenceLineValue) &&
    Number.isFinite(referenceDisplayValue) &&
    referenceActiveInRange;
  const visibleSpanDays =
    Number.isFinite(Number(visibleMinTimestamp)) && Number.isFinite(Number(visibleMaxTimestamp))
      ? (Number(visibleMaxTimestamp) - Number(visibleMinTimestamp)) / DAY_MS
      : null;
  const xAxisTicks = useMemo(
    () => buildXAxisTicks(Number(visibleMinTimestamp), Number(visibleMaxTimestamp)),
    [visibleMinTimestamp, visibleMaxTimestamp],
  );
  const absoluteAxisConfig = useMemo(
    () => (showAbsolute ? buildAbsoluteAxisConfig(chartData) : null),
    [chartData, showAbsolute],
  );

  const trendStats = useMemo(() => {
    if (chartData.length === 0) {
      return {
        lineColor: "#22c55e",
        deltaValue: 0,
        deltaPercent: 0,
        roiGainEuro: 0,
        isPositive: true,
      };
    }

    const firstValue = chartData[0].wert;
    const lastValue = chartData[chartData.length - 1].wert;
    const periodDeltaValue = lastValue - firstValue;
    const firstGrowthPercent = Number(chartData[0]?.growthPercent);
    const lastGrowthPercent = Number(chartData[chartData.length - 1]?.growthPercent);
    const periodDeltaPercent =
      !showAbsolute &&
      Number.isFinite(firstGrowthPercent) &&
      Number.isFinite(lastGrowthPercent)
        ? lastGrowthPercent - firstGrowthPercent
        : firstValue > 0
          ? (periodDeltaValue / firstValue) * 100
          : 0;

    // ROI gain over the period in EUR: the change in profit (wert - invested) rather
    // than the raw value delta. Deposits/withdrawals during the period move wert and
    // invested in lockstep, so they cancel out here — this is the EUR figure that
    // matches the period performance percent and won't show a phantom gain just because
    // money was added. Falls back to the value delta when profit data is unavailable.
    const firstProfitEuro = Number(chartData[0]?.profitEuro);
    const lastProfitEuro = Number(chartData[chartData.length - 1]?.profitEuro);
    const periodRoiGainEuro =
      Number.isFinite(firstProfitEuro) && Number.isFinite(lastProfitEuro)
        ? lastProfitEuro - firstProfitEuro
        : periodDeltaValue;

    const isPositive = showAbsolute ? periodDeltaValue >= 0 : periodDeltaPercent >= 0;

    return {
      lineColor: isPositive ? "#22c55e" : "#ef4444",
      deltaValue: periodDeltaValue,
      deltaPercent: periodDeltaPercent,
      roiGainEuro: periodRoiGainEuro,
      isPositive,
    };
  }, [chartData, showAbsolute]);

  const chartConfig = useMemo(
    () => ({
      growthPercent: {
        label: showAbsolute ? t("chart.priceIn", { currency }) : t("chart.growthPercent"),
        color: trendStats.lineColor,
      },
    }),
    [trendStats.lineColor, showAbsolute, currency, t],
  );

  const dispatchHoverChange = useCallback(
    (payload) => {
      if (typeof onHoverChange !== "function") {
        return;
      }
      const signature = payload
        ? `${payload.date}|${payload.wert}|${payload.growthPercent}|${payload.profitEuro}`
        : "null";
      if (lastHoverSignatureRef.current === signature) {
        return;
      }
      lastHoverSignatureRef.current = signature;
      onHoverChange(payload);
    },
    [onHoverChange],
  );

  const handleChartMouseMove = useCallback(
    (state) => {
      const activeIndex = state?.activeTooltipIndex;
      if (!Number.isInteger(activeIndex) || !chartData[activeIndex]) {
        return;
      }

      if (lastHoveredIndexRef.current === activeIndex) {
        return;
      }
      lastHoveredIndexRef.current = activeIndex;

      if (hoverAnimationFrameRef.current) {
        cancelAnimationFrame(hoverAnimationFrameRef.current);
      }
      hoverAnimationFrameRef.current = requestAnimationFrame(() => {
        hoverAnimationFrameRef.current = null;
        const hoveredData = chartData[activeIndex];
        if (!hoveredData) {
          return;
        }
        dispatchHoverChange({
          wert: hoveredData.wert,
          growthPercent: hoveredData.growthPercent,
          invested: hoveredData.invested,
          profitEuro: hoveredData.profitEuro,
          date: hoveredData.date,
        });
      });
    },
    [chartData, dispatchHoverChange],
  );

  const handleChartMouseLeave = useCallback(() => {
    lastHoveredIndexRef.current = null;
    if (hoverAnimationFrameRef.current) {
      cancelAnimationFrame(hoverAnimationFrameRef.current);
      hoverAnimationFrameRef.current = null;
    }
    dispatchHoverChange(null);
  }, [dispatchHoverChange]);

  useEffect(
    () => () => {
      if (hoverAnimationFrameRef.current) {
        cancelAnimationFrame(hoverAnimationFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (typeof onTrendChange !== "function") {
      return;
    }
    const activeRange = RANGE_OPTIONS.find((option) => option.key === rangeKey) || null;
    onTrendChange({
      rangeKey,
      rangeLabel: rangeLabelFor(rangeKey, t),
      rangeDays: activeRange?.days ?? null,
      deltaValue: trendStats.deltaValue,
      deltaPercent: trendStats.deltaPercent,
      // Emitted alongside deltaValue because the two are not interchangeable:
      // deltaPercent is a growth-percent difference, and the euro figure that
      // actually matches it is roiGainEuro (see trendStats). A consumer pairing
      // deltaValue with deltaPercent shows two numbers that disagree.
      roiGainEuro: trendStats.roiGainEuro,
      isPositive: trendStats.isPositive,
    });
  }, [
    onTrendChange,
    rangeKey,
    t,
    trendStats.deltaPercent,
    trendStats.deltaValue,
    trendStats.roiGainEuro,
    trendStats.isPositive,
  ]);

  const cardClassName = flat
    ? "overflow-hidden border-0 bg-transparent shadow-none dark:bg-transparent dark:shadow-none dark:backdrop-blur-0"
    : disableDarkGlass
      ? "overflow-hidden dark:bg-transparent dark:shadow-none dark:backdrop-blur-0"
      : "overflow-hidden";
  const headerClassName = flat ? "px-0 pb-2 sm:pb-3" : "pb-2 sm:pb-4";
  const contentClassName = flat ? "px-0 pb-2 sm:pb-3" : "px-2 pb-2 sm:px-6 sm:pb-6";
  const footerClassName = flat
    ? "px-0 flex-col items-start gap-2 text-xs sm:text-sm"
    : "flex-col items-start gap-2 text-xs sm:text-sm";

  return (
    <Card ref={cardRef} className={cardClassName}>
      <CardHeader className={headerClassName}>
        <div
          className={`flex flex-col gap-3 sm:flex-row sm:justify-between ${
            headerSlot ? "sm:items-start" : "sm:items-center"
          }`}
        >
          {headerSlot ?? (
            <CardTitle className="hidden text-base font-bold sm:block sm:text-lg">{resolvedTitle}</CardTitle>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {typeof onMetricsScopeChange === "function" ? (
              // Hidden below `sm`: the mobile dashboard puts the same switch at
              // the top of the screen, above the value it changes.
              <div className="hidden w-fit items-center rounded-xl border border-border/70 bg-card/55 p-1 sm:inline-flex">
                {[
                  { key: "investments", label: t("chart.investments") },
                  { key: "all", label: t("chart.all") },
                ].map((option) => {
                  const isActive = metricsScope === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                        isActive
                          ? "bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(255,255,255,0.15)]"
                          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                      }`}
                      onClick={() => onMetricsScopeChange(option.key)}
                      disabled={isLoading}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="inline-flex w-fit items-center rounded-xl border border-border/70 bg-card/55 p-1">
              {RANGE_OPTIONS.map((option) => {
                const isActive = rangeKey === option.key;

                return (
                  <button
                    key={option.key}
                    type="button"
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(255,255,255,0.15)]"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    }`}
                    onClick={() => setRangeKey(option.key)}
                    disabled={isLoading}
                  >
                    {t(option.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className={contentClassName}>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className={`w-full ${chartHeightClassName}`} />
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ) : chartData.length === 0 ? (
          <div className={`flex items-center justify-center text-muted-foreground ${chartHeightClassName}`}>
            <p className="text-sm">{resolvedEmptyLabel}</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className={`aspect-auto w-full ${chartHeightClassName}`}>
            <ComposedChart
              key={rangeKey}
              accessibilityLayer
              data={chartData}
              margin={{
                left: 4,
                right: 2,
                top: 12,
                bottom: 6,
              }}
              onMouseMove={handleChartMouseMove}
              onMouseLeave={handleChartMouseLeave}
            >
              <defs>
                <linearGradient id={fillGradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trendStats.lineColor} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={trendStats.lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              {/* No CartesianGrid: the design draws the plot bare, with the dashed
                  zero line as the only rule. It used to sit here but painted
                  nothing — `hsl(var(--border))` resolved to `hsl(oklch(…))`, an
                  invalid paint the renderer drops. Same reason the zero line was
                  invisible; hence `var(--…)` unwrapped below. */}
              {!showAbsolute ? (
                <ReferenceLine
                  y={0}
                  stroke="var(--border-strong)"
                  strokeDasharray="5 5"
                  ifOverflow="hidden"
                />
              ) : null}
              {showReferenceLine ? (
                <ReferenceLine
                  y={referenceDisplayValue}
                  stroke="var(--muted-foreground)"
                  strokeOpacity={0.65}
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                />
              ) : null}
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={["dataMin", "dataMax"]}
                ticks={xAxisTicks}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={12}
                tickFormatter={(value) => formatTickDate(value, visibleSpanDays)}
              />
              <YAxis
                dataKey="displayValue"
                orientation="right"
                domain={showAbsolute && absoluteAxisConfig ? absoluteAxisConfig.domain : ["auto", "auto"]}
                allowDataOverflow={Boolean(showAbsolute && absoluteAxisConfig)}
                tickCount={showAbsolute && absoluteAxisConfig ? absoluteAxisConfig.tickCount : 7}
                tickLine={false}
                axisLine={false}
                width={70}
                tickMargin={4}
                tickFormatter={
                  showAbsolute && absoluteAxisConfig ? formatUsdTick : formatAxisPercent
                }
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    indicator="line"
                    nameKey="displayValue"
                    labelFormatter={(value) => formatTooltipDate(value)}
                    formatter={(value, name, item, index, dataPoint) => {
                      const wert = Number(dataPoint?.wert);
                      const growth = Number(dataPoint?.growthPercent);
                      const growthClassName = toneText(toneForDelta(growth), "success");
                      return (
                        <div className="flex w-full flex-col gap-1">
                          <div className="flex w-full items-center justify-between gap-4">
                            <span className="text-muted-foreground">{resolvedValueLabel}</span>
                            <span className="font-mono font-medium tabular-nums text-foreground">
                              {formatUsdTick(wert)}
                            </span>
                          </div>
                          <div className="flex w-full items-center justify-between gap-4">
                            <span className="text-muted-foreground">{t("chart.growth")}</span>
                            <span className={`font-mono font-medium tabular-nums ${growthClassName}`}>
                              {formatSignedPercent(growth)}
                            </span>
                          </div>
                          {showReferenceLine && normalizedReferenceLineValue > 0 ? (
                            <div className="flex w-full items-center justify-between gap-4">
                              <span className="text-muted-foreground">
                                {t("chart.vsReference", { label: resolvedReferenceLineLabel })}
                              </span>
                              <span className="font-mono font-medium tabular-nums text-foreground">
                                {formatSignedPercent(
                                  ((wert - normalizedReferenceLineValue) /
                                    normalizedReferenceLineValue) *
                                    100,
                                )}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      );
                    }}
                  />
                }
              />
              <Area
                dataKey="displayValue"
                type="linear"
                stroke="none"
                // Fill downwards from the axis floor, not towards zero. In
                // percent mode a portfolio that spent the whole range below its
                // start has only negative values, and the default zero baseline
                // sits above the visible domain — the band then rendered *over*
                // the line, filling the top of the plot instead of the area
                // beneath it.
                baseValue="dataMin"
                fill={`url(#${fillGradientId})`}
                isAnimationActive
                animationDuration={900}
                animationEasing="ease-out"
                activeDot={false}
                legendType="none"
                tooltipType="none"
              />
              <Line
                dataKey="displayValue"
                type="linear"
                stroke="var(--color-growthPercent)"
                strokeWidth={2.7}
                strokeLinecap="square"
                strokeLinejoin="miter"
                dot={false}
                isAnimationActive
                animationDuration={900}
                animationEasing="ease-out"
                activeDot={{
                  r: 5,
                  fill: trendStats.lineColor,
                  stroke: trendStats.lineColor,
                  strokeWidth: 2,
                }}
              />
            </ComposedChart>
          </ChartContainer>
        )}
      </CardContent>

      {/* A hero in the header already prints the range delta and the range it
          covers, so the footer would say the same thing twice. Other mounts
          (item/group detail) pass no hero and keep it. */}
      <CardFooter className={`${footerClassName}${headerSlot ? " hidden" : ""}`}>
        {isLoading ? (
          <>
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-3 w-40" />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 leading-none font-semibold">
              Performance: {formatSignedUsd(showAbsolute ? trendStats.deltaValue : trendStats.roiGainEuro)} (
              {formatSignedPercent(trendStats.deltaPercent)})
              {trendStats.isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            </div>
            <div className="leading-none text-muted-foreground">
              {t("chart.rangeSummary", { range: rangeLabelFor(rangeKey, t), value: resolvedValueLabel })}
            </div>
          </>
        )}
      </CardFooter>
    </Card>
  );
};
