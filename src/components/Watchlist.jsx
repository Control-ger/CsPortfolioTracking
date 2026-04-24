import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { ItemSearch } from "./ItemSearch";
import { PortfolioChart } from "./PortfolioChart";
import { ApiWarnings } from "./ApiWarnings";
import { ItemListRow } from "./ItemListRow";
import { PriceSourceBadge } from "./PriceSourceBadge";
import { X, Trash2 } from "lucide-react";
import { deleteWatchlistItem, fetchWatchlist } from "@/lib/apiClient.js";
import { Button } from "@/components/ui/button";
import { DeleteConfirmModal } from "./DeleteConfirmModal";
import { WatchlistItemModal } from "./WatchlistItemModal";

function WatchlistLoadingSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>

      <Card>
        <CardContent className="space-y-3 p-4 sm:p-6">
          <Skeleton className="h-10 w-full" />
          <div className="grid gap-3 md:grid-cols-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 md:gap-6">
        <Card>
          <CardHeader className="pb-2 sm:pb-4">
            <Skeleton className="h-5 w-36" />
          </CardHeader>
          <CardContent className="space-y-2 sm:space-y-3">
            {[1, 2, 3, 4].map((entry) => (
              <div key={entry} className="rounded-lg border p-3">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-12 w-12 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="hidden md:block">
          <CardHeader className="pb-2 sm:pb-4">
            <Skeleton className="h-5 w-48" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-[320px] w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export const Watchlist = ({ focusTarget = null }) => {
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showAbsolute, setShowAbsolute] = useState(false);
  const itemRefs = useRef(new Map());

  const loadWatchlistData = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetchWatchlist({ syncLive: true });
      const nextItems = response?.data || [];

      setWatchlistItems(nextItems);
      setWarnings(response?.meta?.warnings || []);
      setSelectedItem((currentSelection) => {
        if (!currentSelection) {
          return null;
        }

        return (
          nextItems.find((item) => item.id === currentSelection.id) || null
        );
      });
    } catch (requestError) {
      const isNetworkError = String(requestError?.name || "") === "TypeError";

      if (isNetworkError) {
        try {
          const fallbackResponse = await fetchWatchlist({ syncLive: false });
          const fallbackItems = fallbackResponse?.data || [];

          setWatchlistItems(fallbackItems);
          setWarnings([
            {
              code: "WATCHLIST_SYNC_FALLBACK",
              label: "Live-Sync eingeschraenkt",
              message: "Watchlist wurde ohne Live-Sync geladen. Bitte spaeter erneut versuchen.",
            },
          ]);
          return;
        } catch (fallbackError) {
          setError(fallbackError.message || "Fehler beim Laden der Watchlist.");
          setWarnings([]);
          return;
        }
      }

      setError(requestError.message || "Fehler beim Laden der Watchlist.");
      setWarnings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWatchlistData();
  }, []);

  useEffect(() => {
    if (!focusTarget?.id || watchlistItems.length === 0) {
      return;
    }

    const matchingItem = watchlistItems.find((item) => item.id === focusTarget.id);
    if (!matchingItem) {
      return;
    }

    setSelectedItem(matchingItem);

    const nextFrame = window.requestAnimationFrame(() => {
      const itemNode = itemRefs.current.get(matchingItem.id);
      itemNode?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });

    return () => {
      window.cancelAnimationFrame(nextFrame);
    };
  }, [focusTarget, watchlistItems]);

  const handleRemoveItem = async (id) => {
    try {
      await deleteWatchlistItem(id);
      setSelectedItem(null);
      setShowDeleteConfirm(false);
      await loadWatchlistData();
    } catch (requestError) {
      setError(
        requestError.message || "Fehler beim Entfernen des Watchlist-Items."
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await handleRemoveItem(selectedItem.id);
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return <WatchlistLoadingSkeleton />;
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Watchlist</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Gefuehrte Suche mit Live-Preisdaten aus dem Backend
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 p-2 sm:p-4 text-xs sm:text-sm text-destructive">
          {error}
        </div>
      )}

      <ApiWarnings warnings={warnings} />

      <ItemSearch
        onAddToWatchlist={loadWatchlistData}
        existingItems={watchlistItems}
      />

      {watchlistItems.length === 0 ? (
        <Card>
          <CardContent className="p-4 sm:p-8 text-center text-muted-foreground">
            <p className="text-sm">
              Keine Items in der Watchlist. Suche ein Item aus und fuege es per
              Auswahl hinzu.
            </p>
          </CardContent>
        </Card>
      ) : (
         <div className="grid gap-3 sm:gap-4 md:gap-6 grid-cols-1 md:grid-cols-2">
           <div className="space-y-3 sm:space-y-4">
             <Card>
               <CardHeader className="pb-2 sm:pb-4">
                 <CardTitle className="text-base sm:text-lg">Watchlist Items</CardTitle>
               </CardHeader>
               <CardContent>
                 <div className="space-y-2 sm:space-y-3">
                   {watchlistItems.map((item) => (
                     <div
                       key={item.id}
                       ref={(node) => {
                         if (node) {
                           itemRefs.current.set(item.id, node);
                           return;
                         }
                         itemRefs.current.delete(item.id);
                       }}
                       className={`transition-colors ${
                         selectedItem?.id === item.id
                           ? "rounded-lg border-primary bg-primary/10"
                           : ""
                       }`}
                     >
                       <ItemListRow
                         item={item}
                         onClick={() => {
                           setSelectedItem(item);
                           if (window.innerWidth < 768) {
                             setIsModalOpen(true);
                           }
                         }}
                       />
                     </div>
                   ))}
                 </div>
               </CardContent>
             </Card>
           </div>

          <div className="hidden md:block">
            {selectedItem ? (
              <Card>
                <CardHeader className="pb-2 sm:pb-4">
                  <div className="flex items-start justify-between gap-2 sm:gap-3">
                    <div className="flex min-w-0 gap-2 sm:gap-4">
                      <div className="h-14 w-14 sm:h-20 sm:w-20 overflow-hidden rounded-lg border flex-shrink-0">
                        {selectedItem.imageUrl ? (
                          <img
                            src={selectedItem.imageUrl}
                            alt={selectedItem.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                            N/A
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <CardTitle className="text-base sm:text-lg truncate">{selectedItem.name}</CardTitle>
                        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                          Interaktiver Preisverlauf
                        </p>
                        {selectedItem.currentPrice !== null && (
                          <div className="mt-1 sm:mt-2 text-xs sm:text-sm text-muted-foreground">
                            <p>
                              Aktuell: {selectedItem.currentPrice.toFixed(2)} EUR
                            </p>
                            <PriceSourceBadge
                              priceSource={selectedItem.priceSource}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedItem(null)}
                      className="text-muted-foreground hover:text-foreground flex-shrink-0"
                    >
                      <X className="h-4 w-4 sm:h-5 sm:w-5" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent>
                  {selectedItem.priceHistory &&
                  selectedItem.priceHistory.length > 0 ? (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold">Preisentwicklung</h3>
                        <button
                          onClick={() => setShowAbsolute(!showAbsolute)}
                          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showAbsolute ? (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">EUR</span>
                          ) : (
                            <span className="text-muted-foreground/50">EUR</span>
                          )}
                          /
                          {showAbsolute ? (
                            <span className="text-muted-foreground/50">%</span>
                          ) : (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">%</span>
                          )}
                        </button>
                      </div>
                      <PortfolioChart
                        history={selectedItem.priceHistory}
                        color={
                          selectedItem.trend === "down" ? "#ef4444" : "#22c55e"
                        }
                        valueLabel="Preis"
                        title="Preisentwicklung"
                        showAbsolute={showAbsolute}
                      />
                    </div>
                  ) : (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      Keine Preishistorie verfuegbar.
                    </div>
                  )}
                  {selectedItem.changeLabel !== "N/A" && (
                    <div className="mt-4 rounded-lg p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-muted-foreground">
                          Preisveraenderung (7 Tage)
                        </span>
                        <span
                          className={`font-semibold ${
                            selectedItem.trend === "down"
                              ? "text-red-600"
                              : "text-green-600"
                          }`}
                        >
                          {selectedItem.changeLabel}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Delete Section - Desktop */}
                  <div className="mt-6 border-t pt-4">
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

                  <DeleteConfirmModal
                    isOpen={showDeleteConfirm}
                    onClose={handleCancelDelete}
                    onConfirm={handleConfirmDelete}
                    isDeleting={isDeleting}
                    itemName={selectedItem?.name}
                    description="aus deiner Watchlist entfernen"
                  />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <p>Waehle ein Item aus, um den Preisverlauf anzuzeigen.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      <WatchlistItemModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        item={selectedItem}
        onDelete={handleRemoveItem}
      />
    </div>
  );
};
