import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { ApiWarnings } from "./ApiWarnings";
import { ItemListRow } from "./ItemListRow";
import { ChevronDown, ChevronUp, Eye } from "lucide-react";
import { fetchWatchlist } from "@/lib/apiClient.js";

export const WatchlistOverview = ({ maxItems = 5, onOpenItem }) => {
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [allWatchlistItems, setAllWatchlistItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [warnings, setWarnings] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const loadWatchlistData = async () => {
      try {
        setLoading(true);
        const response = await fetchWatchlist();
        const items = response?.data || [];
        setAllWatchlistItems(items);
        setWatchlistItems(items.slice(0, maxItems));
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

  // Bestimme welche Items angezeigt werden
  const displayedItems = isExpanded ? allWatchlistItems : watchlistItems;
  const hasMoreItems = allWatchlistItems.length > maxItems;

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
            <div key={entry} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-md flex-shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <Skeleton className="h-4 w-16 flex-shrink-0" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (allWatchlistItems.length === 0) {
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
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex w-full items-center justify-between rounded-lg p-0 transition-colors hover:bg-muted/30"
          aria-expanded={isExpanded}
        >
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Watchlist ({allWatchlistItems.length})
          </CardTitle>
          {hasMoreItems && (
            isExpanded ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )
          )}
        </button>
      </CardHeader>
      <CardContent>
        <ApiWarnings warnings={warnings} className="mb-3" />
        <div className="space-y-3">
          {displayedItems.map((item) => (
            <ItemListRow
              key={item.id}
              item={item}
              onClick={() => onOpenItem?.(item)}
            />
          ))}
        </div>
        {hasMoreItems && !isExpanded && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {allWatchlistItems.length - maxItems} weitere Items • Klick zum Ausklappen
          </p>
        )}
      </CardContent>
    </Card>
  );
};
