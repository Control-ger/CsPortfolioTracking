import { BaseModal } from "@/components/BaseModal";
import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import { TrendingDown, TrendingUp } from "lucide-react";

const formatPrice = (value) =>
  typeof value === "number" && !Number.isNaN(value) ? `${value.toFixed(2)} EUR` : "-";

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

export function WatchlistItemModal({ isOpen, onClose, item }) {
  if (!item) {
    return null;
  }

  const isUp = item.trend === "up";
  const isDown = item.trend === "down";
  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : null;
  const colorClass = isUp ? "text-green-600" : isDown ? "text-red-600" : "text-muted-foreground";

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title={item.name} size="md" className="md:hidden">
      <div className="space-y-4">
        <div className="flex gap-4">
          <div className="h-24 w-24 overflow-hidden rounded-lg border bg-muted flex-shrink-0">
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
            <div className="flex items-center gap-2">
              {Icon && <Icon className={`h-4 w-4 ${colorClass}`} />}
              <span className={`text-sm font-semibold ${colorClass}`}>{item.changeLabel}</span>
            </div>
            <div className="space-y-1">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Aktueller Preis</p>
                <p className="text-lg font-bold">
                  {item.currentPrice !== null ? formatPrice(item.currentPrice) : "N/A"}
                </p>
              </div>
              <PriceSourceBadge priceSource={item.priceSource} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {item.lastPrice !== null && (
            <div className="rounded-md border bg-muted/40 p-2">
              <p className="text-xs uppercase text-muted-foreground">Letzter Preis</p>
              <p className="text-sm font-semibold">{formatPrice(item.lastPrice)}</p>
            </div>
          )}

          {item.highestPrice !== null && (
            <div className="rounded-md border bg-muted/40 p-2">
              <p className="text-xs uppercase text-muted-foreground">Höchst</p>
              <p className="text-sm font-semibold">{formatPrice(item.highestPrice)}</p>
            </div>
          )}

          {item.lowestPrice !== null && (
            <div className="rounded-md border bg-muted/40 p-2">
              <p className="text-xs uppercase text-muted-foreground">Tiefst</p>
              <p className="text-sm font-semibold">{formatPrice(item.lowestPrice)}</p>
            </div>
          )}

          {item.avgPrice !== null && (
            <div className="rounded-md border bg-muted/40 p-2">
              <p className="text-xs uppercase text-muted-foreground">Durchschnitt</p>
              <p className="text-sm font-semibold">{formatPrice(item.avgPrice)}</p>
            </div>
          )}
        </div>

        {item.updateAge !== undefined && (
          <div className="text-xs text-muted-foreground text-center">
            Zuletzt aktualisiert: {item.updateAge}
          </div>
        )}
      </div>
    </BaseModal>
  );
}
