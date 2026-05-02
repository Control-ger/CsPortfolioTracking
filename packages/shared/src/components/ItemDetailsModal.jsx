import { useState } from "react";
import { BaseModal } from "@shared/components/BaseModal";
import { PriceSourceBadge } from "@shared/components/PriceSourceBadge";
import { PortfolioChart } from "@shared/components/PortfolioChart";
import { Badge } from "@shared/components/ui/badge";

const formatPrice = (value) =>
  typeof value === "number" && !Number.isNaN(value) ? `${value.toFixed(2)} EUR` : "-";

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

export function ItemDetailsModal({ isOpen, onClose, item, history = [], historyLoading = false, onToggleExclude }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [showAbsolute, setShowAbsolute] = useState(false);

  if (!item) return null;

  const handleToggleExclude = async () => {
    if (onToggleExclude) {
      await onToggleExclude(item.id);
    }
  };

  const togglePriceDisplay = () => {
    setShowAbsolute(!showAbsolute);
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title={item.name} size="3xl" className="w-full sm:max-w-2xl md:max-w-4xl md:hidden">
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <div className="h-24 w-24 sm:h-32 sm:w-32 shrink-0 overflow-hidden rounded-lg border ">
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
                Funding: {item.fundingMode === "cash_in" ? "Cash-In" : "Wallet"}
              </Badge>
              <Badge variant="outline" className={freshnessBadgeClass(item.freshnessStatus)}>
                {item.freshnessLabel || "unbekannt"}
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          <div className="rounded-md border p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Einkauf</p>
            <p className="mt-2 text-sm font-bold">{formatPrice(item.buyPrice)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{item.quantity}x {formatPrice(item.buyPrice)}</p>
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
              {`${item.roi >= 0 ? "+" : ""}${item.roi.toFixed(2)}%`}
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
        {onToggleExclude && (
          <div className="mt-4 border-t pt-4">
            <button
              onClick={handleToggleExclude}
              className={`flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                item.isExcluded
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/30 dark:bg-emerald-900/20 dark:text-emerald-300"
                  : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900/30 dark:bg-amber-900/20 dark:text-amber-300"
              }`}
            >
              {item.isExcluded ? (
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
          </div>
        )}
      </div>
    </BaseModal>
  );
}
