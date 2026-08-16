import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Callout } from "./ui/callout.jsx";
import { Card, CardContent } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { PortfolioChart } from "./PortfolioChart";
import { AlignLeft, Bell, ChevronDown, List, Trash2 } from "lucide-react";
import { ItemThumb } from "./ui/item-thumb";
import { ItemName } from "./ui/item-name.jsx";
import { resolveItemCategory, resolveItemCategorySingular } from "../lib/portfolioCalculations.js";
import { Sparkline, TargetMeter } from "./ui/data-display";
import {
  GridTable,
  GridTableEmpty,
  GridTableFoot,
  GridTableHead,
  GridTableRow,
} from "./ui/grid-table";
import {
  Inspector,
  InspectorBlock,
  InspectorEmpty,
  InspectorFooter,
  InspectorHeader,
  InspectorPrice,
} from "./ui/inspector";
import {
  FilterChip,
  FilterGroup,
  FilterScopeButton,
  FilterScopeIcon,
  FilterSidebar,
  FilterSortButton,
  SoonBadge,
} from "./ui/filter-sidebar";
import {
  parseHistoryTimestamp,
  resolveHistoryChangePercent,
  resolveHistoryValueUsd,
  resolveWatchlistChangePercent,
  sliceHistoryByDays,
} from "@shared/lib/portfolioHelpers";
import {
  fetchCsFloatBuyOrdersData,
  deleteWatchlistItemData,
  fetchWatchlistData,
  importCsFloatWatchlistData,
  importCsFloatBuyOrdersAsWatchlistData,
  updateWatchlistItemTargetData,
} from "@shared/lib/dataSource.js";
import {
  resolveWatchlistLivePriceUsd,
  resolveWatchlistTarget,
  suggestTargetDirection,
} from "@shared/lib/watchlistTargets.js";
import {
  getWatchlistMutationVersion,
  subscribeWatchlistMutation,
} from "@shared/lib/watchlistMutationBus.js";
import { getPortfolioPreferences } from "@shared/lib/portfolioPreferences";
import { BREAKPOINTS } from "@shared/lib/constants";
import { Button } from "@shared/components/ui/button";
import { DeleteConfirmModal } from "./DeleteConfirmModal";
import { WatchlistItemModal } from "./WatchlistItemModal";
import { useCurrency } from "@shared/contexts/CurrencyContext";
import {
  applyBuyOrdersToWatchlistItems,
  getLoadedWatchlistSnapshot,
  isWatchlistSnapshotFresh,
  normalizeNameKey,
  normalizeNameKeyForBuyOrderMatch,
  setWatchlistViewSnapshot,
} from "@shared/lib/watchlistViewSnapshot.js";


function resolveBuyOrderItemName(row) {
  return String(
    row?.marketHashName ||
      row?.name ||
      row?.expression ||
      row?.itemName ||
      row?.item?.market_hash_name ||
      row?.item?.marketHashName ||
      row?.item?.name ||
      "",
  ).trim();
}

function isBuyOrderMatchForItem(item, order) {
  const itemName = item?.marketHashName || item?.name;
  const orderName = resolveBuyOrderItemName(order);
  const itemExactKey = normalizeNameKey(itemName);
  const orderExactKey = normalizeNameKey(orderName);
  const itemFuzzyKey = normalizeNameKeyForBuyOrderMatch(itemName);
  const orderFuzzyKey = normalizeNameKeyForBuyOrderMatch(orderName);

  if (!itemExactKey || !orderExactKey || !itemFuzzyKey || !orderFuzzyKey) {
    return false;
  }

  if (itemExactKey === orderExactKey || itemFuzzyKey === orderFuzzyKey) {
    return true;
  }

  return itemFuzzyKey.includes(orderFuzzyKey) || orderFuzzyKey.includes(itemFuzzyKey);
}

function buildBuyOrderRowsForItem(item, orders = []) {
  if (!item || !Array.isArray(orders) || orders.length === 0) {
    return [];
  }

  const groupedByPrice = new Map();
  orders.forEach((order) => {
    if (!isBuyOrderMatchForItem(item, order)) {
      return;
    }

    const priceUsd = Number(order?.priceUsd || 0);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      return;
    }

    const quantity = Math.max(1, Number(order?.quantity || 1));
    const key = priceUsd.toFixed(4);
    const existing = groupedByPrice.get(key) || {
      priceUsd,
      orders: 0,
      quantity: 0,
      createdAtLatest: null,
    };
    existing.orders += 1;
    existing.quantity += quantity;

    const createdAtRaw = String(order?.createdAt || "").trim();
    const existingTs = Date.parse(String(existing.createdAtLatest || ""));
    const nextTs = Date.parse(createdAtRaw);
    if (Number.isFinite(nextTs) && (!Number.isFinite(existingTs) || nextTs > existingTs)) {
      existing.createdAtLatest = createdAtRaw;
    }

    groupedByPrice.set(key, existing);
  });

  return Array.from(groupedByPrice.values()).sort((left, right) => {
    if (left.priceUsd === right.priceUsd) {
      return right.orders - left.orders;
    }
    return right.priceUsd - left.priceUsd;
  });
}

/** Item | Live | 24h | 7T | 30T | Verlauf | Zielpreis — the Watchlist design's grid. */
const WATCHLIST_COLUMNS = "minmax(0,1fr) 84px 66px 66px 66px 84px 96px";

const WATCHLIST_ALL_CATEGORIES = "__all__";

/** Sidebar "Ansicht" filters. */
const WATCHLIST_SCOPES = [
  { key: "all", label: "Alle", Icon: List },
  { key: "alerts", label: "Mit Alarm", Icon: Bell },
  { key: "orders", label: "Buyorders", Icon: AlignLeft },
];

/** Trailing window for the row sparkline and the detail chart. */
const WATCHLIST_RANGES = [
  { key: 7, label: "7 Tage" },
  { key: 30, label: "30 Tage" },
  { key: 90, label: "90 Tage" },
];

const WATCHLIST_SORT_OPTIONS = [
  { key: "d7", label: "7T-Veränderung" },
  { key: "d1", label: "24h-Veränderung" },
  { key: "d30", label: "30T-Veränderung" },
  { key: "price", label: "Preis" },
  { key: "target", label: "Abstand zum Ziel" },
  { key: "name", label: "Name A–Z" },
];

