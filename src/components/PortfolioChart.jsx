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

export const PortfolioChart = ({ history, color }) => (
  <Card>
    <CardHeader>
      <CardTitle>Portfolio Entwicklung (wip)</CardTitle>
    </CardHeader>
    <CardContent className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={history}>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="hsl(var(--border))"
          />
          <XAxis dataKey="date" hide />
          <YAxis hide />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
            }}
            itemStyle={{ color: color }}
          />
          <Line
            type="monotone"
            dataKey="wert"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 4, fill: color }}
          />
        </LineChart>
      </ResponsiveContainer>
    </CardContent>
  </Card>
);
