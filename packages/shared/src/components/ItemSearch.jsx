import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  LayoutGrid,
  List,
  LoaderCircle,
  Plus,
  Search,
} from "lucide-react";
import { searchWatchlistItems } from "@shared/lib/apiClient.js";
import { createWatchlistItemData } from "@shared/lib/dataSource.js";
import { useCurrency } from "@shared/contexts/CurrencyContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/components/ui/select";
import { ItemThumb } from "@shared/components/ui/item-thumb";
import { SegmentedControl } from "@shared/components/ui/segmented-control";
import { Pagination } from "@shared/components/ui/data-display";

/**
 * Item-type filter. The design shows these as a single chip row, so the former
 * "Item Type" dropdown is gone — every type it offered must therefore have a
 * chip here, or that filter becomes unreachable.
 */
const CATEGORY_CHIPS = [
  { label: "Alle", type: "all" },
  { label: "Skins", type: "skin" },
  { label: "Cases", type: "case" },
  { label: "Sticker", type: "sticker" },
  { label: "Agents", type: "agent" },
  { label: "Capsules", type: "sticker_capsule" },
  { label: "Patches", type: "patch" },
  { label: "Music Kits", type: "music_kit" },
  { label: "Charms", type: "charm" },
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

export const ItemSearch = ({
  onAddToWatchlist,
  existingItems = [],
  onWarningsChange,
  initialSearchTerm = "",
  autoFocus = false,
  showSearchInput = true,
  submittedTerm = null,
}) => {
  const { formatPrice } = useCurrency();
  const [searchTerm, setSearchTerm] = useState(() => String(initialSearchTerm || "").trim());
  const [submittedSearchTerm, setSubmittedSearchTerm] = useState(() =>
    normalizeSearchTerm(String(initialSearchTerm || "").trim()),
  );
  const [itemType, setItemType] = useState("all");
  const [wear, setWear] = useState("all");
  const [sortBy, setSortBy] = useState("relevance");
  const [viewMode, setViewMode] = useState("grid");
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

  const normalizedSubmittedTerm = submittedTerm !== null
    ? normalizeSearchTerm(String(submittedTerm || ""))
    : normalizeSearchTerm(submittedSearchTerm);
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

  const pageCount = Math.max(totalPages, 1);

  const renderStatus = (message, spinner = false) => (
    <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
      {spinner ? (
        <span className="inline-flex items-center gap-2">
          <LoaderCircle className="size-4 animate-spin" />
          {message}
        </span>
      ) : (
        message
      )}
    </div>
  );

  const priceLabel = (candidate) => {
    const value = Number(candidate.livePriceEur);
    return Number.isFinite(value) && value > 0 ? formatPrice(value) : "Preis folgt";
  };

  const renderAddButton = (candidate, { compact = false } = {}) => {
    const alreadyAdded = existingItemNames.has(candidate.marketHashName);
    const isSubmitting = submittingItem === candidate.marketHashName;

    return (
      <button
        type="button"
        onClick={() => void handleAddItem(candidate)}
        disabled={alreadyAdded || isSubmitting || submittingItem !== ""}
        className={`inline-flex h-[30px] items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition-colors disabled:cursor-not-allowed ${
          compact ? "px-3" : "w-full"
        } ${
          alreadyAdded
            ? "border border-success/35 bg-success/12 text-success"
            : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        }`}
      >
        {isSubmitting ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : alreadyAdded ? (
          <Check className="size-3.5" />
        ) : (
          <Plus className="size-3.5" />
        )}
        {alreadyAdded ? "Watchlist" : "Zur Watchlist"}
      </button>
    );
  };

  const renderGrid = () => (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {results.map((candidate) => (
        <article
          key={candidate.marketHashName}
          className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-success/45"
        >
          <div
            className={`relative h-24 ${
              candidate.iconUrl
                ? "bg-surface-1"
                : "bg-[repeating-linear-gradient(135deg,var(--stripe)_0_7px,transparent_7px_14px)]"
            }`}
          >
            {candidate.iconUrl ? (
              <img
                src={candidate.iconUrl}
                alt={candidate.displayName}
                loading="lazy"
                decoding="async"
                className="size-full object-contain p-2"
              />
            ) : null}
            <span className="absolute left-2 top-2 inline-flex h-[19px] items-center rounded-md border border-border bg-background/85 px-[7px] text-[10px] font-bold text-foreground">
              {candidate.itemTypeLabel || "Item"}
            </span>
            {candidate.wearLabel ? (
              <span className="absolute right-2 top-2 inline-flex h-[19px] items-center rounded-md border border-border bg-background/85 px-[7px] text-[10px] font-bold text-muted-foreground">
                {candidate.wearLabel}
              </span>
            ) : null}
          </div>

          <div className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-2.5">
            <p
              className="line-clamp-2 min-h-[31px] text-xs font-bold leading-[1.3] text-foreground"
              title={candidate.displayName}
            >
              {candidate.displayName}
            </p>
            <span className="text-base font-extrabold tracking-[-0.01em] tabular-nums text-foreground">
              {priceLabel(candidate)}
            </span>
            <div className="mt-auto pt-1">{renderAddButton(candidate)}</div>
          </div>
        </article>
      ))}
    </div>
  );

  const renderList = () => (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid grid-cols-[minmax(0,1fr)_120px_140px_150px] items-center gap-3 border-b border-border px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        <span>Item</span>
        <span className="text-right">Preis</span>
        <span>Condition</span>
        <span className="text-right">Aktion</span>
      </div>
      {results.map((candidate) => (
        <div
          key={candidate.marketHashName}
          className="grid grid-cols-[minmax(0,1fr)_120px_140px_150px] items-center gap-3 border-b border-border-soft px-4 py-2.5 last:border-b-0"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <ItemThumb src={candidate.iconUrl} alt={candidate.displayName} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-foreground">
                {candidate.displayName}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {candidate.itemTypeLabel}
              </p>
            </div>
          </div>
          <span className="text-right text-[13px] font-bold tabular-nums text-foreground">
            {priceLabel(candidate)}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {candidate.wearLabel || "—"}
          </span>
          <div className="flex justify-end">{renderAddButton(candidate, { compact: true })}</div>
        </div>
      ))}
    </div>
  );

  const renderResults = () => {
    if (!shouldSearch) {
      return renderStatus(
        "Gib mindestens 2 Zeichen ein und drücke Enter — oder browse direkt über die Kategorien.",
      );
    }
    if (isSearching) return renderStatus("Suche läuft…", true);
    if (results.length === 0) return renderStatus("Keine Treffer für diese Suche.");
    return viewMode === "grid" ? renderGrid() : renderList();
  };

  return (
    <section className="flex flex-col gap-4">
      {/* Toolbar: query on the left, result count and view controls on the right. */}
      <form
        onSubmit={handleSearchSubmit}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        {showSearchInput ? (
          <label className="relative min-w-0 flex-1 basis-72 sm:max-w-[560px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Nach Item suchen…"
              disabled={submittingItem !== ""}
              className="h-11 w-full rounded-xl border border-border-strong bg-card pl-[42px] pr-3.5 text-[15px] text-foreground outline-none transition-colors focus:border-success/50"
            />
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">Suche erfolgt über die obere Suchleiste.</p>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            {totalItems} Treffer{browseMode ? " · Browse" : ""}
          </span>

          <Select
            value={sortBy}
            onValueChange={(nextSort) => {
              setSortBy(nextSort);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-[38px] w-auto gap-2 rounded-[5px] border-border bg-card px-3 text-xs font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={wear}
            onValueChange={(nextWear) => {
              setWear(nextWear);
              setPage(1);
            }}
            disabled={!wearEnabled}
          >
            <SelectTrigger className="h-[38px] w-auto gap-2 rounded-[5px] border-border bg-card px-3 text-xs font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEAR_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <SegmentedControl
            size="icon"
            value={viewMode}
            onChange={setViewMode}
            items={[
              { value: "grid", title: "Kacheln", label: <LayoutGrid className="size-[15px]" /> },
              { value: "list", title: "Liste", label: <List className="size-[15px]" /> },
            ]}
          />
        </div>
      </form>

      {/* Category chips double as the item-type filter. */}
      <div className="flex flex-wrap gap-[7px] border-b border-border pb-3.5">
        {CATEGORY_CHIPS.map((chip) => (
          <button
            key={chip.type}
            type="button"
            onClick={() => {
              setItemType(chip.type);
              if (chip.type !== "skin") setWear("all");
              setPage(1);
            }}
            className={`inline-flex h-7 items-center rounded-full px-3 text-xs transition-colors ${
              itemType === chip.type
                ? "bg-primary font-bold text-primary-foreground"
                : "border border-border-strong font-semibold text-foreground hover:bg-surface-2"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {renderResults()}

      {shouldSearch && results.length > 0 ? (
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3.5">
          <span className="text-xs tabular-nums text-muted-foreground">
            {results.length} von {totalItems} Treffern · Seite {page} von {pageCount}
          </span>
          <Pagination
            page={page}
            pageCount={pageCount}
            onPageChange={(next) => setPage(Math.min(Math.max(1, next), pageCount))}
          />
        </div>
      ) : null}
    </section>
  );
};
