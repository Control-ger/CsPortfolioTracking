import { TrendingDown, TrendingUp, RotateCw, Clock } from "lucide-react";
import { useCurrency } from "@shared/contexts/CurrencyContext";

const formatAge = (seconds) => {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) {
    return "-";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }

  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h`;
  }

  return `${Math.floor(seconds / 86400)}d`;
};

const formatPercent = (value, fractionDigits = 2) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "-";
  }

  const sign = numericValue >= 0 ? "+" : "";
  return `${sign}${numericValue.toFixed(fractionDigits)}%`;
};

/**
 * PortfolioHeaderCard - Minimalistische Portfolio-Uebersicht fuer mobiles Design
 * Zeigt: Portfolio-Wert mit Trend, prozentuale Aenderung, Total Items und Data Freshness
 */
export const PortfolioHeaderCard = ({
  totalValue = 0,
  totalRoiPercent = 0,
  isPositive = true,
  totalQuantity = 0,
  liveItemsCount = 0,
  staleItemsCount = 0,
  freshestDataAgeSeconds = 0,
  oldestDataAgeSeconds = 0,
}) => {
  const { currency, formatPrice } = useCurrency();
  const numericRoiPercent = Number(totalRoiPercent);
  const hasValidRoiPercent = Number.isFinite(numericRoiPercent);
  const effectiveIsPositive = hasValidRoiPercent ? numericRoiPercent >= 0 : isPositive;
  const Icon = effectiveIsPositive ? TrendingUp : TrendingDown;
  const trendColor = effectiveIsPositive ? "text-emerald-400" : "text-red-400";
  const hasStaleItems = staleItemsCount > 0;
  const freshnessTitle = hasStaleItems
    ? `${staleItemsCount}/${liveItemsCount + staleItemsCount} Items veraltet - aeltest: ${formatAge(oldestDataAgeSeconds)}`
    : `Aktuell - frischestes Update: ${formatAge(freshestDataAgeSeconds)}`;

  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-card/65 p-3.5">
      {/* Mobile: Brokerage als Ueberschrift */}
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground sm:hidden">
        Brokerage
      </h2>

      {/* Hauptwert mit Trend und Frische-Indikator */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight">
              {formatPrice(totalValue || 0, {
                useUsd: true,
                buyPriceUsd: totalValue || 0,
              }).replace(/^[^\d-]+/, "")}
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{currency}</span>
          </div>
          <div className={`mt-1 flex items-center gap-1 ${trendColor}`}>
            <Icon className="h-4 w-4" />
            <span className="text-sm font-semibold">
              {formatPercent(totalRoiPercent, 2)}
            </span>
          </div>
        </div>

        {/* Data Freshness Icon - rechts oben */}
        <div className="flex flex-col items-end gap-2 text-right">
          {hasStaleItems ? (
            <div
              className="rounded-full border border-amber-400/30 bg-amber-500/12 p-2 text-amber-300"
              title={freshnessTitle}
            >
              <RotateCw className="h-4 w-4" />
            </div>
          ) : (
            <div
              className="rounded-full border border-emerald-400/30 bg-emerald-500/12 p-2 text-emerald-300"
              title={freshnessTitle}
            >
              <Clock className="h-4 w-4" />
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            {hasStaleItems ? (
              <span>{staleItemsCount}v</span>
            ) : (
              <span>{formatAge(freshestDataAgeSeconds)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Zusaetzliche Infos in kleinerer Schrift */}
      <div className="text-xs text-muted-foreground">
        <span>{totalQuantity} Items - </span>
        <span className="font-medium">{liveItemsCount} live</span>
        {hasStaleItems && <span>, {staleItemsCount} veraltet</span>}
      </div>
    </div>
  );
};
