import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { BREAKPOINTS } from '@/lib/constants';

// Neue schöne Farbpalette
const COLOR_PALETTE = [
  '#003f5c',
  '#2e4b7f',
  '#655197',
  '#9f509d',
  '#d44e90',
  '#fa5972',
  '#ff7a49',
  '#ffa600',
];

export function PortfolioCompositionChart({ data, isLoading = false }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [isSmallScreen, setIsSmallScreen] = useState(window.innerWidth < BREAKPOINTS.MOBILE);

  useEffect(() => {
    const handleResize = () => {
      setIsSmallScreen(window.innerWidth < BREAKPOINTS.MOBILE);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 border rounded-lg p-6 space-y-4">
        {/* Donut Skeleton */}
        <div className="relative w-48 h-48">
          <Skeleton className="w-full h-full rounded-full" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Skeleton className="w-24 h-24 rounded-full bg-background" />
          </div>
        </div>
        {/* Legend Skeleton */}
        <div className="w-full space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="w-3 h-3 rounded-full" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-12 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 border rounded-lg ">
        <p className="text-muted-foreground">Keine Daten verfügbar</p>
      </div>
    );
  }

  // Assign colors from palette, cycling through if needed
  const displayData = data.map((item, idx) => ({
    ...item,
    displayColor: COLOR_PALETTE[idx % COLOR_PALETTE.length],
  }));

  const totalValue = displayData.reduce((sum, item) => sum + item.value, 0);

  // Custom label renderer for donut center
  const renderCustomLabel = () => {
    return null; // We'll use custom center text instead
  };

  // Custom tooltip
  const renderTooltip = ({ payload }) => {
    if (payload && payload[0]) {
      const { name, count, value, percentage } = payload[0].payload;
      return (
        <div className="bg-background border border-border rounded shadow-lg p-3 text-xs">
          <p className="font-semibold">{name}</p>
          <p className="text-muted-foreground">{count}x verfügbar</p>
          <p className="font-semibold text-primary">€{value.toFixed(2)}</p>
          <p className="text-muted-foreground">{percentage}% des Portfolios</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Donut Chart with Legend Column */}
      <div className="grid grid-cols-1 items-start gap-4 sm:gap-6 lg:grid-cols-3 lg:items-stretch">
        {/* Chart - Left Side (takes 2 columns on large screens) */}
        <div className="flex justify-center lg:col-span-2 lg:items-center">
          <div className="relative h-[220px] w-full max-w-sm sm:h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={displayData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={renderCustomLabel}
                  outerRadius={isSmallScreen ? 70 : 100}
                  innerRadius={isSmallScreen ? 45 : 60}
                  fill="#8884d8"
                  dataKey="value"
                  onMouseEnter={(_, index) => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  {displayData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.displayColor}
                      stroke="none"
                      opacity={hoveredIndex === null || hoveredIndex === index ? 1 : 0.3}
                      style={{ transition: 'opacity 200ms ease-in-out', cursor: 'pointer' }}
                    />
                  ))}
                </Pie>
                <Tooltip content={renderTooltip} />
              </PieChart>
            </ResponsiveContainer>

            {/* Center Text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-center">
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase">Portfolio Wert</p>
                <p className="text-xl sm:text-2xl font-bold">€{totalValue.toFixed(0)}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground">{displayData.length} Assets</p>
              </div>
            </div>
          </div>
        </div>

        {/* Legend - Right Side */}
        <div className="flex flex-col lg:col-span-1 lg:justify-center">
          <div className="max-h-52 space-y-2 overflow-y-auto pr-1 sm:max-h-64 lg:max-h-[320px]">
            {displayData.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 p-2 rounded border hover:bg-muted/50 transition-colors cursor-pointer text-xs sm:text-sm"
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: item.displayColor }}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.percentage}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Stats - Only Items */}
      <div className="grid grid-cols-1 gap-2">
        <div className=" p-2 sm:p-3 rounded-lg text-center border">
          <p className="text-[9px] text-muted-foreground uppercase font-semibold">Items</p>
          <p className="text-base sm:text-lg font-bold">
            {displayData.reduce((sum, item) => sum + item.count, 0)}
          </p>
        </div>
      </div>
    </div>
  );
}
