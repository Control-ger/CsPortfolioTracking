import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { ApiWarnings } from "./ApiWarnings";
import { ItemListRow } from "./ItemListRow";
import { ChevronDown, ChevronUp, Eye, TrendingUp, TrendingDown } from "lucide-react";
import { fetchWatchlistData } from "@/lib/dataSource.js";
import { cn } from "@/lib/utils";
import { UI } from "@/lib/constants";

// Hilfsfunktion: Berechne Top Mover (2 Gewinner, 2 Verlierer)
const calculateTopMovers = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return { gainers: [], losers: [], others: [] };
  }

  // Sortiere nach priceChangePercent (absteigend)
  const sorted = [...items].sort((a, b) => {
    const aValue = a.priceChangePercent ?? -Infinity;
    const bValue = b.priceChangePercent ?? -Infinity;
    return bValue - aValue;
  });

  // Gewinner: positive Werte, Verlierer: negative Werte
  const gainers = sorted.filter((item) => (item.priceChangePercent ?? 0) > 0);
  const losers = sorted.filter((item) => (item.priceChangePercent ?? 0) < 0).reverse(); // niedrigste zuerst

  // Top 2 Gewinner und Top 2 Verlierer
  const topGainers = gainers.slice(0, 2);
  const topLosers = losers.slice(0, 2);

  // Restliche Items (die nicht in Top 2 sind)
  const topMoverIds = new Set([...topGainers, ...topLosers].map((i) => i.id));
  const others = items.filter((item) => !topMoverIds.has(item.id));

  return { gainers: topGainers, losers: topLosers, others };
};

// Spezielle ItemRow für Top Mover mit Highlighting
const TopMoverItemRow = ({ item, rank, type, onClick }) => {
  const isGainer = type === "gainer";
  const rankColors = isGainer
    ? ["bg-green-500/20 text-green-700 border-green-500/30", "bg-green-500/15 text-green-700 border-green-500/25"]
    : ["bg-red-500/20 text-red-700 border-red-500/30", "bg-red-500/15 text-red-700 border-red-500/25"];

  const rankColor = rankColors[rank - 1] || rankColors[1];
  const Icon = isGainer ? TrendingUp : TrendingDown;
  const derivedPercent = item.priceChangePercent ?? 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-3 p-3 text-left transition-all sm:rounded-lg border-2",
        isGainer ? "border-green-500/30 bg-green-500/5 hover:bg-green-500/10" : "border-red-500/30 bg-red-500/5 hover:bg-red-500/10"
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-md border">
          {item.imageUrl ? (
            <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">N/A</div>
          )}
          <div className={cn("absolute -bottom-1 -right-1 h-5 w-5 rounded-full border flex items-center justify-center text-[10px] font-bold", rankColor)}>
            #{rank}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-medium">{item.name}</h4>
          {item.currentPrice !== null && item.currentPrice !== undefined && (
            <p className="truncate text-xs text-muted-foreground">{item.currentPrice.toFixed(2)} EUR</p>
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        <div className="flex flex-col items-end gap-0.5">
          <Icon className={cn("h-4 w-4", isGainer ? "text-green-600" : "text-red-600")} />
          <span className={cn("text-xs font-semibold", isGainer ? "text-green-600" : "text-red-600")}>
            {derivedPercent >= 0 ? "+" : ""}{derivedPercent.toFixed(2)}%
          </span>
        </div>
      </div>
    </button>
  );
};

export const WatchlistOverview = ({ maxItems = UI.MAX_WATCHLIST_ITEMS, onOpenItem }) => {
  const [allWatchlistItems, setAllWatchlistItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [warnings, setWarnings] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const loadWatchlistData = async () => {
      try {
        setLoading(true);
        const response = await fetchWatchlistData();
        const items = response?.data || [];
        setAllWatchlistItems(items);
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

  // Berechne Top Mover
  const { gainers, losers, others } = calculateTopMovers(allWatchlistItems);
  const hasTopMovers = gainers.length > 0 || losers.length > 0;

  // Bestimme welche Items angezeigt werden (für nicht-expandierte Ansicht)
  const remainingSlots = Math.max(0, maxItems - (gainers.length + losers.length));
  const collapsedOthersCount = others.length > 0 ? Math.max(1, remainingSlots) : 0;
  const displayedOthers = isExpanded ? others : others.slice(0, collapsedOthersCount);
  const hasMoreOthers = others.length > displayedOthers.length;

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
          {hasMoreOthers && (
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
        <div className="space-y-4">
          {/* Top Gewinner Sektion */}
          {gainers.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-green-600">
                <TrendingUp className="h-4 w-4" />
                <h3 className="text-xs font-semibold uppercase tracking-wide">Top Gewinner (7 Tage)</h3>
              </div>
              <div className="space-y-2">
                {gainers.map((item, index) => (
                  <TopMoverItemRow
                    key={item.id}
                    item={item}
                    rank={index + 1}
                    type="gainer"
                    onClick={() => onOpenItem?.(item)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Top Verlierer Sektion */}
          {losers.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-red-600">
                <TrendingDown className="h-4 w-4" />
                <h3 className="text-xs font-semibold uppercase tracking-wide">Top Verlierer (7 Tage)</h3>
              </div>
              <div className="space-y-2">
                {losers.map((item, index) => (
                  <TopMoverItemRow
                    key={item.id}
                    item={item}
                    rank={index + 1}
                    type="loser"
                    onClick={() => onOpenItem?.(item)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Trennlinie wenn Top Mover existieren */}
          {hasTopMovers && displayedOthers.length > 0 && (
            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-muted" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-card px-2 text-[10px] uppercase text-muted-foreground">Weitere Items</span>
              </div>
            </div>
          )}

          {/* Restliche Items */}
          {displayedOthers.length > 0 && (
            <div className="space-y-2">
              {displayedOthers.map((item) => (
                <ItemListRow
                  key={item.id}
                  item={item}
                  onClick={() => onOpenItem?.(item)}
                />
              ))}
            </div>
          )}
        </div>

        {hasMoreOthers && !isExpanded && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {others.length - displayedOthers.length} weitere Items • Klick zum Ausklappen
          </p>
        )}
      </CardContent>
    </Card>
  );
};
