import React, { useState, useMemo } from "react";
import data from "./data.json";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { StatCard } from "./components/StatsCards";
import { InventoryTable } from "./components/InventoryTable";
import { ItemDetailPanel } from "./components/ItemDetailPanel";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./components/ui/card";
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

// Importiere hier deine neuen Komponenten (oder definiere sie lokal)
// import { StatCard } from "./StatCard"; ...

export default function Dashboard() {
  const [selectedItem, setSelectedItem] = useState(null);

  // Berechnungen (Memoized für Performance)
  const stats = useMemo(() => {
    const totalValue = data.investments.reduce(
      (acc, i) => acc + i.currentPrice * i.quantity,
      0,
    );
    const totalQuantity = data.investments.reduce(
      (acc, i) => acc + i.quantity,
      0,
    );
    const history = data.***REMOVED***History;
    const startValue = history[0]?.wert || 0;
    const currentValue = history[history.length - 1]?.wert || 0;
    const isPositive = currentValue >= startValue;
    const percentageChange =
      startValue !== 0 ? ((currentValue - startValue) / startValue) * 100 : 0;

    return {
      totalValue,
      totalQuantity,
      isPositive,
      percentageChange,
      chartColor: isPositive ? "#22c55e" : "#ef4444",
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">CS Investor Hub</h1>
          <p className="text-muted-foreground">
            Portfolio-Management für Cases und Sticker.
          </p>
        </header>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full max-w-[400px] grid-cols-2">
            <TabsTrigger value="overview">Übersicht</TabsTrigger>
            <TabsTrigger value="inventory">Inventar & Details</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <StatCard
                title="Gesamtwert"
                value={`${stats.totalValue.toFixed(2)}€`}
                subValue={`${Math.abs(stats.percentageChange).toFixed(2)}%`}
                isPositive={stats.isPositive}
              />
              <StatCard title="Items im Bestand" value={stats.totalQuantity} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Portfolio Entwicklung</CardTitle>
              </CardHeader>
              <CardContent className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.***REMOVED***History}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="hsl(var(--border))"
                    />
                    <XAxis dataKey="date" hide />
                    <YAxis hide />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="wert"
                      stroke={stats.chartColor}
                      strokeWidth={2}
                      dot={{ r: 4, fill: stats.chartColor }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="inventory"
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Deine Investments</CardTitle>
              </CardHeader>
              <CardContent>
                <InventoryTable
                  investments={data.investments}
                  onSelectItem={setSelectedItem}
                />
              </CardContent>
            </Card>
            <ItemDetailPanel item={selectedItem} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
