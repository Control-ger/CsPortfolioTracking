import { TrendingDown, TrendingUp, ArrowRight } from "lucide-react";

/**
 * ItemListRow - Minimale Listenansicht für Items
 * Zeigt nur: Bild, Name, Preis, % Änderung mit Trend-Pfeil
 */
export const ItemListRow = ({
  item,
  onClick,
  className = "",
}) => {
  if (!item) {
    return null;
  }

  const derivedPercent = Number.isFinite(Number(item.roi)) ? Number(item.roi) : Number(item.changePercent);
  const trend = item.trend || (Number.isFinite(derivedPercent) ? (derivedPercent >= 0 ? "up" : "down") : null);
  const isUp = trend === "up";
  const isDown = trend === "down";
  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : null;
  const colorClass = isUp
    ? "text-green-600"
    : isDown
      ? "text-red-600"
      : "text-muted-foreground";
  const changeLabel =
    item.changeLabel || (Number.isFinite(derivedPercent) ? `${derivedPercent >= 0 ? "+" : ""}${derivedPercent.toFixed(1)}%` : "-");

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 p-3 text-left transition-colors sm:rounded-lg sm:border sm:bg-card sm:hover:bg-muted ${className}`}
    >
      {/* Bild + Name */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-md border ">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
              N/A
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-medium">{item.name}</h4>
          {item.currentPrice !== null && item.currentPrice !== undefined && (
            <p className="truncate text-xs text-muted-foreground">
              {item.currentPrice.toFixed(2)} EUR
            </p>
          )}
        </div>
      </div>

      {/* Preis-Änderung und Pfeil */}
      <div className="flex flex-shrink-0 items-center gap-2">
        <div className="flex flex-col items-end gap-0.5">
          {Icon && <Icon className={`h-4 w-4 ${colorClass}`} />}
          <span className={`text-xs font-semibold ${colorClass}`}>{changeLabel}</span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </button>
  );
};

