import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  LayoutGrid,
  List,
  LoaderCircle,
  Plus,
  Search,
  SlidersHorizontal,
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
import { Callout } from "@shared/components/ui/callout";
import { ItemThumb } from "@shared/components/ui/item-thumb";
import { SegmentedControl } from "@shared/components/ui/segmented-control";
import { Pagination } from "@shared/components/ui/data-display";
import { Switch } from "@shared/components/ui/switch";
import { SoonBadge } from "@shared/components/ui/filter-sidebar";
import { BaseModal } from "@shared/components/BaseModal";

/**
 * Item-type filter. The design shows these as a single chip row, so the former
 * "Item Type" dropdown is gone — every type it offered must therefore have a
 * chip here, or that filter becomes unreachable.
 */
const CATEGORY_CHIPS = [
  { labelKey: "categories.all", type: "all" },
  { labelKey: "categories.skins", type: "skin" },
  { labelKey: "categories.cases", type: "case" },
  { labelKey: "categories.stickers", type: "sticker" },
  { labelKey: "categories.agents", type: "agent" },
  { labelKey: "categories.capsules", type: "sticker_capsule" },
  { labelKey: "categories.patches", type: "patch" },
  { labelKey: "categories.musicKits", type: "music_kit" },
  { labelKey: "categories.charms", type: "charm" },
  { labelKey: "categories.everythingElse", type: "other" },
];

const WEAR_OPTIONS = [
  { value: "all", labelKey: "conditions.all" },
  { value: "factory_new", labelKey: "conditions.factoryNew" },
  { value: "minimal_wear", labelKey: "conditions.minimalWear" },
  { value: "field_tested", labelKey: "conditions.fieldTested" },
  { value: "well_worn", labelKey: "conditions.wellWorn" },
  { value: "battle_scarred", labelKey: "conditions.battleScarred" },
];

