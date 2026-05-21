import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Plus,
  Search,
} from "lucide-react";
import { searchWatchlistItems } from "@shared/lib/apiClient.js";
import { createWatchlistItemData } from "@shared/lib/dataSource.js";

const ITEM_TYPE_OPTIONS = [
  { value: "all", label: "Alle Typen" },
  { value: "skin", label: "Skins" },
  { value: "case", label: "Cases" },
  { value: "sticker", label: "Sticker" },
  { value: "agent", label: "Agents" },
  { value: "sticker_capsule", label: "Capsules" },
  { value: "patch", label: "Patches" },
  { value: "music_kit", label: "Music Kits" },
  { value: "charm", label: "Charms" },
  { value: "other", label: "Everything else" },
];

const CATEGORY_CHIPS = [
  { label: "Alle", type: "all" },
  { label: "Skins", type: "skin" },
  { label: "Cases", type: "case" },
  { label: "Sticker", type: "sticker" },
  { label: "Agents", type: "agent" },
  { label: "Capsules", type: "sticker_capsule" },
  { label: "Everything else", type: "other" },
];

const WEAR_OPTIONS = [
  { value: "all", label: "Alle Conditions" },
  { value: "factory_new", label: "Factory New" },
  { value: "minimal_wear", label: "Minimal Wear" },
  { value: "field_tested", label: "Field-Tested" },
  { value: "well_worn", label: "Well-Worn" },
  { value: "battle_scarred", label: "Battle-Scarred" },
];

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

const PAGE_SIZE = 20;
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
  "other",
]);

function normalizeSearchTerm(term) {
  const trimmed = String(term || "").trim().replace(/\s+/g, " ");
  if (trimmed === "") {
    return "";
  }

  return SEARCH_ALIASES.reduce(
    (current, alias) => current.replace(alias.pattern, alias.replacement),
    trimmed,
  );
}

function resolveKeywordBrowseType(term) {
  const normalized = String(term || "").trim().toLowerCase();
  return BROWSE_KEYWORD_MAP[normalized] || null;
}

function formatPriceEur(value) {
  if (!Number.isFinite(value)) {
    return "Preis folgt";
  }
  return `${Number(value).toFixed(2)} EUR`;
}

