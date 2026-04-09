import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

// Neue schöne Farbpalette
const COLOR_PALETTE = [
  '#003f5c',
  '#58508d',
  '#bc5090',
  '#ff6361',
  '#ffa600',
];

const RADIAN = Math.PI / 180;

export function PortfolioCompositionChart({ data }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [isSmallScreen, setIsSmallScreen] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsSmallScreen(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 border rounded-lg bg-muted/20">
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
  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius }) => {
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Chart - Left Side (takes 2 columns on large screens) */}
        <div className="lg:col-span-2 flex justify-center">
          <div className="relative w-full max-w-sm">
            <ResponsiveContainer width="100%" height={isSmallScreen ? 220 : 320}>
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
        <div className="lg:col-span-1 flex flex-col justify-center">
          <div className="space-y-2 max-h-80 overflow-y-auto sm:max-h-none">
            {displayData.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 p-2 rounded border bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer text-xs sm:text-sm"
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
        <div className="bg-muted/40 p-2 sm:p-3 rounded-lg text-center border">
          <p className="text-[9px] text-muted-foreground uppercase font-semibold">Items</p>
          <p className="text-base sm:text-lg font-bold">
            {displayData.reduce((sum, item) => sum + item.count, 0)}
          </p>
        </div>
      </div>
    </div>
  );
}
