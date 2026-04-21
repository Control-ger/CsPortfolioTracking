import { useMemo, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";
import { Skeleton } from "./ui/skeleton";

const RANGE_OPTIONS = [
  { key: "1T", label: "1T", days: 1 },
  { key: "1W", label: "1W", days: 7 },
  { key: "1M", label: "1M", days: 30 },
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

  if (rangeKey === "1T") {
    return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }

  if (rangeKey === "1J" || rangeKey === "MAX") {
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

function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return `${value.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} EUR`;
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

function formatAxisCurrency(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return `EUR ${value.toLocaleString("de-DE", { maximumFractionDigits: 0 })}`;
}

function getRangeDays(rangeKey) {
  const range = RANGE_OPTIONS.find((entry) => entry.key === rangeKey);
  return range?.days ?? null;
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map((entry, index) => {
      const timestamp = parseDateToTimestamp(entry?.date);
      const wert = Number(entry?.wert);

      if (timestamp === null || !Number.isFinite(wert)) {
        return null;
      }

      return {
        id: entry?.id ?? index,
        date: entry?.date ?? "",
        timestamp,
        wert,
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
}) => {
  const [rangeKey, setRangeKey] = useState("MAX");

  const normalizedHistory = useMemo(() => normalizeHistory(history), [history]);
  const visibleHistory = useMemo(
    () => filterHistoryByRange(normalizedHistory, rangeKey),
    [normalizedHistory, rangeKey],
  );

  const trendStats = useMemo(() => {
    if (visibleHistory.length === 0) {
      return {
        lineColor: "#22c55e",
        deltaValue: 0,
        deltaPercent: 0,
        isPositive: true,
      };
    }

    const firstValue = visibleHistory[0].wert;
    const lastValue = visibleHistory[visibleHistory.length - 1].wert;
    const deltaValue = lastValue - firstValue;
    const deltaPercent = firstValue > 0 ? (deltaValue / firstValue) * 100 : 0;
    const isPositive = deltaValue >= 0;

    return {
      lineColor: isPositive ? "#22c55e" : "#ef4444",
      deltaValue,
      deltaPercent,
      isPositive,
    };
  }, [visibleHistory]);

  const chartConfig = useMemo(
    () => ({
      wert: {
        label: valueLabel,
        color: trendStats.lineColor,
      },
    }),
    [trendStats.lineColor, valueLabel],
  );

  return (
    <Card>
      <CardHeader className="pb-2 sm:pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
          <div className="inline-flex w-fit items-center rounded-md border bg-muted/20 p-1">
            {RANGE_OPTIONS.map((option) => {
              const isActive = rangeKey === option.key;

              return (
                <button
                  key={option.key}
                  type="button"
                  className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                    isActive
                      ? "bg-background text-foreground shadow-sm"
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
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-[250px] w-full sm:h-[320px]" />
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ) : visibleHistory.length === 0 ? (
          <div className="flex h-[250px] items-center justify-center text-muted-foreground sm:h-[320px]">
            <p className="text-sm">{emptyLabel}</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full sm:h-[320px]">
            <LineChart
              accessibilityLayer
              data={visibleHistory}
              margin={{
                left: 10,
                right: 10,
                top: 12,
                bottom: 6,
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={28}
                tickFormatter={(value) => formatTickDate(value, rangeKey)}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={66}
                tickFormatter={formatAxisCurrency}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    indicator="line"
                    nameKey="wert"
                    labelFormatter={(value) => formatTooltipDate(value)}
                    formatter={(value) => formatCurrency(Number(value))}
                  />
                }
              />
              <Line
                dataKey="wert"
                type="monotone"
                stroke="var(--color-wert)"
                strokeWidth={2.5}
                dot={false}
                activeDot={{
                  r: 4,
                  fill: trendStats.lineColor,
                  stroke: trendStats.lineColor,
                }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>

      <CardFooter className="flex-col items-start gap-2 text-xs sm:text-sm">
        {isLoading ? (
          <>
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-3 w-40" />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 leading-none font-medium">
              {trendStats.isPositive ? "Gewinn" : "Verlust"}: {formatSignedCurrency(trendStats.deltaValue)} (
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