const SORT_OPTIONS = [
  { value: "relevance", labelKey: "sort.relevance" },
  { value: "name_asc", labelKey: "sort.nameAsc" },
  { value: "name_desc", labelKey: "sort.nameDesc" },
  { value: "price_asc", labelKey: "sort.priceAsc" },
  { value: "price_desc", labelKey: "sort.priceDesc" },
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

/** Quick-select ranges for the price filter, in EUR. */
// The bounds stay literal euro amounts — they are the filter's actual values,
// not copy, and converting them per locale would change what the chip filters.
const PRICE_RANGE_CHIPS = [
  { labelKey: "priceChips.priceAll", min: "", max: "" },
  { labelKey: "priceChips.priceUnder", args: { amount: "10 €" }, min: "", max: "10" },
  { labelKey: "priceChips.priceBetween", args: { min: "10", max: "100 €" }, min: "10", max: "100" },
  { labelKey: "priceChips.priceBetween", args: { min: "100", max: "1.000 €" }, min: "100", max: "1000" },
  { labelKey: "priceChips.priceOver", args: { amount: "1.000 €" }, min: "1000", max: "" },
];

/**
 * Reads a price bound from the free-text inputs. Accepts a decimal comma
 * because the fields are labelled in EUR and typed on a German keyboard.
 * Returns `undefined` for empty or unusable input so `buildPath` drops the
 * param instead of sending a bound the backend would reject.
 */
function parsePriceInput(value) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (normalized === "") {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

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
  const { t } = useTranslation("search");
  const { formatPrice } = useCurrency();
  const [searchTerm, setSearchTerm] = useState(() => String(initialSearchTerm || "").trim());
  const [submittedSearchTerm, setSubmittedSearchTerm] = useState(() =>
    normalizeSearchTerm(String(initialSearchTerm || "").trim()),
  );
  const [itemType, setItemType] = useState("all");
  const [wear, setWear] = useState("all");
  const [sortBy, setSortBy] = useState("relevance");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  // The price fields are free text, so the value that actually drives requests
  // trails the input — otherwise every keystroke would fire a search.
  const [committedPriceRange, setCommittedPriceRange] = useState({ min: "", max: "" });
  const [viewMode, setViewMode] = useState("grid");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
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
  const minPriceEur = parsePriceInput(committedPriceRange.min);
  const maxPriceEur = parsePriceInput(committedPriceRange.max);
  const priceRangeActive = minPriceEur !== undefined || maxPriceEur !== undefined;
  // Only the filters that can actually narrow a request are counted — the
  // still-disabled ownership group must not inflate the badge.
  const activeFilterCount =
    (itemType !== "all" ? 1 : 0)
    + (wear !== "all" && effectiveItemType === "skin" ? 1 : 0)
    + (priceRangeActive ? 1 : 0);
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
    if (priceMin === committedPriceRange.min && priceMax === committedPriceRange.max) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCommittedPriceRange({ min: priceMin, max: priceMax });
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [committedPriceRange.max, committedPriceRange.min, priceMax, priceMin]);

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
            minPriceEur,
            maxPriceEur,
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
          setError(requestError?.message || t("errors.searchFailed"));
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
  }, [
    activeWear,
    effectiveItemType,
    effectiveTerm,
    maxPriceEur,
    minPriceEur,
    page,
    shouldSearch,
    sortBy,
    t,
  ]);

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
      setError(t("errors.alreadyInWatchlist"));
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
      setError(requestError?.message || t("errors.addFailed"));
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
    return Number.isFinite(value) && value > 0 ? formatPrice(value) : t("priceFollows");
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
        {alreadyAdded ? "Watchlist" : t("addToWatchlist")}
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

  // Below `sm` the four fixed columns (120/140/150px) overflow a 380px screen:
  // the name column collapses to nothing and the action button is clipped off
  // the right edge. Mobile stacks each row instead — name and condition on top,
  // price and action beneath — and the header, which only labels columns that
  // no longer exist there, is hidden.
  const LIST_COLUMNS =
    "sm:grid sm:grid-cols-[minmax(0,1fr)_120px_140px_150px] sm:items-center sm:gap-3";

  const renderList = () => (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div
        className={`hidden border-b border-border px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground ${LIST_COLUMNS}`}
      >
        <span>{t("columns.item")}</span>
        <span className="text-right">{t("columns.price")}</span>
        <span>{t("columns.condition")}</span>
        <span className="text-right">{t("columns.action")}</span>
      </div>
      {results.map((candidate) => (
        <div
          key={candidate.marketHashName}
          className={`flex flex-col gap-2.5 border-b border-border-soft px-4 py-3 last:border-b-0 sm:py-2.5 ${LIST_COLUMNS}`}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <ItemThumb src={candidate.iconUrl} alt={candidate.displayName} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-foreground">
                {candidate.displayName}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {candidate.itemTypeLabel}
                {/* Mobile only: from `sm` the Condition column carries this,
                    and printing it twice on one row reads as a mistake. */}
                {candidate.wearLabel ? (
                  <span className="sm:hidden"> · {candidate.wearLabel}</span>
                ) : null}
              </p>
            </div>
          </div>
          <span className="hidden text-right text-[13px] font-bold tabular-nums text-foreground sm:block">
            {priceLabel(candidate)}
          </span>
          <span className="hidden truncate text-xs text-muted-foreground sm:block">
            {candidate.wearLabel || "—"}
          </span>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span className="text-[15px] font-extrabold tabular-nums text-foreground sm:hidden">
              {priceLabel(candidate)}
            </span>
            {renderAddButton(candidate, { compact: true })}
          </div>
        </div>
      ))}
    </div>
  );

  /**
   * Mobile filter sheet.
   *
   * The design collects every filter here. Kategorie, Zustand and Preis reach
   * the search API; the ownership toggle has no backing query yet and stays
   * disabled behind a `SoonBadge` rather than being dropped — the same call
   * the inventory Wallet chips make, so the planned filter set remains visible
   * without any control pretending to work.
   */
  const renderFilterSheet = () => (
    <BaseModal
      isOpen={filterSheetOpen}
      onClose={() => setFilterSheetOpen(false)}
      title="Filter"
      size="lg"
    >
      <div className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
            Kategorie
          </p>
          <div className="flex flex-wrap gap-[7px]">
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
                    : "border border-border-strong font-semibold text-foreground"
                }`}
              >
                {t(chip.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
            Zustand
          </p>
          <div className="grid grid-cols-2 gap-[7px]">
            {WEAR_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={!wearEnabled}
                title={wearEnabled ? undefined : t("filters.conditionSkinsOnly")}
                onClick={() => {
                  setWear(option.value);
                  setPage(1);
                }}
                className={`h-8 rounded-lg px-3 text-xs transition-colors ${
                  !wearEnabled
                    ? "cursor-not-allowed border border-border-soft font-semibold text-muted-foreground opacity-45"
                    : wear === option.value
                      ? "bg-primary font-bold text-primary-foreground"
                      : "border border-border-strong font-semibold text-foreground"
                }`}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
            Preis in €
          </p>
          <div className="flex items-center gap-2">
            <input
              value={priceMin}
              onChange={(event) => setPriceMin(event.target.value)}
              inputMode="decimal"
              placeholder="von"
              aria-label={t("filters.priceFrom")}
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-xs"
            />
            <span className="text-xs text-muted-foreground">bis</span>
            <input
              value={priceMax}
              onChange={(event) => setPriceMax(event.target.value)}
              inputMode="decimal"
              placeholder="bis"
              aria-label={t("filters.priceTo")}
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-xs"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-[7px]">
            {PRICE_RANGE_CHIPS.map((chip) => {
              const chipActive = priceMin === chip.min && priceMax === chip.max;
              return (
                <button
                  key={chip.labelKey + JSON.stringify(chip.args || {})}
                  type="button"
                  onClick={() => {
                    setPriceMin(chip.min);
                    setPriceMax(chip.max);
                  }}
                  className={`inline-flex h-7 items-center rounded-full px-3 text-xs transition-colors ${
                    chipActive
                      ? "bg-primary font-bold text-primary-foreground"
                      : "border border-border-strong font-semibold text-foreground"
                  }`}
                >
                  {t(chip.labelKey, chip.args)}
                </button>
              );
            })}
          </div>
          {/* Items whose price has not been cached yet drop out of a bounded
              search, so the range is stricter than it looks. */}
          {priceRangeActive ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Zeigt nur Items mit bekanntem Preis.
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 opacity-45">
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-[13px] font-bold">
              Nur Items im Bestand
              <SoonBadge />
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              Blendet alles aus, was du nicht besitzt
            </span>
          </span>
          <Switch checked={false} disabled aria-label={t("filters.ownedOnly")} />
        </div>

        <div className="flex items-center gap-2.5 border-t border-border-soft pt-4">
          <button
            type="button"
            onClick={() => {
              setItemType("all");
              setWear("all");
              setPriceMin("");
              setPriceMax("");
              setPage(1);
            }}
            className="h-[42px] shrink-0 rounded-[10px] border border-border-strong px-4 text-[12.5px] font-bold"
          >
            Zurücksetzen
          </button>
          <button
            type="button"
            onClick={() => setFilterSheetOpen(false)}
            className="h-[42px] flex-1 rounded-[10px] bg-primary text-[12.5px] font-extrabold text-primary-foreground"
          >
            {totalItems} Treffer anzeigen
          </button>
        </div>
      </div>
    </BaseModal>
  );

  const renderResults = () => {
    if (!shouldSearch) {
      return renderStatus(t("hint"));
    }
    if (isSearching) return renderStatus(t("running"), true);
    if (results.length === 0) return renderStatus(t("noResults"));
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
              placeholder={t("placeholder")}
              disabled={submittingItem !== ""}
              className="h-11 w-full rounded-xl border border-border-strong bg-card pl-[42px] pr-3.5 text-[15px] text-foreground outline-none transition-colors focus:border-success/50"
            />
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">{t("useTopBar")}</p>
        )}

        {/* Count and both selects wrapped onto three lines at 380px and pushed
            the results down, so on mobile they scroll sideways. The view switch
            stays OUTSIDE the scroller, pinned right: scrolled out of sight it
            reads as missing, and it is how you get to the list view at all. */}
        <div className="flex w-full min-w-0 items-center gap-2.5 sm:w-auto">
        <div className="no-scrollbar -ml-3.5 flex min-w-0 flex-1 items-center gap-2.5 overflow-x-auto pl-3.5 sm:ml-0 sm:flex-none sm:flex-wrap sm:overflow-visible sm:pl-0">
          <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            {totalItems} Treffer{browseMode ? " · Browse" : ""}
          </span>

          {/* Mobile only: from `sm` the chip row and the Condition select are
              visible inline, so a sheet holding the same two controls would be
              a second route to them. */}
          <button
            type="button"
            onClick={() => setFilterSheetOpen(true)}
            className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-[10px] border border-border-strong bg-card px-3 text-xs font-semibold sm:hidden"
          >
            <SlidersHorizontal className="size-[15px]" />
            Filter
            {activeFilterCount > 0 ? (
              <span className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-success px-1 text-[10px] font-extrabold text-background">
                {activeFilterCount}
              </span>
            ) : null}
          </button>

          <Select
            value={sortBy}
            onValueChange={(nextSort) => {
              setSortBy(nextSort);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-[38px] w-auto shrink-0 gap-2 rounded-[5px] border-border bg-card px-3 text-xs font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.labelKey)}
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
            <SelectTrigger className="hidden h-[38px] w-auto shrink-0 gap-2 rounded-[5px] border-border bg-card px-3 text-xs font-semibold sm:flex">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEAR_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          </div>

          <SegmentedControl
            className="shrink-0"
            size="icon"
            value={viewMode}
            onChange={setViewMode}
            items={[
              { value: "grid", title: t("viewTiles"), label: <LayoutGrid className="size-[15px]" /> },
              { value: "list", title: t("viewList"), label: <List className="size-[15px]" /> },
            ]}
          />
        </div>
      </form>

      {/* Category chips double as the item-type filter. Ten of them wrap to four
          rows at 380px, pushing every result below the fold, so on mobile the
          row scrolls sideways instead and wraps only from `sm`. */}
      <div className="hidden gap-[7px] border-b border-border pb-3.5 sm:flex sm:flex-wrap">
        {CATEGORY_CHIPS.map((chip) => (
          <button
            key={chip.type}
            type="button"
            onClick={() => {
              setItemType(chip.type);
              if (chip.type !== "skin") setWear("all");
              setPage(1);
            }}
            className={`inline-flex h-7 shrink-0 items-center rounded-full px-3 text-xs transition-colors ${
              itemType === chip.type
                ? "bg-primary font-bold text-primary-foreground"
                : "border border-border-strong font-semibold text-foreground hover:bg-surface-2"
            }`}
          >
            {t(chip.labelKey)}
          </button>
        ))}
      </div>

      {error ? <Callout tone="danger">{error}</Callout> : null}

      {renderResults()}

      {renderFilterSheet()}

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
