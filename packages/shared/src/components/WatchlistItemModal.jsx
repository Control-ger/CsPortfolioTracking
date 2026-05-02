import { useState } from "react";
import { BaseModal } from "@shared/components/BaseModal";
import { PriceSourceBadge } from "@shared/components/PriceSourceBadge";
import { PortfolioChart } from "@shared/components/PortfolioChart";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { DeleteConfirmModal } from "./DeleteConfirmModal";
import { Trash2 } from "lucide-react";

const formatPrice = (value) =>
  typeof value === "number" && !Number.isNaN(value) ? `${value.toFixed(2)} EUR` : "-";

export function WatchlistItemModal({ isOpen, onClose, item, onDelete }) {
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

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title={item.name} size="md" className="md:hidden">
      <div className="space-y-4">
        <div className="flex gap-4">
          <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg border ">
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
          <div className="rounded-md border p-2">
            <p className="text-xs uppercase text-muted-foreground">Aktuell</p>
            <p className="text-sm font-semibold">{formatPrice(item.currentPrice)}</p>
          </div>

          {item.lastPrice !== null && (
            <div className="rounded-md border p-2">
              <p className="text-xs uppercase text-muted-foreground">Letzter Preis</p>
              <p className="text-sm font-semibold">{formatPrice(item.lastPrice)}</p>
            </div>
          )}

          {item.highestPrice !== null && (
            <div className="rounded-md border p-2">
              <p className="text-xs uppercase text-muted-foreground">Höchst</p>
              <p className="text-sm font-semibold">{formatPrice(item.highestPrice)}</p>
            </div>
          )}

          {item.lowestPrice !== null && (
            <div className="rounded-md border p-2">
              <p className="text-xs uppercase text-muted-foreground">Tiefst</p>
              <p className="text-sm font-semibold">{formatPrice(item.lowestPrice)}</p>
            </div>
          )}

          {item.avgPrice !== null && (
            <div className="rounded-md border p-2">
              <p className="text-xs uppercase text-muted-foreground">Durchschnitt</p>
              <p className="text-sm font-semibold">{formatPrice(item.avgPrice)}</p>
            </div>
          )}

          {item.highestPrice !== null || item.lowestPrice !== null ? (
            <div className="col-span-2 rounded-md border p-2">
              <p className="text-xs uppercase text-muted-foreground">Preis-Spanne</p>
              <p className="text-sm font-semibold">
                {formatPrice(item.lowestPrice)} - {formatPrice(item.highestPrice)}
              </p>
            </div>
          ) : null}
        </div>

        {Array.isArray(item.priceHistory) && item.priceHistory.length > 0 ? (
          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Preisentwicklung</h3>
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
              history={item.priceHistory}
              title="Watchlist Entwicklung"
              valueLabel="Preis"
              emptyLabel="Noch keine Preishistorie verfuegbar"
              showAbsolute={showAbsolute}
            />
          </div>
        ) : null}

        {item.updateAge !== undefined && (
          <div className="text-center text-xs text-muted-foreground">
            Zuletzt aktualisiert: {item.updateAge}
          </div>
        )}

        {/* Delete Section */}
        <div className="border-t pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDeleteClick}
            className="w-full text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
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
