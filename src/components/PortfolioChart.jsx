"use client"

import { useEffect, useState } from "react"
import { TrendingUp } from "lucide-react"
import { CartesianGrid, Dot, Line, LineChart, XAxis, YAxis } from "recharts"

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "./ui/chart"

const formatDate = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
};

const chartConfig = {
  wert: {
    label: "Portfolio Wert",
  },
};

export const PortfolioChart = ({
  history,
  title = "Portfolio Entwicklung",
  emptyLabel = "Noch keine Historie-Daten verfuegbar",
  valueLabel = "Wert",
}) => {
  const [isSmallScreen, setIsSmallScreen] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsSmallScreen(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Determine if it's profit or loss
  const isProfit = history && history.length > 1 
    ? history[history.length - 1].wert >= history[0].wert
    : true;

  const chartData = (history || []).map((item) => ({
    ...item,
    dateFormatted: formatDate(item.date),
    fill: isProfit ? "#22c55e" : "#ef4444",
  }));

  const lineColor = isProfit ? "#22c55e" : "#ef4444";

  const trendingText = isProfit ? "Trending up" : "Trending down";

  return (
    <Card>
      <CardHeader className="pb-2 sm:pb-4">
        <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex h-60 items-center justify-center text-muted-foreground sm:h-80">
            <p className="text-sm">{emptyLabel}</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig}>
            <LineChart
              accessibilityLayer
              data={chartData}
              margin={{
                top: 12,
                left: 12,
                right: 12,
                bottom: 12,
              }}
              height={isSmallScreen ? 250 : 320}
            >
              <CartesianGrid vertical={false} />
              <XAxis 
                dataKey="dateFormatted"
                stroke="currentColor"
                className="text-muted-foreground text-[10px] sm:text-xs"
                tick={{ fontSize: 10 }}
              />
              <YAxis 
                stroke="currentColor"
                className="text-muted-foreground text-[10px] sm:text-xs"
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => `€${value}`}
                width={40}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="line"
                    nameKey="wert"
                    hideLabel
                    formatter={(value) => `€${parseFloat(value).toFixed(2)}`}
                  />
                }
              />
              <Line
                dataKey="wert"
                type="natural"
                stroke={lineColor}
                strokeWidth={2}
                dot={({ payload, ...props }) => {
                  return (
                    <Dot
                      key={payload.dateFormatted}
                      r={5}
                      cx={props.cx}
                      cy={props.cy}
                      fill={payload.fill}
                      stroke={payload.fill}
                    />
                  );
                }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 text-xs sm:text-sm">
        <div className="flex gap-2 leading-none font-medium">
          {trendingText} {isProfit ? <TrendingUp className="h-4 w-4" /> : <TrendingUp className="h-4 w-4 rotate-180" />}
        </div>
        <div className="leading-none text-muted-foreground">
          {valueLabel}
        </div>
      </CardFooter>
    </Card>
  );
};
