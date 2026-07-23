import { useState, useEffect } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "./ui/skeleton.jsx";
import { BREAKPOINTS } from "../lib/constants.js";
import { useCurrency } from "@shared/contexts/CurrencyContext";

const COLOR_PALETTE = ["#5ca9ff", "#4d93ee", "#3e7cdc", "#2f67ca", "#2b56b1", "#23529a", "#1b4d82", "#144168"];
const OTHER_SLICE_COLOR = "#64748b";
const SMALL_SLICE_THRESHOLD_PERCENT = 1;

function normalizeCompositionRows(data) {
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((item) => ({
      ...item,
      value: Number(item?.value || 0),
      count: Number(item?.count || 0),
    }))
    .filter((item) => Number.isFinite(item.value) && item.value > 0);
}

function groupSmallSlices(rows, thresholdPercent = SMALL_SLICE_THRESHOLD_PERCENT) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return rows || [];
  }

  const totalValue = rows.reduce((sum, item) => sum + item.value, 0);
  if (!Number.isFinite(totalValue) || totalValue <= 0) {
    return rows;
  }

  const majorRows = [];
  const smallRows = [];

  rows.forEach((item) => {
    const sharePercent = (item.value / totalValue) * 100;
    if (sharePercent < thresholdPercent) {
      smallRows.push(item);
      return;
    }
    majorRows.push(item);
  });

  if (smallRows.length === 0 || majorRows.length === 0) {
    return rows;
  }

  const groupedOtherRow = {
    name: `Sonstige (<${thresholdPercent}%)`,
    type: "other",
    count: smallRows.reduce((sum, item) => sum + item.count, 0),
    value: smallRows.reduce((sum, item) => sum + item.value, 0),
    isGroupedOther: true,
  };

  return [...majorRows, groupedOtherRow];
}

function decorateCompositionRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const totalValue = rows.reduce((sum, item) => sum + item.value, 0);
  if (!Number.isFinite(totalValue) || totalValue <= 0) {
    return [];
  }

  return rows.map((item, idx) => ({
    ...item,
    percentage: Number(((item.value / totalValue) * 100).toFixed(1)),
    displayColor: item.isGroupedOther ? OTHER_SLICE_COLOR : COLOR_PALETTE[idx % COLOR_PALETTE.length],
  }));
}

export function PortfolioCompositionChart({
  data,
  isLoading = false,
  totalValueOverride = null,
  totalValueLabel = null,
  // Currency + label knobs so the chart can be reused outside the portfolio
  // overview (e.g. cluster weighting inside a group's detail panel). Defaults
  // keep the overview call site unchanged: its `value`s are USD.
  valuesAreUsd = true,
  centerLabel = "Portfolio Wert",
  shareSuffix = "des Portfolios",
  assetCountLabel = "Assets",
}) {
  const { formatPrice } = useCurrency();
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [isSmallScreen, setIsSmallScreen] = useState(window.innerWidth < BREAKPOINTS.MOBILE);

  useEffect(() => {
    const handleResize = () => setIsSmallScreen(window.innerWidth < BREAKPOINTS.MOBILE);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (isLoading) {
    return <div className="flex h-96 items-center justify-center">Loading...</div>;
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center rounded-2xl border border-border/70 bg-card/65">
        <p className="text-muted-foreground">Keine Daten verfuegbar</p>
      </div>
    );
  }

  const normalizedRows = normalizeCompositionRows(data);
  const groupedRows = groupSmallSlices(normalizedRows, SMALL_SLICE_THRESHOLD_PERCENT);
  const displayData = decorateCompositionRows(groupedRows);
  const chartData = displayData;
  const totalValueFromData = normalizedRows.reduce((sum, item) => sum + item.value, 0);
  const totalValue = Number.isFinite(Number(totalValueOverride)) ? Number(totalValueOverride) : totalValueFromData;
  const sourceAssetCount = normalizedRows.length;
  const hasRenderableChartData = chartData.length > 0;

  const formatSliceValue = (value) =>
    valuesAreUsd ? formatPrice(value, { useUsd: true, buyPriceUsd: value }) : formatPrice(value);

  const renderTooltip = ({ payload }) => {
    if (!payload || !payload[0]) {
      return null;
    }
    const { name, count, value, percentage } = payload[0].payload;
    return (
      <div className="rounded-xl border border-border/70 bg-card/90 p-3 text-xs shadow-[0_14px_30px_rgba(0,0,0,0.3)]">
        <p className="font-semibold">{name}</p>
        <p className="text-muted-foreground">{count}x verfuegbar</p>
        <p className="font-semibold text-primary">
          {formatSliceValue(value)}
        </p>
        <p className="text-muted-foreground">{percentage}% {shareSuffix}</p>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
      <div className="flex flex-col items-center gap-3">
        <div className="relative h-[220px] w-full max-w-sm sm:h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              {hasRenderableChartData ? (
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  outerRadius={isSmallScreen ? 70 : 100}
                  innerRadius={isSmallScreen ? 45 : 60}
                  dataKey="value"
                  onMouseEnter={(_, index) => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.displayColor}
                      stroke="none"
                      opacity={hoveredIndex === null || hoveredIndex === index ? 1 : 0.3}
                    />
                  ))}
                </Pie>
              ) : null}
              <Tooltip content={renderTooltip} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-center">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase">{centerLabel}</p>
              <p className="text-xl sm:text-2xl font-bold">
                {totalValueLabel || formatSliceValue(totalValue)}
              </p>
              <p className="text-[10px] sm:text-xs text-muted-foreground">{sourceAssetCount} {assetCountLabel}</p>
              {!hasRenderableChartData ? (
                <p className="mt-1 text-[10px] text-muted-foreground">Noch keine csfloat-Livewerte</p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="w-full max-w-sm rounded-xl border border-border/70 bg-card/65 p-2 text-center sm:p-3">
          <p className="text-[9px] font-semibold uppercase text-muted-foreground">Items</p>
          <p className="text-base font-bold sm:text-lg">{displayData.reduce((sum, item) => sum + item.count, 0)}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 sm:max-h-64 lg:max-h-[420px] xl:grid-cols-3">
        {displayData.map((item, idx) => (
          <div
            key={idx}
            className="flex cursor-pointer items-center gap-2 rounded-xl border border-border/70 bg-card/65 p-2 text-xs transition-colors hover:bg-accent/45 sm:text-sm"
            onMouseEnter={() => setHoveredIndex(idx)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: item.displayColor }} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{item.name}</p>
              <p className="text-xs text-muted-foreground">{item.percentage}%</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
