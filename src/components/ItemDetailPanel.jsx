import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import { PortfolioChart } from "./PortfolioChart";
import { Area, AreaChart, ResponsiveContainer, XAxis, Tooltip } from "recharts";

const formatPrice = (value) => `${value.toFixed(2)} EUR`;

export const ItemDetailPanel = ({ item, history = [] }) => {
  if (!item)
    return (
      <div className="h-100 flex items-center justify-center border-2 border-dashed rounded-xl p-8 text-center text-muted-foreground">
        Waehle ein Item aus der Liste,
        <br />
        um Details zu sehen.
      </div>
    );

  return (
    <Card className="border-primary/20 shadow-lg">
      <CardHeader>
        <div className="flex items-start gap-4">
          <div className="h-24 w-24 overflow-hidden rounded-lg border bg-muted">
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt={item.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                N/A
              </div>
            )}
          </div>
          <div className="min-w-0">
            <CardTitle className="text-lg">{item.name}</CardTitle>
            <CardDescription className="text-[10px] font-bold uppercase tracking-widest">
              {item.type}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-muted/40 p-3 rounded-md border">
            <p className="text-[10px] text-muted-foreground uppercase">
              Einkauf
            </p>
            <p className="text-sm font-bold">{formatPrice(item.buyPrice)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {item.quantity}x {formatPrice(item.buyPrice)}
            </p>
          </div>
          <div className="bg-muted/40 p-3 rounded-md border">
            <p className="text-[10px] text-muted-foreground uppercase">
              Live (CSFloat)
            </p>
            <p
              className={`text-sm font-bold ${item.isLive ? "text-primary" : "text-muted-foreground"}`}
            >
              {item.livePrice !== null
                ? formatPrice(item.livePrice)
                : "Nicht verfuegbar"}
            </p>
            <p className="mt-1 text-[10px] uppercase text-muted-foreground">
              {item.pricingStatus === "live"
                ? "Livepreis aktiv"
                : "Fallback auf Einkaufspreis"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-muted/40 p-3 rounded-md border">
            <p className="text-[10px] text-muted-foreground uppercase">
              Positionswert
            </p>
            <p className="text-sm font-bold">{formatPrice(item.currentValue)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {item.quantity}x {formatPrice(item.displayPrice)}
            </p>
          </div>
          <div className="bg-muted/40 p-3 rounded-md border">
            <p className="text-[10px] text-muted-foreground uppercase">
              Gewinn / Verlust
            </p>
            <p
              className={`text-sm font-bold ${item.isProfitPositive ? "text-green-600" : "text-red-600"}`}
            >
              {item.isProfitPositive ? "+" : ""}
              {formatPrice(item.profitEuro)}
            </p>
            <p
              className={`mt-1 text-[10px] uppercase ${item.roi >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {item.roi >= 0 ? "+" : ""}
              {item.roi.toFixed(2)}%
            </p>
          </div>
        </div>

        <PortfolioChart
          history={history}
          color={item.isProfitPositive ? "#22c55e" : "#ef4444"}
          title="Positionsentwicklung"
          emptyLabel="Noch keine Positionshistorie verfuegbar"
          valueLabel="Positionswert"
        />

        {item.details?.stats6m && (
          <div className="pt-4 border-t text-center">
            <h4 className="text-xs font-bold uppercase mb-4 text-muted-foreground">
              Trends (6 Monate) (Work in Progress)
            </h4>
            <div className="h-45 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={item.details.stats6m}>
                  <XAxis dataKey="month" hide />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey={item.type === "case" ? "opened" : "applied"}
                    stroke="hsl(var(--chart-1))"
                    fill="hsl(var(--chart-1))"
                    fillOpacity={0.2}
                  />
                  {item.type === "case" && (
                    <Area
                      type="monotone"
                      dataKey="dropped"
                      stroke="hsl(var(--chart-2))"
                      fill="hsl(var(--chart-2))"
                      fillOpacity={0.2}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
