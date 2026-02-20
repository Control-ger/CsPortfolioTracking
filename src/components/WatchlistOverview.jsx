import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { TrendingUp, TrendingDown, Eye } from "lucide-react";

export const WatchlistOverview = ({ maxItems = 5 }) => {
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadWatchlistData = async () => {
      try {
        setLoading(true);
        
        // Tabellen initialisieren
        await fetch("http://localhost/cs-api/initWatchlistTables.php");
        
        // Watchlist-Daten abrufen
        const response = await fetch("http://localhost/cs-api/get_watchlist_data.php");
        
        if (response.ok) {
          const data = await response.json();
          setWatchlistItems((data || []).slice(0, maxItems));
        }
      } catch (err) {
        console.error("Fehler beim Laden der Watchlist:", err);
      } finally {
        setLoading(false);
      }
    };

    loadWatchlistData();
  }, [maxItems]);

  const formatPriceChange = (change, percent) => {
    if (change === null || percent === null) {
      return { text: "N/A", color: "text-muted-foreground", icon: null };
    }

    const isPositive = change >= 0;
    const sign = isPositive ? "+" : "";
    const color = isPositive ? "text-green-600" : "text-red-600";
    const Icon = isPositive ? TrendingUp : TrendingDown;

    return {
      text: `${sign}${percent.toFixed(2)}%`,
      color,
      icon: Icon,
    };
  };

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
            const priceInfo = formatPriceChange(
              item.price_change,
              item.price_change_percent
            );
            const Icon = priceInfo.icon;

            return (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-sm truncate">{item.name}</h4>
                  {item.current_price !== null && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {item.current_price.toFixed(2)}€
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {Icon && <Icon className={`h-4 w-4 ${priceInfo.color}`} />}
                  <span className={`text-sm font-semibold ${priceInfo.color}`}>
                    {priceInfo.text}
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
