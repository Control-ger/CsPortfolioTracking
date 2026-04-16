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
import { Badge } from "./ui/badge";
import { MetricPairBlock } from "./MetricPair";

const formatPrice = (value) => `${value.toFixed(2)} EUR`;

export const ItemDetailPanel = ({ item, history = [] }) => {
  if (!item)
    return (
      <div className="flex min-h-50 items-center justify-center rounded-xl border-2 border-dashed p-3 text-center text-muted-foreground sm:min-h-75 sm:p-8">
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
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-muted sm:h-24 sm:w-24">
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
            <div className="mt-2">
              <Badge variant="outline" className="text-[10px] uppercase">
                Funding: {item.fundingMode === "cash_in" ? "Cash-In" : "Wallet"}
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 sm:space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          <div className="rounded-md border bg-muted/40 p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Einkauf</p>
            <div className="mt-2 space-y-2">
              <MetricPairBlock
                title="Preis pro Unit"
                grossValue={formatPrice(item.buyPrice)}
                netValue={typeof item.costBasisUnit === "number" ? formatPrice(item.costBasisUnit) : "N/A"}
                netValueClassName="text-muted-foreground"
                className="border-0 bg-transparent p-0"
              />
              <p className="text-[10px] text-muted-foreground">
                {item.quantity}x {formatPrice(item.buyPrice)}
              </p>
            </div>
          </div>

          <div className="rounded-md border bg-muted/40 p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Live</p>
            <p
              className={`mt-2 text-xs sm:text-sm font-bold ${item.isLive ? "text-primary" : "text-muted-foreground"}`}
            >
              {item.livePrice !== null ? formatPrice(item.livePrice) : "Nicht verfuegbar"}
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

          <MetricPairBlock
            title="Break-even"
            grossValue={formatPrice(item.breakEvenPrice ?? item.buyPrice)}
            netValue={typeof item.breakEvenPriceNet === "number" ? formatPrice(item.breakEvenPriceNet) : "Nicht verfuegbar"}
            netValueClassName="text-muted-foreground"
            note={typeof item.breakEvenDeltaEuro === "number"
              ? `${item.breakEvenDeltaEuro >= 0 ? "+" : ""}${item.breakEvenDeltaEuro.toFixed(2)} EUR brutto Delta`
              : "inkl. Seller + Withdrawal Fees"}
          />

          <MetricPairBlock
            title="Positionswert"
            grossValue={formatPrice(item.currentValue)}
            netValue={typeof item.netPositionValue === "number" ? formatPrice(item.netPositionValue) : "Nicht verfuegbar"}
            netValueClassName="text-muted-foreground"
            note={`${item.quantity}x ${formatPrice(item.displayPrice)}`}
          />

          <MetricPairBlock
            title="Gewinn / Verlust"
            grossValue={`${item.isProfitPositive ? "+" : ""}${formatPrice(item.profitEuro)}`}
            grossValueClassName={item.isProfitPositive ? "text-green-600" : "text-red-600"}
            netValue={`${(item.netProfitEuro ?? 0) >= 0 ? "+" : ""}${typeof item.netProfitEuro === "number" ? formatPrice(item.netProfitEuro) : "N/A"}`}
            netValueClassName={(item.netProfitEuro ?? 0) >= 0 ? "text-green-600" : "text-red-600"}
            note={`${item.roi >= 0 ? "+" : ""}${item.roi.toFixed(2)}% Brutto | ${(item.netRoiPercent ?? 0) >= 0 ? "+" : ""}${typeof item.netRoiPercent === "number" ? item.netRoiPercent.toFixed(2) : "0.00"}% Netto`}
          />

          <div className="rounded-md border bg-muted/40 p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Freshness</p>
            <p className="mt-2 text-xs sm:text-sm font-bold">{item.freshnessLabel || "N/A"}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {item.lastPriceUpdateAt || "Unbekannt"}
            </p>
          </div>

          <div className="rounded-md border bg-muted/40 p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Cost Basis</p>
            <p className="mt-2 text-xs sm:text-sm font-bold">
              {typeof item.costBasisTotal === "number" ? formatPrice(item.costBasisTotal) : "N/A"}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              pro Unit: {typeof item.costBasisUnit === "number" ? formatPrice(item.costBasisUnit) : "N/A"}
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
