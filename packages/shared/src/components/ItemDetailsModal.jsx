import { useEffect, useState } from "react";
import { BaseModal } from "@shared/components/BaseModal";
import { PriceSourceBadge } from "@shared/components/PriceSourceBadge";
import { PortfolioChart } from "@shared/components/PortfolioChart";
import { Badge } from "@shared/components/ui/badge";
import { useCurrency } from "@shared/contexts/CurrencyContext";

const formatSignedPrice = (value) =>
  typeof value === "number" && !Number.isNaN(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(2)} EUR`
    : "-";

const formatSignedPercent = (value) =>
  typeof value === "number" && !Number.isNaN(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
    : "-";

function deltaClassName(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "text-muted-foreground";
  }

  return value >= 0 ? "text-green-600" : "text-red-600";
}

function freshnessBadgeClass(status) {
  switch (status) {
    case "fresh":
      return "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900/60 dark:text-emerald-300";
    case "aging":
      return "border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-900/60 dark:text-amber-300";
    case "stale":
      return "border-red-200 bg-red-500/10 text-red-700 dark:border-red-900/60 dark:text-red-300";
    default:
      return "border-muted text-muted-foreground";
  }
}

function ChangeMetric({ label, percent, euro }) {
  return (
    <div className="flex items-center justify-between rounded border bg-background/80 px-2 py-1.5">
      <span className="text-[10px] uppercase text-muted-foreground">{label}</span>
      <span className={`text-xs font-semibold ${deltaClassName(percent)}`}>
        {formatSignedPercent(percent)}
      </span>
      <span className={`text-[10px] ${deltaClassName(euro)}`}>{formatSignedPrice(euro)}</span>
    </div>
  );
}

export function ItemDetailsModal({
  isOpen,
  onClose,
  item,
  history = [],
  historyLoading = false,
  onToggleExclude,
  onBucketChange,
  onOverpayChange,
  canToggleExclude = true,
}) {
  const { formatPrice } = useCurrency();
  const [showAbsolute, setShowAbsolute] = useState(false);
  const [isOverpayLoading, setIsOverpayLoading] = useState(false);
  const [overpayEnabledDraft, setOverpayEnabledDraft] = useState(false);
  const [overpayFloorDraft, setOverpayFloorDraft] = useState("");
  const [overpayNoteDraft, setOverpayNoteDraft] = useState("");
  const excludeEnabled = canToggleExclude && typeof onToggleExclude === "function";
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

  if (!item) return null;

  const handleToggleExclude = async () => {
    if (!excludeEnabled) {
      return;
    }

    const currentExcluded = Boolean(item.excluded ?? item.isExcluded);
    await onToggleExclude(item.id, !currentExcluded, item.sourceInvestmentIds || []);
  };

  const handleToggleBucket = async () => {
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

    setIsOverpayLoading(true);
    try {
      await onOverpayChange(item, {
        overpayEnabled: Boolean(overpayEnabledDraft),
        overpayFloorEur: normalizedFloor,
        overpayNote: String(overpayNoteDraft || "").trim() || null,
      });
    } catch (error) {
      console.error("Failed to update overpay profile:", error);
    } finally {
      setIsOverpayLoading(false);
    }
  };

  const togglePriceDisplay = () => {
    setShowAbsolute(!showAbsolute);
  };
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
    <BaseModal isOpen={isOpen} onClose={onClose} title={item.name} size="3xl" className="w-full sm:max-w-2xl md:max-w-4xl md:hidden">
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <div className="h-24 w-24 sm:h-32 sm:w-32 shrink-0 overflow-hidden rounded-lg border bg-muted/30 p-1">
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
          <div className="space-y-2 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {item.type}
            </p>
            <p className="text-sm">
              <strong>Condition:</strong> {item.wearName || "N/A"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <PriceSourceBadge priceSource={item.priceSource} />
              <Badge variant="outline">
                Bucket: {String(item?.bucket || "investment").toLowerCase() === "inventory" ? "Inventar" : "Investment"}
              </Badge>
              <Badge variant="outline">
                Funding: {item.fundingMode === "cash_in" ? "Cash-In" : "Wallet"}
              </Badge>
              {(item?.overpayEnabled ?? item?.isOverpayCandidate) ? (
                <Badge variant="outline" className="border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  Overpay
                </Badge>
              ) : null}
              <Badge variant="outline" className={freshnessBadgeClass(item.freshnessStatus)}>
                {item.freshnessLabel || "unbekannt"}
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          <div className="rounded-md border p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Einkauf</p>
            <p className="mt-2 text-sm font-bold">{formatUsdPrice(item.buyPriceUsd ?? item.buyPrice)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{item.quantity}x {formatUsdPrice(item.buyPriceUsd ?? item.buyPrice)}</p>
          </div>

          <div className="rounded-md border p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Live</p>
            <p
              className={`mt-2 text-sm font-bold ${item.isLive ? "text-primary" : "text-muted-foreground"}`}
            >
              {item.livePrice !== null ? formatPrice(item.livePrice) : "Nicht verfuegbar"}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <PriceSourceBadge priceSource={item.priceSource} compact={true} />
              <Badge variant="outline" className="text-[10px] uppercase">
                Funding: {item.fundingMode === "cash_in" ? "Cash-In" : "Wallet"}
              </Badge>
              <Badge variant="outline" className={freshnessBadgeClass(item.freshnessStatus)}>
                {item.freshnessLabel || "unbekannt"}
              </Badge>
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
            <p className="mt-2 text-sm font-bold">
              {formatPrice(item.breakEvenPriceNet ?? item.breakEvenPrice ?? item.buyPrice)}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">inkl. Seller + Withdrawal + FX Fees</p>
          </div>

          <div className="rounded-md border p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Positionswert</p>
            <p className="mt-2 text-sm font-bold">{formatPrice(item.currentValue)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{item.quantity}x {formatPrice(item.displayPrice)}</p>
          </div>

          <div className="rounded-md border p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Gewinn / Verlust</p>
            <p className={`mt-2 text-sm font-bold ${item.isProfitPositive ? "text-green-600" : "text-red-600"}`}>
              {`${item.isProfitPositive ? "+" : ""}${formatPrice(item.profitEuro)}`}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {formatSignedPercent(item.roi)}
            </p>
          </div>

          <div className="rounded-md border p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Price Change</p>
            <div className="mt-2 space-y-1">
              <ChangeMetric
                label="24h"
                percent={item.change24hPercent}
                euro={item.change24hEuro}
              />
              <ChangeMetric
                label="7d"
                percent={item.change7dPercent}
                euro={item.change7dEuro}
              />
              <ChangeMetric
                label="30d"
                percent={item.change30dPercent}
                euro={item.change30dEuro}
              />
            </div>
          </div>

          {(hasFloatValue || hasPaintSeed || item.inspectLink) ? (
            <div className="rounded-md border p-2 sm:p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Instanzdaten</p>
              <p className="mt-2 text-sm font-bold">
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
                  <button
                    onClick={() => void handleOverpaySave()}
                    disabled={isOverpayLoading}
                    className="h-8 rounded-md border px-3 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isOverpayLoading ? "Speichert..." : "Overpay speichern"}
                  </button>
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
            <p className="mt-2 text-sm font-bold">
              {typeof item.costBasisTotal === "number" ? formatPrice(item.costBasisTotal) : "N/A"}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              pro Unit: {typeof item.costBasisUnit === "number" ? formatPrice(item.costBasisUnit) : "N/A"}
            </p>
          </div>
        </div>

        {historyLoading || (history && history.length > 0) ? (
          <div className="rounded-lg border p-3 sm:p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Preishistorie</h3>
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
              isLoading={historyLoading}
              title="Positionsentwicklung"
              emptyLabel="Noch keine Positionshistorie verfuegbar"
              valueLabel="Positionswert"
              showAbsolute={showAbsolute}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-lg border border-dashed p-3 sm:p-4 text-sm text-muted-foreground">
            Keine Positionshistorie verfuegbar.
          </div>
        )}

        {/* Exclude Toggle Button */}
        {excludeEnabled && (
          <div className="mt-4 border-t pt-4">
            <button
              onClick={handleToggleExclude}
              className={`flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                (item.excluded ?? item.isExcluded)
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/30 dark:bg-emerald-900/20 dark:text-emerald-300"
                  : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900/30 dark:bg-amber-900/20 dark:text-amber-300"
              }`}
            >
              {(item.excluded ?? item.isExcluded) ? (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  In Portfolio einbeziehen
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Aus Portfolio ausschließen
                </>
              )}
            </button>
            {bucketToggleEnabled ? (
              <button
                onClick={() => void handleToggleBucket()}
                className="mt-2 flex w-full items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                {String(item?.bucket || "investment").toLowerCase() === "inventory"
                  ? "Zu Investments verschieben"
                  : "Zum Inventar verschieben"}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </BaseModal>
  );
}
