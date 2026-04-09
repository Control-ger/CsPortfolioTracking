import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import { PortfolioChart } from "./PortfolioChart";
import { PriceSourceBadge } from "./PriceSourceBadge";
import { Area, AreaChart, ResponsiveContainer, XAxis, Tooltip } from "recharts";

const formatPrice = (value) => `${value.toFixed(2)} EUR`;

export const ItemDetailPanel = ({ item, history = [] }) => {
  if (!item)
    return (
      <div className="flex items-center justify-center border-2 border-dashed rounded-xl p-3 sm:p-8 text-center text-muted-foreground min-h-[200px] sm:min-h-[300px]">
        <div className="text-xs sm:text-sm">
          Waehle ein Item aus der Liste,
          <br />
          um Details zu sehen.
        </div>
      </div>
    );

  return (
    <Card className="border-primary/20 shadow-lg">
      <CardHeader className="pb-2 sm:pb-4">
        <div className="flex items-start gap-2 sm:gap-4">
          <div className="h-16 w-16 sm:h-24 sm:w-24 overflow-hidden rounded-lg border bg-muted flex-shrink-0">
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
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm sm:text-lg truncate">{item.name}</CardTitle>
            <CardDescription className="text-[10px] font-bold uppercase tracking-widest">
              {item.type}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 sm:space-y-6">
        <div className="grid grid-cols-2 gap-2 sm:gap-4">
          <div className="bg-muted/40 p-2 sm:p-3 rounded-md border">
            <p className="text-[10px] text-muted-foreground uppercase">
              Einkauf
            </p>
            <p className="text-xs sm:text-sm font-bold">{formatPrice(item.buyPrice)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {item.quantity}x {formatPrice(item.buyPrice)}
            </p>
          </div>
          <div className="bg-muted/40 p-2 sm:p-3 rounded-md border">
            <p className="text-[10px] text-muted-foreground uppercase">
              Live
            </p>
            <p
              className={`text-xs sm:text-sm font-bold ${item.isLive ? "text-primary" : "text-muted-foreground"}`}
            >
              {item.livePrice !== null
                ? formatPrice(item.livePrice)
                : "Nicht verfuegbar"}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1 sm:gap-2">
              <PriceSourceBadge priceSource={item.priceSource} compact={true} />
              <p className="text-[10px] uppercase text-muted-foreground">
                {item.pricingStatus === "csfloat"
                  ? "CSFloat"
                  : item.pricingStatus === "steam"
                    ? "Steam"
                    : "Einkauf"}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:gap-4">
          <div className="bg-muted/40 p-2 sm:p-3 rounded-md border">
            <p className="text-[10px] text-muted-foreground uppercase">
              Break-even
            </p>
            <p className="text-xs sm:text-sm font-bold">{formatPrice(item.breakEvenPrice ?? item.buyPrice)}</p>
            {typeof item.breakEvenDeltaEuro === 'number' && (
              <p className={`mt-1 text-[10px] ${item.breakEvenDeltaEuro >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {item.breakEvenDeltaEuro >= 0 ? '+' : ''}{item.breakEvenDeltaEuro.toFixed(2)} EUR
              </p>
            )}
          </div>
          <div className="bg-muted/40 p-2 sm:p-3 rounded-md border">
            <p className="text-[10px] text-muted-foreground uppercase">
              Freshness
            </p>
            <p className="text-xs sm:text-sm font-bold">{item.freshnessLabel || "N/A"}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {item.lastPriceUpdateAt || "Unbekannt"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <div className="bg-muted/40 p-2 sm:p-3 rounded-md border">
            <p className="text-[10px] text-muted-foreground uppercase">
              24h
            </p>
            <p className={`text-xs sm:text-sm font-bold ${typeof item.change24hPercent === 'number' && item.change24hPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {typeof item.change24hPercent === 'number' ? `${item.change24hPercent >= 0 ? '+' : ''}${item.change24hPercent.toFixed(2)}%` : 'N/A'}
            </p>
            {typeof item.change24hEuro === 'number' && (
              <p className={`mt-1 text-[10px] ${item.change24hEuro >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {item.change24hEuro >= 0 ? '+' : ''}{item.change24hEuro.toFixed(2)}€
              </p>
            )}
          </div>
          <div className="bg-muted/40 p-2 sm:p-3 rounded-md border">
            <p className="text-[10px] text-muted-foreground uppercase">
              7d
            </p>
            <p className={`text-xs sm:text-sm font-bold ${typeof item.change7dPercent === 'number' && item.change7dPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {typeof item.change7dPercent === 'number' ? `${item.change7dPercent >= 0 ? '+' : ''}${item.change7dPercent.toFixed(2)}%` : 'N/A'}
            </p>
            {typeof item.change7dEuro === 'number' && (
              <p className={`mt-1 text-[10px] ${item.change7dEuro >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {item.change7dEuro >= 0 ? '+' : ''}{item.change7dEuro.toFixed(2)}€
              </p>
            )}
          </div>
          <div className="bg-muted/40 p-2 sm:p-3 rounded-md border">
            <p className="text-[10px] text-muted-foreground uppercase">
              30d
            </p>
            <p className={`text-xs sm:text-sm font-bold ${typeof item.change30dPercent === 'number' && item.change30dPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {typeof item.change30dPercent === 'number' ? `${item.change30dPercent >= 0 ? '+' : ''}${item.change30dPercent.toFixed(2)}%` : 'N/A'}
            </p>
            {typeof item.change30dEuro === 'number' && (
              <p className={`mt-1 text-[10px] ${item.change30dEuro >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {item.change30dEuro >= 0 ? '+' : ''}{item.change30dEuro.toFixed(2)}€
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:gap-4">
          <div className="bg-muted/40 p-2 sm:p-3 rounded-md border">
            <p className="text-[10px] text-muted-foreground uppercase">
              Positionswert
            </p>
            <p className="text-xs sm:text-sm font-bold">{formatPrice(item.currentValue)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {item.quantity}x {formatPrice(item.displayPrice)}
            </p>
          </div>
          <div className="bg-muted/40 p-2 sm:p-3 rounded-md border">
            <p className="text-[10px] text-muted-foreground uppercase">
              Gewinn / Verlust
            </p>
            <p
              className={`text-xs sm:text-sm font-bold ${item.isProfitPositive ? "text-green-600" : "text-red-600"}`}
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
