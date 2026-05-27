import { useState } from "react";
import { BaseModal } from "@shared/components/BaseModal";
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

  return value >= 0 ? "text-emerald-400" : "text-red-400";
}

function freshnessBadgeClass(status) {
  switch (status) {
    case "fresh":
      return "border-emerald-400/35 bg-emerald-500/12 text-emerald-300";
    case "aging":
      return "border-amber-400/35 bg-amber-500/12 text-amber-300";
    case "stale":
      return "border-red-400/35 bg-red-500/12 text-red-300";
    default:
      return "border-muted text-muted-foreground";
  }
}

function ChangeMetric({ label, percent, euro }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/70 bg-card/65 px-2 py-1.5">
      <span className="text-[10px] uppercase text-muted-foreground">{label}</span>
      <span className={`text-xs font-semibold ${deltaClassName(percent)}`}>
        {formatSignedPercent(percent)}
      </span>
      <span className={`text-[10px] ${deltaClassName(euro)}`}>{formatSignedPrice(euro)}</span>
    </div>
  );
}

function deriveBuyInReferenceValue(item, history = []) {
  const unitCostBasis = Number(item?.costBasisUnit);
  if (Number.isFinite(unitCostBasis) && unitCostBasis > 0) {
    return unitCostBasis;
  }

  const buyPriceEur = Number(item?.buyPrice);
  if (Number.isFinite(buyPriceEur) && buyPriceEur > 0) {
    return buyPriceEur;
  }

  const buyPriceUsd = Number(item?.buyPriceUsd);
  if (!Number.isFinite(buyPriceUsd) || buyPriceUsd <= 0 || !Array.isArray(history)) {
    return null;
  }

  const exchangeRateEntry = history.find((entry) => Number.isFinite(Number(entry?.exchangeRate)));
  const usdToEurRate = Number(exchangeRateEntry?.exchangeRate);
  if (!Number.isFinite(usdToEurRate) || usdToEurRate <= 0) {
    return null;
  }

  return buyPriceUsd * usdToEurRate;
}

function deriveBuyInReferenceTimestamp(item) {
  const candidates = [
    item?.purchasedAt,
    item?.purchaseDate,
    item?.createdAt,
    item?.updatedAt,
  ];

  for (const candidate of candidates) {
    const timestamp = Date.parse(String(candidate || ""));
    if (Number.isFinite(timestamp) && timestamp > 0) {
      return timestamp;
    }
  }

  return null;
}

export function ItemDetailsModal({
  isOpen,
  onClose,
  item,
  history = [],
  historyLoading = false,
  onToggleExclude,
  onBucketChange,
  canToggleExclude = true,
}) {
  const { formatPrice } = useCurrency();
  const [showAbsolute, setShowAbsolute] = useState(false);
  const excludeEnabled = canToggleExclude && typeof onToggleExclude === "function";
  const bucketToggleEnabled = canToggleExclude && typeof onBucketChange === "function";

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

  const togglePriceDisplay = () => {
    setShowAbsolute(!showAbsolute);
  };
  const buyInReferenceValue = deriveBuyInReferenceValue(item, history);
  const buyInReferenceTimestamp = deriveBuyInReferenceTimestamp(item);
  const formatUsdPrice = (value) =>
    formatPrice(value, {
      useUsd: true,
      buyPriceUsd: value,
    });

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title={item.name} size="3xl" className="w-full md:hidden">
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <div className="h-24 w-24 sm:h-32 sm:w-32 shrink-0 overflow-hidden rounded-xl border border-border/75 bg-muted/25 p-1">
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
              <Badge variant="outline">
                Bucket: {String(item?.bucket || "investment").toLowerCase() === "inventory" ? "Inventar" : "Investment"}
              </Badge>
              <Badge variant="outline">
                Funding: {item.fundingMode === "cash_in" ? "Cash-In" : "Wallet"}
              </Badge>
              <Badge variant="outline" className={freshnessBadgeClass(item.freshnessStatus)}>
                {item.freshnessLabel || "unbekannt"}
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Einkauf</p>
            <p className="mt-2 text-sm font-bold">{formatUsdPrice(item.buyPriceUsd ?? item.buyPrice)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{item.quantity}x {formatUsdPrice(item.buyPriceUsd ?? item.buyPrice)}</p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Live</p>
            <p
              className={`mt-2 text-sm font-bold ${item.isLive ? "text-primary" : "text-muted-foreground"}`}
            >
              {item.livePrice !== null ? formatPrice(item.livePrice) : "Kein Preis verfuegbar"}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">{item.lastPriceUpdateAt || item.freshnessLabel || "Unbekannt"}</p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Break-even</p>
            <p className="mt-2 text-sm font-bold">
              {formatPrice(item.breakEvenPriceNet ?? item.breakEvenPrice ?? item.buyPrice)}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">inkl. Seller + Withdrawal + FX Fees</p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Positionswert</p>
            <p className="mt-2 text-sm font-bold">
              {item.isLive ? formatPrice(item.currentValue) : "N/A"}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {item.isLive ? `${item.quantity}x ${formatPrice(item.displayPrice)}` : "Kein csfloat-Preis vorhanden"}
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Gewinn / Verlust</p>
            <p
              className={`mt-2 text-sm font-bold ${
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
              {formatSignedPercent(item.roi)}
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
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

          <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
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
          <div className="rounded-2xl border border-border/70 bg-card/65 p-3 sm:p-4">
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
              referenceLineValue={buyInReferenceValue}
              referenceLineLabel="Buy-In"
              referenceLineTimestamp={buyInReferenceTimestamp}
              disableDarkGlass
            />
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/60 p-3 sm:p-4 text-sm text-muted-foreground">
            Keine Positionshistorie verfuegbar.
          </div>
        )}

        {/* Exclude Toggle Button */}
        {excludeEnabled && (
          <div className="sticky bottom-0 z-10 -mx-3 border-t border-border/70 bg-background/92 px-3 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-4 sm:backdrop-blur-0">
            <button
              onClick={handleToggleExclude}
              className={`flex h-10 w-full items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                (item.excluded ?? item.isExcluded)
                  ? "border-emerald-400/35 bg-emerald-500/12 text-emerald-300 hover:bg-emerald-500/18"
                  : "border-amber-400/35 bg-amber-500/12 text-amber-300 hover:bg-amber-500/18"
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
                  Aus Portfolio ausschliessen
                </>
              )}
            </button>
            {bucketToggleEnabled ? (
              <button
                onClick={() => void handleToggleBucket()}
                className="mt-2 flex h-10 w-full items-center justify-center rounded-xl border border-border/75 bg-card/70 px-4 py-2 text-sm font-medium transition-colors hover:bg-accent/70"
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

