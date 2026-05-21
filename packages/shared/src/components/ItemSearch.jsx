import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import {
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  Compass,
  X,
  LoaderCircle,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { searchWatchlistItems } from "@shared/lib/apiClient.js";
import { createWatchlistItemData, createWatchlistItemsBatchData } from "@shared/lib/dataSource.js";

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

const SEARCH_ALIASES = [
  { pattern: /[()[\]{}]/g, replacement: " " },
  { pattern: /\bcases\b/gi, replacement: "case" },
  { pattern: /\bstickers\b/gi, replacement: "sticker" },
  { pattern: /\bcapsules\b/gi, replacement: "capsule" },
  { pattern: /\bmusic kits\b/gi, replacement: "music kit" },
  { pattern: /\bsouvenir packages\b/gi, replacement: "souvenir package" },
  { pattern: /\bhandschuhe\b/gi, replacement: "gloves" },
  { pattern: /\bhandschuh\b/gi, replacement: "glove" },
  { pattern: /\bgloves\b/gi, replacement: "glove" },
];

const BROWSE_KEYWORD_MAP = {
  case: "case",
  cases: "case",
  sticker: "sticker",
  stickers: "sticker",
  capsule: "sticker_capsule",
  capsules: "sticker_capsule",
  patch: "patch",
  patches: "patch",
  "music kit": "music_kit",
  "music kits": "music_kit",
  agent: "agent",
  agents: "agent",
  key: "key",
  keys: "key",
  charm: "charm",
  charms: "charm",
  graffiti: "graffiti",
  glove: "skin",
  gloves: "skin",
  handschuh: "skin",
  handschuhe: "skin",
};

const QUICK_BROWSE_CHIPS = [
  { label: "Cases", type: "case" },
  { label: "Sticker", type: "sticker" },
  { label: "Capsules", type: "sticker_capsule" },
  { label: "Patches", type: "patch" },
  { label: "Music Kits", type: "music_kit" },
  { label: "Agents", type: "agent" },
  { label: "Charms", type: "charm" },
];

function normalizeSearchTerm(term) {
  const trimmed = term.trim().replace(/\s+/g, " ");
  if (trimmed === "") {
    return "";
  }

  return SEARCH_ALIASES.reduce(
    (current, alias) => current.replace(alias.pattern, alias.replacement),
    trimmed,
  );
}

function resolveKeywordBrowseType(term) {
  const normalized = term.trim().toLowerCase();
  return BROWSE_KEYWORD_MAP[normalized] || null;
}

export const ItemSearch = ({ onAddToWatchlist, existingItems = [], onWarningsChange }) => {
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
  const [isBatchSubmitting, setIsBatchSubmitting] = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);
  const [showFiltersOnMobile, setShowFiltersOnMobile] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);
  const wearEnabled = itemType === "skin";
  const normalizedTerm = normalizeSearchTerm(searchTerm);
  const keywordBrowseType = itemType === "all" ? resolveKeywordBrowseType(normalizedTerm) : null;
  const effectiveItemType = keywordBrowseType || itemType;
  const effectiveTerm = keywordBrowseType ? "" : normalizedTerm;
  const canBrowseWithoutQuery = BROWSABLE_ITEM_TYPES.has(effectiveItemType);
  const isBrowseRequest = effectiveTerm.length === 0 && canBrowseWithoutQuery;
  const shouldSearch = effectiveTerm.length >= 2 || isBrowseRequest;
  const hasMorePages = page < totalPages;
  const existingItemNames = useMemo(
    () => new Set(existingItems.map((item) => item.name)),
    [existingItems],
  );
  const isAlreadyInWatchlist = (itemName) => existingItemNames.has(itemName);
  const selectableResults = useMemo(
    () => results.filter((candidate) => !existingItemNames.has(candidate.marketHashName)),
    [results, existingItemNames],
  );

  useEffect(() => {
    setPage(1);
  }, [searchTerm, itemType, wear, sortBy]);

  useEffect(() => {
    const selectableNames = new Set(selectableResults.map((entry) => entry.marketHashName));
    setSelectedItems((current) => current.filter((name) => selectableNames.has(name)));
  }, [selectableResults]);

  useEffect(() => {
    const activeWear = effectiveItemType === "skin" ? wear : "all";

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
          effectiveTerm,
          {
            itemType: effectiveItemType,
            wear: activeWear,
            sortBy,
          },
          PAGE_SIZE,
          page
        );

        if (!cancelled) {
          const data = response?.data;
          const nextItems = data?.items || [];
          setResults((currentItems) => {
            if (page <= 1) {
              return nextItems;
            }

            const existingNames = new Set(currentItems.map((entry) => entry.marketHashName));
            const merged = [...currentItems];
            nextItems.forEach((entry) => {
              if (!existingNames.has(entry.marketHashName)) {
                merged.push(entry);
              }
            });
            return merged;
          });
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
  }, [effectiveItemType, effectiveTerm, page, shouldSearch, sortBy, wear]);

  useEffect(() => {
    onWarningsChange?.(warnings);
  }, [onWarningsChange, warnings]);

  useEffect(() => () => {
    onWarningsChange?.([]);
  }, [onWarningsChange]);

  const handleTypeChange = (nextType) => {
    setItemType(nextType);

    if (nextType !== "skin") {
      setWear("all");
    }
  };

  const handleQuickBrowse = (nextType) => {
    setSearchTerm("");
    setSortBy("relevance");
    handleTypeChange(nextType);
    setPage(1);
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
      await createWatchlistItemData(marketHashName, candidate.itemType || "other");
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

  const addToSelection = (marketHashName) => {
    setSelectedItems((current) =>
      current.includes(marketHashName) ? current : [...current, marketHashName],
    );
  };

  const removeFromSelection = (marketHashName) => {
    setSelectedItems((current) => current.filter((name) => name !== marketHashName));
  };

  const handleBatchAdd = async () => {
    const toAdd = results.filter((candidate) => selectedItems.includes(candidate.marketHashName));
    if (toAdd.length === 0) {
      return;
    }

    try {
      setIsBatchSubmitting(true);
      setError("");
      await createWatchlistItemsBatchData(
        toAdd.map((candidate) => ({
          marketHashName: candidate.marketHashName,
          itemType: candidate.itemType || "other",
          iconUrl: candidate.iconUrl || null,
        })),
      );

      setSelectedItems([]);
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
      setError(requestError.message || "Fehler beim Batch-Hinzufuegen zur Watchlist.");
    } finally {
      setIsBatchSubmitting(false);
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
      <div className="space-y-2 rounded-xl border border-border/70 bg-card/65 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {results.length} / {totalItems} Treffer angezeigt | Seite {page} von {totalPages}
            {browseMode ? " | Browse-Modus" : ""}
          </span>
          {hasMorePages && (
            <button
              type="button"
              onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
              disabled={isSearching}
              className="inline-flex items-center gap-1 rounded-lg border border-border/75 px-2 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSearching ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Mehr laden
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setPage(1)}
            disabled={page === 1 || isSearching}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/75 transition-colors hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-50"
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/75 transition-colors hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-50"
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
                      : "hover:bg-muted/70"
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/75 transition-colors hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Naechste Seite"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setPage(totalPages)}
            disabled={page >= totalPages || isSearching}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/75 transition-colors hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-50"
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
        <div className="rounded-xl border border-dashed border-border/70 bg-card/55 p-4 text-sm text-muted-foreground">
          Suche mit mindestens 2 Zeichen oder starte mit Kategorien wie
          "cases", "stickers", "music kits". Alternativ oben direkt per
          Kategorie browsen.
        </div>
      );
    }

    if (isSearching) {
      return (
        <div className="space-y-2.5 rounded-xl border border-border/70 bg-card/65 p-3">
          {[1, 2, 3].map((entry) => (
            <div key={entry} className="flex items-center gap-3 rounded-xl border border-border/70 px-3 py-2.5">
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
        <div className="rounded-xl border border-dashed border-border/70 bg-card/55 p-4 text-sm text-muted-foreground">
          Keine passenden Items fuer diese Kombination gefunden. Tipp: Nutze
          die Kategorie-Chips oder versuche Begriffe wie "case", "sticker",
          "ak-47", "moto".
        </div>
      );
    }

    return (
      <div className="space-y-2.5">
        {selectedItems.length > 0 ? (
          <div className="space-y-2 rounded-2xl border border-border/70 bg-card/65 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {selectedItems.length} in Auswahl
              </p>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <button
                  type="button"
                  onClick={() => setSelectedItems([])}
                  disabled={isBatchSubmitting || submittingItem !== ""}
                  className="inline-flex h-9 flex-1 items-center justify-center rounded-xl border border-border/75 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:flex-none sm:px-2.5"
                >
                  Auswahl leeren
                </button>
                <button
                  type="button"
                  onClick={handleBatchAdd}
                  disabled={selectedItems.length === 0 || isBatchSubmitting || submittingItem !== ""}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-[0_10px_22px_rgba(255,255,255,0.14)] transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:min-w-28 sm:flex-none"
                >
                  {isBatchSubmitting ? (
                    <>
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      Speichert...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      Alle hinzufuegen
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedItems.map((marketHashName) => {
                const item = results.find((entry) => entry.marketHashName === marketHashName);
                return (
                  <span
                    key={marketHashName}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px]"
                  >
                    <span className="max-w-[180px] truncate">
                      {item?.displayName || marketHashName}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFromSelection(marketHashName)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`${item?.displayName || marketHashName} aus Auswahl entfernen`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}
        {results.map((candidate) => {
          const alreadyAdded = isAlreadyInWatchlist(candidate.marketHashName);
          const isSubmitting = submittingItem === candidate.marketHashName;
          const isSelected = selectedItems.includes(candidate.marketHashName);

          return (
            <div
              key={candidate.marketHashName}
              className="rounded-2xl border border-border/70 bg-card/65 px-3 py-3"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-muted/25">
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
                  <p className="truncate text-sm font-semibold">{candidate.displayName}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-border/60 bg-card/80 px-2 py-0.5 text-[11px] text-muted-foreground">
                      {candidate.itemTypeLabel}
                    </span>
                    {candidate.wearLabel && (
                      <span className="rounded-full border border-border/60 bg-card/80 px-2 py-0.5 text-[11px] text-muted-foreground">
                        {candidate.wearLabel}
                      </span>
                    )}
                    <span className="rounded-full border border-border/60 bg-card/80 px-2 py-0.5 text-[11px] text-muted-foreground">
                      {candidate.marketTypeLabel}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-primary">
                    {typeof candidate.livePriceEur === "number"
                      ? `${candidate.livePriceEur.toFixed(2)} EUR`
                      : "Preis folgt"}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={() => handleAddItem(candidate)}
                  disabled={alreadyAdded || isSubmitting || submittingItem !== "" || isBatchSubmitting}
                  className="inline-flex h-9 min-w-[126px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-[0_10px_22px_rgba(255,255,255,0.14)] transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:min-w-24 sm:flex-none"
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
                {!alreadyAdded ? (
                  <button
                    type="button"
                    onClick={() =>
                      isSelected
                        ? removeFromSelection(candidate.marketHashName)
                        : addToSelection(candidate.marketHashName)
                    }
                    disabled={isSubmitting || submittingItem !== "" || isBatchSubmitting}
                    className="inline-flex h-9 min-w-[126px] flex-1 items-center justify-center rounded-xl border border-border/75 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:min-w-24 sm:flex-none"
                  >
                    {isSelected ? "Auswahl entfernen" : "Zur Auswahl"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Card className="overflow-hidden border-border/70 bg-card/70">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg font-bold">
          <Search className="h-4 w-4" />
          Suche & Hinzufuegen
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Zum Beispiel: Kilowatt Case, AK-47 Redline oder Music Kit"
            className="h-11 w-full rounded-xl border border-input bg-card/85 py-2 pl-10 pr-4 text-sm text-foreground shadow-[0_12px_30px_rgba(0,0,0,0.18)] focus:outline-none focus:ring-2 focus:ring-ring/60"
            disabled={submittingItem !== ""}
          />
        </div>

        {keywordBrowseType && (
          <p className="text-xs text-muted-foreground">
            Kategorie erkannt: Suche wird als Browse fuer "{keywordBrowseType}" ausgefuehrt.
          </p>
        )}

        <div className="rounded-2xl border border-border/70 bg-card/70 p-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Compass className="h-3.5 w-3.5" />
            Schnell browsebar nach Kategorie
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_BROWSE_CHIPS.map((chip) => (
              <button
                key={chip.type}
                type="button"
                onClick={() => handleQuickBrowse(chip.type)}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                  itemType === chip.type
                    ? "border-primary/60 bg-primary text-primary-foreground"
                    : "bg-muted/35 hover:bg-muted/70"
                }`}
                disabled={submittingItem !== ""}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/65 p-2.5">
          <button
            type="button"
            onClick={() => setShowFiltersOnMobile((current) => !current)}
            className="inline-flex w-full items-center justify-between rounded-xl border border-border/70 bg-card/70 px-3 py-2 text-sm font-semibold transition-colors hover:bg-accent/60 sm:hidden"
          >
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Filter & Sortierung
            </span>
            <span className="text-xs text-muted-foreground">
              {showFiltersOnMobile ? "Verbergen" : "Anzeigen"}
            </span>
          </button>

          <div className={`${showFiltersOnMobile ? "mt-3 block" : "hidden"} sm:mt-0 sm:block`}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <label className="space-y-2 text-sm">
                <span className="font-medium">Item Type</span>
                <select
                  value={itemType}
                  onChange={(event) => handleTypeChange(event.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-card/80 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/60"
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
                  className="h-10 w-full rounded-xl border border-input bg-card/80 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="h-10 w-full rounded-xl border border-input bg-card/80 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/60"
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
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {renderState()}
        {renderPagination()}
      </CardContent>
    </Card>
  );
};
