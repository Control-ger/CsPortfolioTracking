import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Bell } from "lucide-react";

import { useModal } from "@shared/contexts";
import { ApiWarnings } from "@shared/components";
import { InventoryTable } from "@shared/components";
import { ItemDetailsModal } from "@shared/components";
import { ItemDetailPanel } from "@shared/components";
import { CsFloatTradeSyncModal } from "@shared/components";
import { PortfolioChart } from "@shared/components";
import { PortfolioCompositionChart } from "@shared/components";
import { PortfolioHeaderCard } from "@shared/components";
import { StatCard } from "@shared/components";
import { SteamLoginPrompt } from "@shared/components";
import { ThemeToggle } from "@shared/components";
import { UserMenu } from "@shared/components";
import { Watchlist } from "@shared/components";
import { WatchlistOverview } from "@shared/components";
import { Badge } from "@shared/components";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/components";
import { Button } from "@shared/components";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/components";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@shared/components";
import { Skeleton } from "@shared/components";
import { usePortfolio } from "@shared/hooks";
import { usePortfolioComposition } from "@shared/hooks";
import { useCsUpdatesFeed } from "@shared/hooks";
import {
  fetchPortfolioInvestmentHistory,
  fetchCS2Inventory,
  getCurrentUser,
  importInventoryAsInvestments,
  fetchCsFloatApiKeyStatus,
  toggleExcludeInvestment,
} from "@shared/lib";
import { BREAKPOINTS, UI } from "@shared/lib";
import { useKeyboard } from "@shared/hooks";
import { useCurrency } from "@shared/contexts/CurrencyContext";

