import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ItemSearch } from "./ItemSearch";
import { PortfolioChart } from "./PortfolioChart";
import { Trash2, TrendingDown, TrendingUp, X } from "lucide-react";
import { deleteWatchlistItem, fetchWatchlist } from "@/lib/apiClient.js";

export const Watchlist = () => {
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);
  const [error, setError] = useState("");

  const loadWatchlistData = async () => {
    try {
      setLoading(true);
      setError("");

      const data = await fetchWatchlist({ syncLive: true });
      const nextItems = data || [];

      setWatchlistItems(nextItems);
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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWatchlistData();
  }, []);

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Watchlist</h2>
          <p className="text-muted-foreground">
            Gefuehrte Suche mit Live-Preisdaten aus dem Backend
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      <ItemSearch
        onAddToWatchlist={loadWatchlistData}
        existingItems={watchlistItems}
      />

      {watchlistItems.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <p>
              Keine Items in der Watchlist. Suche ein Item aus und fuege es per
              Auswahl hinzu.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Watchlist Items</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
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
                        className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                          selectedItem?.id === item.id
                            ? "border-primary bg-primary/10"
                            : "hover:bg-muted"
                        }`}
                        onClick={() => setSelectedItem(item)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-1 gap-3">
                            <div className="h-14 w-14 overflow-hidden rounded-md border bg-muted">
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
                              <h3 className="text-sm font-semibold">
                                {item.name}
                              </h3>
                              <div className="mt-2 flex items-center gap-2">
                                {Icon && (
                                  <Icon className={`h-4 w-4 ${colorClass}`} />
                                )}
                                <span className={`text-sm ${colorClass}`}>
                                  {item.changeLabel}
                                </span>
                              </div>
                              {item.currentPrice !== null && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Aktuell: {item.currentPrice.toFixed(2)} EUR
                                </p>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleRemoveItem(item.id);
                            }}
                            className="p-1 text-muted-foreground transition-colors hover:text-destructive"
                            title="Aus Watchlist entfernen"
                          >
                            <Trash2 className="h-4 w-4" />
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
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-4">
                      <div className="h-20 w-20 overflow-hidden rounded-lg border bg-muted">
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
                      <div>
                        <CardTitle>{selectedItem.name}</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Preisverlauf der letzten 7 Tage
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedItem(null)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-5 w-5" />
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
