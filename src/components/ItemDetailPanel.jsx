import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import { Button } from "./ui/button";
import { PortfolioChart } from "./PortfolioChart";
import { PriceSourceBadge } from "./PriceSourceBadge";
import { ExcludeInvestmentDialog } from "./ExcludeInvestmentDialog";
import { toggleExcludeInvestment } from "../lib/apiClient";
import { Area, AreaChart, ResponsiveContainer, XAxis, Tooltip } from "recharts";
import { Badge } from "./ui/badge";
import { AlertCircle } from "lucide-react";

const formatPrice = (value) => `${value.toFixed(2)} EUR`;

export const ItemDetailPanel = ({ item, history = [], onExcludeChange }) => {
  const [excludeDialogOpen, setExcludeDialogOpen] = useState(false);
  const [isExcludeLoading, setIsExcludeLoading] = useState(false);
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

  const handleExcludeClick = () => {
    setExcludeDialogOpen(true);
  };

  const handleExcludeConfirm = async (newExcludeState) => {
    setIsExcludeLoading(true);
    try {
      await toggleExcludeInvestment(item.id, newExcludeState);
      setExcludeDialogOpen(false);
      if (onExcludeChange) {
        onExcludeChange(item.id, newExcludeState);
      }
    } catch (error) {
      console.error("Failed to toggle exclude:", error);
    } finally {
      setIsExcludeLoading(false);
    }
  };

  return (
    <>
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
              <CardTitle className="text-sm sm:text-lg truncate">
                {item.name}
                {item.excluded && (
                  <span className="ml-2 inline text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">
                    AUSGESCHLOSSEN
                  </span>
                )}
              </CardTitle>
              <CardDescription className="text-[10px] font-bold uppercase tracking-widest">
                {item.type}
              </CardDescription>
              <div className="mt-2 flex gap-2">
                <Badge variant="outline" className="text-[10px] uppercase">
                  Funding: {item.fundingMode === "cash_in" ? "Cash-In" : "Wallet"}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExcludeClick}
                  className="text-[10px] h-6"
                >
                  <AlertCircle className="mr-1 h-3 w-3" />
                  {item.excluded ? "Einschließen" : "Ausschließen"}
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 sm:space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          <div className="rounded-md border bg-muted/40 p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Einkauf</p>
            <p className="mt-2 text-xs sm:text-sm font-bold">{formatPrice(item.buyPrice)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{item.quantity}x {formatPrice(item.buyPrice)}</p>
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

          <div className="rounded-md border bg-muted/40 p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Break-even</p>
            <p className="mt-2 text-xs sm:text-sm font-bold">
              {formatPrice(item.breakEvenPriceNet ?? item.breakEvenPrice ?? item.buyPrice)}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">inkl. Seller + Withdrawal + FX Fees</p>
          </div>

          <div className="rounded-md border bg-muted/40 p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Positionswert</p>
            <p className="mt-2 text-xs sm:text-sm font-bold">{formatPrice(item.currentValue)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{item.quantity}x {formatPrice(item.displayPrice)}</p>
          </div>

          <div className="rounded-md border bg-muted/40 p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Gewinn / Verlust</p>
            <p className={`mt-2 text-xs sm:text-sm font-bold ${item.isProfitPositive ? "text-green-600" : "text-red-600"}`}>
              {`${item.isProfitPositive ? "+" : ""}${formatPrice(item.profitEuro)}`}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {`${item.roi >= 0 ? "+" : ""}${item.roi.toFixed(2)}%`}
            </p>
          </div>

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

    <ExcludeInvestmentDialog
      isOpen={excludeDialogOpen}
      onOpenChange={setExcludeDialogOpen}
      investment={item}
      onConfirm={handleExcludeConfirm}
      isLoading={isExcludeLoading}
    />
    </>
  );
};
