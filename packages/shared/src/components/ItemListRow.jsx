import { TrendingDown, TrendingUp, ArrowRight } from "lucide-react";
import { useCurrency } from "@shared/contexts/CurrencyContext";
import { Badge } from "@shared/components/ui/badge";

/**
 * ItemListRow - Minimale Listenansicht fuer Items
 * Zeigt nur: Bild, Name, Preis, % Aenderung mit Trend-Pfeil
 */
export const ItemListRow = ({
  item,
  onClick,
  className = "",
}) => {
  const { formatPrice } = useCurrency();

  if (!item) {
    return null;
  }

  const derivedPercent = Number.isFinite(Number(item.roi)) ? Number(item.roi) : Number(item.changePercent);
  const trend = item.trend || (Number.isFinite(derivedPercent) ? (derivedPercent >= 0 ? "up" : "down") : null);
  const isUp = trend === "up";
  const isDown = trend === "down";
  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : null;
  const colorClass = isUp
    ? "text-emerald-400"
    : isDown
      ? "text-red-400"
      : "text-muted-foreground";
  const changeLabel =
    item.changeLabel || (Number.isFinite(derivedPercent) ? `${derivedPercent >= 0 ? "+" : ""}${derivedPercent.toFixed(1)}%` : "-");
  const hasBuyOrder = Number(item?.buyOrderCount || 0) > 0 && Number(item?.buyOrderBestPriceUsd || 0) > 0;
  const buyOrderLabel = hasBuyOrder
    ? `Buyorder ${formatPrice(item.buyOrderBestPriceUsd, { useUsd: true, buyPriceUsd: item.buyOrderBestPriceUsd })}${item.buyOrderCount > 1 ? ` x${item.buyOrderCount}` : ""}`
    : "";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-md border border-border bg-transparent p-3 text-left shadow-none transition-all hover:border-border hover:bg-accent/45 active:scale-[0.995] dark:rounded-2xl dark:border-border/70 dark:bg-card/75 dark:shadow-[0_14px_30px_rgba(0,0,0,0.2)] ${className}`}
    >
      {/* Bild + Name */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl border border-border/75 bg-muted/25 p-1 sm:h-14 sm:w-14">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.name}
              className="h-full w-full object-contain"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
              N/A
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold">{item.name}</h4>
          {item.currentPrice !== null && item.currentPrice !== undefined && (
            <p className="truncate text-xs text-muted-foreground">
              {item.currentPriceUsd !== null && item.currentPriceUsd !== undefined
                ? formatPrice(item.currentPriceUsd, {
                    useUsd: true,
                    buyPriceUsd: item.currentPriceUsd,
                  })
                : formatPrice(item.currentPrice)}
            </p>
          )}
          {hasBuyOrder ? (
            <Badge variant="outline" className="mt-1 border-sky-400/35 bg-sky-500/12 text-[10px] text-sky-300">
              {buyOrderLabel}
            </Badge>
          ) : null}
        </div>
      </div>

      {/* Preis-Aenderung und Pfeil */}
      <div className="flex flex-shrink-0 items-center gap-2">
        <div className="flex flex-col items-end gap-0.5">
          {Icon && <Icon className={`h-4 w-4 ${colorClass}`} />}
          <span className={`text-xs font-bold ${colorClass}`}>{changeLabel}</span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/85" />
      </div>
    </button>
  );
};


