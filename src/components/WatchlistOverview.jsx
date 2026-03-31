import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Eye, TrendingDown, TrendingUp } from "lucide-react";
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
                className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="h-12 w-12 overflow-hidden rounded-md border bg-muted">
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
                    {item.currentPrice !== null && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.currentPrice.toFixed(2)} EUR
                      </p>
                    )}
                  </div>
                </div>
                <div className="ml-4 flex items-center gap-2">
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
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Zeige {maxItems} von {watchlistItems.length} Items
          </p>
        )}
      </CardContent>
    </Card>
  );
};
