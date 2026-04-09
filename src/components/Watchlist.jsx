import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ItemSearch } from "./ItemSearch";
import { PortfolioChart } from "./PortfolioChart";
import { ApiWarnings } from "./ApiWarnings";
import { PriceSourceBadge } from "./PriceSourceBadge";
import { Trash2, TrendingDown, TrendingUp, X } from "lucide-react";
import { deleteWatchlistItem, fetchWatchlist } from "@/lib/apiClient.js";

export const Watchlist = ({ focusTarget = null }) => {
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);
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
      await loadWatchlistData();
    } catch (requestError) {
      setError(
        requestError.message || "Fehler beim Entfernen des Watchlist-Items."
      );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">
          Lade Watchlist und gleiche Live-Preise ab...
        </p>
      </div>
    );
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
                  {watchlistItems.map((item) => {
                    const isUp = item.trend === "up";
                    const isDown = item.trend === "down";
                    const Icon = isUp
                      ? TrendingUp
                      : isDown
                        ? TrendingDown
                        : null;
                    const colorClass = isUp
                      ? "text-green-600"
                      : isDown
                        ? "text-red-600"
                        : "text-muted-foreground";

                    return (
                      <div
                        key={item.id}
                        ref={(node) => {
                          if (node) {
                            itemRefs.current.set(item.id, node);
                            return;
                          }

                          itemRefs.current.delete(item.id);
                        }}
                        className={`cursor-pointer rounded-lg border p-2 sm:p-4 transition-colors ${
                          selectedItem?.id === item.id
                            ? "border-primary bg-primary/10"
                            : "hover:bg-muted"
                        }`}
                        onClick={() => setSelectedItem(item)}
                      >
                        <div className="flex items-start justify-between gap-2 sm:gap-3">
                          <div className="flex min-w-0 flex-1 gap-2 sm:gap-3">
                            <div className="h-10 w-10 sm:h-14 sm:w-14 overflow-hidden rounded-md border bg-muted flex-shrink-0">
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
                              <h3 className="text-xs sm:text-sm font-semibold truncate">
                                {item.name}
                              </h3>
                              <div className="mt-1 sm:mt-2 flex items-center gap-1 sm:gap-2">
                                {Icon && (
                                  <Icon className={`h-3 w-3 sm:h-4 sm:w-4 ${colorClass}`} />
                                )}
                                <span className={`text-xs sm:text-sm ${colorClass}`}>
                                  {item.changeLabel}
                                </span>
                              </div>
                              {item.currentPrice !== null && (
                                <div className="mt-1 text-[10px] sm:text-xs text-muted-foreground line-clamp-2">
                                  <p>Aktuell: {item.currentPrice.toFixed(2)} EUR</p>
                                  <PriceSourceBadge
                                    priceSource={item.priceSource}
                                    compact
                                  />
                                </div>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleRemoveItem(item.id);
                            }}
                            className="p-1 text-muted-foreground transition-colors hover:text-destructive flex-shrink-0"
                            title="Aus Watchlist entfernen"
                          >
                            <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            {selectedItem ? (
              <Card>
                <CardHeader className="pb-2 sm:pb-4">
                  <div className="flex items-start justify-between gap-2 sm:gap-3">
                    <div className="flex min-w-0 gap-2 sm:gap-4">
                      <div className="h-14 w-14 sm:h-20 sm:w-20 overflow-hidden rounded-lg border bg-muted flex-shrink-0">
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
                          Preisverlauf der letzten 7 Tage
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
                    <PortfolioChart
                      history={selectedItem.priceHistory}
                      color={
                        selectedItem.trend === "down" ? "#ef4444" : "#22c55e"
                      }
                    />
                  ) : (
                    <div className="flex h-80 items-center justify-center text-muted-foreground">
                      <p>Noch keine Preis-Historie verfuegbar.</p>
                    </div>
                  )}

                  {selectedItem.changeLabel !== "N/A" && (
                    <div className="mt-4 rounded-lg bg-muted p-4">
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
    </div>
  );
};
