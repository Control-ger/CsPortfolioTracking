import { BaseModal } from "@/components/BaseModal";
import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import { PortfolioChart } from "@/components/PortfolioChart";
import { Badge } from "@/components/ui/badge";
import { MetricPairBlock } from "@/components/MetricPair";

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
      return "border-muted bg-muted/30 text-muted-foreground";
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

export function ItemDetailsModal({ isOpen, onClose, item, history = [] }) {
  if (!item) {
    return null;
  }

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title={item.name} size="3xl" className="w-full sm:max-w-2xl md:max-w-4xl md:hidden">
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <div className="h-24 w-24 sm:h-32 sm:w-32 shrink-0 overflow-hidden rounded-lg border bg-muted">
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

          <div className="rounded-md border bg-muted/40 p-2 sm:p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Cost Basis</p>
            <p className="mt-2 text-sm font-bold">
              {typeof item.costBasisTotal === "number" ? formatPrice(item.costBasisTotal) : "N/A"}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              pro Unit: {typeof item.costBasisUnit === "number" ? formatPrice(item.costBasisUnit) : "N/A"}
            </p>
          </div>
        </div>

        {history && history.length > 0 ? (
            <div className="rounded-lg border bg-muted/20 p-3 sm:p-4">
              <h3 className="mb-3 sm:mb-4 text-sm font-semibold">Preishistorie</h3>
              <PortfolioChart
                history={history}
                color={item.isProfitPositive ? "#22c55e" : "#ef4444"}
                title="Positionsentwicklung"
                emptyLabel="Noch keine Positionshistorie verfuegbar"
                valueLabel="Positionswert"
              />
            </div>
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-dashed bg-muted/20 p-3 sm:p-4 text-sm text-muted-foreground">
              Keine Positionshistorie verfuegbar.
            </div>
          )}
      </div>
    </BaseModal>
  );
}
