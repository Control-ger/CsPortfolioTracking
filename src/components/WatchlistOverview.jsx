import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { TrendingUp, TrendingDown, Eye } from "lucide-react";
import { fetchWatchlist } from "@/lib/apiClient.js";

export const WatchlistOverview = ({ maxItems = 5 }) => {
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadWatchlistData = async () => {
      try {
        setLoading(true);
        const data = await fetchWatchlist();
        setWatchlistItems((data || []).slice(0, maxItems));
      } catch (err) {
        console.error("Fehler beim Laden der Watchlist:", err);
      } finally {
        setLoading(false);
      }
    };

    loadWatchlistData();
  }, [maxItems]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Watchlist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Lade Watchlist...</p>
        </CardContent>
      </Card>
    );
  }

  if (watchlistItems.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Watchlist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Noch keine Items in der Watchlist
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5" />
          Watchlist ({watchlistItems.length})
        </CardTitle>
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
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-sm truncate">{item.name}</h4>
                  {item.currentPrice !== null && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {item.currentPrice.toFixed(2)}€
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {Icon && <Icon className={`h-4 w-4 ${colorClass}`} />}
                  <span className={`text-sm font-semibold ${colorClass}`}>
                    {item.changeLabel}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {watchlistItems.length >= maxItems && (
          <p className="text-xs text-muted-foreground mt-3 text-center">
            Zeige {maxItems} von {watchlistItems.length} Items
          </p>
        )}
      </CardContent>
    </Card>
  );
};
