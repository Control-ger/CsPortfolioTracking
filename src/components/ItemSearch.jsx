import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { ApiWarnings } from "./ApiWarnings";
import { PriceSourceBadge } from "./PriceSourceBadge";
import {
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Plus,
  Search,
} from "lucide-react";
import { createWatchlistItem, searchWatchlistItems } from "@/lib/apiClient.js";

const ITEM_TYPE_OPTIONS = [
  { value: "all", label: "Alle Typen" },
  { value: "skin", label: "Skin" },
  { value: "case", label: "Case" },
  { value: "souvenir_package", label: "Souvenir Package" },
  { value: "sticker_capsule", label: "Sticker Capsule" },
  { value: "sticker", label: "Sticker" },
  { value: "patch", label: "Patch" },
  { value: "music_kit", label: "Music Kit" },
  { value: "agent", label: "Agent" },
  { value: "key", label: "Key" },
  { value: "terminal", label: "Terminal" },
  { value: "charm", label: "Charm" },
  { value: "graffiti", label: "Graffiti" },
  { value: "tool", label: "Tool" },
  { value: "container", label: "Container" },
  { value: "other", label: "Other" },
];

const WEAR_OPTIONS = [
  { value: "all", label: "Alle Conditions" },
  { value: "factory_new", label: "Factory New" },
  { value: "minimal_wear", label: "Minimal Wear" },
  { value: "field_tested", label: "Field-Tested" },
  { value: "well_worn", label: "Well-Worn" },
  { value: "battle_scarred", label: "Battle-Scarred" },
];

const PAGE_SIZE = 8;
const BROWSABLE_ITEM_TYPES = new Set([
  "skin",
  "case",
  "souvenir_package",
  "sticker_capsule",
  "sticker",
  "patch",
  "music_kit",
  "agent",
  "key",
  "terminal",
  "charm",
  "graffiti",
  "tool",
]);
const SORT_OPTIONS = [
  { value: "relevance", label: "Relevanz" },
  { value: "name_asc", label: "Name A-Z" },
  { value: "name_desc", label: "Name Z-A" },
  { value: "price_asc", label: "Preis aufsteigend" },
  { value: "price_desc", label: "Preis absteigend" },
];

