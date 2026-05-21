import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Search } from "lucide-react";

import { Badge, Button, ItemSearch } from "@shared/components";
import { fetchWatchlistData } from "@shared/lib/dataSource.js";

export default function ItemBrowserPage() {
  const [searchParams] = useSearchParams();
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [loadingWatchlist, setLoadingWatchlist] = useState(false);
  const [watchlistError, setWatchlistError] = useState("");
  const [searchWarnings, setSearchWarnings] = useState([]);
  const initialQuery = useMemo(() => String(searchParams.get("q") || "").trim(), [searchParams]);

  const loadWatchlist = useCallback(async () => {
    try {
      setLoadingWatchlist(true);
      setWatchlistError("");
      const response = await fetchWatchlistData({ syncLive: false });
      setWatchlistItems(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      setWatchlistItems([]);
      setWatchlistError(error?.message || "Watchlist konnte nicht geladen werden.");
    } finally {
      setLoadingWatchlist(false);
    }
  }, []);

  useEffect(() => {
    void loadWatchlist();
  }, [loadWatchlist]);

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-4 px-3.5 pb-28 pt-4 sm:px-6 sm:pb-8 lg:px-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Zurueck
            </Link>
          </Button>
          {initialQuery ? (
            <Badge variant="secondary" className="text-xs">
              Suche: "{initialQuery}"
            </Badge>
          ) : null}
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Alle Produkte</h1>
          <p className="text-sm text-muted-foreground">
            Suche, filtere und browse neue Items fuer deine Watchlist.
          </p>
        </div>
      </header>

      {watchlistError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {watchlistError}
        </div>
      ) : null}

      {searchWarnings?.length > 0 ? (
        <div className="rounded-lg border border-amber-400/35 bg-amber-500/12 p-3 text-xs text-amber-300">
          <p className="mb-1 font-semibold">Hinweise zur Suche</p>
          <ul className="space-y-1">
            {searchWarnings.slice(0, 3).map((warning, index) => (
              <li key={`${warning?.code || "warning"}-${index}`}>
                {warning?.message || warning?.label || "Unbekannter Hinweis"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-lg border border-border/70 bg-background/35 p-3 sm:p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Search className="h-4 w-4" />
          Produktsuche
          <span className="text-xs font-normal text-muted-foreground">
            ({loadingWatchlist ? "Lade Watchlist..." : `${watchlistItems.length} bekannte Watchlist-Items`})
          </span>
        </div>
        <ItemSearch
          onAddToWatchlist={loadWatchlist}
          existingItems={watchlistItems}
          onWarningsChange={setSearchWarnings}
          initialSearchTerm={initialQuery}
          autoFocus={true}
        />
      </div>
    </div>
  );
}
