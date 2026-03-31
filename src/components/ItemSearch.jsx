import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { LoaderCircle, Plus, Search } from "lucide-react";
import {
  createWatchlistItem,
  searchWatchlistItems,
} from "@/lib/apiClient.js";

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

export const ItemSearch = ({ onAddToWatchlist, existingItems = [] }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [itemType, setItemType] = useState("all");
  const [wear, setWear] = useState("all");
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [submittingItem, setSubmittingItem] = useState("");
  const [error, setError] = useState("");

  const wearEnabled = itemType === "skin";

  useEffect(() => {
    const normalizedTerm = searchTerm.trim();
    const activeWear = wearEnabled ? wear : "all";

    if (normalizedTerm.length < 2) {
      setResults([]);
      setIsSearching(false);
      return undefined;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        setIsSearching(true);
        setError("");

        const data = await searchWatchlistItems(
          normalizedTerm,
          {
            itemType,
            wear: activeWear,
          },
          8
        );

        if (!cancelled) {
          setResults(data || []);
        }
      } catch (requestError) {
        if (!cancelled) {
          setResults([]);
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
  }, [itemType, searchTerm, wear, wearEnabled]);

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

  const renderState = () => {
    const normalizedTerm = searchTerm.trim();

    if (normalizedTerm.length < 2) {
      return (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Suche nach mindestens 2 Zeichen. Alle CS-Item-Typen werden unterstuetzt
          und mit Live-Preisen von CSFloat validiert.
        </div>
      );
    }

    if (isSearching) {
      return (
        <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Suche passende Items und gleiche Live-Preise ab...
        </div>
      );
    }

    if (results.length === 0) {
      return (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Keine passenden Items fuer die aktuelle Such- und Filterkombination gefunden.
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {results.map((candidate) => {
          const alreadyAdded = isAlreadyInWatchlist(candidate.marketHashName);
          const isSubmitting = submittingItem === candidate.marketHashName;

          return (
            <div
              key={candidate.marketHashName}
              className="flex items-center gap-4 rounded-lg border p-4"
            >
              <div className="h-14 w-14 overflow-hidden rounded-md bg-muted">
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
                <p className="truncate font-medium">{candidate.displayName}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                    {candidate.itemTypeLabel}
                  </span>
                  {candidate.wearLabel && (
                    <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                      {candidate.wearLabel}
                    </span>
                  )}
                  <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                    {candidate.marketTypeLabel}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold text-primary">
                  {candidate.livePriceEur.toFixed(2)} EUR
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleAddItem(candidate)}
                disabled={alreadyAdded || isSubmitting || submittingItem !== ""}
                className="inline-flex min-w-28 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Search-to-Add
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Zum Beispiel: Kilowatt Case, AK-47 Redline oder Music Kit"
            className="w-full rounded-lg border bg-background py-2 pl-10 pr-4 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            disabled={submittingItem !== ""}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span className="font-medium">Item Type</span>
            <select
              value={itemType}
              onChange={(event) => handleTypeChange(event.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
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
              className="w-full rounded-lg border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
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
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {renderState()}
      </CardContent>
    </Card>
  );
};