export const ItemSearch = ({ onAddToWatchlist, existingItems = [] }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [itemType, setItemType] = useState("all");
  const [wear, setWear] = useState("all");
  const [sortBy, setSortBy] = useState("relevance");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [browseMode, setBrowseMode] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [submittingItem, setSubmittingItem] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);

  const wearEnabled = itemType === "skin";
  const normalizedTerm = searchTerm.trim();
  const canBrowseWithoutQuery = BROWSABLE_ITEM_TYPES.has(itemType);
  const isBrowseRequest = normalizedTerm.length === 0 && canBrowseWithoutQuery;
  const shouldSearch = normalizedTerm.length >= 2 || isBrowseRequest;

  useEffect(() => {
    setPage(1);
  }, [searchTerm, itemType, wear, sortBy]);

  useEffect(() => {
    const activeWear = wearEnabled ? wear : "all";

    if (!shouldSearch) {
      setResults([]);
      setTotalItems(0);
      setTotalPages(0);
      setBrowseMode(false);
      setIsSearching(false);
      setWarnings([]);
      return undefined;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        setIsSearching(true);
        setError("");

        const response = await searchWatchlistItems(
          normalizedTerm,
          {
            itemType,
            wear: activeWear,
            sortBy,
          },
          PAGE_SIZE,
          page
        );

        if (!cancelled) {
          const data = response?.data;
          setResults(data?.items || []);
          setTotalItems(Number(data?.totalItems || 0));
          setTotalPages(Number(data?.totalPages || 0));
          setBrowseMode(Boolean(data?.browseMode));
          setWarnings(response?.meta?.warnings || []);
          if (typeof data?.page === "number" && data.page !== page) {
            setPage(data.page);
          }
        }
      } catch (requestError) {
        if (!cancelled) {
          setResults([]);
          setTotalItems(0);
          setTotalPages(0);
          setBrowseMode(false);
          setWarnings([]);
          setError(requestError.message || "Fehler bei der Item-Suche.");
        }
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [itemType, normalizedTerm, page, shouldSearch, sortBy, wear, wearEnabled]);

  const isAlreadyInWatchlist = (itemName) =>
    existingItems.some((item) => item.name === itemName);

  const handleTypeChange = (nextType) => {
    setItemType(nextType);

    if (nextType !== "skin") {
      setWear("all");
    }
  };

  const handleAddItem = async (candidate) => {
    const marketHashName = candidate.marketHashName?.trim();

    if (!marketHashName) {
      setError("Das ausgewaehlte Item ist ungueltig.");
      return;
    }

    if (isAlreadyInWatchlist(marketHashName)) {
      setError("Dieses Item ist bereits in der Watchlist.");
      return;
    }

    try {
      setSubmittingItem(marketHashName);
      setError("");
      await createWatchlistItem(marketHashName, candidate.itemType || "other");
      setSearchTerm("");
      setResults([]);
      setTotalItems(0);
      setTotalPages(0);
      setBrowseMode(false);
      setPage(1);
      setWarnings([]);

      if (onAddToWatchlist) {
        await onAddToWatchlist();
      }
    } catch (requestError) {
      setError(
        requestError.message || "Fehler beim Hinzufuegen zur Watchlist."
      );
    } finally {
      setSubmittingItem("");
    }
  };

  const renderPagination = () => {
    if (totalPages === 0) {
      return null;
    }

    const paginationItems = [];

    for (let nextPage = 1; nextPage <= totalPages; nextPage += 1) {
      const isBoundaryPage = nextPage === 1 || nextPage === totalPages;
      const isNearbyPage = Math.abs(nextPage - page) <= 1;

      if (isBoundaryPage || isNearbyPage) {
        paginationItems.push(nextPage);
        continue;
      }

      if (paginationItems[paginationItems.length - 1] !== "...") {
        paginationItems.push("...");
      }
    }

    return (
      <div className="flex flex-col gap-2 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-muted-foreground">
          {totalItems} Treffer | Seite {page} von {totalPages}
          {browseMode ? " | Browse-Modus" : ""}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPage(1)}
            disabled={page === 1 || isSearching}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Erste Seite"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              setPage((currentPage) => Math.max(1, currentPage - 1))
            }
            disabled={page === 1 || isSearching}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Vorherige Seite"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1 overflow-x-auto">
            {paginationItems.map((paginationItem, index) =>
              paginationItem === "..." ? (
                <span
                  key={`ellipsis-${index}`}
                  className="inline-flex h-8 min-w-8 items-center justify-center px-1 text-xs text-muted-foreground"
                >
                  ...
                </span>
              ) : (
                <button
                  type="button"
                  key={paginationItem}
                  onClick={() => setPage(paginationItem)}
                  disabled={isSearching || paginationItem === page}
                  className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    paginationItem === page
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  {paginationItem}
                </button>
              )
            )}
          </div>
          <button
            type="button"
            onClick={() =>
              setPage((currentPage) => Math.min(totalPages, currentPage + 1))
            }
            disabled={page >= totalPages || isSearching}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Naechste Seite"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setPage(totalPages)}
            disabled={page >= totalPages || isSearching}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Letzte Seite"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };

  const renderState = () => {
    if (!shouldSearch) {
      return (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Suche nach mindestens 2 Zeichen oder waehle einen browsebaren
          Item-Typ wie Case, Sticker oder Agent.
        </div>
      );
    }

    if (isSearching) {
      return (
        <div className="space-y-2.5 rounded-lg border p-3">
          {[1, 2, 3].map((entry) => (
            <div key={entry} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
              <Skeleton className="h-12 w-12 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <div className="flex flex-wrap gap-1.5">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                </div>
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-9 w-24 rounded-lg" />
            </div>
          ))}
        </div>
      );
    }

    if (results.length === 0) {
      return (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Keine passenden Items fuer die aktuelle Such- und Filterkombination
          gefunden.
        </div>
      );
    }

    return (
      <div className="space-y-2.5">
        {results.map((candidate) => {
          const alreadyAdded = isAlreadyInWatchlist(candidate.marketHashName);
          const isSubmitting = submittingItem === candidate.marketHashName;

          return (
            <div
              key={candidate.marketHashName}
              className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
            >
              <div className="h-12 w-12 overflow-hidden rounded-md bg-muted">
                {candidate.iconUrl ? (
                  <img
                    src={candidate.iconUrl}
                    alt={candidate.displayName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    N/A
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{candidate.displayName}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {candidate.itemTypeLabel}
                  </span>
                  {candidate.wearLabel && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {candidate.wearLabel}
                    </span>
                  )}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {candidate.marketTypeLabel}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-primary">
                    {candidate.livePriceEur.toFixed(2)} EUR
                  </p>
                  <PriceSourceBadge
                    priceSource={candidate.priceSource}
                    compact
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleAddItem(candidate)}
                disabled={alreadyAdded || isSubmitting || submittingItem !== ""}
                className="inline-flex min-w-24 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Speichert...
                  </>
                ) : alreadyAdded ? (
                  "Bereits drin"
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Hinzufuegen
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Search className="h-4 w-4" />
          Search-to-Add
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Zum Beispiel: Kilowatt Case, AK-47 Redline oder Music Kit"
            className="h-10 w-full rounded-lg border bg-background py-2 pl-10 pr-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            disabled={submittingItem !== ""}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-2 text-sm">
            <span className="font-medium">Item Type</span>
            <select
              value={itemType}
              onChange={(event) => handleTypeChange(event.target.value)}
              className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={submittingItem !== ""}
            >
              {ITEM_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm">
            <span className="font-medium">Wear / Condition</span>
            <select
              value={wear}
              onChange={(event) => setWear(event.target.value)}
              className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!wearEnabled || submittingItem !== ""}
            >
              {WEAR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {!wearEnabled && (
              <p className="text-xs text-muted-foreground">
                Der Wear-Filter ist nur fuer den Item-Typ Skin aktiv.
              </p>
            )}
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium">Sortierung</span>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={submittingItem !== ""}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <ApiWarnings warnings={warnings} />

        {renderState()}
        {renderPagination()}
      </CardContent>
    </Card>
  );
};
