import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import { Button } from "./ui/button";
import { ExcludeInvestmentDialog } from "./ExcludeInvestmentDialog";
import { toggleExcludeInvestment } from "../lib/apiClient";
import { Area, AreaChart, ResponsiveContainer, XAxis, Tooltip } from "recharts";
import { Badge } from "./ui/badge";
import { AlertCircle } from "lucide-react";
import { PortfolioChart } from "./PortfolioChart";
import { useCurrency } from "@shared/contexts/CurrencyContext";

export const ItemDetailPanel = ({
  item,
  history,
  historyLoading,
  onExcludeChange,
  onBucketChange,
  canToggleExclude = true,
}) => {
  const { formatPrice } = useCurrency();
  const [excludeDialogOpen, setExcludeDialogOpen] = useState(false);
  const [isExcludeLoading, setIsExcludeLoading] = useState(false);
  const [showAbsolute, setShowAbsolute] = useState(false);
  const excludeEnabled = canToggleExclude && typeof onExcludeChange === "function";
  const bucketToggleEnabled = canToggleExclude && typeof onBucketChange === "function";

  if (!item)
    return (
        <div className="flex min-h-50 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/60 p-3 text-center text-muted-foreground sm:min-h-75 sm:p-8">
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

  const togglePriceDisplay = () => {
    setShowAbsolute(!showAbsolute);
  };

  const handleExcludeConfirm = async (newExcludeState) => {
    setIsExcludeLoading(true);
    try {
      await toggleExcludeInvestment(item.id, newExcludeState, item.sourceInvestmentIds || []);
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

  const handleBucketToggle = async () => {
    if (!bucketToggleEnabled) {
      return;
    }
    const currentBucket = String(item?.bucket || "investment").toLowerCase() === "inventory"
      ? "inventory"
      : "investment";
    const nextBucket = currentBucket === "investment" ? "inventory" : "investment";
    await onBucketChange(item, nextBucket);
  };

  const stats6m = item.details?.stats6m;
  const roiValue = Number.isFinite(Number(item.roi)) ? Number(item.roi) : null;
  const formatUsdPrice = (value) =>
    formatPrice(value, {
      useUsd: true,
      buyPriceUsd: value,
    });

  return (
      <>
        <Card className="border-border/70">
          <CardHeader className="pb-2 sm:pb-4">
            <div className="flex items-start gap-2 sm:gap-4">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border/75 bg-muted/25 p-1 sm:h-24 sm:w-24">
                {item.imageUrl ? (
                    <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="h-full w-full object-contain"
                        loading="lazy"
                        decoding="async"
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
                      <span className="ml-2 inline rounded border border-amber-300/70 bg-amber-100/80 px-2 py-1 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-200">
                    AUSGESCHLOSSEN
                  </span>
                  )}
                </CardTitle>
                <CardDescription className="text-[10px] font-bold uppercase tracking-widest">
                  {item.type}
                </CardDescription>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    Bucket: {String(item?.bucket || "investment").toLowerCase() === "inventory" ? "Inventar" : "Investment"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    Funding: {item.fundingMode === "cash_in" ? "Cash-In" : "Wallet"}
                  </Badge>
                  {excludeEnabled ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExcludeClick}
                      className={`h-8 rounded-lg border px-2.5 text-[10px] font-semibold uppercase tracking-wide shadow-sm transition-all hover:-translate-y-0.5 hover:shadow ${
                          item.excluded
                              ? "border-sky-400/35 bg-sky-500/12 text-sky-300 hover:bg-sky-500/18"
                              : "border-amber-400/35 bg-amber-500/12 text-amber-300 hover:bg-amber-500/18"
                      }`}
                  >
                    <AlertCircle className="mr-1 h-3 w-3" />
                    {item.excluded ? "Einschliessen" : "Ausschliessen"}
                    </Button>
                  ) : null}
                  {bucketToggleEnabled ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleBucketToggle()}
                      className="h-8 rounded-lg border border-border/75 bg-card/75 px-2.5 text-[10px] font-semibold uppercase tracking-wide shadow-sm transition-all hover:-translate-y-0.5 hover:bg-accent/70 hover:shadow"
                    >
                      {String(item?.bucket || "investment").toLowerCase() === "inventory"
                        ? "Zu Investments"
                        : "Zum Inventar"}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 sm:space-y-6">
            <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Einkauf</p>
                <p className="mt-2 text-xs sm:text-sm font-bold">{formatUsdPrice(item.buyPriceUsd ?? item.buyPrice)}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{item.quantity}x {formatUsdPrice(item.buyPriceUsd ?? item.buyPrice)}</p>
              </div>

              <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Live</p>
                <p
                    className={`mt-2 text-xs sm:text-sm font-bold ${item.isLive ? "text-primary" : "text-muted-foreground"}`}
                >
                  {item.livePrice !== null ? formatPrice(item.livePrice) : "Kein Preis verfuegbar"}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1 sm:gap-2">
                  <p className="text-[10px] text-muted-foreground">
                    {item.lastPriceUpdateAt || item.freshnessLabel || "Unbekannt"}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Break-even</p>
                <p className="mt-2 text-xs sm:text-sm font-bold">
                  {formatPrice(item.breakEvenPriceNet ?? item.breakEvenPrice ?? item.buyPrice)}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">inkl. Seller + Withdrawal + FX Fees</p>
              </div>

              <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Positionswert</p>
                <p className="mt-2 text-xs sm:text-sm font-bold">
                  {item.isLive ? formatPrice(item.currentValue) : "N/A"}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {item.isLive ? `${item.quantity}x ${formatPrice(item.displayPrice)}` : "Kein csfloat-Preis vorhanden"}
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Gewinn / Verlust</p>
                <p
                  className={`mt-2 text-xs sm:text-sm font-bold ${
                    item.isProfitPositive === null
                      ? "text-muted-foreground"
                      : item.isProfitPositive
                        ? "text-emerald-400"
                        : "text-red-400"
                  }`}
                >
                  {item.isLive
                    ? `${item.isProfitPositive ? "+" : ""}${formatPrice(item.profitEuro)}`
                    : "N/A"}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {roiValue === null
                    ? "N/A"
                    : `${roiValue >= 0 ? "+" : ""}${roiValue.toFixed(2)}%`}
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Freshness</p>
                <p className="mt-2 text-xs sm:text-sm font-bold">{item.freshnessLabel || "N/A"}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {item.lastPriceUpdateAt || "Unbekannt"}
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Cost Basis</p>
                <p className="mt-2 text-xs sm:text-sm font-bold">
                  {typeof item.costBasisTotal === "number" ? formatPrice(item.costBasisTotal) : "N/A"}
                </p>
                {stats6m?.length > 0 ? (
                    <h4 className="mt-3 text-xs font-semibold text-muted-foreground">
                      Trends (6 Monate)
                    </h4>
                ) : null}
                {stats6m?.length > 0 ? (
                    <div className="h-45 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={stats6m}>
                          <XAxis dataKey="month" hide />
                          <Tooltip />
                          <Area
                              type="linear"
                              dataKey={item.type === "case" ? "opened" : "applied"}
                              stroke="hsl(var(--chart-1))"
                              strokeLinecap="square"
                              strokeLinejoin="miter"
                              fill="hsl(var(--chart-1))"
                              fillOpacity={0.2}
                          />
                          {item.type === "case" && (
                              <Area
                                  type="linear"
                                  dataKey="dropped"
                                  stroke="hsl(var(--chart-2))"
                                  strokeLinecap="square"
                                  strokeLinejoin="miter"
                                  fill="hsl(var(--chart-2))"
                                  fillOpacity={0.2}
                              />
                          )}
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                ) : null}
              </div>
            </div>

            {/* Price History Chart */}
            {Array.isArray(history) && history.length > 0 && (
              <div className="rounded-2xl border border-border/70 bg-card/65 p-3 sm:p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">Preisentwicklung</h3>
                  <button
                    onClick={togglePriceDisplay}
                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showAbsolute ? (
                      <>
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">EUR</span>
                        <span className="text-muted-foreground/50">%</span>
                      </>
                    ) : (
                      <>
                        <span className="text-muted-foreground/50">EUR</span>
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">%</span>
                      </>
                    )}
                  </button>
                </div>
                <PortfolioChart
                  history={history}
                  title=""
                  valueLabel="Preis"
                  emptyLabel="Noch keine Preishistorie verfügbar"
                  isLoading={historyLoading}
                  showAbsolute={showAbsolute}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {excludeEnabled ? (
          <ExcludeInvestmentDialog
            isOpen={excludeDialogOpen}
            onOpenChange={setExcludeDialogOpen}
            investment={item}
            onConfirm={handleExcludeConfirm}
            isLoading={isExcludeLoading}
          />
        ) : null}
      </>
  );
};

