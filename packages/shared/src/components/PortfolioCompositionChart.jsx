import { useState, useEffect } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "./ui/skeleton.jsx";
import { BREAKPOINTS } from "../lib/constants.js";
import { useCurrency } from "@shared/contexts/CurrencyContext";

const COLOR_PALETTE = ["#5ca9ff", "#4d93ee", "#3e7cdc", "#2f67ca", "#2b56b1", "#23529a", "#1b4d82", "#144168"];

export function PortfolioCompositionChart({
  data,
  isLoading = false,
  totalValueOverride = null,
  totalValueLabel = null,
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

  const displayData = data.map((item, idx) => ({ ...item, displayColor: COLOR_PALETTE[idx % COLOR_PALETTE.length] }));
  const chartData = displayData.filter((item) => Number(item.value) > 0);
  const totalValueFromData = displayData.reduce((sum, item) => sum + item.value, 0);
  const totalValue = Number.isFinite(Number(totalValueOverride)) ? Number(totalValueOverride) : totalValueFromData;
  const hasRenderableChartData = chartData.length > 0;

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
          {formatPrice(value, { useUsd: true, buyPriceUsd: value })}
        </p>
        <p className="text-muted-foreground">{percentage}% des Portfolios</p>
      </div>
    );
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-1 items-start gap-4 sm:gap-6 lg:grid-cols-3 lg:items-start">
        <div className="flex justify-center lg:col-span-2 lg:items-start">
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
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase">Portfolio Wert</p>
                <p className="text-xl sm:text-2xl font-bold">
                  {totalValueLabel || formatPrice(totalValue, { useUsd: true, buyPriceUsd: totalValue })}
                </p>
                <p className="text-[10px] sm:text-xs text-muted-foreground">{displayData.length} Assets</p>
                {!hasRenderableChartData ? (
                  <p className="mt-1 text-[10px] text-muted-foreground">Noch keine csfloat-Livewerte</p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col lg:col-span-1 lg:justify-start">
          <div className="max-h-52 space-y-2 overflow-y-auto pr-1 sm:max-h-64 lg:h-[320px] lg:max-h-[320px]">
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
      </div>
      <div className="grid grid-cols-1 gap-2">
        <div className="rounded-xl border border-border/70 bg-card/65 p-2 text-center sm:p-3">
          <p className="text-[9px] font-semibold uppercase text-muted-foreground">Items</p>
          <p className="text-base font-bold sm:text-lg">{displayData.reduce((sum, item) => sum + item.count, 0)}</p>
        </div>
      </div>
    </div>
  );
}
