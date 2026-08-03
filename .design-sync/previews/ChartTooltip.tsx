import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from "@packages/shared";
import { AreaChart, Area, CartesianGrid, XAxis, YAxis } from "recharts";

const data = [
  { d: "09.07.", wert: 11840, einstand: 11200 },
  { d: "14.07.", wert: 12010, einstand: 11200 },
  { d: "19.07.", wert: 11730, einstand: 11200 },
  { d: "24.07.", wert: 12290, einstand: 11200 },
  { d: "29.07.", wert: 12480, einstand: 11200 },
];

const config = {
  wert: { label: "Portfolio-Wert", color: "var(--chart-1)" },
  einstand: { label: "Einstand", color: "var(--chart-2)" },
};

// ChartTooltip only renders inside a ChartContainer — the card shows that composition.
export const InContext = () => (
  <ChartContainer config={config} className="h-[220px] w-[500px]">
    <AreaChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="d" tickLine={false} axisLine={false} tickMargin={8} />
      <YAxis width={56} tickLine={false} axisLine={false} />
      <ChartTooltip content={<ChartTooltipContent />} />
      <ChartLegend content={<ChartLegendContent />} />
      <Area dataKey="einstand" type="monotone" isAnimationActive={false} fill="var(--color-einstand)" stroke="var(--color-einstand)" fillOpacity={0.12} />
      <Area dataKey="wert" type="monotone" isAnimationActive={false} fill="var(--color-wert)" stroke="var(--color-wert)" fillOpacity={0.2} />
    </AreaChart>
  </ChartContainer>
);
