import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";
import { Skeleton } from "./ui/skeleton";
import { useCurrency } from "@shared/contexts/CurrencyContext";

const RANGE_OPTIONS = [
  { key: "7T", label: "7T", days: 7 },
  { key: "30T", label: "30T", days: 30 },
  { key: "1J", label: "1J", days: 365 },
  { key: "MAX", label: "MAX", days: null },
];

function parseDateToTimestamp(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const localDate = new Date(`${value}T00:00:00`);
    const localTimestamp = localDate.getTime();
    return Number.isNaN(localTimestamp) ? null : localTimestamp;
  }

  const normalizedValue =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(value)
      ? value.replace(" ", "T")
      : value;

  const timestamp = new Date(normalizedValue).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

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
    return date.toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
  }

  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function formatTooltipDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "unbekannt";
  }

  const dateLabel = date.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  // Day-bucketed points sit at local midnight — appending "00:00" is noise.
  if (date.getHours() === 0 && date.getMinutes() === 0) {
    return dateLabel;
  }

  return `${dateLabel}, ${date.toLocaleTimeString("de-DE", {
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
// referenceValue (buy-in) must be part of the domain: the axis uses an explicit
// domain with allowDataOverflow, which overrides ifOverflow="extendDomain" on the
// ReferenceLine — without this a buy-in outside the price range is silently clipped.
function buildAbsoluteAxisConfig(chartData = [], referenceValue = null) {
  const values = chartData
    .map((entry) => Number(entry?.displayValue))
    .filter((value) => Number.isFinite(value));
  if (Number.isFinite(referenceValue)) {
    values.push(referenceValue);
  }
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
      const timestamp = parseDateToTimestamp(entry?.date);
      // Internal unit is USD (source of truth). Read USD fields only — priceEur is
      // deliberately NOT a fallback to avoid silently mixing currencies on the axis.
      const rawValue =
        entry?.priceUsd ??
        entry?.price_usd ??
        entry?.valueUsd ??
        entry?.wert ??
        entry?.value;
      const wert = Number(rawValue);
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
  title = "Portfolio Entwicklung",
  emptyLabel = "Noch keine Historie-Daten verfuegbar",
  valueLabel = "Wert",
  isLoading = false,
  onHoverChange = null,
  onTrendChange = null,
  showAbsolute = false,
  referenceLineValue = null,
  referenceLineLabel = "Buy-In",
  referenceLineTimestamp = null,
  disableDarkGlass = false,
  metricsScope = null,
  onMetricsScopeChange = null,
  flat = false,
  cardRef = null,
}) => {
  const { formatPrice, currency } = useCurrency();
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
  const normalizedReferenceLineValue = Number(referenceLineValue);
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
  // The dot marks the actual purchase moment on the time axis; purchases before the
  // visible window keep the line but drop the dot.
  const referenceDotX =
    showReferenceLine &&
    hasReferenceTimestamp &&
    Number.isFinite(Number(visibleMinTimestamp)) &&
    normalizedReferenceLineTimestamp >= Number(visibleMinTimestamp) &&
    normalizedReferenceLineTimestamp <= Number(visibleMaxTimestamp)
      ? normalizedReferenceLineTimestamp
      : null;
  const visibleSpanDays =
    Number.isFinite(Number(visibleMinTimestamp)) && Number.isFinite(Number(visibleMaxTimestamp))
      ? (Number(visibleMaxTimestamp) - Number(visibleMinTimestamp)) / DAY_MS
      : null;
  const xAxisTicks = useMemo(
    () => buildXAxisTicks(Number(visibleMinTimestamp), Number(visibleMaxTimestamp)),
    [visibleMinTimestamp, visibleMaxTimestamp],
  );
  const absoluteAxisConfig = useMemo(
    () =>
      showAbsolute
        ? buildAbsoluteAxisConfig(
            chartData,
            showReferenceLine ? normalizedReferenceLineValue : null,
          )
        : null,
    [chartData, showAbsolute, showReferenceLine, normalizedReferenceLineValue],
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
        label: showAbsolute ? `Preis (${currency})` : "Zuwachs (%)",
        color: trendStats.lineColor,
      },
    }),
    [trendStats.lineColor, showAbsolute, currency],
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
      rangeLabel: activeRange?.label || rangeKey,
      rangeDays: activeRange?.days ?? null,
      deltaValue: trendStats.deltaValue,
      deltaPercent: trendStats.deltaPercent,
      isPositive: trendStats.isPositive,
    });
  }, [
    onTrendChange,
    rangeKey,
    trendStats.deltaPercent,
    trendStats.deltaValue,
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="hidden text-base font-bold sm:block sm:text-lg">{title}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {typeof onMetricsScopeChange === "function" ? (
              <div className="inline-flex w-fit items-center rounded-xl border border-border/70 bg-card/55 p-1">
                {[
                  { key: "investments", label: "Investments" },
                  { key: "all", label: "Alles" },
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
                    {option.label}
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
            <Skeleton className="h-[300px] w-full sm:h-[340px]" />
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center text-muted-foreground sm:h-[340px]">
            <p className="text-sm">{emptyLabel}</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[300px] w-full sm:h-[340px]">
            <LineChart
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
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.45} />
              {!showAbsolute ? (
                <ReferenceLine y={0} stroke="hsl(var(--border))" strokeOpacity={0.8} strokeDasharray="3 3" />
              ) : null}
              {showReferenceLine ? (
                <ReferenceLine
                  y={referenceDisplayValue}
                  stroke="hsl(var(--muted-foreground))"
                  strokeOpacity={0.65}
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{
                    value: referenceLineLabel,
                    position: "insideTopLeft",
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 10,
                  }}
                />
              ) : null}
              {showReferenceLine && Number.isFinite(Number(referenceDotX)) ? (
                <ReferenceDot
                  x={referenceDotX}
                  y={referenceDisplayValue}
                  r={4}
                  ifOverflow="extendDomain"
                  fill="hsl(var(--muted-foreground))"
                  stroke="hsl(var(--background))"
                  strokeWidth={1.25}
                  isFront
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
                      const growthClassName =
                        Number.isFinite(growth) && growth < 0 ? "text-red-500" : "text-emerald-500";
                      return (
                        <div className="flex w-full flex-col gap-1">
                          <div className="flex w-full items-center justify-between gap-4">
                            <span className="text-muted-foreground">{valueLabel}</span>
                            <span className="font-mono font-medium tabular-nums text-foreground">
                              {formatUsdTick(wert)}
                            </span>
                          </div>
                          <div className="flex w-full items-center justify-between gap-4">
                            <span className="text-muted-foreground">Zuwachs</span>
                            <span className={`font-mono font-medium tabular-nums ${growthClassName}`}>
                              {formatSignedPercent(growth)}
                            </span>
                          </div>
                          {showReferenceLine && normalizedReferenceLineValue > 0 ? (
                            <div className="flex w-full items-center justify-between gap-4">
                              <span className="text-muted-foreground">vs. {referenceLineLabel}</span>
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
              <Line
                dataKey="displayValue"
                type="linear"
                stroke="var(--color-growthPercent)"
                strokeWidth={2.7}
                strokeLinecap="square"
                strokeLinejoin="miter"
                dot={false}
                activeDot={{
                  r: 5,
                  fill: trendStats.lineColor,
                  stroke: trendStats.lineColor,
                  strokeWidth: 2,
                }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>

      <CardFooter className={footerClassName}>
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
              Zeitraum: {rangeKey} - {valueLabel}
            </div>
          </>
        )}
      </CardFooter>
    </Card>
  );
};
