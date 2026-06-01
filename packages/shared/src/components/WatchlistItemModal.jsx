import { useState } from "react";
import { BaseModal } from "@shared/components/BaseModal";
import { PortfolioChart } from "@shared/components/PortfolioChart";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { DeleteConfirmModal } from "./DeleteConfirmModal";
import { Trash2 } from "lucide-react";
import { useCurrency } from "@shared/contexts/CurrencyContext";

export function WatchlistItemModal({ isOpen, onClose, item, onDelete }) {
  const { currency, formatPrice: formatCurrencyPrice } = useCurrency();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showAbsolute, setShowAbsolute] = useState(false);

  if (!item) {
    return null;
  }

  const togglePriceDisplay = () => {
    setShowAbsolute(!showAbsolute);
  };

  const handleDeleteClick = () => {
    setShowConfirm(true);
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete?.(item.id);
      setShowConfirm(false);
      onClose();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setShowConfirm(false);
  };

  const hasBuyOrder =
    Number(item?.buyOrderCount || 0) > 0 &&
    Number(item?.buyOrderBestPriceUsd || 0) > 0;
  const buyOrderRows = Array.isArray(item?.buyOrderRows) ? item.buyOrderRows : [];
  const toPositivePrice = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
  };
  const historyValues = (Array.isArray(item?.priceHistory) ? item.priceHistory : [])
    .map((entry) => {
      const rawPrice =
        entry?.wert ??
        entry?.priceEur ??
        entry?.price_eur ??
        entry?.price ??
        entry?.value;
      return toPositivePrice(rawPrice);
    })
    .filter((value) => value !== null);
  const fallbackCurrentPrice =
    historyValues.length > 0 ? historyValues[historyValues.length - 1] : null;
  const fallbackLastPrice =
    historyValues.length > 1 ? historyValues[historyValues.length - 2] : null;
  const fallbackHighestPrice =
    historyValues.length > 0 ? Math.max(...historyValues) : null;
  const fallbackLowestPrice =
    historyValues.length > 0 ? Math.min(...historyValues) : null;
  const fallbackAvgPrice = historyValues.length > 0
    ? historyValues.reduce((sum, value) => sum + value, 0) / historyValues.length
    : null;

  const currentPrice = toPositivePrice(item?.currentPrice) ?? fallbackCurrentPrice;
  const lastPrice = toPositivePrice(item?.lastPrice) ?? fallbackLastPrice;
  const highestPrice = toPositivePrice(item?.highestPrice) ?? fallbackHighestPrice;
  const lowestPrice = toPositivePrice(item?.lowestPrice) ?? fallbackLowestPrice;
  const avgPrice = toPositivePrice(item?.avgPrice) ?? fallbackAvgPrice;
  const hasExtendedStats =
    lastPrice !== null ||
    highestPrice !== null ||
    lowestPrice !== null ||
    avgPrice !== null;

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title={item.name} size="md" className="md:hidden">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-xl border border-border/75 ">
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
                {currentPrice !== null ? formatCurrencyPrice(currentPrice) : "N/A"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px] uppercase">
                {item.changeLabel || "-"}
              </Badge>
              {hasBuyOrder ? (
                <Badge variant="outline" className="border-sky-400/35 bg-sky-500/12 text-[10px] text-sky-300">
                  CSFloat Buyorder{" "}
                  {formatCurrencyPrice(Number(item.buyOrderBestPriceUsd), {
                    useUsd: true,
                    buyPriceUsd: Number(item.buyOrderBestPriceUsd),
                  })}
                  {Number(item.buyOrderCount) > 1 ? ` x${Number(item.buyOrderCount)}` : ""}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>

        {hasExtendedStats ? (
          <div className="grid grid-cols-2 gap-3">
            {currentPrice !== null ? (
              <div className="rounded-xl border border-border/70 bg-card/65 p-2">
                <p className="text-xs uppercase text-muted-foreground">Aktuell</p>
                <p className="text-sm font-semibold">{formatCurrencyPrice(currentPrice)}</p>
              </div>
            ) : null}

            {lastPrice !== null ? (
            <div className="rounded-xl border border-border/70 bg-card/65 p-2">
              <p className="text-xs uppercase text-muted-foreground">Letzter Preis</p>
              <p className="text-sm font-semibold">{formatCurrencyPrice(lastPrice)}</p>
            </div>
            ) : null}

            {highestPrice !== null ? (
            <div className="rounded-xl border border-border/70 bg-card/65 p-2">
              <p className="text-xs uppercase text-muted-foreground">Hoechst</p>
              <p className="text-sm font-semibold">{formatCurrencyPrice(highestPrice)}</p>
            </div>
            ) : null}

            {lowestPrice !== null ? (
            <div className="rounded-xl border border-border/70 bg-card/65 p-2">
              <p className="text-xs uppercase text-muted-foreground">Tiefst</p>
              <p className="text-sm font-semibold">{formatCurrencyPrice(lowestPrice)}</p>
            </div>
            ) : null}

            {avgPrice !== null ? (
            <div className="rounded-xl border border-border/70 bg-card/65 p-2">
              <p className="text-xs uppercase text-muted-foreground">Durchschnitt</p>
              <p className="text-sm font-semibold">{formatCurrencyPrice(avgPrice)}</p>
            </div>
            ) : null}

            {highestPrice !== null && lowestPrice !== null ? (
              <div className="col-span-2 rounded-xl border border-border/70 bg-card/65 p-2">
                <p className="text-xs uppercase text-muted-foreground">Preis-Spanne</p>
                <p className="text-sm font-semibold">
                  {formatCurrencyPrice(lowestPrice)} - {formatCurrencyPrice(highestPrice)}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {Array.isArray(item.priceHistory) && item.priceHistory.length > 0 ? (
          <div className="rounded-2xl border border-border/75 bg-card/65 p-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Preisentwicklung</h3>
              <button
                onClick={togglePriceDisplay}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAbsolute ? (
                  <>
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">{currency}</span>
                    <span className="text-muted-foreground/50">%</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground/50">{currency}</span>
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">%</span>
                  </>
                )}
              </button>
            </div>
            <PortfolioChart
              history={item.priceHistory}
              title="Watchlist Entwicklung"
              valueLabel="Preis"
              emptyLabel="Noch keine Preishistorie verfuegbar"
              showAbsolute={showAbsolute}
              disableDarkGlass
            />
          </div>
        ) : null}

        <div className="rounded-2xl border border-border/75 bg-card/65 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Buyorders (CSFloat)</h3>
            {buyOrderRows.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {buyOrderRows.reduce((sum, row) => sum + Number(row.orders || 0), 0)} Orders,{" "}
                {buyOrderRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)} Menge
              </span>
            ) : null}
          </div>

          {buyOrderRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine passenden Buyorders fuer dieses Item gefunden.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border/60">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-left text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-2 font-medium">Preis</th>
                    <th className="px-2.5 py-2 font-medium">Orders</th>
                    <th className="px-2.5 py-2 font-medium">Menge</th>
                  </tr>
                </thead>
                <tbody>
                  {buyOrderRows.slice(0, 12).map((row, index) => (
                    <tr key={`${row.priceUsd}-${index}`} className="border-t border-border/50">
                      <td className="px-2.5 py-2 text-sky-300">
                        {formatCurrencyPrice(Number(row.priceUsd), {
                          useUsd: true,
                          buyPriceUsd: Number(row.priceUsd),
                        })}
                      </td>
                      <td className="px-2.5 py-2">{Number(row.orders || 0)}</td>
                      <td className="px-2.5 py-2">{Number(row.quantity || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {item.updateAge !== undefined && (
          <div className="text-center text-xs text-muted-foreground">
            Zuletzt aktualisiert: {item.updateAge}
          </div>
        )}

        {/* Delete Section */}
        <div className="sticky bottom-0 z-10 -mx-3 border-t border-border/70 bg-background/92 px-3 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-4 sm:backdrop-blur-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDeleteClick}
            className="h-10 w-full rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Aus Watchlist entfernen
          </Button>
        </div>
      </div>

      <DeleteConfirmModal
        isOpen={showConfirm}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
        itemName={item.name}
        description="aus deiner Watchlist entfernen"
      />
    </BaseModal>
  );
}

