import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { ApiWarnings } from "./ApiWarnings";
import { PriceSourceBadge } from "./PriceSourceBadge";
import { ArrowRight, Eye, TrendingDown, TrendingUp } from "lucide-react";
import { fetchWatchlist } from "@/lib/apiClient.js";

export const WatchlistOverview = ({ maxItems = 5, onOpenItem }) => {
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [warnings, setWarnings] = useState([]);

  useEffect(() => {
    const loadWatchlistData = async () => {
      try {
        setLoading(true);
        const response = await fetchWatchlist();
        setWatchlistItems((response?.data || []).slice(0, maxItems));
        setWarnings(response?.meta?.warnings || []);
      } catch (err) {
        console.error("Fehler beim Laden der Watchlist:", err);
        setWarnings([]);
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
        <CardContent className="space-y-3">
          {[1, 2, 3].map((entry) => (
            <div key={entry} className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-md" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <div className="ml-4 flex items-center gap-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-4 rounded-full" />
              </div>
            </div>
          ))}
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
        <ApiWarnings warnings={warnings} className="mb-3" />
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
              <button
                type="button"
                key={item.id}
                onClick={() => onOpenItem?.(item)}
                className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors hover:bg-muted"
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
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <p>{item.currentPrice.toFixed(2)} EUR</p>
                        <PriceSourceBadge
                          priceSource={item.priceSource}
                          compact
                        />
                      </div>
                    )}
                  </div>
                </div>
                <div className="ml-4 flex items-center gap-2">
                  {Icon && <Icon className={`h-4 w-4 ${colorClass}`} />}
                  <span className={`text-sm font-semibold ${colorClass}`}>
                    {item.changeLabel}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
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