function getWatchlistSortValue(item, key) {
  if (key === "name") {
    return String(item?.name || "").toLowerCase();
  }
  if (key === "price") {
    const usd = Number(item?.currentPriceUsd);
    if (Number.isFinite(usd)) {
      return usd;
    }
    const price = Number(item?.currentPrice);
    return Number.isFinite(price) ? price : Number.NEGATIVE_INFINITY;
  }
  // Change columns read the values derived in `decorateWatchlistRow`. Reading
  // `roi`/`changePercent` off the raw row (as this once did) made every entry
  // tie at -Infinity, collapsing the sort into the name tie-break.
  if (key === "d1" || key === "d7" || key === "d30") {
    const change = Number(item?.[key]);
    return Number.isFinite(change) ? change : Number.NEGATIVE_INFINITY;
  }
  // Closest to its target first, so descending (the default for numeric sorts)
  // puts the nearly-reached rows on top. Rows without a target have no distance
  // at all and sort last rather than tying at zero, which would rank them as if
  // they were exactly on target.
  if (key === "target") {
    const distance = Number(item?.target?.distancePercent);
    return Number.isFinite(distance) ? -Math.abs(distance) : Number.NEGATIVE_INFINITY;
  }
  const change = resolveWatchlistChangePercent(item);
  return Number.isFinite(change) ? change : Number.NEGATIVE_INFINITY;
}

function sortWatchlistItems(items, sortKey, sortDirection) {
  const factor = sortDirection === "asc" ? 1 : -1;
  return [...items].sort((left, right) => {
    const leftValue = getWatchlistSortValue(left, sortKey);
    const rightValue = getWatchlistSortValue(right, sortKey);

    let comparison;
    if (typeof leftValue === "string" || typeof rightValue === "string") {
      comparison = String(leftValue).localeCompare(String(rightValue), "de", {
        numeric: true,
        sensitivity: "base",
      });
    } else {
      comparison = leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
    }

    if (comparison !== 0) {
      return comparison * factor;
    }

    // Stable tie-break by name so order stays deterministic across renders.
    return String(left?.name || "").localeCompare(String(right?.name || ""), "de", {
      sensitivity: "base",
    });
  });
}

/**
 * Attach the three change windows the design's table asks for.
 *
 * Only a 7-day change ships from the API (`priceChangePercent`); 24h and 30d are
 * derived from the row's own `priceHistory`. `d7` prefers the derived value too
 * so all three columns come from one series and cannot disagree, and falls back
 * to the server number when the history is too short to answer.
 */
function decorateWatchlistRow(item) {
  const history = Array.isArray(item?.priceHistory) ? item.priceHistory : [];
  const derived7d = resolveHistoryChangePercent(history, 7);

  return {
    ...item,
    d1: resolveHistoryChangePercent(history, 1),
    d7: derived7d ?? resolveWatchlistChangePercent(item),
    d30: resolveHistoryChangePercent(history, 30),
    // Resolved once per row so the table cell, the mobile card and the inspector
    // cannot disagree about distance or whether the target is reached.
    target: resolveWatchlistTarget(item),
  };
}

/** "noch −12,3 %" / "+4,0 % über Ziel" — the distance the price still has to go. */
function formatTargetDistance(distancePercent) {
  if (!Number.isFinite(distancePercent)) {
    return "–";
  }
  const rounded = Math.abs(distancePercent);
  if (rounded < 0.05) {
    return "am Ziel";
  }
  return `${distancePercent >= 0 ? "+" : "−"}${rounded.toFixed(1)} %`;
}

