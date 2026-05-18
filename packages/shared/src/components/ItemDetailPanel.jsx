import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import { Button } from "./ui/button";
import { PriceSourceBadge } from "./PriceSourceBadge";
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
  onOverpayChange,
  canToggleExclude = true,
}) => {
  const { formatPrice } = useCurrency();
  const [excludeDialogOpen, setExcludeDialogOpen] = useState(false);
  const [isExcludeLoading, setIsExcludeLoading] = useState(false);
  const [isOverpayLoading, setIsOverpayLoading] = useState(false);
  const [showAbsolute, setShowAbsolute] = useState(false);
  const [overpayEnabledDraft, setOverpayEnabledDraft] = useState(false);
  const [overpayFloorDraft, setOverpayFloorDraft] = useState("");
  const [overpayNoteDraft, setOverpayNoteDraft] = useState("");
  const excludeEnabled = canToggleExclude && typeof onExcludeChange === "function";
  const bucketToggleEnabled = canToggleExclude && typeof onBucketChange === "function";
  const overpayToggleEnabled = canToggleExclude && typeof onOverpayChange === "function";

  useEffect(() => {
    const enabled = Boolean(item?.overpayEnabled ?? item?.isOverpayCandidate);
    const floorValue = Number(item?.overpayFloorEur);
    setOverpayEnabledDraft(enabled);
    setOverpayFloorDraft(
      Number.isFinite(floorValue) && floorValue > 0 ? floorValue.toFixed(2) : "",
    );
    setOverpayNoteDraft(String(item?.overpayNote || ""));
  }, [item?.id, item?.overpayEnabled, item?.isOverpayCandidate, item?.overpayFloorEur, item?.overpayNote]);

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

  const handleOverpaySave = async () => {
    if (!overpayToggleEnabled) {
      return;
    }

    const parsedFloor = Number(overpayFloorDraft);
    const normalizedFloor =
      Number.isFinite(parsedFloor) && parsedFloor > 0
        ? Number(parsedFloor.toFixed(2))
        : null;
    const payload = {
      overpayEnabled: Boolean(overpayEnabledDraft),
      overpayFloorEur: normalizedFloor,
      overpayNote: String(overpayNoteDraft || "").trim() || null,
    };

    setIsOverpayLoading(true);
    try {
      await onOverpayChange(item, payload);
    } catch (error) {
      console.error("Failed to update overpay profile:", error);
    } finally {
      setIsOverpayLoading(false);
    }
  };

  const stats6m = item.details?.stats6m;
  const roiValue = Number.isFinite(Number(item.roi)) ? Number(item.roi) : null;
  const floatValue = Number(item.floatValue);
  const hasFloatValue = Number.isFinite(floatValue) && floatValue >= 0 && floatValue <= 1;
  const paintSeed = Number(item.paintSeed);
  const hasPaintSeed = Number.isFinite(paintSeed) && paintSeed >= 0;
  const priceScope = String(item.priceScope || "item").toLowerCase();
  const strategyLabelMap = {
    seed_exact: "Pattern-Match",
    float_band_00025: "Float-Band +/-0.0025",
    float_band_00050: "Float-Band +/-0.0050",
    float_band_00100: "Float-Band +/-0.0100",
    float_band_00200: "Float-Band +/-0.0200",
    market_lowest: "Market Lowest",
  };
  const strategyLabel = strategyLabelMap[String(item.priceStrategy || "").toLowerCase()] || null;
  const confidenceLabelMap = {
    high: "hoch",
    medium: "mittel",
    low: "niedrig",
  };
  const confidenceLabel = confidenceLabelMap[String(item.priceConfidence || "").toLowerCase()] || null;
  const formatUsdPrice = (value) =>
    formatPrice(value, {
      useUsd: true,
      buyPriceUsd: value,
    });

  return (
      <>
        <Card className="border-primary/20 shadow-lg">
          <CardHeader className="pb-2 sm:pb-4">
            <div className="flex items-start gap-2 sm:gap-4">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-muted/30 p-1 sm:h-24 sm:w-24">
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
                <div className="mt-2 flex gap-2">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    Bucket: {String(item?.bucket || "investment").toLowerCase() === "inventory" ? "Inventar" : "Investment"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    Funding: {item.fundingMode === "cash_in" ? "Cash-In" : "Wallet"}
                  </Badge>
                  {(item?.overpayEnabled ?? item?.isOverpayCandidate) ? (
                    <Badge variant="outline" className="text-[10px] uppercase border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                      Overpay
                    </Badge>
                  ) : null}
                  {excludeEnabled ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExcludeClick}
                      className={`h-7 rounded-md border px-2.5 text-[10px] font-semibold uppercase tracking-wide shadow-sm transition-all hover:-translate-y-0.5 hover:shadow ${
                          item.excluded
                              ? "border-blue-500/50 bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300"
                              : "border-amber-500/50 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 dark:text-amber-300"
                      }`}
                  >
                    <AlertCircle className="mr-1 h-3 w-3" />
                    {item.excluded ? "Einschließen" : "Ausschließen"}
                    </Button>
                  ) : null}
                  {bucketToggleEnabled ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleBucketToggle()}
                      className="h-7 rounded-md border px-2.5 text-[10px] font-semibold uppercase tracking-wide shadow-sm transition-all hover:-translate-y-0.5 hover:shadow"
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
              <div className="rounded-md border p-2 sm:p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Einkauf</p>
                <p className="mt-2 text-xs sm:text-sm font-bold">{formatUsdPrice(item.buyPriceUsd ?? item.buyPrice)}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{item.quantity}x {formatUsdPrice(item.buyPriceUsd ?? item.buyPrice)}</p>
              </div>

              <div className="rounded-md border p-2 sm:p-3">
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
                {priceScope === "instance" ? (
                  <p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                    Instanzbewertung{strategyLabel ? `: ${strategyLabel}` : ""}
                    {confidenceLabel ? ` (${confidenceLabel})` : ""}
                  </p>
                ) : null}
                {item.overpayApplied && Number.isFinite(Number(item.baseLivePrice)) ? (
                  <p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                    Overpay aktiv: Basis {formatPrice(item.baseLivePrice)} → Anzeige {formatPrice(item.livePrice)}
                  </p>
                ) : null}
              </div>

              <div className="rounded-md border p-2 sm:p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Break-even</p>
                <p className="mt-2 text-xs sm:text-sm font-bold">
                  {formatPrice(item.breakEvenPriceNet ?? item.breakEvenPrice ?? item.buyPrice)}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">inkl. Seller + Withdrawal + FX Fees</p>
              </div>

              <div className="rounded-md border p-2 sm:p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Positionswert</p>
                <p className="mt-2 text-xs sm:text-sm font-bold">{formatPrice(item.currentValue)}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{item.quantity}x {formatPrice(item.displayPrice)}</p>
              </div>

              <div className="rounded-md border p-2 sm:p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Gewinn / Verlust</p>
                <p className={`mt-2 text-xs sm:text-sm font-bold ${item.isProfitPositive ? "text-green-600" : "text-red-600"}`}>
                  {`${item.isProfitPositive ? "+" : ""}${formatPrice(item.profitEuro)}`}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {roiValue === null
                    ? "N/A"
                    : `${roiValue >= 0 ? "+" : ""}${roiValue.toFixed(2)}%`}
                </p>
              </div>

              <div className="rounded-md border p-2 sm:p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Freshness</p>
                <p className="mt-2 text-xs sm:text-sm font-bold">{item.freshnessLabel || "N/A"}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {item.lastPriceUpdateAt || "Unbekannt"}
                </p>
              </div>

              {(hasFloatValue || hasPaintSeed || item.inspectLink) ? (
                <div className="rounded-md border p-2 sm:p-3">
                  <p className="text-[10px] uppercase text-muted-foreground">Instanzdaten</p>
                  <p className="mt-2 text-xs sm:text-sm font-bold">
                    {hasFloatValue ? `Float: ${floatValue.toFixed(6)}` : "Float: -"}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {hasPaintSeed ? `Pattern Seed: ${paintSeed}` : "Pattern Seed: -"}
                  </p>
                  {item.inspectLink ? (
                    <a
                      href={item.inspectLink}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex text-[10px] uppercase tracking-wide text-primary underline-offset-2 hover:underline"
                    >
                      Inspect Link
                    </a>
                  ) : null}
                </div>
              ) : null}

              {overpayToggleEnabled || (item?.overpayEnabled ?? item?.isOverpayCandidate) ? (
                <div className="rounded-md border p-2 sm:p-3">
                  <p className="text-[10px] uppercase text-muted-foreground">Float Overpay</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={overpayEnabledDraft}
                        onChange={(event) => setOverpayEnabledDraft(event.target.checked)}
                      />
                      Overpay-Kandidat aktiv
                    </label>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={overpayFloorDraft}
                      onChange={(event) => setOverpayFloorDraft(event.target.value)}
                      placeholder="Floor EUR (optional)"
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    />
                    <input
                      type="text"
                      value={overpayNoteDraft}
                      onChange={(event) => setOverpayNoteDraft(event.target.value)}
                      placeholder="Notiz (z. B. Tradeup-freundlicher Float)"
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    />
                    {overpayToggleEnabled ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isOverpayLoading}
                        onClick={() => void handleOverpaySave()}
                        className="h-8 text-[11px] uppercase"
                      >
                        {isOverpayLoading ? "Speichert..." : "Overpay speichern"}
                      </Button>
                    ) : null}
                  </div>
                  {Number.isFinite(Number(item?.overpayFloorEur)) ? (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Aktueller Floor: {formatPrice(Number(item.overpayFloorEur))}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-md border p-2 sm:p-3">
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
                ) : null}
              </div>
            </div>

            {/* Price History Chart */}
            {Array.isArray(history) && history.length > 0 && (
              <div className="rounded-lg border p-3 sm:p-4">
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
