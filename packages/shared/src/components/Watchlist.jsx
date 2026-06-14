import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { PortfolioChart } from "./PortfolioChart";
import { ItemListRow } from "./ItemListRow";
import { X, Trash2 } from "lucide-react";
import {
  fetchCsFloatBuyOrdersData,
  deleteWatchlistItemData,
  fetchWatchlistData,
} from "@shared/lib/dataSource.js";
import { BREAKPOINTS } from "@shared/lib/constants";
import { Button } from "@shared/components/ui/button";
import { DeleteConfirmModal } from "./DeleteConfirmModal";
import { WatchlistItemModal } from "./WatchlistItemModal";
import { useCurrency } from "@shared/contexts/CurrencyContext";

let watchlistViewSnapshot = {
  loaded: false,
  items: [],
  buyOrderSummary: [],
  buyOrderOrders: [],
  buyOrderDebug: null,
  warnings: [],
  updatedAt: 0,
};
const WATCHLIST_CACHE_TTL_MS = 2 * 60 * 1000;

function getValidWatchlistSnapshot() {
  const updatedAt = Number(watchlistViewSnapshot.updatedAt || 0);
  if (!watchlistViewSnapshot.loaded || !Number.isFinite(updatedAt)) {
    return null;
  }
  if (Date.now() - updatedAt > WATCHLIST_CACHE_TTL_MS) {
    watchlistViewSnapshot = {
      loaded: false,
      items: [],
      buyOrderSummary: [],
      buyOrderOrders: [],
      buyOrderDebug: null,
      warnings: [],
      updatedAt: 0,
    };
    return null;
  }
  return watchlistViewSnapshot;
}

function normalizeNameKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeNameKeyForBuyOrderMatch(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\bstattrak(?:™)?\b/gi, "")
    .replace(/\bsouvenir\b/gi, "")
    .replace(/[★]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function applyBuyOrdersToWatchlistItems(items = [], summaryRows = []) {
  const summaryByName = new Map();
  (Array.isArray(summaryRows) ? summaryRows : []).forEach((row) => {
    const exactKey = normalizeNameKey(row?.marketHashName);
    const fuzzyKey = normalizeNameKeyForBuyOrderMatch(row?.marketHashName);
    if (!exactKey && !fuzzyKey) {
      return;
    }
    if (exactKey) {
      summaryByName.set(exactKey, row);
    }
    if (fuzzyKey) {
      summaryByName.set(fuzzyKey, row);
    }
  });

  return (Array.isArray(items) ? items : []).map((item) => {
    const rawName = item?.marketHashName || item?.name;
    const key = normalizeNameKey(rawName);
    const fuzzyKey = normalizeNameKeyForBuyOrderMatch(rawName);
    let summary = key ? summaryByName.get(key) : null;

    if (!summary && fuzzyKey) {
      summary = summaryByName.get(fuzzyKey) || null;
    }

    if (!summary && fuzzyKey) {
      summary =
        (Array.isArray(summaryRows) ? summaryRows : []).find((row) => {
          const rowKey = normalizeNameKeyForBuyOrderMatch(row?.marketHashName);
          return (
            rowKey &&
            (rowKey.includes(fuzzyKey) || fuzzyKey.includes(rowKey))
          );
        }) || null;
    }

    const buyOrderCount = Number(summary?.orders || 0);
    const buyOrderQuantity = Number(summary?.quantity || 0);
    const buyOrderBestPriceUsd = Number(summary?.bestPriceUsd || 0);

    return {
      ...item,
      hasBuyOrder: buyOrderCount > 0 && buyOrderBestPriceUsd > 0,
      buyOrderCount: buyOrderCount > 0 ? buyOrderCount : 0,
      buyOrderQuantity: buyOrderQuantity > 0 ? buyOrderQuantity : 0,
      buyOrderBestPriceUsd: buyOrderBestPriceUsd > 0 ? buyOrderBestPriceUsd : null,
    };
  });
}

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

function WatchlistItemsLoadingSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2 sm:pb-4">
        <CardTitle className="text-base sm:text-lg">Watchlist Items</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 sm:space-y-3">
        {[1, 2, 3, 4].map((entry) => (
          <div
            key={entry}
            className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-transparent p-3 shadow-none dark:rounded-2xl dark:border-border/70 dark:bg-card/75 dark:shadow-[0_14px_30px_rgba(0,0,0,0.2)]"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Skeleton className="h-12 w-12 flex-shrink-0 rounded-xl sm:h-14 sm:w-14" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <div className="flex flex-col items-end gap-1">
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-3 w-10" />
              </div>
              <Skeleton className="h-4 w-4 rounded-full" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export const Watchlist = ({ focusTarget = null, onWarningsChange }) => {
  const { currency, formatPrice } = useCurrency();
  const validSnapshot = getValidWatchlistSnapshot();
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
  const [showAbsolute, setShowAbsolute] = useState(false);
  const itemRefs = useRef(new Map());
  const isDesktopRuntime = typeof window !== "undefined" && Boolean(window.electronAPI?.localStore);
  const hasFiniteNumber = (value) => Number.isFinite(Number(value));
  const combinedWarnings = useMemo(() => [...warnings], [warnings]);
  const selectedItemBuyOrderRows = useMemo(
    () => buildBuyOrderRowsForItem(selectedItem, buyOrderOrders),
    [selectedItem, buyOrderOrders],
  );
  const selectedItemWithBuyOrderRows = useMemo(() => (
    selectedItem
      ? {
          ...selectedItem,
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

      const response = await fetchWatchlistData({ syncLive: true });
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
          };

          if (nextBuyOrderSummary.length === 0 || nextBuyOrderOrders.length === 0) {
            const liveBuyOrderResponse = await fetchCsFloatBuyOrdersData({
              syncNow: true,
              limit: 200,
              maxPages: 8,
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
      watchlistViewSnapshot = {
        loaded: true,
        items: nextItems,
        buyOrderSummary: nextBuyOrderSummary,
        buyOrderOrders: nextBuyOrderOrders,
        buyOrderDebug: nextBuyOrderDebug,
        warnings: nextWarnings,
        updatedAt: Date.now(),
      };
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
          watchlistViewSnapshot = {
            loaded: true,
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
            updatedAt: Date.now(),
          };
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
    void loadWatchlistData({ showLoading: !getValidWatchlistSnapshot() });
  }, [loadWatchlistData]);

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

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Watchlist</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Deine beobachteten Items mit aktuellem Verlauf.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 p-2 sm:p-4 text-xs sm:text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <WatchlistItemsLoadingSkeleton />
      ) : watchlistItems.length === 0 ? (
        <Card>
          <CardContent className="p-4 sm:p-8 text-center text-muted-foreground">
            <p className="text-sm">
              Keine Items in der Watchlist. Nutze die Suche oben und fuege
              neue Items hinzu.
            </p>
          </CardContent>
        </Card>
      ) : (
         <div className="grid gap-3 sm:gap-4 md:gap-6 grid-cols-1 md:grid-cols-2">
           <div className="space-y-3 sm:space-y-4">
             <Card>
               <CardHeader className="pb-2 sm:pb-4">
                 <CardTitle className="text-base sm:text-lg">Watchlist Items</CardTitle>
               </CardHeader>
               <CardContent>
                 <div className="space-y-2 sm:space-y-3">
                   {watchlistItems.map((item) => (
                     <div
                       key={item.id}
                       ref={(node) => {
                         if (node) {
                           itemRefs.current.set(item.id, node);
                           return;
                         }
                         itemRefs.current.delete(item.id);
                       }}
                        className={`transition-colors ${
                          selectedItem?.id === item.id
                            ? "rounded-md border border-primary/40 bg-primary/10 shadow-none dark:rounded-2xl dark:bg-primary/14 dark:shadow-[0_14px_28px_rgba(255,255,255,0.12)]"
                            : ""
                        }`}
                     >
                       <ItemListRow
                         item={item}
                         onClick={() => {
                           setSelectedItem(item);
                           if (window.innerWidth < BREAKPOINTS.MOBILE) {
                             setIsModalOpen(true);
                           }
                         }}
                       />
                     </div>
                   ))}
                 </div>
               </CardContent>
             </Card>
           </div>

          <div className="hidden md:sticky md:top-20 md:block md:self-start md:max-h-[calc(100vh-6rem)] md:overflow-y-auto">
            {selectedItemWithBuyOrderRows ? (
              <Card>
                <CardHeader className="pb-2 sm:pb-4">
                  <div className="flex items-start justify-between gap-2 sm:gap-3">
                    <div className="flex min-w-0 gap-2 sm:gap-4">
                      <div className="h-14 w-14 sm:h-20 sm:w-20 overflow-hidden rounded-xl border border-border/75 bg-muted/25 flex-shrink-0">
                        {selectedItemWithBuyOrderRows.imageUrl ? (
                          <img
                            src={selectedItemWithBuyOrderRows.imageUrl}
                            alt={selectedItemWithBuyOrderRows.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                            N/A
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <CardTitle className="text-base sm:text-lg truncate">{selectedItemWithBuyOrderRows.name}</CardTitle>
                        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                          Interaktiver Preisverlauf
                        </p>
                        {hasFiniteNumber(selectedItemWithBuyOrderRows.currentPrice) && (
                          <div className="mt-1 sm:mt-2 text-xs sm:text-sm text-muted-foreground">
                            <p>
                              Aktuell: {formatPrice(Number(selectedItemWithBuyOrderRows.currentPrice))}
                            </p>
                            {selectedItemWithBuyOrderRows?.hasBuyOrder && Number(selectedItemWithBuyOrderRows?.buyOrderBestPriceUsd || 0) > 0 ? (
                              <p className="mt-1 inline-flex items-center gap-1 rounded-md border border-sky-400/40 bg-sky-400/10 px-2 py-0.5 font-medium text-sky-300">
                                Meine Buyorder: {formatPrice(Number(selectedItemWithBuyOrderRows.buyOrderBestPriceUsd), {
                                  useUsd: true,
                                  buyPriceUsd: Number(selectedItemWithBuyOrderRows.buyOrderBestPriceUsd),
                                })}
                                {Number(selectedItemWithBuyOrderRows?.buyOrderCount || 0) > 1
                                  ? ` (${Number(selectedItemWithBuyOrderRows.buyOrderCount)} Orders)`
                                  : ""}
                              </p>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedItem(null)}
                      className="flex-shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4 sm:h-5 sm:w-5" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent>
                  {selectedItemWithBuyOrderRows.priceHistory &&
                  selectedItemWithBuyOrderRows.priceHistory.length > 0 ? (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold">Preisentwicklung</h3>
                        <button
                          onClick={() => setShowAbsolute(!showAbsolute)}
                          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showAbsolute ? (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">{currency}</span>
                          ) : (
                            <span className="text-muted-foreground/50">{currency}</span>
                          )}
                          /
                          {showAbsolute ? (
                            <span className="text-muted-foreground/50">%</span>
                          ) : (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">%</span>
                          )}
                        </button>
                      </div>
                      <PortfolioChart
                        history={selectedItemWithBuyOrderRows.priceHistory}
                        color={
                          selectedItemWithBuyOrderRows.trend === "down" ? "#ef4444" : "#22c55e"
                        }
                        valueLabel="Preis"
                        title="Preisentwicklung"
                        showAbsolute={showAbsolute}
                        disableDarkGlass
                      />
                    </div>
                  ) : (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      Keine Preishistorie verfuegbar.
                    </div>
                  )}
                  <div className={`mt-4 rounded-xl border p-4 ${
                    selectedItemBuyOrderRows.length > 0
                      ? "border-sky-400/40 bg-sky-400/5"
                      : "border-border/70 bg-card/65"
                  }`}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h4 className="flex items-center gap-2 text-sm font-semibold">
                        Meine Buyorders (CSFloat)
                        {selectedItemBuyOrderRows.length > 0 ? (
                          <span className="rounded-full border border-sky-400/40 bg-sky-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-300">
                            Aktiv
                          </span>
                        ) : null}
                      </h4>
                      {selectedItemBuyOrderRows.length > 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {selectedItemBuyOrderRows.reduce((sum, row) => sum + Number(row.orders || 0), 0)} Orders,{" "}
                          {selectedItemBuyOrderRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)} Menge
                        </span>
                      ) : null}
                    </div>
                    {selectedItemBuyOrderRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Du hast aktuell keine Buyorders bei CSFloat fuer dieses Item gesetzt.
                      </p>
                    ) : (
                      <div className="overflow-hidden rounded-lg border border-border/60">
                        <table className="w-full text-xs sm:text-sm">
                          <thead className="bg-muted/30 text-left text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 font-medium">Preis</th>
                              <th className="px-3 py-2 font-medium">Orders</th>
                              <th className="px-3 py-2 font-medium">Menge</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedItemBuyOrderRows.slice(0, 12).map((row, index) => (
                              <tr key={`${row.priceUsd}-${index}`} className="border-t border-border/50">
                                <td className="px-3 py-2 text-sky-300">
                                  {formatPrice(Number(row.priceUsd), {
                                    useUsd: true,
                                    buyPriceUsd: Number(row.priceUsd),
                                  })}
                                </td>
                                <td className="px-3 py-2">{Number(row.orders || 0)}</td>
                                <td className="px-3 py-2">{Number(row.quantity || 0)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {isDesktopRuntime && buyOrderDebug ? (
                      <p className="mt-3 font-mono text-[10px] text-muted-foreground">
                        Debug: client={buyOrderDebug.clientSource || "-"} | upstream={buyOrderDebug.upstreamSource || "-"} | pages={Number(buyOrderDebug.pagesFetched || 0)} | raw={Number(buyOrderDebug.rawOrders || 0)} | summary={Number(buyOrderDebug.summaryItems || 0)} | cache={buyOrderDebug.fromCache ? "yes" : "no"} | errors={Number(buyOrderDebug.errorCount || 0)} | firstError={buyOrderDebug.firstErrorCode || "-"}({Number(buyOrderDebug.firstErrorStatus || 0) || "-"})
                      </p>
                    ) : null}
                  </div>

                  {/* Delete Section - Desktop */}
                  <div className="mt-6 border-t pt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDeleteClick}
                      className="w-full text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Aus Watchlist entfernen
                    </Button>
                  </div>

                  <DeleteConfirmModal
                    isOpen={showDeleteConfirm}
                    onClose={handleCancelDelete}
                    onConfirm={handleConfirmDelete}
                    isDeleting={isDeleting}
                    itemName={selectedItem?.name}
                    description="aus deiner Watchlist entfernen"
                  />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <p>Waehle ein Item aus, um den Preisverlauf anzuzeigen.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      <WatchlistItemModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        item={selectedItemWithBuyOrderRows}
        onDelete={handleRemoveItem}
      />
    </div>
  );
};