function formatAge(seconds) {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) {
    return "-";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }

  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h`;
  }

  return `${Math.floor(seconds / 86400)}d`;
}

function freshnessBadgeClass(staleRatio) {
  if (staleRatio <= 0) {
    return "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900/60 dark:text-emerald-300";
  }
  if (staleRatio < 50) {
    return "border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-900/60 dark:text-amber-300";
  }

  return "border-red-200 bg-red-500/10 text-red-700 dark:border-red-900/60 dark:text-red-300";
}

function formatRelativeHours(hours) {
  if (!Number.isFinite(hours)) {
    return "unbekannt";
  }

  if (hours < 1) {
    return "<1h";
  }

  return `${Math.max(1, Math.round(hours))}h`;
}

const TABS = ["overview", "inventory", "watchlist", "management"];
const SWIPE_THRESHOLD = UI.SWIPE_THRESHOLD;
const JOURNEY_STORAGE_KEY = "onboarding:journey:v1";
const STEAM_SYNC_META_KEY = "steam:sync:meta:v1";
const STEAM_SYNC_PREF_KEY = "steam:sync:auto-enabled:v1";
const STEAM_SYNC_COOLDOWN_MS = 1000 * 60 * 30;

async function readJourneyState() {
  if (typeof window === "undefined") {
    return { skipped: false };
  }

  if (window.electronAPI?.localFileRead) {
    const value = await window.electronAPI.localFileRead(JOURNEY_STORAGE_KEY);
    return value && typeof value === "object" ? value : { skipped: false };
  }

  try {
    const raw = localStorage.getItem(JOURNEY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : { skipped: false };
  } catch {
    return { skipped: false };
  }
}

async function writeJourneyState(nextState) {
  if (typeof window === "undefined") {
    return;
  }

  if (window.electronAPI?.localFileWrite) {
    await window.electronAPI.localFileWrite(JOURNEY_STORAGE_KEY, nextState);
    return;
  }

  localStorage.setItem(JOURNEY_STORAGE_KEY, JSON.stringify(nextState));
}

async function readLocalState(key, fallback) {
  if (typeof window === "undefined") {
    return fallback;
  }

  if (window.electronAPI?.localFileRead) {
    const value = await window.electronAPI.localFileRead(key);
    return value ?? fallback;
  }

  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function writeLocalState(key, value) {
  if (typeof window === "undefined") {
    return;
  }

  if (window.electronAPI?.localFileWrite) {
    await window.electronAPI.localFileWrite(key, value);
    return;
  }

  localStorage.setItem(key, JSON.stringify(value));
}

function getClusterKey(item) {
  return String(item?.marketHashName || item?.name || item?.itemName || item?.id || "")
    .trim()
    .toLowerCase();
}

function buildManagementClusters(items = []) {
  const groups = new Map();
  items.forEach((item) => {
    const key = getClusterKey(item);
    if (!key) {
      return;
    }

    if (!groups.has(key)) {
      groups.set(key, {
        id: `cluster-${key}`,
        key,
        name: item.name || item.marketHashName || "Unknown Item",
        type: item.type || "skin",
        imageUrl: item.imageUrl || null,
        positions: [],
      });
    }

    const group = groups.get(key);
    group.positions.push({
      id: item.id,
      name: item.name || group.name,
      quantity: Number(item.quantity || 0),
      buyPriceUsd: Number(item.buyPriceUsd ?? item.buyPrice ?? 0),
      externalTradeId: item.externalTradeId || null,
      purchasedAt: item.purchasedAt || null,
      excluded: Boolean(item.excluded),
    });
  });

  return Array.from(groups.values())
    .map((cluster) => {
      const totalCount = cluster.positions.reduce((sum, pos) => sum + pos.quantity, 0);
      const excludedCount = cluster.positions
        .filter((pos) => pos.excluded)
        .reduce((sum, pos) => sum + pos.quantity, 0);
      return {
        ...cluster,
        totalCount,
        excludedCount,
        activeCount: Math.max(0, totalCount - excludedCount),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

function formatSteamSyncError(error) {
  const raw = String(error?.message || error || "");
  const upper = raw.toUpperCase();
  if (upper.includes("INVENTORY_ACCESS_DENIED")) {
    return "Steam-Inventar ist nicht oeffentlich erreichbar. Pruefe Privatsphaere/Inventar-Sichtbarkeit in Steam und versuche es erneut.";
  }
  if (upper.includes("RATE") || upper.includes("429")) {
    return "Steam hat den Abruf temporaer begrenzt (Rate Limit). Bitte in einigen Minuten erneut versuchen.";
  }
  if (upper.includes("INVALID RESPONSE") || upper.includes("JSON")) {
    return "Steam hat keine gueltige Inventarantwort geliefert. Bitte spaeter erneut versuchen.";
  }
  if (upper.includes("FAILED TO FETCH") || upper.includes("NETWORK")) {
    return "Netzwerkfehler beim Steam-Sync. Bitte Verbindung pruefen und erneut starten.";
  }
  return raw || "Steam Sync fehlgeschlagen.";
}

export function PortfolioPage({ initialTab = "overview" }) {
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resolvedInitialTab = searchParams.get("tab") || initialTab;
  const {
    enrichedInvestments,
    isLoading: portfolioLoading,
    authRequired,
    stats,
    portfolioHistory,
    error,
    warnings,
    refreshPortfolio,
    removeInvestmentFromView,
  } =
    usePortfolio();
  const {
    latestItem: latestCsUpdate,
    latestItemAgeHours: latestCsUpdateAgeHours,
    isLoading: csUpdatesLoading,
  } = useCsUpdatesFeed();
  const [compositionRefreshToken, setCompositionRefreshToken] = useState(0);
  const {
    data: compositionData,
    loading: compositionLoading,
    error: compositionError,
  } = usePortfolioComposition(compositionRefreshToken);
  const { modals, openModal, closeModal } = useModal();
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemHistory, setSelectedItemHistory] = useState([]);
  const [selectedItemHistoryLoading, setSelectedItemHistoryLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(resolvedInitialTab);
  const [watchlistFocusTarget, setWatchlistFocusTarget] = useState(null);
  const [isCsFloatSyncOpen, setIsCsFloatSyncOpen] = useState(false);
  const [hoveredChartData, setHoveredChartData] = useState(null);
  const [managementInvestments, setManagementInvestments] = useState([]);
  const [managementLoading, setManagementLoading] = useState(false);
  const [managementError, setManagementError] = useState("");
  const [matchingRows, setMatchingRows] = useState([]);
  const [matchingLoading, setMatchingLoading] = useState(false);
  const [expandedClusters, setExpandedClusters] = useState({});
  const [managementFilter, setManagementFilter] = useState("all");
  const [managementSection, setManagementSection] = useState("matching");
  const [priceDrafts, setPriceDrafts] = useState({});
  const [savingPriceItemId, setSavingPriceItemId] = useState(null);
  const [syncNotification, setSyncNotification] = useState({
    newItemsCount: 0,
    lastSyncedAt: null,
  });
  const [syncNotifications, setSyncNotifications] = useState([]);
  const [journeyState, setJourneyState] = useState({ skipped: false });
  const [journeyLoading, setJourneyLoading] = useState(true);
  const [hasCsFloatKey, setHasCsFloatKey] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [isSteamSyncing, setIsSteamSyncing] = useState(false);
  const [steamSyncError, setSteamSyncError] = useState("");
  const autoSyncStartedRef = useRef(false);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const touchEndX = useRef(null);
  const touchEndY = useRef(null);
  const searchInputRef = useRef(null);

  // Keyboard shortcuts for tab navigation and search
  useKeyboard({
    onArrowLeft: () => {
      const currentIndex = TABS.indexOf(activeTab);
      if (currentIndex > 0) {
        const newTab = TABS[currentIndex - 1];
        setActiveTab(newTab);
        navigate(`/?tab=${newTab}`, { replace: true });
      }
    },
    onArrowRight: () => {
      const currentIndex = TABS.indexOf(activeTab);
      if (currentIndex < TABS.length - 1) {
        const newTab = TABS[currentIndex + 1];
        setActiveTab(newTab);
        navigate(`/?tab=${newTab}`, { replace: true });
      }
    },
    onSearch: () => {
      // Focus search input if on watchlist tab, otherwise navigate to watchlist
      if (activeTab === 'watchlist' && searchInputRef.current) {
        searchInputRef.current.focus();
      } else {
        setActiveTab('watchlist');
        navigate('/?tab=watchlist', { replace: true });
        // Focus after navigation
        setTimeout(() => searchInputRef.current?.focus(), 100);
      }
    }
  }, true);

  useEffect(() => {
    setActiveTab(resolvedInitialTab);
  }, [resolvedInitialTab]);

  useEffect(() => {
    const loadJourneyState = async () => {
      setJourneyLoading(true);
      try {
        const [savedJourney, keyStatus] = await Promise.all([
          readJourneyState(),
          fetchCsFloatApiKeyStatus(),
        ]);
        setJourneyState(savedJourney || { skipped: false });
        const keyConnected = Boolean(keyStatus?.data?.hasKey || keyStatus?.data?.configured);
        setHasCsFloatKey(keyConnected);

        if (keyConnected && !savedJourney?.completedAt) {
          const completedJourney = {
            ...(savedJourney || {}),
            skipped: false,
            completedAt: new Date().toISOString(),
          };
          setJourneyState(completedJourney);
          await writeJourneyState(completedJourney);
        }
      } catch (journeyError) {
        console.warn("Failed to load onboarding journey state", journeyError);
      } finally {
        setJourneyLoading(false);
      }
    };

    void loadJourneyState();
  }, []);

  useEffect(() => {
    const loadManagementInvestments = async () => {
      const isDesktopLocal =
        typeof window !== "undefined" && Boolean(window.electronAPI?.localStore);
      if (!isDesktopLocal) {
        setManagementInvestments([]);
        return;
      }

      setManagementLoading(true);
      setMatchingLoading(true);
      try {
        const user = await getCurrentUser();
        const userId = user?.id || "local";
        const [items, matches] = await Promise.all([
          window.electronAPI.localStore.listInvestments(userId),
          window.electronAPI.localStore.listSteamCsfloatMatches(userId, null, 300),
        ]);
        setManagementInvestments(Array.isArray(items) ? items : []);
        setMatchingRows(Array.isArray(matches) ? matches : []);
        setManagementError("");
      } catch (loadError) {
        setManagementError(loadError?.message || "Verwaltungsdaten konnten nicht geladen werden.");
        setManagementInvestments([]);
        setMatchingRows([]);
      } finally {
        setManagementLoading(false);
        setMatchingLoading(false);
      }
    };

    void loadManagementInvestments();
  }, [compositionRefreshToken]);

  useEffect(() => {
    const loadNotifications = async () => {
      const isDesktopLocal =
        typeof window !== "undefined" && Boolean(window.electronAPI?.localStore?.listNotifications);
      if (!isDesktopLocal) {
        setSyncNotifications([]);
        return;
      }

      try {
        const user = await getCurrentUser();
        const userId = user?.id || "local";
        const notifications = await window.electronAPI.localStore.listNotifications(userId, { limit: 20 });
        const rows = Array.isArray(notifications) ? notifications : [];
        setSyncNotifications(rows);
        const unreadCount = rows.filter((row) => row.category === "steam_sync" && row.unread).length;
        setSyncNotification((current) => ({
          ...current,
          newItemsCount: unreadCount,
          lastSyncedAt: rows[0]?.createdAt || current.lastSyncedAt || null,
        }));
      } catch (notificationError) {
        console.warn("Failed to load notifications", notificationError);
      }
    };

    void loadNotifications();
  }, [compositionRefreshToken]);

  useEffect(() => {
    const loadSyncPreference = async () => {
      const pref = await readLocalState(STEAM_SYNC_PREF_KEY, { enabled: true });
      setAutoSyncEnabled(pref?.enabled !== false);
    };

    void loadSyncPreference();
  }, []);

  const runSteamSync = useCallback(async ({ manual = false } = {}) => {
    const isDesktopLocal = typeof window !== "undefined" && Boolean(window.electronAPI?.localStore);
    if (!isDesktopLocal || authRequired || isSteamSyncing) {
      return;
    }

    setSteamSyncError("");
    setIsSteamSyncing(true);
    try {
      const user = await getCurrentUser();
      const steamId = user?.steamId;
      const userId = user?.id || "local";
      if (!steamId) {
        return;
      }

      if (!manual) {
        const meta = await readLocalState(STEAM_SYNC_META_KEY, {});
        const lastRunAt = meta?.lastRunAt ? Date.parse(meta.lastRunAt) : NaN;
        if (Number.isFinite(lastRunAt) && Date.now() - lastRunAt < STEAM_SYNC_COOLDOWN_MS) {
          return;
        }
      }

      const inventoryResult = await fetchCS2Inventory(steamId);
      if (!inventoryResult?.success || !Array.isArray(inventoryResult.items)) {
        throw new Error(inventoryResult?.error || "Steam-Inventar konnte nicht geladen werden.");
      }

      const marketableItems = inventoryResult.items.filter((item) => item?.marketable);
      const syncResult = await importInventoryAsInvestments(marketableItems, userId);
      const imported = Number(syncResult?.imported || 0);
      const updated = Number(syncResult?.updated || 0);
      const syncedAt = new Date().toISOString();

      await writeLocalState(STEAM_SYNC_META_KEY, { lastRunAt: syncedAt });
      if (imported > 0 && window.electronAPI?.localStore?.createNotification) {
        await window.electronAPI.localStore.createNotification({
          userId,
          category: "steam_sync",
          title: "Neue Steam Items",
          message: `${imported} neue Items durch Steam Sync`,
          payload: {
            imported,
            updated,
            syncedAt,
          },
          createdAt: syncedAt,
        });
      }
      if (imported > 0) {
        setSyncNotification({
          newItemsCount: imported,
          lastSyncedAt: syncedAt,
        });
      } else {
        setSyncNotification((current) => ({
          ...current,
          lastSyncedAt: syncedAt,
        }));
      }
      if (window.electronAPI?.localStore?.listNotifications) {
        const notifications = await window.electronAPI.localStore.listNotifications(userId, { limit: 20 });
        const rows = Array.isArray(notifications) ? notifications : [];
        setSyncNotifications(rows);
        const unreadCount = rows.filter((row) => row.category === "steam_sync" && row.unread).length;
        setSyncNotification((current) => ({
          ...current,
          newItemsCount: unreadCount,
          lastSyncedAt: rows[0]?.createdAt || current.lastSyncedAt || null,
        }));
      }

      if (imported > 0 || updated > 0) {
        await refreshPortfolio();
        setCompositionRefreshToken((current) => current + 1);
      }
    } catch (syncError) {
      console.warn("Steam sync failed", syncError);
      setSteamSyncError(formatSteamSyncError(syncError));
    } finally {
      setIsSteamSyncing(false);
    }
  }, [authRequired, isSteamSyncing, refreshPortfolio]);

  useEffect(() => {
    const runAutoSteamSync = async () => {
      const isDesktopLocal =
        typeof window !== "undefined" && Boolean(window.electronAPI?.localStore);
      if (!isDesktopLocal || authRequired || autoSyncStartedRef.current || !autoSyncEnabled) {
        return;
      }
      autoSyncStartedRef.current = true;
      await runSteamSync({ manual: false });
    };

    void runAutoSteamSync();
  }, [authRequired, autoSyncEnabled, runSteamSync]);

  const handleExcludeChange = async (itemId, excluded) => {
    if (excluded) {
      setSelectedItem((currentItem) => (currentItem?.id === itemId ? null : currentItem));
      setSelectedItemHistory([]);
      removeInvestmentFromView(itemId);
    }

    await refreshPortfolio();
    setCompositionRefreshToken((current) => current + 1);
  };

  const selectedItemWithLive = useMemo(() => {
    if (!selectedItem) {
      return null;
    }

    return enrichedInvestments.find((investment) => investment.id === selectedItem.id);
  }, [selectedItem, enrichedInvestments]);

  useEffect(() => {
    const loadItemHistory = async () => {
      if (!selectedItemWithLive) {
        setSelectedItemHistory([]);
        setSelectedItemHistoryLoading(false);
        return;
      }

      const isDesktopLocal =
        typeof window !== "undefined" && Boolean(window.electronAPI?.localStore);
      const isClustered =
        typeof selectedItemWithLive.id === "string" && selectedItemWithLive.id.startsWith("cluster-");

      if (isDesktopLocal || isClustered) {
        setSelectedItemHistory([]);
        setSelectedItemHistoryLoading(false);
        return;
      }

      setSelectedItemHistoryLoading(true);
      try {
        const history = await fetchPortfolioInvestmentHistory(selectedItemWithLive.id, {
          itemName: selectedItemWithLive.name,
        });
        setSelectedItemHistory(history || []);
      } catch (historyError) {
        console.error("Fehler beim Laden der Positionshistorie:", historyError);
        setSelectedItemHistory([]);
      } finally {
        setSelectedItemHistoryLoading(false);
      }
    };

    void loadItemHistory();
  }, [selectedItemWithLive]);

  // Keep this return after all hooks. Returning before the other hooks run changes
  // hook order after login and triggers React's minified error #310.
  if (authRequired) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <SteamLoginPrompt onLoginSuccess={refreshPortfolio} />
      </div>
    );
  }

  const handleOpenWatchlistItem = (item) => {
    if (!item?.id) {
      return;
    }

    setWatchlistFocusTarget({
      id: item.id,
      requestedAt: Date.now(),
    });
    setActiveTab("watchlist");
  };

  const handleSwipeNavigation = (direction) => {
    const currentIndex = TABS.indexOf(activeTab);
    if (currentIndex === -1) return;

    let nextIndex;
    if (direction === "left") {
      nextIndex = Math.min(currentIndex + 1, TABS.length - 1);
    } else {
      nextIndex = Math.max(currentIndex - 1, 0);
    }

    if (nextIndex !== currentIndex) {
      const nextTab = TABS[nextIndex];
      const path = nextTab === "overview" ? "/" : `/${nextTab}`;
      navigate(path);
      setActiveTab(nextTab);
    }
  };

  const onTouchStart = (e) => {
    touchStartX.current = e.changedTouches[0].screenX;
    touchStartY.current = e.changedTouches[0].screenY;
    touchEndX.current = null;
    touchEndY.current = null;
  };

  const onTouchMove = (e) => {
    touchEndX.current = e.changedTouches[0].screenX;
    touchEndY.current = e.changedTouches[0].screenY;
  };

  const onTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;
    if (touchStartY.current === null || touchEndY.current === null) return;

    const distanceX = touchEndX.current - touchStartX.current;
    const distanceY = touchEndY.current - touchStartY.current;
    const isMobileView = window.innerWidth < BREAKPOINTS.MOBILE;

    // Only trigger if horizontal movement is greater than vertical
    const isHorizontalSwipe = Math.abs(distanceX) > Math.abs(distanceY);

    if (isMobileView && isHorizontalSwipe && Math.abs(distanceX) > SWIPE_THRESHOLD) {
      if (distanceX < 0) {
        handleSwipeNavigation("left");
      } else {
        handleSwipeNavigation("right");
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
    touchEndX.current = null;
    touchEndY.current = null;
  };

  const loadItemHistory = async (itemId, itemName) => {
    const isDesktopLocal =
      typeof window !== "undefined" && Boolean(window.electronAPI?.localStore);
    const isClustered = typeof itemId === "string" && itemId.startsWith("cluster-");

    if (isDesktopLocal || isClustered) {
      setSelectedItemHistory([]);
      setSelectedItemHistoryLoading(false);
      return;
    }

    setSelectedItemHistoryLoading(true);
    try {
      const history = await fetchPortfolioInvestmentHistory(itemId, { itemName });
      setSelectedItemHistory(history || []);
    } catch (historyError) {
      console.error("Fehler beim Laden der Positionshistorie:", historyError);
      setSelectedItemHistory([]);
    } finally {
      setSelectedItemHistoryLoading(false);
    }
  };

  const liveItems = Number(stats.liveItemsCount || 0);
  const staleItems = Number(stats.staleLiveItemsCount || 0);
  const staleRatio = Number(stats.staleLiveItemsRatioPercent || 0);
  const headerPortfolioValue = hoveredChartData?.wert ?? (stats.totalValue || 0);
  const headerPortfolioPercent = hoveredChartData?.growthPercent ?? (stats.totalRoiPercent || 0);
  const headerPortfolioPositive = hoveredChartData
    ? Number(hoveredChartData.growthPercent) >= 0
    : Boolean(stats.isPositive);
  const showCsUpdateBanner =
    !csUpdatesLoading &&
    Boolean(latestCsUpdate) &&
    Number.isFinite(latestCsUpdateAgeHours) &&
    latestCsUpdateAgeHours <= 12;
  const portfolioValueLabel = formatPrice(stats.totalValue || 0, {
    useUsd: true,
    buyPriceUsd: stats.totalValue || 0,
  });
  const managementClusters = buildManagementClusters(managementInvestments);
  const filteredManagementClusters = (() => {
    if (managementFilter === "excluded") {
      return managementClusters.filter((cluster) => cluster.excludedCount > 0);
    }
    if (managementFilter === "active") {
      return managementClusters.filter((cluster) => cluster.activeCount > 0);
    }
    return managementClusters;
  })();
  const matchingSuggestedCount = matchingRows.filter((row) => row.status === "suggested").length;
  const steamInventoryItems = managementInvestments.filter((item) => {
    const platform = String(item.platform || item.source || "").toLowerCase();
    return platform === "steam_inventory" || Boolean(item.steamAssetId);
  });
  const priceMissingCount = managementInvestments.filter((item) => {
    const platform = String(item.platform || item.source || "").toLowerCase();
    if (!(platform === "steam_inventory" || item.steamAssetId)) {
      return false;
    }
    const price = Number(item.buyPriceUsd ?? item.buyPrice ?? 0);
    return !Number.isFinite(price) || price <= 0;
  }).length;

  const toggleClusterExpanded = (clusterId) => {
    setExpandedClusters((current) => ({
      ...current,
      [clusterId]: !current[clusterId],
    }));
  };

  const handleManagementExcludeToggle = async (investmentId, exclude) => {
    await toggleExcludeInvestment(investmentId, exclude);
    await refreshPortfolio();
    setCompositionRefreshToken((current) => current + 1);
  };

  const handleManagementClusterToggle = async (cluster, exclude) => {
    await toggleExcludeInvestment(
      cluster.id,
      exclude,
      cluster.positions.map((position) => position.id),
    );
    await refreshPortfolio();
    setCompositionRefreshToken((current) => current + 1);
  };

  const handleMatchStatusUpdate = async (matchId, status) => {
    if (!window.electronAPI?.localStore?.updateSteamCsfloatMatchStatus) {
      return;
    }
    await window.electronAPI.localStore.updateSteamCsfloatMatchStatus(matchId, status);
    setCompositionRefreshToken((current) => current + 1);
  };
  const handlePriceDraftChange = (itemId, value) => {
    setPriceDrafts((current) => ({
      ...current,
      [itemId]: value,
    }));
  };

  const handleSaveSteamItemPrice = async (item) => {
    const draftValue = priceDrafts[item.id];
    const nextPrice = Number(draftValue);
    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      return;
    }

    setSavingPriceItemId(item.id);
    try {
      await window.electronAPI.localStore.upsertInvestment({
        ...item,
        id: item.id,
        buyPriceUsd: nextPrice,
        buyPrice: nextPrice,
        platform: "steam_inventory",
        source: "steam_inventory",
      });
      await refreshPortfolio();
      setCompositionRefreshToken((current) => current + 1);
    } catch (saveError) {
      console.error("Failed to save steam item buy price", saveError);
    } finally {
      setSavingPriceItemId(null);
    }
  };
  const unreadNotificationCount = syncNotification.newItemsCount;
  const formatCompactNewCount = (count) => {
    const value = Number(count || 0);
    if (value > 999) {
      return "999+ neu";
    }
    return `${Math.max(0, value)} neu`;
  };
  const resolveNotificationActionTarget = () => {
    if (matchingSuggestedCount > 0) {
      return { section: "matching", label: "Matching" };
    }
    if (priceMissingCount > 0) {
      return { section: "prices", label: "Preise" };
    }
    return { section: "matching", label: "Inbox" };
  };
  const handleNotificationClick = async (entry) => {
    if (window.electronAPI?.localStore?.markNotificationRead) {
      await window.electronAPI.localStore.markNotificationRead(entry.id);
    }
    const target = resolveNotificationActionTarget();
    setActiveTab("management");
    setManagementSection(target.section);
    navigate("/?tab=management", { replace: true });
    setCompositionRefreshToken((current) => current + 1);
  };
  const journeySteps = [
    {
      id: "steam",
      label: "Steam verbunden",
      done: Boolean(!authRequired),
    },
    {
      id: "inventory",
      label: "Steam-Items importiert",
      done: steamInventoryItems.length > 0,
    },
    {
      id: "csfloat",
      label: "CSFloat Key hinterlegt",
      done: hasCsFloatKey,
    },
    {
      id: "matching",
      label: "Matching geprueft",
      done: matchingSuggestedCount === 0,
    },
  ];
  const completedJourneySteps = journeySteps.filter((step) => step.done).length;
  const showJourneyBanner =
    !journeyLoading &&
    !hasCsFloatKey &&
    !journeyState?.skipped &&
    !journeyState?.completedAt;

  const handleSkipJourney = async () => {
    const nextState = {
      ...journeyState,
      skipped: true,
      skippedAt: new Date().toISOString(),
    };
    setJourneyState(nextState);
    await writeJourneyState(nextState);
  };

  const handleRefreshCsFloatStatus = async () => {
    try {
      const keyStatus = await fetchCsFloatApiKeyStatus();
      const keyConnected = Boolean(keyStatus?.data?.hasKey || keyStatus?.data?.configured);
      setHasCsFloatKey(keyConnected);
      if (keyConnected) {
        const nextState = {
          ...journeyState,
          skipped: false,
          completedAt: new Date().toISOString(),
        };
        setJourneyState(nextState);
        await writeJourneyState(nextState);
      }
    } catch (statusError) {
      console.warn("Failed to refresh CSFloat key status", statusError);
    }
  };
  const handleToggleAutoSync = async () => {
    const nextEnabled = !autoSyncEnabled;
    setAutoSyncEnabled(nextEnabled);
    await writeLocalState(STEAM_SYNC_PREF_KEY, { enabled: nextEnabled });
    if (nextEnabled) {
      autoSyncStartedRef.current = false;
      await runSteamSync({ manual: false });
    }
  };

  return (
    <div
      className="min-h-screen bg-background font-sans text-foreground pb-20 touch-pan-y"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="mx-auto max-w-7xl space-y-6 sm:space-y-8 p-4 sm:p-6 md:p-8">
        {/* Mobile Header - nur auf Mobile sichtbar */}
        <header className="flex sm:hidden items-center justify-between">
          <h1 className="text-lg font-bold tracking-tight text-primary">CS Investor Hub</h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="relative h-10 w-10 rounded-full p-0">
                  <Bell className="h-5 w-5" />
                  {unreadNotificationCount > 0 ? (
                    <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                      {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel>Neue Steam Items</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {syncNotification.newItemsCount === 0 ? (
                  <DropdownMenuItem disabled>
                    Keine neuen Items seit letztem App-Start.
                  </DropdownMenuItem>
                ) : (
                  <div className="space-y-1 px-2 py-1">
                    {syncNotifications
                      .filter((entry) => entry.category === "steam_sync")
                      .slice(0, 5)
                      .map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => void handleNotificationClick(entry)}
                          className="w-full rounded-md border px-2 py-1 text-left hover:bg-accent"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium">{entry.message}</p>
                            <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                              {formatCompactNewCount(entry?.payload?.imported || 0)}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Aktion: {resolveNotificationActionTarget().label}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleString("de-DE")}
                          </p>
                        </button>
                      ))}
                  </div>
                )}
                {syncNotification.newItemsCount > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <div className="p-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const user = await getCurrentUser();
                          const userId = user?.id || "local";
                          if (window.electronAPI?.localStore?.markAllNotificationsRead) {
                            await window.electronAPI.localStore.markAllNotificationsRead(userId, "steam_sync");
                          }
                          setCompositionRefreshToken((current) => current + 1);
                        }}
                      >
                        Alle als gelesen
                      </Button>
                    </div>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Header - nur auf Desktop sichtbar */}
        <header className="hidden sm:flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-primary md:text-3xl">CS Investor Hub</h1>
            <p className="text-sm text-muted-foreground md:text-base">Live Tracking via CSFloat and Currency API</p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="relative h-11 w-11 rounded-full p-0">
                  <Bell className="h-5 w-5" />
                  {unreadNotificationCount > 0 ? (
                    <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                      {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel>Neue Steam Items</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                {syncNotification.newItemsCount === 0 ? (
                  <DropdownMenuItem disabled>
                    Keine neuen Items seit letztem App-Start.
                  </DropdownMenuItem>
                ) : (
                  <div className="space-y-1 px-2 py-1">
                    {syncNotifications
                      .filter((entry) => entry.category === "steam_sync")
                      .slice(0, 5)
                      .map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => void handleNotificationClick(entry)}
                          className="w-full rounded-md border px-2 py-1 text-left hover:bg-accent"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium">{entry.message}</p>
                            <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                              {formatCompactNewCount(entry?.payload?.imported || 0)}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Aktion: {resolveNotificationActionTarget().label}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleString("de-DE")}
                          </p>
                        </button>
                      ))}
                  </div>
                )}
                {syncNotification.newItemsCount > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <div className="p-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const user = await getCurrentUser();
                          const userId = user?.id || "local";
                          if (window.electronAPI?.localStore?.markAllNotificationsRead) {
                            await window.electronAPI.localStore.markAllNotificationsRead(userId, "steam_sync");
                          }
                          setCompositionRefreshToken((current) => current + 1);
                        }}
                      >
                        Alle als gelesen
                      </Button>
                    </div>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <UserMenu />
          </div>
        </header>

        <ApiWarnings warnings={warnings} />

        {showJourneyBanner ? (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Setup Journey</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                Steam-Import ist aktiv. Als naechsten Schritt verbinde CSFloat:
                <span className="font-medium"> CSFloat → Profile → Developer → New Key</span>.
              </p>
              <div className="space-y-1 rounded-md border bg-background/70 p-2">
                <p className="text-xs font-semibold">
                  Fortschritt: {completedJourneySteps}/{journeySteps.length} Schritte
                </p>
                {journeySteps.map((step) => (
                  <p key={step.id} className="text-xs text-muted-foreground">
                    {step.done ? "[x]" : "[ ]"} {step.label}
                  </p>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Danach kannst du CSFloat-Import starten und in der Verwaltung Matching sowie Preise bearbeiten.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => navigate("/settings", { replace: true })}
                >
                  CSFloat Key hinterlegen
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleRefreshCsFloatStatus()}>
                  Ich habe verbunden
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void handleSkipJourney()}>
                  Journey ueberspringen
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* Tab Navigation - nur auf Desktop sichtbar */}
          <div className="hidden sm:block">
            {error && (
              <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <TabsList className="grid w-full grid-cols-4 gap-1 sm:max-w-200">
              <TabsTrigger value="overview" className="text-xs sm:text-sm">Uebersicht</TabsTrigger>
              <TabsTrigger value="inventory" className="text-xs sm:text-sm">Inventar</TabsTrigger>
              <TabsTrigger value="watchlist" className="text-xs sm:text-sm">Watchlist</TabsTrigger>
              <TabsTrigger value="management" className="text-xs sm:text-sm">Verwaltung</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="space-y-4 sm:space-y-6">
            {/* Mobile: PortfolioHeaderCard oben, Desktop: Alte Stats-Cards */}
            <div className="sm:hidden">
              <PortfolioHeaderCard
                totalValue={headerPortfolioValue}
                totalRoiPercent={headerPortfolioPercent}
                isPositive={headerPortfolioPositive}
                totalQuantity={stats.totalQuantity}
                liveItemsCount={liveItems}
                staleItemsCount={staleItems}
                freshestDataAgeSeconds={stats.freshestDataAgeSeconds}
                oldestDataAgeSeconds={stats.oldestDataAgeSeconds}
              />
            </div>

            {/* Desktop: Alte Stats-Cards */}
            <div className="hidden sm:grid gap-2 sm:gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
              <StatCard
                title="Portfolio Wert (Live)"
                value={portfolioValueLabel}
                isPositive={stats.isPositive}
              />
              <StatCard
                title="Gesamt Zuwachs"
                value={`${stats.isPositive ? "+" : ""}${formatPrice(Math.abs(stats.totalProfitEuro || 0), {
                  useUsd: true,
                  buyPriceUsd: Math.abs(stats.totalProfitEuro || 0),
                })}`}
                subValue={`${(stats.totalRoiPercent || 0) >= 0 ? "+" : ""}${(stats.totalRoiPercent || 0).toFixed(2)}%`}
                isPositive={stats.isPositive}
              />
              <StatCard title="Items im Bestand" value={`${stats.totalQuantity} Stueck`} />
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
                    Data Freshness
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-2xl font-bold">
                    {formatAge(stats.freshestDataAgeSeconds)} - {formatAge(stats.oldestDataAgeSeconds)}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      Live: {liveItems} | Stale: {staleItems}
                    </span>
                    <Badge variant="outline" className={freshnessBadgeClass(staleRatio)}>
                      {staleRatio.toFixed(0)}% stale
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2">
              <PortfolioChart
                history={portfolioHistory}
                isLoading={portfolioLoading}
                onHoverChange={setHoveredChartData}
              />
              <div className="hidden md:block">
                <WatchlistOverview maxItems={5} onOpenItem={handleOpenWatchlistItem} />
              </div>
            </div>

            {/* Mobile: Watchlist full-width */}
            <div className="sm:hidden">
              <WatchlistOverview maxItems={5} onOpenItem={handleOpenWatchlistItem} />
            </div>

            <div className="grid gap-4 sm:gap-6 grid-cols-1">
              <div>
                <h3 className="mb-4 text-lg font-semibold">Portfolio Zusammensetzung</h3>
                {compositionLoading ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <div className="lg:col-span-2 flex justify-center">
                          <Skeleton className="h-55 w-full max-w-sm sm:h-80" />
                      </div>
                      <div className="space-y-2">
                        {[1, 2, 3, 4].map((entry) => (
                          <Skeleton key={entry} className="h-14 w-full" />
                        ))}
                      </div>
                    </div>
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : compositionError ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {compositionError}
                  </div>
                ) : (
                  <PortfolioCompositionChart
                    data={compositionData}
                    totalValueOverride={stats.totalValue || 0}
                    totalValueLabel={portfolioValueLabel}
                  />
                )}
              </div>
            </div>

            {showCsUpdateBanner && latestCsUpdate ? (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-4 py-3 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">
                      CS Update
                    </p>
                    <p className="truncate text-sm font-semibold text-foreground sm:text-base">
                      Neues Update seit {formatRelativeHours(latestCsUpdateAgeHours)}: {latestCsUpdate.title}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Feed oeffnen
                    </span>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/cs-updates">Fullscreen</Link>
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="inventory" className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
            <div className="md:col-span-2 flex items-center justify-between gap-3 p-3 sm:p-4 sm:rounded-lg sm:border sm:bg-card">
              <div>
                <h3 className="text-base font-semibold">Inventar importieren</h3>
                <p className="text-xs text-muted-foreground">
                  Manueller CSFloat-Sync: zuerst Preview prüfen, dann Import starten.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => setIsCsFloatSyncOpen(true)}>
                CSFloat Sync
              </Button>
            </div>

            <div className="overflow-x-auto md:col-span-1 sm:rounded-lg sm:border sm:bg-card">
              <InventoryTable
                investments={enrichedInvestments}
                onSelectItem={(item) => {
                  setSelectedItem(item);
                  const historyItem = enrichedInvestments.find((inv) => inv.id === item.id);
                  if (historyItem) {
                    loadItemHistory(historyItem.id, historyItem.name).then(() => {
                      // Auf Mobile: Modal öffnen (nach Geschichtsdaten geladen)
                      if (window.innerWidth < BREAKPOINTS.MOBILE) {
                        openModal("itemDetail", { item });
                      }
                    });
                  }
                }}
              />
            </div>

            <div className="hidden md:block md:col-span-1">
              <ItemDetailPanel
                item={selectedItem}
                history={selectedItemHistory}
                historyLoading={selectedItemHistoryLoading}
                onExcludeChange={handleExcludeChange}
              />
            </div>

            {modals.map((modal) =>
              modal.type === "itemDetail" ? (
                <ItemDetailsModal
                  key={modal.id}
                  isOpen={true}
                  onClose={() => closeModal(modal.id)}
                  item={modal.data.item}
                  history={selectedItemHistory}
                  historyLoading={selectedItemHistoryLoading}
                  onToggleExclude={handleExcludeChange}
                />
              ) : null,
            )}
          </TabsContent>

          <TabsContent value="watchlist" className="space-y-4 sm:space-y-6">
            <Watchlist focusTarget={watchlistFocusTarget} />
          </TabsContent>

          <TabsContent value="management" className="space-y-4 sm:space-y-6">
            {typeof window !== "undefined" && !window.electronAPI?.localStore ? (
              <Card>
                <CardHeader>
                  <CardTitle>Cluster-Verwaltung nur im Desktop verfuegbar</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Diese Detailverwaltung arbeitet auf lokalen Positionen (inkl. excluded Status).
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="rounded-lg border p-3 sm:p-4 space-y-3">
                  <div>
                    <h3 className="text-base font-semibold">Inbox</h3>
                    <p className="text-xs text-muted-foreground">
                      Neue Aufgaben aus dem letzten Steam-Sync.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Card>
                      <CardContent className="p-3">
                        <p className="text-[10px] uppercase text-muted-foreground">Neue Steam-Items</p>
                        <p className="text-lg font-bold">{syncNotification.newItemsCount}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-3">
                        <p className="text-[10px] uppercase text-muted-foreground">Matching offen</p>
                        <p className="text-lg font-bold">{matchingSuggestedCount}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-3">
                        <p className="text-[10px] uppercase text-muted-foreground">Ohne Einkaufspreis</p>
                        <p className="text-lg font-bold">{priceMissingCount}</p>
                      </CardContent>
                    </Card>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      disabled={isSteamSyncing}
                      onClick={() => void runSteamSync({ manual: true })}
                    >
                      {isSteamSyncing ? "Sync laeuft..." : "Jetzt Steam Sync"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void handleToggleAutoSync()}>
                      Auto-Sync: {autoSyncEnabled ? "An" : "Aus"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setManagementSection("matching")}>
                      Matching pruefen
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setManagementSection("prices")}>
                      Preise setzen
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setManagementSection("exclude")}>
                      Exclude pruefen
                    </Button>
                  </div>
                  {steamSyncError ? (
                    <p className="text-xs text-destructive">{steamSyncError}</p>
                  ) : null}
                  <p className="text-[11px] text-muted-foreground">
                    Datenabruf erfolgt nur lokal fuer deinen Account. Auto-Sync laeuft maximal alle 30 Minuten
                    pro App-Instanz und kann jederzeit deaktiviert werden.
                  </p>
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle>Steam API Hinweise</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs text-muted-foreground">
                    <p>
                      Valve/Steam ist Datenquelle dieser App, aber die App ist nicht offiziell von Valve
                      unterstuetzt oder betrieben.
                    </p>
                    <p>
                      Gespeichert werden nur Portfolio-relevante Itemdaten, Exclude-Status und optional von dir
                      gesetzte Einkaufspreise. Es werden keine Steam-Passwoerter gespeichert.
                    </p>
                    <p>
                      Preis- oder Importdaten werden nur im Rahmen der von dir genutzten Features abgerufen.
                    </p>
                  </CardContent>
                </Card>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={managementSection === "matching" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setManagementSection("matching")}
                  >
                    Matching
                  </Button>
                  <Button
                    variant={managementSection === "prices" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setManagementSection("prices")}
                  >
                    Preise
                  </Button>
                  <Button
                    variant={managementSection === "exclude" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setManagementSection("exclude")}
                  >
                    Exclude
                  </Button>
                </div>

                {managementError ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {managementError}
                  </div>
                ) : null}

                {managementSection === "prices" ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Preise setzen</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {steamInventoryItems.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Noch keine Steam-Inventory-Items vorhanden.
                        </p>
                      ) : (
                        <>
                          <p className="text-sm text-muted-foreground">
                            Nur Steam-Inventory-Items koennen hier einen Einkaufspreis erhalten.
                          </p>
                          <div className="space-y-2">
                            {steamInventoryItems.map((item) => {
                              const currentPrice = Number(item.buyPriceUsd ?? item.buyPrice ?? 0);
                              const draftValue = priceDrafts[item.id] ?? String(currentPrice > 0 ? currentPrice : "");
                              return (
                                <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-semibold">{item.name}</p>
                                    <p className="text-[11px] text-muted-foreground">
                                      Aktuell: {currentPrice > 0 ? `${currentPrice.toFixed(2)} USD` : "kein Preis gesetzt"}
                                    </p>
                                  </div>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={draftValue}
                                    onChange={(event) => handlePriceDraftChange(item.id, event.target.value)}
                                    className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
                                    placeholder="USD"
                                  />
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={savingPriceItemId === item.id}
                                    onClick={() => void handleSaveSteamItemPrice(item)}
                                  >
                                    {savingPriceItemId === item.id ? "Speichert..." : "Speichern"}
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ) : null}

                {managementSection === "exclude" && managementLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : null}

                {managementSection === "exclude" && !managementLoading && filteredManagementClusters.length === 0 ? (
                  <Card>
                    <CardContent className="py-6 text-sm text-muted-foreground">
                      Keine Cluster fuer den gewaehlten Filter gefunden.
                    </CardContent>
                  </Card>
                ) : null}

                {managementSection === "exclude" ? (
                  <>
                    <div className="flex items-center gap-2">
                      <Button
                        variant={managementFilter === "all" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setManagementFilter("all")}
                      >
                        Alle
                      </Button>
                      <Button
                        variant={managementFilter === "excluded" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setManagementFilter("excluded")}
                      >
                        Nur Excluded
                      </Button>
                      <Button
                        variant={managementFilter === "active" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setManagementFilter("active")}
                      >
                        Nur Aktiv
                      </Button>
                    </div>
                  <div className="space-y-3">
                    {filteredManagementClusters.map((cluster) => {
                      const isExpanded = Boolean(expandedClusters[cluster.id]);
                      return (
                        <Card key={cluster.id}>
                          <CardContent className="space-y-3 p-3 sm:p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <div className="h-12 w-12 overflow-hidden rounded-md border bg-muted/30 p-1">
                                  {cluster.imageUrl ? (
                                    <img
                                      src={cluster.imageUrl}
                                      alt={cluster.name}
                                      className="h-full w-full object-contain"
                                      loading="lazy"
                                      decoding="async"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                                      N/A
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold">{cluster.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {cluster.totalCount} Stueck | excluded: {cluster.excludedCount} | aktiv: {cluster.activeCount}
                                  </p>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => toggleClusterExpanded(cluster.id)}
                                >
                                  {isExpanded ? "Positionen ausblenden" : "Positionen anzeigen"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleManagementClusterToggle(cluster, true)}
                                >
                                  Cluster excluden
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleManagementClusterToggle(cluster, false)}
                                >
                                  Cluster einschliessen
                                </Button>
                              </div>
                            </div>

                            {isExpanded ? (
                              <div className="space-y-2 rounded-md border p-2 sm:p-3">
                                {cluster.positions.map((position) => (
                                  <div
                                    key={position.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                                  >
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold">
                                        {position.quantity}x @ {formatPrice(position.buyPriceUsd, {
                                          useUsd: true,
                                          buyPriceUsd: position.buyPriceUsd,
                                        })}
                                      </p>
                                      <p className="truncate text-[11px] text-muted-foreground">
                                        Trade ID: {position.externalTradeId || "-"} | Kauf: {position.purchasedAt || "-"}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Badge variant={position.excluded ? "destructive" : "outline"}>
                                        {position.excluded ? "excluded" : "aktiv"}
                                      </Badge>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                          void handleManagementExcludeToggle(
                                            position.id,
                                            !position.excluded,
                                          )
                                        }
                                      >
                                        {position.excluded ? "Einschliessen" : "Excluden"}
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                  </>
                ) : null}

                {managementSection === "matching" ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Steam ↔ CSFloat Matching Queue</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {matchingLoading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-14 w-full" />
                        <Skeleton className="h-14 w-full" />
                      </div>
                    ) : matchingRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Noch keine Matching-Vorschlaege vorhanden.
                      </p>
                    ) : (
                      matchingRows.slice(0, 40).map((row) => (
                        <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold">
                              Steam: {row.steamItemName}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              Score: {row.matchScore.toFixed(0)} | Confidence: {row.confidence} | Status: {row.status}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleMatchStatusUpdate(row.id, "manual_confirmed")}
                            >
                              Bestaetigen
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleMatchStatusUpdate(row.id, "rejected")}
                            >
                              Ablehnen
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
                ) : null}
              </>
            )}
          </TabsContent>
        </Tabs>

        <CsFloatTradeSyncModal
          isOpen={isCsFloatSyncOpen}
          onClose={() => setIsCsFloatSyncOpen(false)}
          onSynced={async () => {
            await refreshPortfolio();
            setActiveTab("inventory");
            setIsCsFloatSyncOpen(false);
          }}
        />
      </div>
    </div>
  );
}
