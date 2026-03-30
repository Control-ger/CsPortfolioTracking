import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ItemSearch } from "./ItemSearch";
import { PortfolioChart } from "./PortfolioChart";
import { TrendingUp, TrendingDown, Trash2, X } from "lucide-react";
import { deleteWatchlistItem, fetchWatchlist } from "@/lib/apiClient.js";

export const Watchlist = () => {
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);
  const [error, setError] = useState("");

  // Watchlist-Daten laden
  const loadWatchlistData = async () => {
    try {
      setLoading(true);
      setError("");

      const data = await fetchWatchlist();
      setWatchlistItems(data || []);
    } catch (err) {
      setError(err.message || "Fehler beim Laden der Watchlist");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWatchlistData();
  }, []);

  // Item aus Watchlist entfernen
  const handleRemoveItem = async (id) => {
    try {
      await deleteWatchlistItem(id);
      loadWatchlistData();
      if (selectedItem && selectedItem.id === id) {
        setSelectedItem(null);
      }
    } catch (err) {
      setError(err.message || "Fehler beim Entfernen des Items");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lade Watchlist...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Watchlist</h2>
          <p className="text-muted-foreground">
            Verfolge Preise von CS2 Items über die Zeit
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive p-4 rounded-lg">
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
            <p>Keine Items in der Watchlist. Füge Items hinzu, um ihre Preise zu verfolgen.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Watchlist-Übersicht */}
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
                    const Icon = isUp ? TrendingUp : isDown ? TrendingDown : null;
                    const colorClass = isUp
                      ? "text-green-600"
                      : isDown
                        ? "text-red-600"
                        : "text-muted-foreground";

                    return (
                      <div
                        key={item.id}
                        className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                          selectedItem?.id === item.id
                            ? "bg-primary/10 border-primary"
                            : "hover:bg-muted"
                        }`}
                        onClick={() => setSelectedItem(item)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="font-semibold text-sm">{item.name}</h3>
                            <div className="mt-2 flex items-center gap-2">
                              {Icon && <Icon className={`h-4 w-4 ${colorClass}`} />}
                              <span className={`text-sm ${colorClass}`}>
                                {item.changeLabel}
                              </span>
                            </div>
                            {item.currentPrice !== null && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Aktuell: {item.currentPrice.toFixed(2)}€
                              </p>
                            )}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveItem(item.id);
                            }}
                            className="ml-2 p-1 text-muted-foreground hover:text-destructive transition-colors"
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

          {/* Detail-Ansicht mit Chart */}
          <div>
            {selectedItem ? (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle>{selectedItem.name}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        Preisverlauf der letzten 7 Tage
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedItem(null)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent>
                  {selectedItem.priceHistory && selectedItem.priceHistory.length > 0 ? (
                    <PortfolioChart
                      history={selectedItem.priceHistory}
                      color={selectedItem.trend === "down" ? "#ef4444" : "#22c55e"}
                    />
                  ) : (
                    <div className="h-80 flex items-center justify-center text-muted-foreground">
                      <p>Noch keine Preis-Historie verfügbar</p>
                    </div>
                  )}
                  {selectedItem.changeLabel !== "N/A" && (
                    <div className="mt-4 p-4 bg-muted rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Preisänderung (7 Tage)
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
                  <p>Wähle ein Item aus, um den Preisverlauf anzuzeigen</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