export const ItemSearch = ({
  onAddToWatchlist,
  existingItems = [],
  onWarningsChange,
  initialSearchTerm = "",
  autoFocus = false,
}) => {
  const [searchTerm, setSearchTerm] = useState(() => String(initialSearchTerm || "").trim());
  const [submittedSearchTerm, setSubmittedSearchTerm] = useState(() =>
    normalizeSearchTerm(String(initialSearchTerm || "").trim()),
  );
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
  const searchInputRef = useRef(null);

  const existingItemNames = useMemo(
    () => new Set(existingItems.map((item) => item.name)),
    [existingItems],
  );

  const normalizedSubmittedTerm = normalizeSearchTerm(submittedSearchTerm);
  const keywordBrowseType = itemType === "all" ? resolveKeywordBrowseType(normalizedSubmittedTerm) : null;
  const effectiveItemType = keywordBrowseType || itemType;
  const effectiveTerm = keywordBrowseType ? "" : normalizedSubmittedTerm;
  const wearEnabled = effectiveItemType === "skin";
  const activeWear = wearEnabled ? wear : "all";
  const canBrowseWithoutQuery = BROWSABLE_ITEM_TYPES.has(effectiveItemType) && effectiveItemType !== "all";
  const isBrowseRequest = effectiveTerm.length === 0 && canBrowseWithoutQuery;
  const shouldSearch = effectiveTerm.length >= 2 || isBrowseRequest;

  useEffect(() => {
    const nextTerm = String(initialSearchTerm || "").trim();
    setSearchTerm(nextTerm);
    setSubmittedSearchTerm(normalizeSearchTerm(nextTerm));
    setPage(1);
  }, [initialSearchTerm]);

  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [autoFocus]);

  useEffect(() => {
    if (!shouldSearch) {
      setIsSearching(false);
      setResults([]);
      setTotalItems(0);
      setTotalPages(0);
      setBrowseMode(false);
      setWarnings([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
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
          page,
        );

        if (cancelled) {
          return;
        }

        const data = response?.data;
        setResults(Array.isArray(data?.items) ? data.items : []);
        setTotalItems(Number(data?.totalItems || 0));
        setTotalPages(Number(data?.totalPages || 0));
        setBrowseMode(Boolean(data?.browseMode));
        setWarnings(Array.isArray(response?.meta?.warnings) ? response.meta.warnings : []);
      } catch (requestError) {
        if (!cancelled) {
          setResults([]);
          setTotalItems(0);
          setTotalPages(0);
          setBrowseMode(false);
          setWarnings([]);
          setError(requestError?.message || "Fehler bei der Item-Suche.");
        }
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [activeWear, effectiveItemType, effectiveTerm, page, shouldSearch, sortBy]);

  useEffect(() => {
    onWarningsChange?.(warnings);
  }, [onWarningsChange, warnings]);

  useEffect(() => () => {
    onWarningsChange?.([]);
  }, [onWarningsChange]);

  const handleSearchSubmit = (event) => {
    event?.preventDefault?.();
    setPage(1);
    setSubmittedSearchTerm(normalizeSearchTerm(searchTerm));
  };

  const handleAddItem = async (candidate) => {
    const marketHashName = String(candidate?.marketHashName || "").trim();
    if (!marketHashName) {
      return;
    }

    if (existingItemNames.has(marketHashName)) {
      setError("Dieses Item ist bereits in der Watchlist.");
      return;
    }

    try {
      setSubmittingItem(marketHashName);
      setError("");
      await createWatchlistItemData(marketHashName, candidate?.itemType || "other");
      if (onAddToWatchlist) {
        await onAddToWatchlist();
      }
    } catch (requestError) {
      setError(requestError?.message || "Fehler beim Hinzufuegen zur Watchlist.");
    } finally {
      setSubmittingItem("");
    }
  };

  const renderBody = () => {
    if (!shouldSearch) {
      return (
        <div className="px-3 py-5 text-sm text-muted-foreground">
          Gib mindestens 2 Zeichen ein und druecke Enter oder browse direkt ueber die Kategorien.
        </div>
      );
    }

    if (isSearching) {
      return (
        <tbody>
          {[1, 2, 3, 4].map((row) => (
            <tr key={`loading-${row}`} className="border-t border-border/70">
              <td colSpan={5} className="px-3 py-4 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Suche laeuft...
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      );
    }

    if (results.length === 0) {
      return (
        <tbody>
          <tr className="border-t border-border/70">
            <td colSpan={5} className="px-3 py-5 text-sm text-muted-foreground">
              Keine Treffer fuer diese Suche.
            </td>
          </tr>
        </tbody>
      );
    }

    return (
      <tbody>
        {results.map((candidate, index) => {
          const alreadyAdded = existingItemNames.has(candidate.marketHashName);
          const isSubmitting = submittingItem === candidate.marketHashName;
          const rowNumber = (page - 1) * PAGE_SIZE + index + 1;

          return (
            <tr key={candidate.marketHashName} className="border-t border-border/70 align-middle">
              <td className="px-3 py-3 text-xs text-muted-foreground">{rowNumber}</td>
              <td className="px-3 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="h-9 w-9 shrink-0 overflow-hidden rounded-sm border border-border/70">
                    {candidate.iconUrl ? (
                      <img
                        src={candidate.iconUrl}
                        alt={candidate.displayName}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {candidate.displayName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {candidate.itemTypeLabel}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 text-sm font-semibold text-foreground">
                {formatPriceEur(candidate.livePriceEur)}
              </td>
              <td className="px-3 py-3 text-sm text-muted-foreground">
                {candidate.wearLabel || "-"}
              </td>
              <td className="px-3 py-3 text-right">
                <button
                  type="button"
                  onClick={() => void handleAddItem(candidate)}
                  disabled={alreadyAdded || isSubmitting || submittingItem !== ""}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-border/75 px-2.5 text-xs font-semibold transition-colors hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  {alreadyAdded ? "Bereits in Watchlist" : "Hinzufuegen"}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    );
  };

  return (
    <section className="space-y-3">
      <form onSubmit={handleSearchSubmit} className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchInputRef}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Suche nach Item-Namen (Enter startet Suche)"
            className="h-10 w-full rounded-md border border-border/70 bg-transparent pl-10 pr-28 text-sm text-foreground outline-none transition-colors focus:border-border"
            disabled={submittingItem !== ""}
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1.5 inline-flex h-7 items-center rounded-md border border-border/70 px-2.5 text-xs font-semibold hover:bg-accent/60"
          >
            Suchen
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-border/70 pb-2">
          {CATEGORY_CHIPS.map((chip) => (
            <button
              key={chip.type}
              type="button"
              onClick={() => {
                setItemType(chip.type);
                if (chip.type !== "skin") {
                  setWear("all");
                }
                setPage(1);
              }}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                itemType === chip.type
                  ? "border-primary/60 bg-primary text-primary-foreground"
                  : "border-border/70 text-foreground hover:bg-accent/60"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="space-y-1 text-xs text-muted-foreground">
            Item Type
            <select
              value={itemType}
              onChange={(event) => {
                const nextType = event.target.value;
                setItemType(nextType);
                if (nextType !== "skin") {
                  setWear("all");
                }
                setPage(1);
              }}
              className="h-9 w-full rounded-md border border-border/70 bg-transparent px-2.5 text-sm text-foreground"
            >
              {ITEM_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs text-muted-foreground">
            Condition
            <select
              value={wear}
              onChange={(event) => {
                setWear(event.target.value);
                setPage(1);
              }}
              disabled={!wearEnabled}
              className="h-9 w-full rounded-md border border-border/70 bg-transparent px-2.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {WEAR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs text-muted-foreground">
            Sortierung
            <select
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value);
                setPage(1);
              }}
              className="h-9 w-full rounded-md border border-border/70 bg-transparent px-2.5 text-sm text-foreground"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </form>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border border-border/70">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border/70 bg-transparent text-left">
                <th className="w-14 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">#</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</th>
                <th className="w-44 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Price</th>
                <th className="w-40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Condition</th>
                <th className="w-52 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Action</th>
              </tr>
            </thead>
            {renderBody()}
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2 text-xs text-muted-foreground">
        <span>
          {results.length} / {totalItems} Treffer | Seite {page} von {Math.max(totalPages, 1)}
          {browseMode ? " | Browse-Modus" : ""}
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPage(1)}
            disabled={page <= 1 || isSearching}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Erste Seite"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || isSearching}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Vorherige Seite"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(Math.max(totalPages, 1), current + 1))}
            disabled={page >= totalPages || totalPages === 0 || isSearching}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Naechste Seite"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPage(Math.max(totalPages, 1))}
            disabled={page >= totalPages || totalPages === 0 || isSearching}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Letzte Seite"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </section>
  );
};
