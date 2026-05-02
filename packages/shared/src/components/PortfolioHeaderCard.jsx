import { TrendingDown, TrendingUp, RotateCw, Clock } from "lucide-react";

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

/**
 * PortfolioHeaderCard - Minimalistische Portfolio-Übersicht für mobiles Design
 * Zeigt: Portfolio-Wert mit Trend, Prozentuale Änderung, Total Items und Data Freshness
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
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const trendColor = isPositive ? "text-green-600" : "text-red-600";
  const hasStaleItems = staleItemsCount > 0;
  const freshnessTitle = hasStaleItems
    ? `${staleItemsCount}/${liveItemsCount + staleItemsCount} Items veraltet • ältest: ${formatAge(oldestDataAgeSeconds)}`
    : `Aktuell • frischestes Update: ${formatAge(freshestDataAgeSeconds)}`;

  return (
    <div className="space-y-3">
      {/* Mobile: Portfolio als Überschrift */}
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground sm:hidden">
        Portfolio
      </h2>

      {/* Hauptwert mit Trend und Frische-Indikator */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight">
              {(totalValue || 0).toFixed(2)}
            </span>
            <span className="text-sm text-muted-foreground">EUR</span>
          </div>
          <div className={`mt-1 flex items-center gap-1 ${trendColor}`}>
            <Icon className="h-4 w-4" />
            <span className="text-sm font-semibold">
              {isPositive ? "+" : ""}
              {totalRoiPercent.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Data Freshness Icon - rechts oben */}
        <div className="flex flex-col items-end gap-2 text-right">
          {hasStaleItems ? (
            <div
              className="rounded-full bg-amber-500/10 p-2 text-amber-600"
              title={freshnessTitle}
            >
              <RotateCw className="h-4 w-4" />
            </div>
          ) : (
            <div
              className="rounded-full bg-emerald-500/10 p-2 text-emerald-600"
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

      {/* Zusätzliche Infos in kleinerer Schrift */}
      <div className="text-xs text-muted-foreground">
        <span>{totalQuantity} Items • </span>
        <span className="font-medium">{liveItemsCount} live</span>
        {hasStaleItems && <span>, {staleItemsCount} veraltet</span>}
      </div>
    </div>
  );
};

