import { TrendingDown, TrendingUp, RotateCw, Clock } from "lucide-react";
import { useCurrency } from "@shared/contexts/CurrencyContext";
import { Skeleton } from "@shared/components/ui/skeleton.jsx";

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

const resolveSyncHealth = (oldestAgeSeconds, liveItemsCount) => {
  if (!Number.isFinite(liveItemsCount) || liveItemsCount <= 0) {
    return {
      label: "keine live quotes",
      tone: "text-muted-foreground",
      iconClass: "rounded-full border border-border bg-surface-2 p-2 text-muted-foreground",
      icon: "clock",
    };
  }

  if (!Number.isFinite(oldestAgeSeconds)) {
    return {
      label: "status unbekannt",
      tone: "text-muted-foreground",
      iconClass: "rounded-full border border-border bg-surface-2 p-2 text-muted-foreground",
      icon: "clock",
    };
  }

  if (oldestAgeSeconds <= 90 * 60) {
    return {
      label: "im plan",
      tone: "text-success",
      iconClass: "rounded-full border border-success/30 bg-success/10 p-2 text-success",
      icon: "clock",
    };
  }

  if (oldestAgeSeconds <= 3 * 60 * 60) {
    return {
      label: "verzoegert",
      tone: "text-warn",
      iconClass: "rounded-full border border-warn/30 bg-warn/10 p-2 text-warn",
      icon: "refresh",
    };
  }

  return {
    label: "nachlauf",
    tone: "text-danger",
    iconClass: "rounded-full border border-danger/30 bg-danger/10 p-2 text-danger",
    icon: "refresh",
  };
};

/**
 * PortfolioHeaderCard - Minimalistische Portfolio-Uebersicht fuer mobiles Design
 * Zeigt: Portfolio-Wert mit Trend, prozentuale Aenderung, Total Items und Price Sync
 */
export const PortfolioHeaderCard = ({
  totalValue = 0,
  totalRoiPercent = 0,
  isPositive = true,
  totalQuantity = 0,
  liveItemsCount = 0,
  freshestDataAgeSeconds = 0,
  oldestDataAgeSeconds = 0,
  isLoading = false,
}) => {
  const { currency, formatPrice } = useCurrency();
  const numericRoiPercent = Number(totalRoiPercent);
  const hasValidRoiPercent = Number.isFinite(numericRoiPercent);
  const effectiveIsPositive = hasValidRoiPercent ? numericRoiPercent >= 0 : isPositive;
  const Icon = effectiveIsPositive ? TrendingUp : TrendingDown;
  const trendColor = effectiveIsPositive ? "text-success" : "text-danger";
  const syncHealth = resolveSyncHealth(Number(oldestDataAgeSeconds), Number(liveItemsCount));
  const syncTitle = `Price Sync - Live Quotes: ${liveItemsCount} | Aeltestes Cache-Alter: ${formatAge(oldestDataAgeSeconds)}`;

  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-card/65 p-3.5">
      {/* Mobile: Brokerage als Ueberschrift */}
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground sm:hidden">
        Brokerage
      </h2>

      {/* Hauptwert mit Trend und Frische-Indikator */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-36" />
              <Skeleton className="h-4 w-20" />
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold tracking-tight">
                  {/* No `useUsd`: the props mirror `calculatePortfolioSummary`, whose
                      totals sum the rows' EUR `currentValue`. */}
                  {formatPrice(totalValue || 0).replace(/^[^\d-]+/, "")}
                </span>
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{currency}</span>
              </div>
              <div className={`mt-1 flex items-center gap-1 ${trendColor}`}>
                <Icon className="h-4 w-4" />
                <span className="text-sm font-semibold">
                  {formatPercent(totalRoiPercent, 2)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Price Sync Icon - rechts oben */}
        {isLoading ? (
          <Skeleton className="h-12 w-16" />
        ) : (
          <div className="flex flex-col items-end gap-2 text-right">
            <div
              className={syncHealth.iconClass}
              title={syncTitle}
            >
              {syncHealth.icon === "refresh" ? (
                <RotateCw className="h-4 w-4" />
              ) : (
                <Clock className="h-4 w-4" />
              )}
            </div>
            <div className={`text-xs ${syncHealth.tone}`}>
              <span>{syncHealth.label}</span>
            </div>
          </div>
        )}
      </div>

      {/* Zusaetzliche Infos in kleinerer Schrift */}
      {isLoading ? (
        <Skeleton className="h-3 w-56" />
      ) : (
        <div className="text-xs text-muted-foreground">
          <span>{totalQuantity} Items - </span>
          <span className="font-medium">{liveItemsCount} live quotes</span>
          <span>, aeltestes Cache-Alter {formatAge(oldestDataAgeSeconds)}</span>
          <span>, letztes Update {formatAge(freshestDataAgeSeconds)}</span>
        </div>
      )}
    </div>
  );
};