function formatSignedPercentOneDecimal(value) {
  if (!Number.isFinite(value)) {
    return "–";
  }
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)} %`;
}

function changeToneClass(value) {
  if (!Number.isFinite(value)) {
    return "text-muted-foreground";
  }
  if (value === 0) {
    return "text-muted-foreground";
  }
  return value > 0 ? "text-success" : "text-danger";
}

/** "Beobachtet seit" — desktop rows carry `createdAt`; web rows do not. */
function formatWatchedSince(item) {
  const timestamp = parseHistoryTimestamp(item?.createdAt || item?.addedAt);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function WatchlistItemsLoadingSkeleton() {
  return (
    <GridTable>
      <GridTableHead columns={WATCHLIST_COLUMNS}>
        <span>Item</span>
        <span className="text-right">Live</span>
        <span className="text-right">24h</span>
        <span className="text-right">7T</span>
        <span className="text-right">30T</span>
        <span className="text-right">Verlauf</span>
        <span className="text-right">Zielpreis</span>
      </GridTableHead>
      {[1, 2, 3, 4, 5].map((entry) => (
        <div
          key={entry}
          className="flex items-center gap-[11px] border-b border-border-soft px-4 py-[9px]"
        >
          <Skeleton className="size-[34px] shrink-0 rounded-lg" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </GridTable>
  );
}

export const Watchlist = ({ focusTarget = null, onWarningsChange }) => {
  const { currency, formatPrice, convertToUsd, convertFromUsd } = useCurrency();
  const validSnapshot = getLoadedWatchlistSnapshot();
  const [watchlistItems, setWatchlistItems] = useState(() => validSnapshot?.items || []);
  const [_buyOrderSummary, setBuyOrderSummary] = useState(() => validSnapshot?.buyOrderSummary || []);
  const [buyOrderOrders, setBuyOrderOrders] = useState(() => validSnapshot?.buyOrderOrders || []);
  const [buyOrderDebug, setBuyOrderDebug] = useState(() => validSnapshot?.buyOrderDebug || null);
  const [loading, setLoading] = useState(() => !validSnapshot);
  const [selectedItem, setSelectedItem] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState(() => validSnapshot?.warnings || []);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [targetInput, setTargetInput] = useState("");
  const [isSavingTarget, setIsSavingTarget] = useState(false);
  const [targetError, setTargetError] = useState("");
  const [showAbsolute, setShowAbsolute] = useState(false);
  const [sortKey, setSortKey] = useState("d7");
  const [sortDirection, setSortDirection] = useState("desc");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [category, setCategory] = useState(WATCHLIST_ALL_CATEGORIES);
  const [scope, setScope] = useState("all");
  const [range, setRange] = useState(90);
  const [isImportingCsFloat, setIsImportingCsFloat] = useState(false);
  const [watchlistMutationVersion, setWatchlistMutationVersion] = useState(getWatchlistMutationVersion);
  const handledMutationVersionRef = useRef(getWatchlistMutationVersion());
  const itemRefs = useRef(new Map());
  const isDesktopRuntime = typeof window !== "undefined" && Boolean(window.electronAPI?.localStore);
  const hasFiniteNumber = (value) => Number.isFinite(Number(value));
  const combinedWarnings = useMemo(() => [...warnings], [warnings]);
  const selectedItemBuyOrderRows = useMemo(
    () => buildBuyOrderRowsForItem(selectedItem, buyOrderOrders),
    [selectedItem, buyOrderOrders],
  );
  // The three change windows are derived once per load, not per render: they
  // walk the whole (hourly, ~1500-point) history three times per row.
  const decoratedItems = useMemo(
    () => watchlistItems.map(decorateWatchlistRow),
    [watchlistItems],
  );

  // Categories come from the item types actually on the watchlist, so the chip
  // row tracks the catalog instead of a hardcoded list.
  const watchlistCategories = useMemo(() => {
    const seen = new Map();
    watchlistItems.forEach((item) => {
      const key = resolveItemCategory(item).toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, { key, label: resolveItemCategory(item), count: 0 });
      }
      seen.get(key).count += 1;
    });
    return Array.from(seen.values()).sort((left, right) =>
      left.label.localeCompare(right.label, "de"),
    );
  }, [watchlistItems]);

  const activeCategory = watchlistCategories.some((entry) => entry.key === category)
    ? category
    : WATCHLIST_ALL_CATEGORIES;

  const buyOrderItemCount = useMemo(
    () => decoratedItems.filter((item) => item?.hasBuyOrder).length,
    [decoratedItems],
  );

  const sortedWatchlistItems = useMemo(() => {
    let scoped = decoratedItems;
    if (scope === "orders") {
      scoped = scoped.filter((item) => item?.hasBuyOrder);
    }
    if (scope === "alerts") {
      scoped = scoped.filter((item) => item?.target?.hasTarget);
    }
    if (activeCategory !== WATCHLIST_ALL_CATEGORIES) {
      scoped = scoped.filter(
        (item) => resolveItemCategory(item).toLowerCase() === activeCategory,
      );
    }
    return sortWatchlistItems(scoped, sortKey, sortDirection);
  }, [decoratedItems, scope, activeCategory, sortKey, sortDirection]);
  // Decorated here as well as in the list: the selection survives a reload via
  // `nextItems.find(...)`, which hands back a raw row without the change fields.
  const selectedItemWithBuyOrderRows = useMemo(() => (
    selectedItem
      ? {
          ...decorateWatchlistRow(selectedItem),
          buyOrderRows: selectedItemBuyOrderRows,
        }
      : null
  ), [selectedItem, selectedItemBuyOrderRows]);

  const loadWatchlistData = useCallback(async ({ showLoading = true } = {}) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      setError("");

      // Auto-imports run fire-and-forget: they self-throttle (cooldown) and, when
      // they add items, notify the watchlist mutation bus which re-triggers this
      // load. Awaiting them here serialized several upstream round-trips in front
      // of the first paint and made the tab feel stuck on a spinner.
      if (isDesktopRuntime) {
        void (async () => {
          try {
            const prefs = await getPortfolioPreferences();
            const autoImportPromises = [];
            if (prefs?.csfloatWatchlistAutoImport) {
              autoImportPromises.push(importCsFloatWatchlistData());
            }
            if (prefs?.csfloatBuyOrderAutoImport) {
              autoImportPromises.push(importCsFloatBuyOrdersAsWatchlistData());
            }
            if (autoImportPromises.length > 0) {
              await Promise.allSettled(autoImportPromises);
            }
          } catch (autoImportError) {
            console.warn("[watchlist] csfloat auto-import failed", autoImportError);
          }
        })();
      }

      // Fast first paint: serve the local watchlist (no desktop sync, no live
      // CSFloat refresh) before the heavy live pass below replaces it. Only
      // worth it when the view has nothing to show yet.
      if (showLoading && isDesktopRuntime) {
        try {
          const quickResponse = await fetchWatchlistData({
            syncLive: false,
            skipDesktopSync: true,
          });
          const quickItems = Array.isArray(quickResponse?.data) ? quickResponse.data : [];
          if (quickItems.length > 0) {
            setWatchlistItems(applyBuyOrdersToWatchlistItems(quickItems, []));
            setLoading(false);
          }
        } catch (quickError) {
          console.warn("[watchlist] quick local paint failed", quickError);
        }
      }

      // Cache-only read against the homeserver (single source of truth): prices
      // come from item_live_cache, refreshed solely by the server cron. syncLive
      // would trigger a per-item CSFloat lookup + 200ms sleep on the server —
      // that live path is reserved for explicit sync actions.
      const response = await fetchWatchlistData({ syncLive: false });
      const nextItemsRaw = response?.data || [];
      const nextWarnings = response?.meta?.warnings || [];
      let nextBuyOrderSummary = [];
      let nextBuyOrderOrders = [];
      let nextBuyOrderDebug = null;

      if (isDesktopRuntime) {
        try {
          const buyOrderResponse = await fetchCsFloatBuyOrdersData();
          const buyOrderMeta = buyOrderResponse?.meta || {};
          nextBuyOrderSummary = Array.isArray(buyOrderResponse?.data?.summaryByMarketHashName)
            ? buyOrderResponse.data.summaryByMarketHashName
            : [];
          nextBuyOrderOrders = Array.isArray(buyOrderResponse?.data?.orders)
            ? buyOrderResponse.data.orders
            : [];
          nextBuyOrderDebug = {
            clientSource: String(buyOrderMeta?.source || "unknown"),
            upstreamSource: String(buyOrderMeta?.upstreamSource || buyOrderMeta?.source || "unknown"),
            pagesFetched: Number(buyOrderMeta?.pagesFetched || 0),
            fromCache: Boolean(buyOrderMeta?.fromCache),
            rawOrders: nextBuyOrderOrders.length,
            summaryItems: nextBuyOrderSummary.length,
            errorCount: Array.isArray(buyOrderMeta?.errors) ? buyOrderMeta.errors.length : 0,
            firstErrorCode: String(buyOrderMeta?.errors?.[0]?.code || ""),
            firstErrorStatus: Number(buyOrderMeta?.errors?.[0]?.statusCode || 0),
            buyOrdersErrorCode: String(buyOrderMeta?.buyOrdersError?.code || ""),
            buyOrdersErrorStatus: Number(buyOrderMeta?.buyOrdersError?.statusCode || 0),
          };

          if (nextBuyOrderSummary.length === 0 || nextBuyOrderOrders.length === 0) {
            const liveBuyOrderResponse = await fetchCsFloatBuyOrdersData({
              syncNow: true,
            });
            const liveMeta = liveBuyOrderResponse?.meta || {};
            nextBuyOrderSummary = Array.isArray(liveBuyOrderResponse?.data?.summaryByMarketHashName)
              ? liveBuyOrderResponse.data.summaryByMarketHashName
              : [];
            nextBuyOrderOrders = Array.isArray(liveBuyOrderResponse?.data?.orders)
              ? liveBuyOrderResponse.data.orders
              : [];
            nextBuyOrderDebug = {
              clientSource: String(liveMeta?.source || "unknown"),
              upstreamSource: String(liveMeta?.upstreamSource || liveMeta?.source || "unknown"),
              pagesFetched: Number(liveMeta?.pagesFetched || 0),
              fromCache: Boolean(liveMeta?.fromCache),
              rawOrders: nextBuyOrderOrders.length,
              summaryItems: nextBuyOrderSummary.length,
              errorCount: Array.isArray(liveMeta?.errors) ? liveMeta.errors.length : 0,
              firstErrorCode: String(liveMeta?.errors?.[0]?.code || ""),
              firstErrorStatus: Number(liveMeta?.errors?.[0]?.statusCode || 0),
              buyOrdersErrorCode: String(liveMeta?.buyOrdersError?.code || ""),
              buyOrdersErrorStatus: Number(liveMeta?.buyOrdersError?.statusCode || 0),
            };
          }
        } catch (buyOrderError) {
          console.warn("[watchlist] CSFloat buyorders unavailable", buyOrderError);
          nextBuyOrderDebug = {
            clientSource: "error",
            upstreamSource: "error",
            pagesFetched: 0,
            fromCache: false,
            rawOrders: 0,
            summaryItems: 0,
            errorCount: 1,
            firstErrorCode: "WATCHLIST_BUYORDER_FETCH_FAILED",
            firstErrorStatus: 0,
          };
        }
      }

      const nextItems = applyBuyOrdersToWatchlistItems(nextItemsRaw, nextBuyOrderSummary);

      setWatchlistItems(nextItems);
      setBuyOrderSummary(nextBuyOrderSummary);
      setBuyOrderOrders(nextBuyOrderOrders);
      setBuyOrderDebug(nextBuyOrderDebug);
      setWarnings(nextWarnings);
      setWatchlistViewSnapshot({
        items: nextItems,
        buyOrderSummary: nextBuyOrderSummary,
        buyOrderOrders: nextBuyOrderOrders,
        buyOrderDebug: nextBuyOrderDebug,
        warnings: nextWarnings,
      });
      setSelectedItem((currentSelection) => {
        if (!currentSelection) {
          return null;
        }

        return (
          nextItems.find((item) => item.id === currentSelection.id) || null
        );
      });
    } catch (requestError) {
      const isNetworkError = String(requestError?.name || "") === "TypeError";

      if (isNetworkError) {
        try {
          const fallbackResponse = await fetchWatchlistData({ syncLive: false });
          const fallbackItems = applyBuyOrdersToWatchlistItems(fallbackResponse?.data || [], []);

          setWatchlistItems(fallbackItems);
          setBuyOrderSummary([]);
          setBuyOrderOrders([]);
          setBuyOrderDebug({
            clientSource: "watchlist-fallback",
            upstreamSource: "watchlist-fallback",
            pagesFetched: 0,
            fromCache: false,
            rawOrders: 0,
            summaryItems: 0,
            errorCount: 1,
            firstErrorCode: "WATCHLIST_SYNC_FALLBACK",
            firstErrorStatus: 0,
          });
          setWatchlistViewSnapshot({
            items: fallbackItems,
            buyOrderSummary: [],
            buyOrderOrders: [],
            buyOrderDebug: {
              clientSource: "watchlist-fallback",
              upstreamSource: "watchlist-fallback",
              pagesFetched: 0,
              fromCache: false,
              rawOrders: 0,
              summaryItems: 0,
              errorCount: 1,
              firstErrorCode: "WATCHLIST_SYNC_FALLBACK",
              firstErrorStatus: 0,
            },
            warnings: [
              {
                code: "WATCHLIST_SYNC_FALLBACK",
                label: "Live-Sync eingeschraenkt",
                message: "Watchlist wurde ohne Live-Sync geladen. Bitte spaeter erneut versuchen.",
              },
            ],
          });
          setWarnings([
            {
              code: "WATCHLIST_SYNC_FALLBACK",
              label: "Live-Sync eingeschraenkt",
              message: "Watchlist wurde ohne Live-Sync geladen. Bitte spaeter erneut versuchen.",
            },
          ]);
          return;
        } catch (fallbackError) {
          setError(fallbackError.message || "Fehler beim Laden der Watchlist.");
          setWarnings([]);
          return;
        }
      }

      setError(requestError.message || "Fehler beim Laden der Watchlist.");
      setBuyOrderSummary([]);
      setBuyOrderOrders([]);
      setBuyOrderDebug({
        clientSource: "watchlist-error",
        upstreamSource: "watchlist-error",
        pagesFetched: 0,
        fromCache: false,
        rawOrders: 0,
        summaryItems: 0,
        errorCount: 1,
        firstErrorCode: "WATCHLIST_SYNC_ERROR",
        firstErrorStatus: 0,
      });
      setWarnings([]);
    } finally {
      setLoading(false);
    }
  }, [isDesktopRuntime]);

  useEffect(() => {
    // Fresh snapshot (e.g. from the startup prefetch): serve it as-is, no
    // network. A stale-but-loaded snapshot is already painted via the state
    // initializers; refresh it in the background without a spinner.
    if (isWatchlistSnapshotFresh()) {
      return;
    }
    void loadWatchlistData({ showLoading: !getLoadedWatchlistSnapshot() });
  }, [loadWatchlistData]);

  // Refetch when a watchlist mutation happens elsewhere (search add, batch
  // import). The tab stays mounted via forceMount, so the snapshot it holds
  // would otherwise stay stale until a full reload.
  useEffect(() => subscribeWatchlistMutation(setWatchlistMutationVersion), []);

  useEffect(() => {
    if (watchlistMutationVersion === handledMutationVersionRef.current) {
      return;
    }
    handledMutationVersionRef.current = watchlistMutationVersion;
    void loadWatchlistData({ showLoading: false });
  }, [watchlistMutationVersion, loadWatchlistData]);

  // Seed the target field from the selected row, in display currency. Keyed on
  // the id and the stored target, never on the row object: that object is
  // rebuilt on every price refresh and would wipe what the user is typing.
  useEffect(() => {
    const targetUsd = selectedItem?.alertPriceUsd ?? null;
    setTargetInput(
      targetUsd === null ? "" : String(convertFromUsd(Number(targetUsd)).toFixed(2)),
    );
    setTargetError("");
  }, [selectedItem?.id, selectedItem?.alertPriceUsd, convertFromUsd]);

  useEffect(() => {
    onWarningsChange?.(combinedWarnings);
  }, [combinedWarnings, onWarningsChange]);

  useEffect(() => () => {
    onWarningsChange?.([]);
  }, [onWarningsChange]);

  useEffect(() => {
    if (!focusTarget?.id || watchlistItems.length === 0) {
      return;
    }

    const matchingItem = watchlistItems.find((item) => item.id === focusTarget.id);
    if (!matchingItem) {
      return;
    }

    setSelectedItem(matchingItem);

    const nextFrame = window.requestAnimationFrame(() => {
      const itemNode = itemRefs.current.get(matchingItem.id);
      itemNode?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });

    return () => {
      window.cancelAnimationFrame(nextFrame);
    };
  }, [focusTarget, watchlistItems]);

  const handleRemoveItem = async (id) => {
    try {
      await deleteWatchlistItemData(id);
      setSelectedItem(null);
      setShowDeleteConfirm(false);
      await loadWatchlistData();
    } catch (requestError) {
      setError(
        requestError.message || "Fehler beim Entfernen des Watchlist-Items."
      );
    } finally {
      setIsDeleting(false);
    }
  };

  // Manual counterpart to the opt-in auto-import: forces a CSFloat watchlist
  // pull past the 60s cooldown. Add-only, so it can be re-run safely.
  const handleImportCsFloatWatchlist = async () => {
    setIsImportingCsFloat(true);
    try {
      await importCsFloatWatchlistData({ force: true });
      await loadWatchlistData({ showLoading: false });
    } catch (importError) {
      setError(importError?.message || "CSFloat-Import fehlgeschlagen.");
    } finally {
      setIsImportingCsFloat(false);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await handleRemoveItem(selectedItem.id);
    } finally {
      setIsDeleting(false);
    }
  };

  /**
   * Save or clear the selected item's target.
   *
   * The input is in display currency and converted at this boundary — the same
   * split the manual buy-price field uses, and the reason USD stays the only
   * persisted form. The anchor is the live price *now*, captured here because
   * this is the only moment the "where it started" of the progress bar is known.
   */
  const handleSaveTarget = async (clear = false) => {
    if (!selectedItem?.id) {
      return;
    }

    let alertPriceUsd = null;
    if (!clear) {
      const parsed = Number(String(targetInput).replace(",", "."));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setTargetError("Bitte einen Zielpreis groesser 0 angeben.");
        return;
      }
      alertPriceUsd = Number(convertToUsd(parsed).toFixed(2));
    }

    const livePriceUsd = resolveWatchlistLivePriceUsd(selectedItem);
    setIsSavingTarget(true);
    setTargetError("");
    try {
      await updateWatchlistItemTargetData(selectedItem.id, {
        alertPriceUsd,
        alertDirection: suggestTargetDirection(alertPriceUsd, livePriceUsd),
        alertAnchorPriceUsd: livePriceUsd,
      });
      await loadWatchlistData({ showLoading: false });
      if (clear) {
        setTargetInput("");
      }
    } catch (saveError) {
      setTargetError(saveError?.message || "Zielpreis konnte nicht gespeichert werden.");
    } finally {
      setIsSavingTarget(false);
    }
  };

  const handleSortSelect = (nextKey) => {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    // Names read best ascending (A→Z); numeric metrics best descending.
    setSortKey(nextKey);
    setSortDirection(nextKey === "name" ? "asc" : "desc");
  };

  // The mobile sort is one cycling button, not a chip strip — the four usable
  // sorts filled a whole row on a 380px screen. `soon` options are skipped:
  // cycling into a sort that cannot run would be a dead tap.
  const mobileSortOptions = WATCHLIST_SORT_OPTIONS.filter((option) => !option.soon);
  const activeMobileSortIndex = Math.max(
    0,
    mobileSortOptions.findIndex((option) => option.key === sortKey),
  );
  const activeMobileSort = mobileSortOptions[activeMobileSortIndex];
  const nextMobileSort =
    mobileSortOptions[(activeMobileSortIndex + 1) % mobileSortOptions.length];

  const watchedSince = formatWatchedSince(selectedItemWithBuyOrderRows);
  const selectedBestBuyOrder = selectedItemBuyOrderRows[0] || null;
  const selectedD1 = Number(selectedItemWithBuyOrderRows?.d1);
  // The detail chart keeps its own 7T/30T/1J/MAX control, so it gets the full
  // series. "Zeitraum" governs the table's Verlauf column — two range controls
  // narrowing the same chart would just fight each other.
  const selectedChartHistory = Array.isArray(selectedItemWithBuyOrderRows?.priceHistory)
    ? selectedItemWithBuyOrderRows.priceHistory
    : [];

  return (
    <div className="lg:-mx-2 lg:flex lg:items-stretch">
      <FilterSidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((current) => !current)}
        collapsed={
          <div className="mt-1 flex flex-col items-stretch gap-0.5">
            {WATCHLIST_SCOPES.map((entry) => (
              <FilterScopeIcon
                key={entry.key}
                label={entry.label}
                icon={<entry.Icon className="size-[17px]" />}
                soon={entry.soon}
                active={scope === entry.key}
                onClick={() => setScope(entry.key)}
              />
            ))}
          </div>
        }
      >
        <FilterGroup label="Ansicht">
          <div className="flex flex-col">
            {WATCHLIST_SCOPES.map((entry) => (
              <FilterScopeButton
                key={entry.key}
                label={entry.label}
                soon={entry.soon}
                count={
                  entry.key === "all"
                    ? decoratedItems.length
                    : entry.key === "orders"
                      ? buyOrderItemCount
                      : null
                }
                active={scope === entry.key}
                onClick={() => setScope(entry.key)}
              />
            ))}
          </div>
        </FilterGroup>

        {watchlistCategories.length > 1 ? (
          <FilterGroup label="Kategorie">
            <div className="flex flex-wrap gap-1">
              <FilterChip
                active={activeCategory === WATCHLIST_ALL_CATEGORIES}
                onClick={() => setCategory(WATCHLIST_ALL_CATEGORIES)}
              >
                Alle
              </FilterChip>
              {watchlistCategories.map((entry) => (
                <FilterChip
                  key={entry.key}
                  active={activeCategory === entry.key}
                  onClick={() => setCategory(entry.key)}
                  title={`${entry.count} Items`}
                >
                  {entry.label}
                </FilterChip>
              ))}
            </div>
          </FilterGroup>
        ) : null}

        <FilterGroup label="Zeitraum">
          <div className="flex flex-col">
            {WATCHLIST_RANGES.map((entry) => (
              <FilterSortButton
                key={entry.key}
                active={range === entry.key}
                onClick={() => setRange(entry.key)}
              >
                {entry.label}
              </FilterSortButton>
            ))}
          </div>
        </FilterGroup>

        <FilterGroup label="Sortierung">
          <div className="flex flex-col">
            {WATCHLIST_SORT_OPTIONS.map((option) => (
              <FilterSortButton
                key={option.key}
                active={sortKey === option.key}
                direction={sortDirection}
                soon={option.soon}
                onClick={() => handleSortSelect(option.key)}
              >
                {option.label}
              </FilterSortButton>
            ))}
          </div>
        </FilterGroup>
      </FilterSidebar>

      <div className="min-w-0 flex-1 space-y-4 lg:px-5 lg:py-[18px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold tracking-[-0.01em] sm:text-2xl">Watchlist</h2>
            <p className="mt-[7px] text-xs text-muted-foreground">
              {sortedWatchlistItems.length}
              {sortedWatchlistItems.length === decoratedItems.length
                ? ""
                : ` von ${decoratedItems.length}`}{" "}
              Items · {buyOrderItemCount} mit Buyorder · Preise aus dem Server-Cache
            </p>
          </div>
          {isDesktopRuntime ? (
            <Button
              variant="outline"
              size="sm"
              className="h-[34px]"
              disabled={isImportingCsFloat}
              onClick={() => void handleImportCsFloatWatchlist()}
            >
              {isImportingCsFloat ? "Importiere…" : "CSFloat importieren"}
            </Button>
          ) : null}
        </div>

        {error ? <Callout tone="danger">{error}</Callout> : null}

        {loading ? (
          <WatchlistItemsLoadingSkeleton />
        ) : watchlistItems.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-center text-muted-foreground sm:p-8">
              <p className="text-sm">
                Keine Items in der Watchlist. Nutze die Suche oben und fuege neue Items hinzu.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_356px]">
            <div className="min-w-0">
              {/* Desktop: Item | Live | 24h | 7T | 30T | Verlauf | Zielpreis */}
              <div className="hidden md:block">
                <GridTable>
                  <GridTableHead columns={WATCHLIST_COLUMNS}>
                    <span>Item</span>
                    <span className="text-right">Live</span>
                    <span className="text-right" title="Preisänderung der letzten 24 Stunden">
                      24h
                    </span>
                    <span className="text-right" title="Preisänderung der letzten 7 Tage">
                      7T
                    </span>
                    <span className="text-right" title="Preisänderung der letzten 30 Tage">
                      30T
                    </span>
                    <span className="text-right">Verlauf</span>
                    <span className="text-right">Zielpreis</span>
                  </GridTableHead>

                  {sortedWatchlistItems.length === 0 ? (
                    <GridTableEmpty>Keine Items für diese Filter.</GridTableEmpty>
                  ) : null}

                  {sortedWatchlistItems.map((item) => {
                    const historyValues = sliceHistoryByDays(item.priceHistory, range).map(
                      (entry) => Number(resolveHistoryValueUsd(entry)),
                    );
                    const hasItemBuyOrder =
                      item?.hasBuyOrder && Number(item?.buyOrderBestPriceUsd || 0) > 0;

                    return (
                      <GridTableRow
                        key={item.id}
                        columns={WATCHLIST_COLUMNS}
                        selected={selectedItem?.id === item.id}
                        ref={(node) => {
                          if (node) {
                            itemRefs.current.set(item.id, node);
                            return;
                          }
                          itemRefs.current.delete(item.id);
                        }}
                        onClick={() => setSelectedItem(item)}
                      >
                        <div className="flex min-w-0 items-center gap-[11px]">
                          <ItemThumb
                            src={item.imageUrl}
                            alt={item.name}
                            className="size-[30px] rounded-none border-border-soft"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-bold">
                              {item.name}
                            </span>
                            <span className="mt-[3px] flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                              <span className="truncate">{resolveItemCategorySingular(item)}</span>
                              {hasItemBuyOrder ? (
                                <span
                                  title="Offene CSFloat-Buyorder"
                                  className="shrink-0 bg-info/16 px-1.5 py-px text-[9px] font-extrabold tracking-[0.04em] text-info"
                                >
                                  BO{" "}
                                  {formatPrice(Number(item.buyOrderBestPriceUsd), {
                                    useUsd: true,
                                    buyPriceUsd: Number(item.buyOrderBestPriceUsd),
                                  })}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </div>

                        <span className="text-right text-[13.5px] font-bold tabular-nums">
                          {hasFiniteNumber(item.currentPrice) ? (
                            formatPrice(Number(item.currentPrice))
                          ) : (
                            <span className="text-[11px] font-medium text-muted-foreground">
                              –
                            </span>
                          )}
                        </span>

                        {[item.d1, item.d7, item.d30].map((change, index) => (
                          <span
                            key={index}
                            className={`text-right text-xs font-bold tabular-nums ${changeToneClass(change)}`}
                          >
                            {formatSignedPercentOneDecimal(change)}
                          </span>
                        ))}

                        {/* Colour is left to the sparkline, which derives it from
                            the samples it actually draws. Forcing it from `d7`
                            painted a 90-day decline green whenever the last week
                            happened to be flat. */}
                        <span className="flex items-center justify-end">
                          <Sparkline values={historyValues} width={80} height={26} />
                        </span>

                        {/* Target: the price on top, the remaining distance
                            below. At 96px there is no room for the bar as well —
                            the mobile card and the inspector carry that. */}
                        <span className="flex flex-col items-end justify-center leading-tight">
                          {item.target?.hasTarget ? (
                            <>
                              <span
                                className={`flex items-center gap-1 text-xs font-bold tabular-nums ${
                                  item.target.reached ? "text-success" : "text-foreground"
                                }`}
                              >
                                <Bell className="size-[11px]" aria-hidden="true" />
                                {formatPrice(item.target.targetPriceUsd, {
                                  useUsd: true,
                                  buyPriceUsd: item.target.targetPriceUsd,
                                })}
                              </span>
                              <span
                                className={`text-[10.5px] font-semibold tabular-nums ${
                                  item.target.reached ? "text-success" : "text-muted-foreground"
                                }`}
                              >
                                {item.target.reached
                                  ? "erreicht"
                                  : formatTargetDistance(item.target.distancePercent)}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs tabular-nums text-muted-foreground">–</span>
                          )}
                        </span>
                      </GridTableRow>
                    );
                  })}

                  <GridTableFoot>
                    <span>
                      {sortedWatchlistItems.length === decoratedItems.length
                        ? `${sortedWatchlistItems.length} Items`
                        : `${sortedWatchlistItems.length} von ${decoratedItems.length} Items`}
                    </span>
                    <span>
                      Verlauf: {WATCHLIST_RANGES.find((entry) => entry.key === range)?.label}
                    </span>
                  </GridTableFoot>
                </GridTable>
              </div>

              {/* Mobile: the design's watch card. The sidebar is desktop-only,
                  so the range and sort controls it owns stay inline here. The
                  card's lower half carries the target price, the remaining
                  distance and the progress bar. */}
              <div className="space-y-2.5 md:hidden">
                {/* Category and range both live in the desktop-only sidebar,
                    so without these rows neither is reachable on mobile. */}
                {watchlistCategories.length > 1 ? (
                  <div className="no-scrollbar -mx-3.5 flex gap-1.5 overflow-x-auto px-3.5">
                    {[{ key: WATCHLIST_ALL_CATEGORIES, label: "Alle" }, ...watchlistCategories].map(
                      (entry) => {
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
                      },
                    )}
                  </div>
                ) : null}

                <div className="no-scrollbar -mx-3.5 flex gap-1.5 overflow-x-auto px-3.5">
                  {WATCHLIST_RANGES.map((entry) => {
                    const active = range === entry.key;
                    return (
                      <button
                        key={entry.key}
                        type="button"
                        onClick={() => setRange(entry.key)}
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
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">
                    {sortedWatchlistItems.length === decoratedItems.length
                      ? `${sortedWatchlistItems.length} Items`
                      : `${sortedWatchlistItems.length} von ${decoratedItems.length} Items`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleSortSelect(nextMobileSort.key)}
                    className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[11px] font-semibold"
                    title={`Sortiert nach ${activeMobileSort.label} — tippen für ${nextMobileSort.label}`}
                  >
                    {activeMobileSort.label}
                    <span aria-hidden="true" className="text-[10px] text-muted-foreground">
                      {sortDirection === "asc" ? "↑" : "↓"}
                    </span>
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  </button>
                </div>

                {sortedWatchlistItems.map((item) => {
                  const historyValues = sliceHistoryByDays(item.priceHistory, range).map((entry) =>
                    Number(resolveHistoryValueUsd(entry)),
                  );
                  // Always the 7-day change, never the selected Zeitraum: that
                  // control governs the sparkline window (as it does the
                  // desktop Verlauf column), and there is no d90 field to show
                  // at 90 Tage — a pill silently falling back to d7 under a
                  // "90 Tage" chip claims a number it is not.
                  const rangeChange = item.d7;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelectedItem(item);
                        if (window.innerWidth < BREAKPOINTS.MOBILE) {
                          setIsModalOpen(true);
                        }
                      }}
                      className="flex w-full flex-col gap-2.5 rounded-2xl border border-border bg-card px-3.5 py-[13px] text-left"
                    >
                      <span className="flex w-full items-center gap-[11px]">
                      <ItemThumb
                        src={item.imageUrl}
                        alt={item.name}
                        className="size-[38px] shrink-0 rounded-[9px]"
                      />
                      <span className="min-w-0 flex-1">
                        <ItemName name={item.name} nameClassName="text-[13.5px] font-bold" />
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {resolveItemCategorySingular(item)}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-[15px] font-extrabold tabular-nums">
                          {hasFiniteNumber(item.currentPrice) ? formatPrice(Number(item.currentPrice)) : "–"}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Sparkline values={historyValues} width={44} height={16} />
                          <span
                            className={`inline-flex h-[21px] items-center rounded-full px-[7px] text-[10px] font-bold tabular-nums ${
                              !hasFiniteNumber(rangeChange)
                                ? "bg-surface-2 text-muted-foreground"
                                : Number(rangeChange) >= 0
                                  ? "bg-success/15 text-success"
                                  : "bg-danger/15 text-danger"
                            }`}
                          >
                            7T {formatSignedPercentOneDecimal(rangeChange)}
                          </span>
                        </span>
                      </span>
                      </span>

                      {/* Target price, remaining distance and the progress bar.
                          Only rendered for rows that carry a target — an empty
                          track on every card would be noise on a phone. */}
                      {item.target?.hasTarget ? (
                        <span className="flex w-full flex-col gap-1.5 border-t border-border-soft pt-2.5">
                          <span className="flex items-center justify-between gap-2">
                            <span
                              className={`flex items-center gap-1.5 text-[11px] font-bold ${
                                item.target.reached ? "text-success" : "text-muted-foreground"
                              }`}
                            >
                              <Bell className="size-[13px]" />
                              {formatPrice(item.target.targetPriceUsd, {
                                useUsd: true,
                                buyPriceUsd: item.target.targetPriceUsd,
                              })}
                            </span>
                            <span
                              className={`text-[10.5px] font-bold tabular-nums ${
                                item.target.reached ? "text-success" : "text-muted-foreground"
                              }`}
                            >
                              {item.target.reached
                                ? "Ziel erreicht"
                                : formatTargetDistance(item.target.distancePercent)}
                            </span>
                          </span>
                          <TargetMeter
                            value={item.target.progressPercent}
                            reached={item.target.reached}
                          />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Visible from md, where the mobile detail modal stops firing. */}
            <div className="hidden md:block lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
              {selectedItemWithBuyOrderRows ? (
                <Inspector>
                  <InspectorHeader
                    thumb={
                      <ItemThumb
                        src={selectedItemWithBuyOrderRows.imageUrl}
                        alt={selectedItemWithBuyOrderRows.name}
                        className="size-16 rounded-none border-border-soft p-1"
                      />
                    }
                    title={selectedItemWithBuyOrderRows.name}
                    // "Beobachtet seit" lives in the stat rows below; repeating
                    // it here only truncated the line.
                    meta={resolveItemCategorySingular(selectedItemWithBuyOrderRows)}
                    onClose={() => setSelectedItem(null)}
                  />

                  <InspectorPrice
                    value={
                      hasFiniteNumber(selectedItemWithBuyOrderRows.currentPrice)
                        ? formatPrice(Number(selectedItemWithBuyOrderRows.currentPrice))
                        : "Kein Preis"
                    }
                    delta={
                      Number.isFinite(selectedD1)
                        ? `${formatSignedPercentOneDecimal(selectedD1)} (24h)`
                        : null
                    }
                    tone={
                      !Number.isFinite(selectedD1)
                        ? "muted"
                        : selectedD1 >= 0
                          ? "success"
                          : "danger"
                    }
                  />

                  {Array.isArray(selectedChartHistory) && selectedChartHistory.length > 0 ? (
                    <InspectorBlock
                      label="Preisentwicklung"
                      aside={
                        <button
                          type="button"
                          onClick={() => setShowAbsolute((current) => !current)}
                          className="font-extrabold uppercase tracking-[0.12em] transition-colors hover:text-foreground"
                          title="Zwischen Absolutwert und Wachstum umschalten"
                        >
                          {showAbsolute ? currency : "%"}
                        </button>
                      }
                    >
                      <PortfolioChart
                        history={selectedChartHistory}
                        color={
                          Number.isFinite(selectedD1) && selectedD1 < 0 ? "#ef4444" : "#22c55e"
                        }
                        valueLabel="Preis"
                        title=""
                        showAbsolute={showAbsolute}
                        flat
                      />
                    </InspectorBlock>
                  ) : (
                    <InspectorBlock label="Preisentwicklung">
                      <p className="mt-2 text-[12px] text-muted-foreground">
                        Keine Preishistorie verfuegbar.
                      </p>
                    </InspectorBlock>
                  )}

                  {[
                    { label: "24 Stunden", value: selectedItemWithBuyOrderRows.d1 },
                    { label: "7 Tage", value: selectedItemWithBuyOrderRows.d7 },
                    { label: "30 Tage", value: selectedItemWithBuyOrderRows.d30 },
                  ].map((entry) => (
                    <div
                      key={entry.label}
                      className="flex items-center justify-between gap-3 border-b border-border-soft px-4 py-[9px]"
                    >
                      <span className="text-[11.5px] font-semibold text-muted-foreground">
                        {entry.label}
                      </span>
                      <span
                        className={`text-[12.5px] font-extrabold tabular-nums ${changeToneClass(entry.value)}`}
                      >
                        {formatSignedPercentOneDecimal(entry.value)}
                      </span>
                    </div>
                  ))}

                  <div className="flex items-center justify-between gap-3 border-b border-border-soft px-4 py-[9px]">
                    <span className="text-[11.5px] font-semibold text-muted-foreground">
                      Abstand zum Zielpreis
                    </span>
                    <span
                      className={`text-[12.5px] font-extrabold tabular-nums ${
                        !selectedItemWithBuyOrderRows.target?.hasTarget
                          ? "text-muted-foreground"
                          : selectedItemWithBuyOrderRows.target.reached
                            ? "text-success"
                            : "text-foreground"
                      }`}
                    >
                      {!selectedItemWithBuyOrderRows.target?.hasTarget
                        ? "–"
                        : selectedItemWithBuyOrderRows.target.reached
                          ? "Ziel erreicht"
                          : formatTargetDistance(
                              selectedItemWithBuyOrderRows.target.distancePercent,
                            )}
                    </span>
                  </div>

                  {watchedSince ? (
                    <div className="flex items-center justify-between gap-3 border-b border-border-soft px-4 py-[9px]">
                      <span className="text-[11.5px] font-semibold text-muted-foreground">
                        Beobachtet seit
                      </span>
                      <span className="text-[12.5px] font-extrabold tabular-nums">
                        {watchedSince}
                      </span>
                    </div>
                  ) : null}

                  <InspectorBlock
                    label="Buyorders · CSFloat"
                    aside={
                      selectedBestBuyOrder
                        ? formatPrice(Number(selectedBestBuyOrder.priceUsd), {
                            useUsd: true,
                            buyPriceUsd: Number(selectedBestBuyOrder.priceUsd),
                          })
                        : null
                    }
                  >
                    {selectedItemBuyOrderRows.length === 0 ? (
                      <p className="mt-2 text-[12px] text-muted-foreground">
                        Du hast aktuell keine Buyorders bei CSFloat fuer dieses Item gesetzt.
                      </p>
                    ) : (
                      <div className="mt-2.5">
                        <div className="grid grid-cols-[minmax(0,1fr)_52px_58px] gap-2 border-b border-border-soft pb-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
                          <span>Preis</span>
                          <span className="text-right">Orders</span>
                          <span className="text-right">Menge</span>
                        </div>
                        {selectedItemBuyOrderRows.slice(0, 12).map((row, index) => (
                          <div
                            key={`${row.priceUsd}-${index}`}
                            className="grid grid-cols-[minmax(0,1fr)_52px_58px] gap-2 border-b border-border-soft py-2 text-xs tabular-nums"
                          >
                            <span className="font-bold">
                              {formatPrice(Number(row.priceUsd), {
                                useUsd: true,
                                buyPriceUsd: Number(row.priceUsd),
                              })}
                            </span>
                            <span className="text-right text-muted-foreground">
                              {Number(row.orders || 0)}
                            </span>
                            <span className="text-right text-muted-foreground">
                              {Number(row.quantity || 0)}
                            </span>
                          </div>
                        ))}
                        <p className="pt-2 text-[10.5px] text-muted-foreground">
                          {selectedItemBuyOrderRows.reduce(
                            (sum, row) => sum + Number(row.orders || 0),
                            0,
                          )}{" "}
                          Orders ·{" "}
                          {selectedItemBuyOrderRows.reduce(
                            (sum, row) => sum + Number(row.quantity || 0),
                            0,
                          )}{" "}
                          Menge
                        </p>
                      </div>
                    )}

                    {isDesktopRuntime && buyOrderDebug ? (
                      <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                        Debug: client={buyOrderDebug.clientSource || "-"} | upstream=
                        {buyOrderDebug.upstreamSource || "-"} | pages=
                        {Number(buyOrderDebug.pagesFetched || 0)} | raw=
                        {Number(buyOrderDebug.rawOrders || 0)} | summary=
                        {Number(buyOrderDebug.summaryItems || 0)} | cache=
                        {buyOrderDebug.fromCache ? "yes" : "no"} | errors=
                        {Number(buyOrderDebug.errorCount || 0)} | firstError=
                        {buyOrderDebug.firstErrorCode || "-"}(
                        {Number(buyOrderDebug.firstErrorStatus || 0) || "-"}) | boError=
                        {buyOrderDebug.buyOrdersErrorCode || "-"}(
                        {Number(buyOrderDebug.buyOrdersErrorStatus || 0) || "-"})
                      </p>
                    ) : null}
                  </InspectorBlock>

                  <InspectorBlock label="Zielpreis">
                    <div className="mt-2 space-y-2">
                      {selectedItemWithBuyOrderRows.target?.hasTarget ? (
                        <TargetMeter
                          value={selectedItemWithBuyOrderRows.target.progressPercent}
                          reached={selectedItemWithBuyOrderRows.target.reached}
                        />
                      ) : null}

                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={targetInput}
                            onChange={(event) => setTargetInput(event.target.value)}
                            placeholder="0,00"
                            aria-label={`Zielpreis in ${currency}`}
                            className="h-8 w-full rounded-md border border-border bg-background px-2 pr-10 text-[12.5px] tabular-nums outline-none focus:border-primary"
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] font-semibold text-muted-foreground">
                            {currency}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          className="h-8"
                          disabled={isSavingTarget}
                          onClick={() => void handleSaveTarget(false)}
                        >
                          Speichern
                        </Button>
                        {selectedItemWithBuyOrderRows.target?.hasTarget ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={isSavingTarget}
                            onClick={() => void handleSaveTarget(true)}
                          >
                            Löschen
                          </Button>
                        ) : null}
                      </div>

                      {targetError ? (
                        <p className="text-[11px] font-semibold text-danger">{targetError}</p>
                      ) : (
                        <p className="text-[10.5px] text-muted-foreground">
                          {/* Says which way the alert points, so a sell target
                              entered above the price is not mistaken for a buy
                              target that will never fire. */}
                          {selectedItemWithBuyOrderRows.target?.hasTarget
                            ? selectedItemWithBuyOrderRows.target.direction === "above"
                              ? "Meldung, sobald der Preis das Ziel erreicht oder übersteigt."
                              : "Meldung, sobald der Preis auf das Ziel oder darunter fällt."
                            : "Noch kein Zielpreis gesetzt."}
                        </p>
                      )}
                    </div>
                  </InspectorBlock>

                  <InspectorFooter>
                    <Button
                      variant="softDanger"
                      size="sm"
                      onClick={handleDeleteClick}
                      className="h-8 flex-1"
                    >
                      <Trash2 className="mr-2 size-4" />
                      Entfernen
                    </Button>
                    {/* "Zu Investments" needs a buy price and a purchase date the
                        watchlist does not hold — disabled until that flow exists. */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled
                      title="Noch nicht verfügbar"
                      className="h-8 flex-1 gap-1.5"
                    >
                      Zu Investments
                      <SoonBadge />
                    </Button>
                  </InspectorFooter>

                  <DeleteConfirmModal
                    isOpen={showDeleteConfirm}
                    onClose={handleCancelDelete}
                    onConfirm={handleConfirmDelete}
                    isDeleting={isDeleting}
                    itemName={selectedItem?.name}
                    description="aus deiner Watchlist entfernen"
                  />
                </Inspector>
              ) : (
                <InspectorEmpty>
                  Wähle ein Item aus,
                  <br />
                  um den Preisverlauf anzuzeigen.
                </InspectorEmpty>
              )}
            </div>
          </div>
        )}
      </div>

      <WatchlistItemModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        item={selectedItemWithBuyOrderRows}
        onDelete={handleRemoveItem}
      />
    </div>
  );
};
