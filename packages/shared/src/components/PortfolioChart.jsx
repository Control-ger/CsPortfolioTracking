import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";
import { Skeleton } from "./ui/skeleton";

const RANGE_OPTIONS = [
  { key: "7T", label: "7T", days: 7 },
  { key: "30T", label: "30T", days: 30 },
  { key: "90T", label: "90T", days: 90 },
  { key: "180T", label: "180T", days: 180 },
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

function formatTickDate(timestamp, rangeKey) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  if (rangeKey === "90T" || rangeKey === "180T" || rangeKey === "1J" || rangeKey === "MAX") {
    return date.toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
  }

  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function formatTooltipDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "unbekannt";
  }

  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSignedCurrency(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} EUR`;
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

function formatAxisAbsolute(value, decimals = 2) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return `${value.toLocaleString("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}€`;
}

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
    tickFormatter: (value) => formatAxisAbsolute(value, 2),
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
      const rawValue =
        entry?.wert ??
        entry?.priceEur ??
        entry?.price_eur ??
        entry?.price ??
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
  const [rangeKey, setRangeKey] = useState("90T");
  const hoverAnimationFrameRef = useRef(null);
  const lastHoveredIndexRef = useRef(null);
  const lastHoverSignatureRef = useRef("");

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
  const absoluteAxisConfig = useMemo(
    () => (showAbsolute ? buildAbsoluteAxisConfig(chartData) : null),
    [chartData, showAbsolute],
  );
  const normalizedReferenceLineValue = Number(referenceLineValue);
  const normalizedReferenceLineTimestamp = Number(referenceLineTimestamp);
  const visibleMinTimestamp = visibleHistory[0]?.timestamp ?? null;
  const visibleMaxTimestamp = visibleHistory[visibleHistory.length - 1]?.timestamp ?? null;
  const referenceTimestampInVisibleRange =
    Number.isFinite(normalizedReferenceLineTimestamp) &&
    Number.isFinite(Number(visibleMinTimestamp)) &&
    Number.isFinite(Number(visibleMaxTimestamp)) &&
    normalizedReferenceLineTimestamp >= Number(visibleMinTimestamp) &&
    normalizedReferenceLineTimestamp <= Number(visibleMaxTimestamp);
  const showReferenceLine =
    showAbsolute &&
    Number.isFinite(normalizedReferenceLineValue) &&
    referenceTimestampInVisibleRange;
  const referenceDotX = chartData.length > 0 ? chartData[chartData.length - 1]?.timestamp : null;

  const trendStats = useMemo(() => {
    if (chartData.length === 0) {
      return {
        lineColor: "#22c55e",
        deltaValue: 0,
        deltaPercent: 0,
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

    const isPositive = showAbsolute ? periodDeltaValue >= 0 : periodDeltaPercent >= 0;

    return {
      lineColor: isPositive ? "#22c55e" : "#ef4444",
      deltaValue: periodDeltaValue,
      deltaPercent: periodDeltaPercent,
      isPositive,
    };
  }, [chartData, showAbsolute]);

  const chartConfig = useMemo(
    () => ({
      growthPercent: {
        label: showAbsolute ? "Preis (EUR)" : "Zuwachs (%)",
        color: trendStats.lineColor,
      },
    }),
    [trendStats.lineColor, showAbsolute],
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
                  y={normalizedReferenceLineValue}
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
                  y={normalizedReferenceLineValue}
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
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={rangeKey === "7T" || rangeKey === "30T" ? 18 : 28}
                tickFormatter={(value) => formatTickDate(value, rangeKey)}
              />
              <YAxis
                dataKey="displayValue"
                orientation="right"
                domain={showAbsolute && absoluteAxisConfig ? absoluteAxisConfig.domain : ["auto", "auto"]}
                allowDataOverflow={Boolean(showAbsolute && absoluteAxisConfig)}
                tickCount={showAbsolute && absoluteAxisConfig ? absoluteAxisConfig.tickCount : undefined}
                tickLine={false}
                axisLine={false}
                width={70}
                tickMargin={4}
                tickFormatter={
                  showAbsolute && absoluteAxisConfig
                    ? absoluteAxisConfig.tickFormatter
                    : formatAxisPercent
                }
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    indicator="line"
                    nameKey="displayValue"
                    labelFormatter={(value) => formatTooltipDate(value)}
                    formatter={(value) => showAbsolute ? `${Number(value).toLocaleString("de-DE", {minimumFractionDigits: 2, maximumFractionDigits: 2})} EUR` : formatAxisPercent(Number(value))}
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
              Performance: {formatSignedCurrency(trendStats.deltaValue)} (
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
