import { BaseModal } from "@/components/BaseModal";
import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import { PortfolioChart } from "@/components/PortfolioChart";
import { Badge } from "@/components/ui/badge";

const formatPrice = (value) =>
  typeof value === "number" && !Number.isNaN(value) ? `${value.toFixed(2)} EUR` : "-";

export function WatchlistItemModal({ isOpen, onClose, item }) {
  if (!item) {
    return null;
  }

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title={item.name} size="md" className="md:hidden">
      <div className="space-y-4">
        <div className="flex gap-4">
          <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg border bg-muted">
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
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Watchlist
            </p>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Aktueller Preis</p>
              <p className="text-lg font-bold">
                {item.currentPrice !== null ? formatPrice(item.currentPrice) : "N/A"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <PriceSourceBadge priceSource={item.priceSource} />
              <Badge variant="outline" className="text-[10px] uppercase">
                {item.changeLabel || "-"}
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border bg-muted/40 p-2">
            <p className="text-xs uppercase text-muted-foreground">Aktuell</p>
            <p className="text-sm font-semibold">{formatPrice(item.currentPrice)}</p>
          </div>

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

          {item.highestPrice !== null || item.lowestPrice !== null ? (
            <div className="col-span-2 rounded-md border bg-muted/40 p-2">
              <p className="text-xs uppercase text-muted-foreground">Preis-Spanne</p>
              <p className="text-sm font-semibold">
                {formatPrice(item.lowestPrice)} - {formatPrice(item.highestPrice)}
              </p>
            </div>
          ) : null}
        </div>

        {Array.isArray(item.priceHistory) && item.priceHistory.length > 0 ? (
          <div className="rounded-lg border bg-muted/20 p-3">
            <h3 className="mb-3 text-sm font-semibold">Preisentwicklung</h3>
            <PortfolioChart
              history={item.priceHistory}
              title="Watchlist Entwicklung"
              valueLabel="Preis"
              emptyLabel="Noch keine Preis-Historie verfuegbar"
            />
          </div>
        ) : null}

        {item.updateAge !== undefined && (
          <div className="text-center text-xs text-muted-foreground">
            Zuletzt aktualisiert: {item.updateAge}
          </div>
        )}
      </div>
    </BaseModal>
  );
}
