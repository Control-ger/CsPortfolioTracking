import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

// Formatierungsfunktion für Datum
const formatDate = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
};

// Formatierungsfunktion für Tooltip
const formatTooltipValue = (value) => {
  return `${parseFloat(value).toFixed(2)}€`;
};

export const PortfolioChart = ({ history, color }) => {
  // Daten für Chart formatieren
  const chartData = (history || []).map((item) => ({
    ...item,
    dateFormatted: formatDate(item.date),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio Entwicklung</CardTitle>
      </CardHeader>
      <CardContent className="h-80 w-full">
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>Noch keine Historie-Daten verfügbar</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="dateFormatted"
                stroke="hsl(var(--muted-foreground))"
                style={{ fontSize: "12px" }}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                style={{ fontSize: "12px" }}
                tickFormatter={(value) => `${value.toFixed(0)}€`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
                formatter={(value) => [formatTooltipValue(value), "Wert"]}
                labelFormatter={(label) => `Datum: ${label}`}
              />
              <Line
                type="monotone"
                dataKey="wert"
                stroke={color}
                strokeWidth={2}
                dot={{ r: 4, fill: color }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
};
