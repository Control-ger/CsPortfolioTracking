import { Suspense, lazy, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { List, Package, TrendingUp } from "lucide-react";
import { Skeleton } from "./ui/skeleton.jsx";
import { SegmentedControl } from "./ui/segmented-control.jsx";
import {
  FilterChip,
  FilterGroup,
  FilterScopeButton,
  FilterScopeIcon,
  FilterSidebar,
  FilterSortButton,
  SoonBadge,
} from "./ui/filter-sidebar.jsx";
import {
  normalizeBucket,
  resolveLiveClusterItem,
  withBuyOrderFields,
} from "../lib/portfolioHelpers.js";
import { useCurrency } from "@shared/contexts/CurrencyContext";
import { resolveItemCategory } from "../lib/portfolioCalculations.js";

import { getActiveIntlLocale } from "@shared/lib/i18n/index.js";
const InventoryTable = lazy(() =>
  import("./InventoryTable.jsx").then((module) => ({
    default: module.InventoryTable,
  })),
);
const ItemDetailsModal = lazy(() =>
  import("./ItemDetailsModal.jsx").then((module) => ({
    default: module.ItemDetailsModal,
  })),
);
const ItemDetailPanel = lazy(() =>
  import("./ItemDetailPanel.jsx").then((module) => ({
    default: module.ItemDetailPanel,
  })),
);

const SCOPES = [
  // The collapsed rail shows icons, not initials — "Investments" and "Inventar"
  // share a first syllable, so no short abbreviation distinguishes them.
  { key: "investment", labelKey: "scope.investments", Icon: TrendingUp },
  { key: "inventory", labelKey: "scope.inventory", Icon: Package },
  { key: "all", labelKey: "scope.everything", Icon: List },
];

const SORTS = [
  { key: "roi", labelKey: "sort.roi" },
  { key: "value", labelKey: "sort.positionValue" },
  { key: "quantity", labelKey: "sort.quantity" },
  { key: "item", labelKey: "sort.name" },
];

const ALL_CATEGORIES = "__all__";

/** The bucket a row belongs to, matching PortfolioPage's scope filter. */
function resolveRowBucket(item) {
  return normalizeBucket(
    item?.bucket,
    String(item?.platform || item?.source || "").toLowerCase() === "steam_inventory"
      ? "inventory"
      : "investment",
  );
}

// Both derive from the catalogue category, never from `item.type`: that field is
// importer-supplied and defaults to "skin", so the chip row offered a single
// "Skin" entry that also swallowed every case, sticker and patch.
function categoryKey(item) {
  return resolveItemCategory(item).toLowerCase();
}

function categoryLabel(item) {
  return resolveItemCategory(item);
}

/**
 * Inventory tab content for the Portfolio page.
 *
 * Layout follows the Inventar design: a collapsible filter rail owns scope,
 * category and sort; the content column carries the header, the dense table and
 * the inspector. Scope stays lifted to PortfolioPage (it keys the row filter and
 * is shared with other surfaces); category and sort are view-local.
 */
export function PortfolioInventorySection({
  inventoryScope,
  onInventoryScopeChange,
  inventoryTabItems,
  portfolioGroupSummaries,
  onSelectItem,
  onSelectGroup,
  onSelectCluster,
  selectedItemWithLiveAndBuyOrders,
  selectedItem,
  selectedItemHistory,
  selectedItemHistoryLoading,
  isDesktopRuntime,
  onExcludeChange,
  onBucketChange,
  canToggleExclude,
  canToggleBucket,
  onModalExcludeToggle,
  modals,
  onCloseModal,
  enrichedInvestments,
  inventoryBuyOrderSummary,
}) {
  const { t } = useTranslation("inventory");
  const { formatPrice } = useCurrency();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [sortKey, setSortKey] = useState("roi");
  const [sortDirection, setSortDirection] = useState("desc");

  // Scope counts have to come from the unfiltered rows — `inventoryTabItems` is
  // already narrowed to the active scope, so it can only ever count itself.
  const scopeCounts = useMemo(() => {
    const counts = { investment: 0, inventory: 0, all: 0 };
    (Array.isArray(enrichedInvestments) ? enrichedInvestments : []).forEach((item) => {
      counts.all += 1;
      counts[resolveRowBucket(item)] += 1;
    });
    return counts;
  }, [enrichedInvestments]);

  const scopedGroups = useMemo(
    () =>
      (Array.isArray(portfolioGroupSummaries) ? portfolioGroupSummaries : []).filter(
        (group) =>
          inventoryScope === "all" || String(group?.bucket || "investment") === inventoryScope,
      ),
    [portfolioGroupSummaries, inventoryScope],
  );

  // Categories are derived from what is actually in the scope rather than from a
  // fixed list, so a catalog that gains a type does not need a code change.
  const categories = useMemo(() => {
    const seen = new Map();
    (Array.isArray(inventoryTabItems) ? inventoryTabItems : []).forEach((item) => {
      const key = categoryKey(item);
      if (!seen.has(key)) {
        seen.set(key, { key, label: categoryLabel(item), count: 0 });
      }
      seen.get(key).count += 1;
    });
    return Array.from(seen.values()).sort((left, right) =>
      left.label.localeCompare(right.label, getActiveIntlLocale()),
    );
  }, [inventoryTabItems]);

  const activeCategory = categories.some((entry) => entry.key === category)
    ? category
    : ALL_CATEGORIES;

  // A category filter narrows single positions only. Groups aggregate across
  // types, so filtering them by one type would show a partial group total.
  const filteredItems = useMemo(() => {
    const rows = Array.isArray(inventoryTabItems) ? inventoryTabItems : [];
    const withOrders = rows.map((item) => withBuyOrderFields(item, inventoryBuyOrderSummary));
    if (activeCategory === ALL_CATEGORIES) {
      return withOrders;
    }
    return withOrders.filter((item) => categoryKey(item) === activeCategory);
  }, [inventoryTabItems, inventoryBuyOrderSummary, activeCategory]);

  const visibleGroups = activeCategory === ALL_CATEGORIES ? scopedGroups : [];

  const selectedId = selectedItem?.id ?? null;
  const scopeEntry = SCOPES.find((entry) => entry.key === inventoryScope);
  const scopeLabel = scopeEntry ? t(scopeEntry.labelKey) : t("scope.inventory");

  const handleSortChange = (nextKey, nextDirection) => {
    setSortKey(nextKey);
    setSortDirection(nextDirection);
  };

  const handleSortSelect = (nextKey) => {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "item" ? "asc" : "desc");
  };

  const totalScopeValue = useMemo(
    () =>
      (Array.isArray(inventoryTabItems) ? inventoryTabItems : []).reduce((sum, item) => {
        const value = Number(item?.currentValue);
        return Number.isFinite(value) ? sum + value : sum;
      }, 0),
    [inventoryTabItems],
  );

  return (
    <div className="lg:-mx-2 lg:flex lg:items-stretch">
      <FilterSidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((current) => !current)}
        collapsed={
          <div className="mt-1 flex flex-col items-stretch gap-0.5">
            {SCOPES.map((scope) => (
              <FilterScopeIcon
                key={scope.key}
                label={t(scope.labelKey)}
                icon={<scope.Icon className="size-[17px]" />}
                active={inventoryScope === scope.key}
                onClick={() => onInventoryScopeChange(scope.key)}
              />
            ))}
          </div>
        }
      >
        <FilterGroup label={t("filters.range")}>
          <div className="flex flex-col">
            {SCOPES.map((scope) => (
              <FilterScopeButton
                key={scope.key}
                label={t(scope.labelKey)}
                count={scopeCounts[scope.key]}
                active={inventoryScope === scope.key}
                onClick={() => onInventoryScopeChange(scope.key)}
              />
            ))}
          </div>
        </FilterGroup>

        {categories.length > 1 ? (
          <FilterGroup label={t("filters.category")}>
            <div className="flex flex-wrap gap-1">
              <FilterChip
                active={activeCategory === ALL_CATEGORIES}
                onClick={() => setCategory(ALL_CATEGORIES)}
              >
                {t("filters.all")}
              </FilterChip>
              {categories.map((entry) => (
                <FilterChip
                  key={entry.key}
                  active={activeCategory === entry.key}
                  onClick={() => setCategory(entry.key)}
                  title={`${entry.count} Positionen`}
                >
                  {entry.label}
                </FilterChip>
              ))}
            </div>
          </FilterGroup>
        ) : null}

        <FilterGroup label={t("filters.sorting")}>
          <div className="flex flex-col">
            {SORTS.map((sort) => (
              <FilterSortButton
                key={sort.key}
                active={sortKey === sort.key}
                direction={sortDirection}
                onClick={() => handleSortSelect(sort.key)}
              >
                {t(sort.labelKey)}
              </FilterSortButton>
            ))}
          </div>
        </FilterGroup>

        {activeCategory !== ALL_CATEGORIES ? (
          <p className="text-[10.5px] leading-[1.5] text-muted-foreground">
            Gruppen bündeln mehrere Typen und sind deshalb nur ohne Kategoriefilter sichtbar.
          </p>
        ) : null}
      </FilterSidebar>

      <div className="min-w-0 flex-1 space-y-4 lg:px-5 lg:py-[18px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="text-xl font-extrabold tracking-[-0.01em] sm:text-2xl">{t("title")}</h3>
            <p className="mt-[7px] text-xs text-muted-foreground">
              {t("summary", {
                scope: scopeLabel,
                positions: filteredItems.length,
                groups:
                  visibleGroups.length > 0
                    ? t("groupsSuffix", { count: visibleGroups.length })
                    : "",
                value: formatPrice(totalScopeValue),
              })}
            </p>
          </div>

          {/* Below lg the sidebar is hidden, so the scope switch moves inline. */}
          <SegmentedControl
            className="lg:hidden"
            size="sm"
            value={inventoryScope}
            onChange={onInventoryScopeChange}
            items={SCOPES.map((scope) => ({
              value: scope.key,
              label: t(scope.labelKey),
              count: scopeCounts[scope.key],
            }))}
          />
        </div>

        {/* The category filter lives in the desktop sidebar, which is hidden
            below lg — without this row it was simply unreachable there. Scrolls
            horizontally rather than wrapping, so a catalogue that gains types
            cannot push the list off the first screen. */}
        {categories.length > 1 ? (
          <div className="no-scrollbar -mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 lg:hidden">
            {[{ key: ALL_CATEGORIES, label: t("filters.all") }, ...categories].map((entry) => {
              const active = activeCategory === entry.key;
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setCategory(entry.key)}
                  aria-pressed={active}
                  className={`h-7 shrink-0 rounded-full px-2.5 text-[11px] transition-colors ${
                    active
                      ? "border border-border-strong bg-surface-2 font-extrabold text-foreground"
                      : "border border-border-soft font-semibold text-muted-foreground"
                  }`}
                >
                  {entry.label}
                </button>
              );
            })}
            {/* Wallet / Cash-In from the design, rendered inert: rows carry a
                `fundingMode`, but nothing filters on it yet on any surface.
                Marked rather than dropped, so the planned filter set stays
                visible — same call as the `soon` rows in the watchlist. */}
            {[t("filters.wallet"), t("filters.cashIn")].map((label) => (
              <button
                key={label}
                type="button"
                disabled
                title={t("filters.fundingSoon")}
                className="inline-flex h-7 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-full border border-border-soft px-2.5 text-[11px] font-semibold text-muted-foreground opacity-45"
              >
                {label}
                <SoonBadge />
              </button>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_356px]">
          <div className="min-w-0">
            <Suspense
              fallback={
                <div className="space-y-3 p-4">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              }
            >
              <InventoryTable
                investments={filteredItems}
                groups={visibleGroups}
                onSelectItem={onSelectItem}
                onSelectGroup={onSelectGroup}
                onSelectCluster={onSelectCluster}
                selectedId={selectedId}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSortChange={handleSortChange}
                unfilteredCount={
                  (Array.isArray(inventoryTabItems) ? inventoryTabItems.length : 0) +
                  scopedGroups.length
                }
                unfilteredItemCount={
                  Array.isArray(inventoryTabItems) ? inventoryTabItems.length : 0
                }
              />
            </Suspense>
          </div>

          {/* Visible from md, because that is where the mobile detail modal stops
              firing (BREAKPOINTS.MOBILE = 768). Between md and lg it sits under
              the table; from lg it becomes the right-hand column. */}
          <div className="hidden md:block lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
            <Suspense fallback={<Skeleton className="h-[28rem] w-full rounded-[14px]" />}>
              <ItemDetailPanel
                item={selectedItemWithLiveAndBuyOrders || selectedItem}
                history={selectedItemHistory}
                historyLoading={selectedItemHistoryLoading}
                onExcludeChange={isDesktopRuntime ? onExcludeChange : undefined}
                onBucketChange={isDesktopRuntime ? onBucketChange : undefined}
                canToggleExclude={canToggleExclude}
                canToggleBucket={canToggleBucket}
              />
            </Suspense>
          </div>
        </div>
      </div>

      {modals.map((modal) =>
        modal.type === "itemDetail" ? (() => {
          const rawModalItem = modal?.data?.item;
          // Group selections must NOT be resolved against enrichedInvestments: their
          // sourceInvestmentIds (mapped from memberInvestmentIds) overlap real rows and
          // would return a single member instead of the group aggregate.
          const isGroupModalItem =
            rawModalItem?.__detailKind === "group" ||
            rawModalItem?.__detailKind === "group-cluster";
          const liveModalItem = isGroupModalItem
            ? rawModalItem
            : resolveLiveClusterItem(rawModalItem, enrichedInvestments) || rawModalItem || null;
          const modalItemWithBuyOrders = withBuyOrderFields(liveModalItem, inventoryBuyOrderSummary);
          return (
            <Suspense key={modal.id} fallback={null}>
              <ItemDetailsModal
                isOpen={true}
                onClose={() => onCloseModal(modal.id)}
                item={modalItemWithBuyOrders}
                history={selectedItemHistory}
                historyLoading={selectedItemHistoryLoading}
                onToggleExclude={isDesktopRuntime ? onModalExcludeToggle : undefined}
                onBucketChange={isDesktopRuntime ? onBucketChange : undefined}
                canToggleExclude={isDesktopRuntime}
              />
            </Suspense>
          );
        })() : null,
      )}
    </div>
  );
}
