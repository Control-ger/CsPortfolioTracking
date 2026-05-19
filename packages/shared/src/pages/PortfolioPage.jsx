import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Bell, Eye, FolderCog, Info, LayoutGrid, Package } from "lucide-react";

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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@shared/components";
import { Skeleton } from "@shared/components";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@shared/components";
import { usePortfolio } from "@shared/hooks";
import { usePortfolioComposition } from "@shared/hooks";
import {
  fetchItemPriceHistory,
  fetchPortfolioInvestmentHistory,
  updateInvestmentBucket,
} from "../lib/apiClient";
import { useCsUpdatesFeed } from "@shared/hooks";
import {
  fetchCS2Inventory,
  getPortfolioPreferences,
  getCurrentUser,
  importInventoryAsInvestments,
  resolveDesktopLocalUserId as resolveDesktopRuntimeUserId,
  resolveMetricsScopeFromPreferences,
  fetchCsFloatApiKeyStatus,
  updateCsFloatApiKey,
  toggleExcludeInvestment,
  updatePortfolioPreferences,
} from "@shared/lib";
import { BREAKPOINTS, UI } from "@shared/lib";
import { useKeyboard } from "@shared/hooks";
import { useCurrency } from "@shared/contexts/CurrencyContext";
import { runDesktopSyncNowIfDue } from "@shared/lib/desktopSync.js";
import { deriveSteamPaletteFromUser } from "@shared/components/SteamLoginPrompt.jsx";
import { normalizeServerHostInput } from "@shared/lib/serverConfig";

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

function formatDateSafe(value) {
  if (!value) {
    return "-";
  }
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) {
    return String(value);
  }
  return new Date(timestamp).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const SWIPE_THRESHOLD = UI.SWIPE_THRESHOLD;
const JOURNEY_STORAGE_KEY = "onboarding:journey:v1";
const STEAM_SYNC_META_KEY = "steam:sync:meta:v1";
const STEAM_SYNC_PREF_KEY = "steam:sync:auto-enabled:v1";
const STEAM_SYNC_COOLDOWN_MS = 1000 * 60 * 30;
const STARTUP_WELCOME_DISMISS_KEY = "startup:welcome:dismissed:v1";
const JOURNEY_STEP_ORDER = ["server", "import_defaults", "csfloat_key", "csfloat_import", "matching", "management"];
const DESKTOP_SIDEBAR_TABS = [
  { key: "overview", label: "Uebersicht", icon: LayoutGrid },
  { key: "inventory", label: "Inventar", icon: Package },
  { key: "watchlist", label: "Watchlist", icon: Eye },
  { key: "management", label: "Verwaltung", icon: FolderCog, desktopOnly: true },
];

function readStartupWelcomeDismissed() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return sessionStorage.getItem(STARTUP_WELCOME_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStartupWelcomeDismissed() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    sessionStorage.setItem(STARTUP_WELCOME_DISMISS_KEY, "1");
  } catch {
    // Ignore storage failures; welcome fallback remains functional.
  }
}

function normalizeBucket(value, fallback = "investment") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "inventory") {
    return "inventory";
  }
  if (normalized === "investment") {
    return "investment";
  }
  return fallback === "inventory" ? "inventory" : "investment";
}

function normalizeCsFloatApiKeyInput(value) {
  let normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  normalized = normalized
    .replace(/^["']|["']$/g, "")
    .replace(/^bearer\s+/i, "")
    .replace(/^csfloat[_-]?api[_-]?key\s*[:=]\s*/i, "")
    .replace(/\s+/g, "");

  return normalized;
}

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

function getItemNameKey(item) {
  return String(item?.marketHashName || item?.name || item?.itemName || "")
    .trim()
    .toLowerCase();
}

function hasSourceIdOverlap(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) {
    return false;
  }
  const left = new Set(a.map((entry) => String(entry || "").trim()).filter(Boolean));
  return b.some((entry) => left.has(String(entry || "").trim()));
}

function resolveLiveClusterItem(baseItem, rows = []) {
  if (!baseItem || !Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const exactMatch = rows.find((row) => row.id === baseItem.id);
  if (exactMatch) {
    return exactMatch;
  }

  const baseSourceIds = Array.isArray(baseItem.sourceInvestmentIds)
    ? baseItem.sourceInvestmentIds
    : [];
  if (baseSourceIds.length > 0) {
    const sourceMatch = rows.find((row) =>
      hasSourceIdOverlap(baseSourceIds, Array.isArray(row?.sourceInvestmentIds) ? row.sourceInvestmentIds : []),
    );
    if (sourceMatch) {
      return sourceMatch;
    }
  }

  return null;
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
      platform: String(item.platform || item.source || "").toLowerCase(),
      steamAssetId: item.steamAssetId ? String(item.steamAssetId) : null,
      bucket: normalizeBucket(item.bucket),
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
  const isElectronRuntime = typeof window !== "undefined" && Boolean(window.electronAPI);
  const isDesktopRuntime = isElectronRuntime && Boolean(window.electronAPI?.localStore);
  const runtimeTabs = isDesktopRuntime
    ? ["overview", "inventory", "watchlist", "management"]
    : ["overview", "inventory", "watchlist"];
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resolvedInitialTab = searchParams.get("tab") || initialTab;
  const [showStartupWelcome, setShowStartupWelcome] = useState(
    () => isElectronRuntime && !readStartupWelcomeDismissed(),
  );
  const [portfolioPreferences, setPortfolioPreferences] = useState({
    steamImportBucket: "inventory",
    csfloatImportBucket: "investment",
    metricsDisplayMode: "toggle_mode",
    metricsScopeDefault: "investments",
  });
  const [selectedMetricsScope, setSelectedMetricsScope] = useState("investments");
  const [inventoryScope, setInventoryScope] = useState("investment");
  const metricsScope = resolveMetricsScopeFromPreferences(
    portfolioPreferences,
    selectedMetricsScope,
  );
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
    usePortfolio({ scope: metricsScope, rowScope: "all" });
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
  } = usePortfolioComposition(compositionRefreshToken, { scope: metricsScope });
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
  const [manualItemDraft, setManualItemDraft] = useState({
    name: "",
    buyPriceUsd: "",
    quantity: "1",
    platform: "manual",
    fundingMode: "wallet_funded",
    type: "skin",
    bucket: "investment",
  });
  const [manualItemSaving, setManualItemSaving] = useState(false);
  const [syncNotification, setSyncNotification] = useState({
    newItemsCount: 0,
    lastSyncedAt: null,
  });
  const [syncNotifications, setSyncNotifications] = useState([]);
  const [appUpdateNotification, setAppUpdateNotification] = useState({
    state: "idle",
    version: null,
    percent: 0,
    message: "",
  });
  const [installedAppVersion, setInstalledAppVersion] = useState("");
  const [appUpdateUnread, setAppUpdateUnread] = useState(false);
  const [journeyState, setJourneyState] = useState({ skipped: false });
  const [journeyLoading, setJourneyLoading] = useState(true);
  const [journeyUserName, setJourneyUserName] = useState("");
  const [hasCsFloatKey, setHasCsFloatKey] = useState(false);
  const [journeyApiKey, setJourneyApiKey] = useState("");
  const [journeyApiKeySaving, setJourneyApiKeySaving] = useState(false);
  const [journeyApiKeyError, setJourneyApiKeyError] = useState("");
  const [journeyApiKeySuccess, setJourneyApiKeySuccess] = useState("");
  const [journeyApiKeyHelper, setJourneyApiKeyHelper] = useState("");
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [isSteamSyncing, setIsSteamSyncing] = useState(false);
  const [steamSyncError, setSteamSyncError] = useState("");
  const [serverSetup, setServerSetup] = useState({
    loading: true,
    configured: true,
    serverUrl: "",
  });
  const [serverSetupTesting, setServerSetupTesting] = useState(false);
  const [serverSetupSaving, setServerSetupSaving] = useState(false);
  const [serverSetupError, setServerSetupError] = useState("");
  const [serverSetupMessage, setServerSetupMessage] = useState("");
  const autoSyncStartedRef = useRef(false);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const touchEndX = useRef(null);
  const touchEndY = useRef(null);
  const searchInputRef = useRef(null);

  // Keyboard shortcuts for tab navigation and search
  useKeyboard({
    onArrowLeft: () => {
      const currentIndex = runtimeTabs.indexOf(activeTab);
      if (currentIndex > 0) {
        const newTab = runtimeTabs[currentIndex - 1];
        setActiveTab(newTab);
        navigate(`/?tab=${newTab}`, { replace: true });
      }
    },
    onArrowRight: () => {
      const currentIndex = runtimeTabs.indexOf(activeTab);
      if (currentIndex < runtimeTabs.length - 1) {
        const newTab = runtimeTabs[currentIndex + 1];
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
    if (!isElectronRuntime || !showStartupWelcome) {
      return;
    }

    return () => {
      writeStartupWelcomeDismissed();
    };
  }, [isElectronRuntime, showStartupWelcome]);

  useEffect(() => {
    const loadJourneyState = async () => {
      setJourneyLoading(true);
      try {
        const [savedJourney, keyStatus, currentUser] = await Promise.all([
          readJourneyState(),
          fetchCsFloatApiKeyStatus(),
          getCurrentUser(),
        ]);
        setJourneyState(savedJourney && typeof savedJourney === "object" ? savedJourney : { skipped: false });
        setJourneyUserName(String(currentUser?.name || currentUser?.steamName || ""));
        const keyConnected = Boolean(keyStatus?.data?.hasKey || keyStatus?.data?.configured);
        setHasCsFloatKey(keyConnected);
      } catch (journeyError) {
        console.warn("Failed to load onboarding journey state", journeyError);
      } finally {
        setJourneyLoading(false);
      }
    };

    void loadJourneyState();
  }, []);

  useEffect(() => {
    const loadPortfolioPreferences = async () => {
      if (!isDesktopRuntime) {
        return;
      }

      try {
        const preferences = await getPortfolioPreferences();
        setPortfolioPreferences(preferences);
        setSelectedMetricsScope(preferences.metricsScopeDefault || "investments");
      } catch (preferenceError) {
        console.warn("Failed to load portfolio preferences", preferenceError);
      }
    };

    void loadPortfolioPreferences();
  }, [isDesktopRuntime]);

  useEffect(() => {
    if (!isDesktopRuntime || typeof document === "undefined") {
      return;
    }

    let active = true;
    const root = document.documentElement;
    const isJourneyVisible =
      !journeyLoading &&
      !journeyState?.skipped &&
      !journeyState?.completedAt &&
      activeTab !== "management";

    const applyJourneyPalette = async () => {
      try {
        const currentUser = await getCurrentUser();
        const palette = await deriveSteamPaletteFromUser(currentUser);
        if (!active || !palette) {
          return;
        }
        root.style.setProperty("--steam-shell-color-a", String(palette.colorA || ""));
        root.style.setProperty("--steam-shell-color-b", String(palette.colorB || ""));
        root.style.setProperty("--steam-shell-color-c", String(palette.colorC || ""));
        root.style.setProperty("--steam-shell-color-d", String(palette.colorD || palette.colorB || ""));
      } catch (paletteError) {
        console.warn("Failed to apply journey palette", paletteError);
      }
    };

    void applyJourneyPalette();
    const intervalId = isJourneyVisible ? window.setInterval(() => void applyJourneyPalette(), 120000) : null;

    return () => {
      active = false;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [activeTab, isDesktopRuntime, journeyLoading, journeyState?.completedAt, journeyState?.skipped, journeyUserName]);

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
        const userId = resolveDesktopRuntimeUserId(user, 1);
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
        const userId = resolveDesktopRuntimeUserId(user, 1);
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

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.updater?.onStatus) {
      return;
    }

    const unsubscribe = window.electronAPI.updater.onStatus((payload) => {
      if (!payload || typeof payload !== "object") {
        return;
      }

      setAppUpdateNotification((current) => ({
        ...current,
        ...payload,
      }));

      const nextState = String(payload.state || "");
      if (["available", "downloading", "downloaded", "error"].includes(nextState)) {
        setAppUpdateUnread(true);
      }
      if (nextState === "not-available") {
        setAppUpdateUnread(false);
      }
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    const loadInstalledVersion = async () => {
      if (!window.electronAPI?.updater?.getVersion) {
        return;
      }
      try {
        const value = await window.electronAPI.updater.getVersion();
        setInstalledAppVersion(String(value || ""));
      } catch {
        setInstalledAppVersion("");
      }
    };

    void loadInstalledVersion();
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
      const userId = resolveDesktopRuntimeUserId(user, 1);
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
      const syncResult = await importInventoryAsInvestments(marketableItems, userId, {
        bucket: portfolioPreferences.steamImportBucket,
      });
      const imported = Number(syncResult?.imported || 0);
      const updated = Number(syncResult?.updated || 0);
      const matchesSuggested = Number(syncResult?.matchesSuggested || 0);
      const syncedAt = new Date().toISOString();
      try {
        await runDesktopSyncNowIfDue({ force: true });
      } catch (desktopSyncError) {
        console.warn("[desktop-sync] steam import sync failed", desktopSyncError);
        const syncMessage = String(desktopSyncError?.message || "");
        if (syncMessage.toLowerCase().includes("cloudflare access")) {
          setSteamSyncError(
            "Cloudflare Access Anmeldung erforderlich. Bitte melde dich im Login-Fenster an und starte den Sync erneut.",
          );
        }
      }

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

      if (imported > 0 || updated > 0 || matchesSuggested > 0) {
        await refreshPortfolio();
        setCompositionRefreshToken((current) => current + 1);
      }
    } catch (syncError) {
      console.warn("Steam sync failed", syncError);
      setSteamSyncError(formatSteamSyncError(syncError));
    } finally {
      setIsSteamSyncing(false);
    }
  }, [authRequired, isSteamSyncing, portfolioPreferences.steamImportBucket, refreshPortfolio]);

  useEffect(() => {
    const loadServerSetup = async () => {
      if (!window.electronAPI?.serverConfig?.get) {
        setServerSetup({ loading: false, configured: true, serverUrl: "" });
        return;
      }

      try {
        const config = await window.electronAPI.serverConfig.get();
        const configured = Boolean(String(config?.serverUrl || "").trim());
        const normalizedHost = normalizeServerHostInput(config?.serverUrl || "");
        setServerSetup({
          loading: false,
          configured,
          serverUrl: normalizedHost || String(config?.serverUrl || ""),
        });
      } catch {
        setServerSetup({ loading: false, configured: false, serverUrl: "" });
      }
    };

    void loadServerSetup();
  }, []);

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

  const handleModalExcludeToggle = async (itemId, excluded, sourceInvestmentIds = []) => {
    await toggleExcludeInvestment(itemId, excluded, sourceInvestmentIds);
    await handleExcludeChange(itemId, excluded);
  };

  const selectedItemWithLive = useMemo(() => {
    if (!selectedItem) {
      return null;
    }

    return resolveLiveClusterItem(selectedItem, enrichedInvestments);
  }, [selectedItem, enrichedInvestments]);

  useEffect(() => {
    const loadItemHistory = async () => {
      if (!selectedItemWithLive) {
        setSelectedItemHistory([]);
        setSelectedItemHistoryLoading(false);
        return;
      }

      setSelectedItemHistoryLoading(true);
      try {
        const isDesktopLocal =
          typeof window !== "undefined" && Boolean(window.electronAPI?.localStore);
        const itemId = Number(selectedItemWithLive.itemId ?? selectedItemWithLive.item_id ?? 0);

        if (isDesktopLocal && itemId > 0) {
          const history = await window.electronAPI.localStore.listPriceHistory(itemId);
          if (Array.isArray(history) && history.length > 0) {
            setSelectedItemHistory(history);
            return;
          }
        }

        if (itemId > 0) {
          const history = await fetchItemPriceHistory(itemId, {
            itemName: selectedItemWithLive.name,
          });
          setSelectedItemHistory(history || []);
          return;
        }

        // Fallback: keep old position-history endpoint for legacy items
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
  if (isElectronRuntime && showStartupWelcome) {
    return (
      <div className="steam-startup-shell flex min-h-full items-center justify-center p-4">
        <SteamLoginPrompt
          onLoginSuccess={async () => {
            await refreshPortfolio();
            writeStartupWelcomeDismissed();
            setShowStartupWelcome(false);
          }}
        />
      </div>
    );
  }

  if (authRequired && !portfolioLoading) {
    return (
      <div className={`flex items-center justify-center p-4 ${isElectronRuntime ? "min-h-full" : "min-h-screen"}`}>
        <SteamLoginPrompt onLoginSuccess={refreshPortfolio} />
      </div>
    );
  }

  const handleTabSelect = (nextTab) => {
    if (!runtimeTabs.includes(nextTab)) {
      return;
    }
    setActiveTab(nextTab);
    navigate(`/?tab=${nextTab}`, { replace: true });
  };

  const handleOpenWatchlistItem = (item) => {
    if (!item?.id) {
      return;
    }

    setWatchlistFocusTarget({
      id: item.id,
      requestedAt: Date.now(),
    });
    handleTabSelect("watchlist");
  };

  const handleSwipeNavigation = (direction) => {
    const currentIndex = runtimeTabs.indexOf(activeTab);
    if (currentIndex === -1) return;

    let nextIndex;
    if (direction === "left") {
      nextIndex = Math.min(currentIndex + 1, runtimeTabs.length - 1);
    } else {
      nextIndex = Math.max(currentIndex - 1, 0);
    }

    if (nextIndex !== currentIndex) {
      const nextTab = runtimeTabs[nextIndex];
      handleTabSelect(nextTab);
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

  const liveItems = Number(stats.liveItemsCount || 0);
  const staleItems = Number(stats.staleLiveItemsCount || 0);
  const staleRatio = Number(stats.staleLiveItemsRatioPercent || 0);
  const headerPortfolioValue = hoveredChartData?.wert ?? (stats.totalValue || 0);
  const headerPortfolioPercent = hoveredChartData?.growthPercent ?? (stats.totalRoiPercent || 0);
  const hoveredProfitEuro = Number(hoveredChartData?.profitEuro);
  const headerProfitEuro = hoveredChartData
    ? Number.isFinite(hoveredProfitEuro)
      ? hoveredProfitEuro
      : (headerPortfolioValue || 0) - Number(stats.totalInvested || 0)
    : Number(stats.totalProfitEuro || 0);
  const headerPortfolioPositive = hoveredChartData ? headerProfitEuro >= 0 : Boolean(stats.isPositive);
  const showCsUpdateBanner =
    !csUpdatesLoading &&
    Boolean(latestCsUpdate) &&
    Number.isFinite(latestCsUpdateAgeHours) &&
    latestCsUpdateAgeHours <= 24;
  const portfolioValueLabel = formatPrice(stats.totalValue || 0, {
    useUsd: true,
    buyPriceUsd: stats.totalValue || 0,
  });
  const headerPortfolioValueLabel = formatPrice(headerPortfolioValue || 0, {
    useUsd: true,
    buyPriceUsd: headerPortfolioValue || 0,
  });
  const headerProfitPercent = hoveredChartData
    ? Number(headerPortfolioPercent || 0)
    : Number(stats.totalRoiPercent || 0);
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
  const pendingMatchingRows = matchingRows.filter((row) => row.status === "suggested");
  const confirmedOrAutoMatchByCsfloatId = new Map();
  matchingRows.forEach((row) => {
    const status = String(row?.status || "").toLowerCase();
    if (!["manual_confirmed", "auto_linked"].includes(status)) {
      return;
    }
    const csfloatId = String(row?.csfloatInvestmentId || "").trim();
    const steamId = String(row?.steamAssetId || "").trim();
    if (!csfloatId || !steamId) {
      return;
    }
    confirmedOrAutoMatchByCsfloatId.set(csfloatId, steamId);
  });
  const matchingSuggestedCount = pendingMatchingRows.length;
  const inventoryTabItems = enrichedInvestments.filter((item) => {
    const bucket = normalizeBucket(
      item?.bucket,
      String(item?.platform || item?.source || "").toLowerCase() === "steam_inventory"
        ? "inventory"
        : "investment",
    );
    if (inventoryScope === "all") {
      return true;
    }
    return bucket === inventoryScope;
  });
  const steamInventoryItems = managementInvestments.filter((item) => {
    const platform = String(item.platform || item.source || "").toLowerCase();
    return platform === "steam_inventory" || Boolean(item.steamAssetId);
  });
  const suggestedPriceByNameKey = (() => {
    const nextMap = new Map();

    enrichedInvestments.forEach((item) => {
      const key = getItemNameKey(item);
      if (!key || nextMap.has(key)) {
        return;
      }

      const livePrice = Number(item.livePrice);
      if (Number.isFinite(livePrice) && livePrice > 0) {
        nextMap.set(key, {
          value: livePrice,
          source: item.priceSource || "live",
        });
      }
    });

    return nextMap;
  })();
  const priceMissingCount = managementInvestments.filter((item) => {
    const platform = String(item.platform || item.source || "").toLowerCase();
    if (!(platform === "steam_inventory" || item.steamAssetId)) {
      return false;
    }
    const price = Number(item.buyPriceUsd ?? item.buyPrice ?? 0);
    return !Number.isFinite(price) || price <= 0;
  }).length;
  const managementQuickHints = [
    {
      id: "matching",
      title: "Matching",
      text: "Verknuepfe Steam-Items mit CSFloat-Kaeufen fuer korrekte Kaufpreise und Historie.",
    },
    {
      id: "prices",
      title: "Preise",
      text: "Ergaenze fehlende Einkaufspreise fuer saubere ROI- und Gewinnwerte.",
    },
    {
      id: "exclude",
      title: "Exclude",
      text: "Blende Positionen aus Kennzahlen aus, ohne Daten zu loeschen.",
    },
    {
      id: "sync",
      title: "Sync",
      text: "Starte manuell oder automatisch neue Imports, wenn sich dein Steam-Inventar geaendert hat.",
    },
  ];

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

  const handleManagementBucketToggle = async (investmentId, bucket) => {
    await updateInvestmentBucket(investmentId, bucket);
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

  const handleManagementClusterBucketToggle = async (cluster, bucket) => {
    await updateInvestmentBucket(
      cluster.id,
      bucket,
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

  const handleSaveSteamItemPrice = async (item, explicitPrice = null) => {
    const draftValue = explicitPrice ?? priceDrafts[item.id];
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
        priceSetMode: "user_confirmed",
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
  const handleAcceptSuggestedPrice = async (item, suggestedPriceUsd) => {
    const normalizedSuggestion = Number(suggestedPriceUsd);
    if (!Number.isFinite(normalizedSuggestion) || normalizedSuggestion <= 0) {
      return;
    }

    setPriceDrafts((current) => ({
      ...current,
      [item.id]: normalizedSuggestion.toFixed(2),
    }));

    await handleSaveSteamItemPrice(item, normalizedSuggestion);
  };
  const handleManualItemDraftChange = (key, value) => {
    setManualItemDraft((current) => ({
      ...current,
      [key]: value,
    }));
  };
  const handleCreateManualInvestment = async () => {
    if (!window.electronAPI?.localStore?.upsertInvestment) {
      return;
    }

    const name = String(manualItemDraft.name || "").trim();
    const quantity = Number(manualItemDraft.quantity);
    const buyPriceUsd = Number(manualItemDraft.buyPriceUsd);
    const bucket = manualItemDraft.bucket === "inventory" ? "inventory" : "investment";
    const platform = String(manualItemDraft.platform || "manual").trim().toLowerCase() || "manual";
    const fundingMode =
      String(manualItemDraft.fundingMode || "wallet_funded").trim().toLowerCase() === "balance_funded"
        ? "balance_funded"
        : "wallet_funded";
    const type = String(manualItemDraft.type || "skin").trim().toLowerCase() || "skin";

    if (!name) {
      setManagementError("Bitte einen Item-Namen angeben.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setManagementError("Bitte eine gueltige Menge > 0 angeben.");
      return;
    }
    if (!Number.isFinite(buyPriceUsd) || buyPriceUsd < 0) {
      setManagementError("Bitte einen gueltigen USD-Einkaufspreis angeben.");
      return;
    }

    const user = await getCurrentUser();
    const userId = resolveDesktopRuntimeUserId(user, 1);
    const generatedId = window.crypto?.randomUUID
      ? `manual-${window.crypto.randomUUID()}`
      : `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setManualItemSaving(true);
    setManagementError("");
    try {
      await window.electronAPI.localStore.upsertInvestment({
        id: generatedId,
        userId,
        name,
        marketHashName: name,
        type,
        quantity: Math.max(1, Math.floor(quantity)),
        buyPriceUsd,
        buyPrice: buyPriceUsd,
        fundingMode,
        platform,
        source: platform,
        bucket,
        createdManually: true,
        createdAt: new Date().toISOString(),
      });
      try {
        await runDesktopSyncNowIfDue({ force: true });
      } catch (syncError) {
        console.warn("[desktop-sync] manual investment sync failed", syncError);
      }
      await refreshPortfolio();
      setCompositionRefreshToken((current) => current + 1);
      setManualItemDraft({
        name: "",
        buyPriceUsd: "",
        quantity: "1",
        platform: "manual",
        fundingMode: "wallet_funded",
        type: "skin",
        bucket: "investment",
      });
      setManagementSection("exclude");
    } catch (createError) {
      setManagementError(createError?.message || "Item konnte nicht erstellt werden.");
    } finally {
      setManualItemSaving(false);
    }
  };
  const appUpdateState = String(appUpdateNotification?.state || "idle");
  const appUpdateVersionLabel = appUpdateNotification?.version
    ? `v${appUpdateNotification.version}`
    : "neue Version";
  const appUpdateStatusLabel = (() => {
    if (appUpdateState === "checking") {
      return "Suche nach Updates...";
    }
    if (appUpdateState === "available") {
      return `${appUpdateVersionLabel} verfuegbar`;
    }
    if (appUpdateState === "downloading") {
      const percent = Number(appUpdateNotification?.percent || 0);
      return `Download laeuft (${Math.max(0, Math.min(100, Math.round(percent)))}%)`;
    }
    if (appUpdateState === "downloaded") {
      return `${appUpdateVersionLabel} heruntergeladen`;
    }
    if (appUpdateState === "not-available") {
      return "App ist aktuell";
    }
    if (appUpdateState === "error") {
      return appUpdateNotification?.message || "Update-Pruefung fehlgeschlagen";
    }
    return "Noch kein Update-Status vorhanden";
  })();
  const appUpdateNotificationClass = (() => {
    if (appUpdateState === "downloaded") {
      return "w-full rounded-md border border-emerald-300 bg-emerald-500/10 px-2 py-2 text-left hover:bg-emerald-500/20";
    }
    if (appUpdateState === "downloading") {
      return "w-full rounded-md border border-blue-300 bg-blue-500/10 px-2 py-2 text-left hover:bg-blue-500/20";
    }
    if (appUpdateState === "available") {
      return "w-full rounded-md border border-amber-300 bg-amber-500/10 px-2 py-2 text-left hover:bg-amber-500/20";
    }
    if (appUpdateState === "error") {
      return "w-full rounded-md border border-destructive/60 bg-destructive/10 px-2 py-2 text-left hover:bg-destructive/20";
    }
    return "w-full rounded-md border px-2 py-2 text-left hover:bg-accent";
  })();
  const appUpdateHintLabel = (() => {
    if (appUpdateState === "downloaded") {
      return "Klick: Jetzt updaten.";
    }
    if (appUpdateState === "downloading") {
      return "Klick: Download-Status ansehen.";
    }
    if (appUpdateState === "available") {
      return "Klick: Update-Info ansehen.";
    }
    if (appUpdateState === "error") {
      return "Klick: Fehlerdetails ansehen.";
    }
    return "Klick: Update-Status ansehen.";
  })();
  const hasVisibleAppUpdateNotification = ["available", "downloading", "downloaded", "error"].includes(appUpdateState);
  const hasUnreadAppUpdate =
    appUpdateUnread && ["available", "downloading", "downloaded", "error"].includes(appUpdateState);
  const unreadNotificationCount = syncNotification.newItemsCount + (hasUnreadAppUpdate ? 1 : 0);
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
  const handleAppUpdateInstall = async () => {
    if (!window.electronAPI?.updater?.install) {
      return;
    }
    await window.electronAPI.updater.install();
  };
  const handleAppUpdateNotificationClick = async () => {
    if (appUpdateState === "downloaded") {
      const shouldInstallNow = window.confirm(
        `${appUpdateVersionLabel} ist heruntergeladen. Jetzt neu starten und installieren?`,
      );
      if (shouldInstallNow) {
        await handleAppUpdateInstall();
        return;
      }
      setAppUpdateUnread(false);
      return;
    }

    if (appUpdateState === "available" || appUpdateState === "downloading") {
      window.alert(
        `${appUpdateVersionLabel} ist verfuegbar. Der Download laeuft im Hintergrund; sobald er fertig ist, kannst du direkt installieren.`,
      );
      setAppUpdateUnread(false);
      return;
    }

    if (appUpdateState === "error") {
      window.alert(appUpdateStatusLabel);
      setAppUpdateUnread(false);
    }
  };
  const renderNotificationsDropdownContent = () => (
    <>
      <DropdownMenuLabel>Benachrichtigungen</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <div className="space-y-2 px-2 py-1">
        {hasVisibleAppUpdateNotification ? (
          <button
            type="button"
            onClick={() => void handleAppUpdateNotificationClick()}
            className={appUpdateNotificationClass}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">App Update</p>
              {hasUnreadAppUpdate ? (
                <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  neu
                </span>
              ) : null}
            </div>
            {installedAppVersion ? (
              <p className="text-[11px] text-muted-foreground">Installiert: v{installedAppVersion}</p>
            ) : null}
            <p className="text-[11px] text-muted-foreground">{appUpdateStatusLabel}</p>
            <p className="text-[11px] text-muted-foreground">{appUpdateHintLabel}</p>
          </button>
        ) : null}

        <div className="rounded-md border p-2">
          <p className="text-xs font-semibold">Neue Steam Items</p>
          {syncNotification.newItemsCount === 0 ? (
            <p className="text-[11px] text-muted-foreground">Keine neuen Items seit letztem App-Start.</p>
          ) : (
            <div className="mt-1 space-y-1">
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
            <div className="mt-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const user = await getCurrentUser();
                  const userId = resolveDesktopRuntimeUserId(user, 1);
                  if (window.electronAPI?.localStore?.markAllNotificationsRead) {
                    await window.electronAPI.localStore.markAllNotificationsRead(userId, "steam_sync");
                  }
                  setCompositionRefreshToken((current) => current + 1);
                }}
              >
                Alle als gelesen
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
  const journeySteps = [
    {
      id: "server",
      label: "Server-Verbindung eingerichtet",
      done: Boolean(serverSetup.configured),
    },
    {
      id: "import_defaults",
      label: "Steam-Importziel bestaetigt",
      done: Boolean(journeyState?.importBucketConfirmedAt),
    },
    {
      id: "csfloat_key",
      label: "CSFloat API Key hinterlegt",
      done: hasCsFloatKey,
    },
    {
      id: "csfloat_import",
      label: "CSFloat-Import entschieden",
      done: Boolean(journeyState?.csfloatImportCompletedAt || journeyState?.csfloatImportSkippedAt),
    },
    {
      id: "matching",
      label: "Matching geprueft",
      done: Boolean(journeyState?.matchingReviewedAt) || matchingSuggestedCount === 0,
    },
    {
      id: "management",
      label: "Verwaltung-Hinweise gesehen",
      done: Boolean(journeyState?.managementHintsSeenAt),
    },
  ];
  const completedJourneySteps = journeySteps.filter((step) => step.done).length;
  const journeyStarted = Boolean(journeyState?.startedAt);
  const firstIncompleteJourneyStep =
    journeySteps.find((step) => !step.done)?.id || JOURNEY_STEP_ORDER[JOURNEY_STEP_ORDER.length - 1];
  const storedJourneyStepId = String(journeyState?.currentStepId || "").trim();
  const activeJourneyStepId =
    journeyStarted && JOURNEY_STEP_ORDER.includes(storedJourneyStepId)
      ? storedJourneyStepId
      : journeyStarted
        ? firstIncompleteJourneyStep
        : "intro";
  const showJourneyBanner =
    !journeyLoading &&
    !journeyState?.skipped &&
    !journeyState?.completedAt;
  const showSetupJourney = isDesktopRuntime && showJourneyBanner && activeTab !== "management";
  const showJourneyBannerLegacy = false;
  const journeyProgressPercent =
    journeySteps.length > 0 ? Math.round((completedJourneySteps / journeySteps.length) * 100) : 0;
  const updateJourneyState = async (patch) => {
    const nextState = {
      ...journeyState,
      ...patch,
    };
    setJourneyState(nextState);
    await writeJourneyState(nextState);
    return nextState;
  };
  const resolveNextJourneyStepId = (stepId) => {
    const currentIndex = JOURNEY_STEP_ORDER.indexOf(stepId);
    if (currentIndex < 0) {
      return firstIncompleteJourneyStep;
    }
    if (currentIndex >= JOURNEY_STEP_ORDER.length - 1) {
      return JOURNEY_STEP_ORDER[JOURNEY_STEP_ORDER.length - 1];
    }
    return JOURNEY_STEP_ORDER[currentIndex + 1];
  };
  const resolvePreviousJourneyStepId = (stepId) => {
    const currentIndex = JOURNEY_STEP_ORDER.indexOf(stepId);
    if (currentIndex <= 0) {
      return JOURNEY_STEP_ORDER[0];
    }
    return JOURNEY_STEP_ORDER[currentIndex - 1];
  };

  const handleSkipJourney = async () => {
    await updateJourneyState({
      skipped: true,
      skippedAt: new Date().toISOString(),
    });
  };
  const handleStartJourney = async () => {
    if (journeyStarted) {
      return;
    }
    await updateJourneyState({
      skipped: false,
      startedAt: new Date().toISOString(),
      currentStepId: serverSetup.configured ? firstIncompleteJourneyStep : "server",
    });
  };
  const handleGoToJourneyStep = async (stepId) => {
    if (!JOURNEY_STEP_ORDER.includes(stepId)) {
      return;
    }
    await updateJourneyState({
      currentStepId: stepId,
    });
  };
  const handleGoBackJourneyStep = async () => {
    if (!journeyStarted || activeJourneyStepId === "intro") {
      return;
    }
    await handleGoToJourneyStep(resolvePreviousJourneyStepId(activeJourneyStepId));
  };
  const handleGoNextJourneyStep = async () => {
    if (!journeyStarted || activeJourneyStepId === "intro") {
      return;
    }
    await handleGoToJourneyStep(resolveNextJourneyStepId(activeJourneyStepId));
  };
  const handleConfirmImportDefaultsStep = async () => {
    await updateJourneyState({
      importBucketConfirmedAt: new Date().toISOString(),
      currentStepId: resolveNextJourneyStepId("import_defaults"),
    });
  };
  const handleMarkCsFloatImportSkipped = async () => {
    await updateJourneyState({
      csfloatImportSkippedAt: new Date().toISOString(),
      currentStepId: resolveNextJourneyStepId("csfloat_import"),
    });
  };
  const handleMarkMatchingReviewed = async () => {
    await updateJourneyState({
      matchingReviewedAt: new Date().toISOString(),
      currentStepId: resolveNextJourneyStepId("matching"),
    });
  };
  const handleManagementHintsSeen = async () => {
    await updateJourneyState({
      managementHintsSeenAt: new Date().toISOString(),
    });
  };
  const handleCompleteJourney = async () => {
    await updateJourneyState({
      skipped: false,
      completedAt: new Date().toISOString(),
      currentStepId: JOURNEY_STEP_ORDER[JOURNEY_STEP_ORDER.length - 1],
    });
    setActiveTab("management");
    setManagementSection("matching");
  };

  const handleRefreshCsFloatStatus = async () => {
    try {
      const keyStatus = await fetchCsFloatApiKeyStatus();
      const keyConnected = Boolean(keyStatus?.data?.hasKey || keyStatus?.data?.configured);
      setHasCsFloatKey(keyConnected);
      if (keyConnected && journeyStarted && activeJourneyStepId === "csfloat_key") {
        await updateJourneyState({
          currentStepId: resolveNextJourneyStepId("csfloat_key"),
        });
      }
      return keyConnected;
    } catch (statusError) {
      console.warn("Failed to refresh CSFloat key status", statusError);
      return false;
    }
  };
  const handleSaveJourneyCsFloatKey = async () => {
    const normalizedKey = normalizeCsFloatApiKeyInput(journeyApiKey);
    if (!normalizedKey) {
      setJourneyApiKeyError("Bitte einen gueltigen CSFloat API Key eingeben.");
      setJourneyApiKeySuccess("");
      setJourneyApiKeyHelper("");
      return;
    }

    if (normalizedKey.length < 20) {
      setJourneyApiKeyError("Der CSFloat API Key wirkt unvollstaendig. Bitte kopiere den kompletten Key.");
      setJourneyApiKeySuccess("");
      setJourneyApiKeyHelper(`Aktuell erkannt: ${normalizedKey.length} Zeichen`);
      return;
    }

    try {
      setJourneyApiKeySaving(true);
      setJourneyApiKeyError("");
      setJourneyApiKeySuccess("");
      setJourneyApiKeyHelper(`Speichere ${normalizedKey.length} Zeichen...`);
      await updateCsFloatApiKey(normalizedKey);
      setJourneyApiKey("");
      setJourneyApiKeySuccess("CSFloat API Key wurde gespeichert.");
      setJourneyApiKeyHelper("Key erfolgreich gespeichert.");
      const keyConnected = await handleRefreshCsFloatStatus();
      if (keyConnected) {
        await updateJourneyState({
          csfloatKeySavedAt: new Date().toISOString(),
          currentStepId: resolveNextJourneyStepId("csfloat_key"),
        });
      }
    } catch (error) {
      setJourneyApiKeyError(error?.message || "CSFloat API Key konnte nicht gespeichert werden.");
      setJourneyApiKeySuccess("");
      setJourneyApiKeyHelper("");
    } finally {
      setJourneyApiKeySaving(false);
    }
  };
  const handlePasteJourneyCsFloatKey = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      setJourneyApiKeyError("Zwischenablage ist in dieser Umgebung nicht verfuegbar.");
      setJourneyApiKeySuccess("");
      setJourneyApiKeyHelper("");
      return;
    }

    try {
      const rawClipboard = await navigator.clipboard.readText();
      const normalized = normalizeCsFloatApiKeyInput(rawClipboard);
      setJourneyApiKey(normalized);
      setJourneyApiKeyError("");
      setJourneyApiKeySuccess("");
      if (!normalized) {
        setJourneyApiKeyHelper("Zwischenablage war leer oder enthielt keinen verarbeitbaren Key.");
        return;
      }
      setJourneyApiKeyHelper(`Key aus Zwischenablage erkannt (${normalized.length} Zeichen).`);
    } catch {
      setJourneyApiKeyError("Konnte nicht auf die Zwischenablage zugreifen.");
      setJourneyApiKeySuccess("");
      setJourneyApiKeyHelper("");
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

  const handleMetricsScopeChange = async (nextScope) => {
    const normalizedScope = nextScope === "all" ? "all" : "investments";
    setSelectedMetricsScope(normalizedScope);

    if (isDesktopRuntime && portfolioPreferences.metricsDisplayMode === "toggle_mode") {
      try {
        const updated = await updatePortfolioPreferences({
          metricsScopeDefault: normalizedScope,
        });
        setPortfolioPreferences(updated);
      } catch (preferenceError) {
        console.warn("Failed to persist metrics scope preference", preferenceError);
      }
    }
  };

  const handleMoveItemBucket = async (item, bucket) => {
    const normalizedBucket = bucket === "inventory" ? "inventory" : "investment";
    const sourceIds = Array.isArray(item?.sourceInvestmentIds) && item.sourceInvestmentIds.length > 0
      ? item.sourceInvestmentIds
      : [];
    await updateInvestmentBucket(item.id, normalizedBucket, sourceIds);
    await refreshPortfolio();
    setCompositionRefreshToken((current) => current + 1);
  };
  const useDesktopSidebarShell = isDesktopRuntime && !showSetupJourney;

  return (
    <div
      className={`${isElectronRuntime ? "h-full box-border" : "min-h-screen"} font-sans text-foreground pb-20 md:pb-0 touch-pan-y ${
        showSetupJourney ? "steam-startup-shell" : "bg-background"
      }`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        className={
          showSetupJourney
            ? "mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 pb-12 pt-8 sm:p-8"
            : useDesktopSidebarShell
              ? "flex w-full flex-col gap-6 p-4 sm:gap-8 sm:p-6 md:p-8 lg:p-0"
              : "mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:gap-8 sm:p-6 md:p-8"
        }
      >
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
                {renderNotificationsDropdownContent()}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Header - nur auf Desktop sichtbar */}
        <header className={`hidden sm:flex flex-col items-start justify-between gap-4 md:flex-row md:items-center ${
          useDesktopSidebarShell ? "lg:hidden" : ""
        }`}>
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
                {renderNotificationsDropdownContent()}
              </DropdownMenuContent>
            </DropdownMenu>
            <UserMenu />
          </div>
        </header>

        <ApiWarnings warnings={warnings} />

        {showJourneyBannerLegacy ? (
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

        {showSetupJourney ? (
          <Card className="relative overflow-hidden border-white/15 bg-slate-950/58 text-slate-100 shadow-2xl backdrop-blur-xl">
            <CardHeader className="space-y-2 pb-3">
              <CardTitle className="text-2xl tracking-tight text-slate-50">
                Setup Journey{journeyUserName ? ` fuer ${journeyUserName}` : ""}
              </CardTitle>
              <p className="text-sm text-slate-300">
                Wir teilen alles in klare Schritte auf. Du kannst spaeter in den Einstellungen jeden Punkt wieder aendern.
              </p>
            </CardHeader>
            <CardContent className="space-y-6 text-sm">
              <div className="space-y-3 rounded-xl border border-white/15 bg-white/5 p-4">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Fortschritt</span>
                  <span>{journeyProgressPercent}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/15">
                  <div
                    className={`h-full rounded-full bg-cyan-300 transition-[width] duration-500 ${journeyProgressPercent < 100 ? "steam-progress-pulse" : ""}`}
                    style={{ width: `${journeyProgressPercent}%` }}
                  />
                </div>
                <div className="grid gap-2 pt-1 sm:grid-cols-2">
                  {journeySteps.map((step) => (
                    <label
                      key={step.id}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                        step.done
                          ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-200"
                          : "border-white/15 bg-slate-900/40 text-slate-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={step.done}
                        readOnly
                        disabled
                        className="h-4 w-4 cursor-default accent-emerald-400"
                      />
                      <span>{step.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {!journeyStarted ? (
                <div className="space-y-4 rounded-xl border border-white/15 bg-white/5 p-4">
                  <p className="text-slate-200">
                    Reihenfolge: Login, Server, Steam-Importziel, CSFloat-Key, CSFloat-Import, Matching, Verwaltung.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => void handleStartJourney()}>Journey starten</Button>
                    <Button
                      variant="ghost"
                      className="text-slate-200 hover:bg-white/10 hover:text-slate-50"
                      onClick={() => void handleSkipJourney()}
                    >
                      Ueberspringen
                    </Button>
                  </div>
                </div>
              ) : null}

              {journeyStarted ? (
                <div key={activeJourneyStepId} className="journey-step-panel space-y-4">
                  {activeJourneyStepId === "server" ? (
                    <div className="space-y-4 rounded-xl border border-amber-300/35 bg-amber-500/10 p-4">
                      <div>
                        <p className="font-semibold text-amber-100">1. Server-Verbindung</p>
                        <p className="mt-1 text-xs text-amber-200/90">
                          Diese URL wird fuer Sync und serverseitige Preisdaten benoetigt.
                        </p>
                      </div>
                      {serverSetupError ? <p className="text-xs text-red-200">{serverSetupError}</p> : null}
                      {serverSetupMessage ? <p className="text-xs text-emerald-200">{serverSetupMessage}</p> : null}
                        <input
                          type="text"
                          value={serverSetup.serverUrl}
                        onChange={(event) => {
                          setServerSetup((current) => ({ ...current, serverUrl: event.target.value }));
                          setServerSetupError("");
                          setServerSetupMessage("");
                          }}
                          onBlur={() => {
                            const normalized = normalizeServerHostInput(serverSetup.serverUrl);
                            if (normalized && normalized !== serverSetup.serverUrl) {
                              setServerSetup((current) => ({ ...current, serverUrl: normalized }));
                            }
                          }}
                          placeholder="cs2.clustercontrol.cc"
                          className="h-10 w-full rounded-md border border-white/20 bg-slate-900/65 px-3 text-sm text-slate-100 placeholder:text-slate-400"
                        />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-white/30 bg-slate-900/35 text-slate-100 hover:bg-white/10"
                          disabled={serverSetupTesting || !serverSetup.serverUrl.trim()}
                          onClick={async () => {
                            try {
                              const normalizedHost = normalizeServerHostInput(serverSetup.serverUrl);
                              if (!normalizedHost) {
                                setServerSetupError("Bitte gueltigen Hostnamen eingeben (z.B. cs2.clustercontrol.cc).");
                                return;
                              }
                              setServerSetupTesting(true);
                              setServerSetupError("");
                              setServerSetupMessage("");
                              const result = await window.electronAPI.serverConfig.test(normalizedHost);
                              if (result?.ok) {
                                setServerSetup((current) => ({ ...current, serverUrl: normalizedHost }));
                                setServerSetupMessage(result?.message || "Verbindung erfolgreich.");
                              } else {
                                setServerSetupError(result?.message || "Verbindung fehlgeschlagen.");
                              }
                            } catch (error) {
                              setServerSetupError(error?.message || "Verbindungstest fehlgeschlagen.");
                            } finally {
                              setServerSetupTesting(false);
                            }
                          }}
                        >
                          {serverSetupTesting ? "Teste..." : "Verbindung testen"}
                        </Button>
                        <Button
                          size="sm"
                          disabled={serverSetupSaving || !serverSetup.serverUrl.trim()}
                          onClick={async () => {
                            try {
                              const normalizedHost = normalizeServerHostInput(serverSetup.serverUrl);
                              if (!normalizedHost) {
                                setServerSetupError("Bitte gueltigen Hostnamen eingeben (z.B. cs2.clustercontrol.cc).");
                                return;
                              }
                              setServerSetupSaving(true);
                              setServerSetupError("");
                              setServerSetupMessage("");
                              await window.electronAPI.serverConfig.set({
                                serverUrl: normalizedHost,
                              });
                              setServerSetup((current) => ({ ...current, configured: true, serverUrl: normalizedHost }));
                              setServerSetupMessage("Server-URL gespeichert.");
                              await handleGoNextJourneyStep();
                            } catch (error) {
                              setServerSetupError(error?.message || "Server-URL konnte nicht gespeichert werden.");
                            } finally {
                              setServerSetupSaving(false);
                            }
                          }}
                        >
                          {serverSetupSaving ? "Speichert..." : "Speichern"}
                        </Button>
                        {serverSetup.configured ? (
                          <Button size="sm" onClick={() => void handleGoNextJourneyStep()}>
                            Weiter
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {activeJourneyStepId === "import_defaults" ? (
                    <div className="space-y-4 rounded-xl border border-white/15 bg-white/5 p-4">
                      <div>
                        <p className="font-semibold text-slate-100">2. Ziel fuer Steam-Items waehlen</p>
                        <p className="mt-1 text-xs text-slate-300">
                          Kleiner Hinweis: Das kannst du spaeter jederzeit in den Einstellungen aendern.
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs text-slate-300">Steam-Import</label>
                          <select
                            className="h-10 w-full rounded-md border border-white/20 bg-slate-900/65 px-3 text-sm text-slate-100"
                            value={portfolioPreferences.steamImportBucket}
                            onChange={async (event) => {
                              const updated = await updatePortfolioPreferences({
                                steamImportBucket: event.target.value,
                              });
                              setPortfolioPreferences(updated);
                            }}
                          >
                            <option value="inventory">In Inventar einsortieren</option>
                            <option value="investment">In Investments einsortieren</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-slate-300">CSFloat-Import</label>
                          <select
                            className="h-10 w-full rounded-md border border-white/20 bg-slate-900/65 px-3 text-sm text-slate-100"
                            value={portfolioPreferences.csfloatImportBucket}
                            onChange={async (event) => {
                              const updated = await updatePortfolioPreferences({
                                csfloatImportBucket: event.target.value,
                              });
                              setPortfolioPreferences(updated);
                            }}
                          >
                            <option value="investment">In Investments einsortieren</option>
                            <option value="inventory">In Inventar einsortieren</option>
                          </select>
                        </div>
                      </div>
                      <label className="flex items-start gap-3 rounded-md border border-white/15 bg-slate-900/40 p-3 text-xs text-slate-200">
                        <input
                          type="checkbox"
                          checked={Boolean(journeyState?.importBucketConfirmedAt)}
                          onChange={(event) => {
                            if (event.target.checked) {
                              void handleConfirmImportDefaultsStep();
                            }
                          }}
                          className="mt-0.5 h-4 w-4 accent-cyan-400"
                        />
                        <span>Importziel verstanden und bestaetigt.</span>
                      </label>
                    </div>
                  ) : null}
                  {activeJourneyStepId === "csfloat_key" ? (
                    <div className="space-y-4 rounded-xl border border-cyan-300/30 bg-cyan-500/10 p-4">
                      <div>
                        <p className="font-semibold text-cyan-100">3. CSFloat API Key hinterlegen</p>
                        <p className="mt-1 text-xs text-cyan-100/90">
                          Der Key wird nur lokal und verschluesselt gespeichert. Nie im Web-Build und nie auf dem Server.
                        </p>
                      </div>
                      <ol className="list-decimal space-y-1 pl-4 text-xs text-cyan-100/90">
                        <li>
                          <a
                            href="https://csfloat.com/"
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-cyan-300/50 underline-offset-2 hover:text-cyan-200"
                          >
                            csfloat.com
                          </a>{" "}
                          oeffnen
                        </li>
                        <li>
                          Profil aufrufen:{" "}
                          <a
                            href="https://csfloat.com/profile"
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-cyan-300/50 underline-offset-2 hover:text-cyan-200"
                          >
                            csfloat.com/profile
                          </a>
                        </li>
                        <li>Zum Reiter Developer gehen</li>
                        <li>Neuen Schluessel erstellen und kopieren</li>
                      </ol>
                      <div className="rounded-md border border-amber-300/35 bg-amber-500/10 p-3 text-xs text-amber-100">
                        Gib den Schluessel nicht weiter. Falls du einen Leak vermutest: alten Schluessel loeschen und neu
                        erstellen. Du kannst den Key spaeter jederzeit in der Verwaltung aendern.
                      </div>
                      {journeyApiKeyError ? (
                        <div className="rounded-md border border-red-300/35 bg-red-500/10 p-2 text-xs text-red-200">
                          {journeyApiKeyError}
                        </div>
                      ) : null}
                      {journeyApiKeySuccess ? (
                        <div className="rounded-md border border-emerald-300/35 bg-emerald-500/10 p-2 text-xs text-emerald-200">
                          {journeyApiKeySuccess}
                        </div>
                      ) : null}
                      {journeyApiKeyHelper ? (
                        <div className="rounded-md border border-cyan-300/35 bg-cyan-500/10 p-2 text-xs text-cyan-100">
                          {journeyApiKeyHelper}
                        </div>
                      ) : null}
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-cyan-100">CSFloat API Key</label>
                        <input
                          type="password"
                          value={journeyApiKey}
                          onChange={(event) => {
                            setJourneyApiKey(event.target.value);
                            setJourneyApiKeyError("");
                            setJourneyApiKeySuccess("");
                            setJourneyApiKeyHelper("");
                          }}
                          onBlur={() => {
                            const normalized = normalizeCsFloatApiKeyInput(journeyApiKey);
                            if (normalized !== journeyApiKey) {
                              setJourneyApiKey(normalized);
                            }
                          }}
                          placeholder="CSFloat API Key..."
                          className="h-10 w-full rounded-md border border-white/20 bg-slate-900/65 px-3 text-sm text-slate-100 placeholder:text-slate-400"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            disabled={journeyApiKeySaving || !normalizeCsFloatApiKeyInput(journeyApiKey)}
                            className="bg-slate-100 text-slate-900 hover:bg-white disabled:bg-slate-500 disabled:text-slate-800"
                            onClick={() => void handleSaveJourneyCsFloatKey()}
                          >
                            {journeyApiKeySaving ? "Speichert..." : "Key speichern"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-white/30 bg-slate-900/35 text-slate-100 hover:bg-white/10"
                            onClick={() => void handlePasteJourneyCsFloatKey()}
                          >
                            Aus Zwischenablage einfuegen
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-white/30 bg-slate-900/35 text-slate-100 hover:bg-white/10"
                            onClick={() => void handleRefreshCsFloatStatus()}
                          >
                            Status aktualisieren
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {activeJourneyStepId === "csfloat_import" ? (
                    <div className="space-y-4 rounded-xl border border-white/15 bg-white/5 p-4">
                      <div>
                        <p className="font-semibold text-slate-100">4. CSFloat-Import jetzt starten?</p>
                        <p className="mt-1 text-xs text-slate-300">
                          Beim Import siehst du direkt die Ladeanzeige im CSFloat-Sync-Dialog.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          onClick={() => {
                            setIsCsFloatSyncOpen(true);
                          }}
                        >
                          CSFloat-Import starten
                        </Button>
                        <Button
                          variant="outline"
                          className="border-white/30 bg-slate-900/35 text-slate-100 hover:bg-white/10"
                          onClick={() => void handleMarkCsFloatImportSkipped()}
                        >
                          Spaeter / Skip
                        </Button>
                      </div>
                      <p className="text-[11px] text-slate-300">
                        Wenn du jetzt importierst, leiten wir dich danach direkt zum Matching-Schritt.
                      </p>
                    </div>
                  ) : null}
                  {activeJourneyStepId === "matching" ? (
                    <div className="space-y-4 rounded-xl border border-white/15 bg-white/5 p-4">
                      <div>
                        <p className="font-semibold text-slate-100">5. Steam und CSFloat Matching pruefen</p>
                        <p className="mt-1 text-xs text-slate-300">
                          Offene Matching-Vorschlaege: <span className="font-semibold">{matchingSuggestedCount}</span>
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          className="border-white/30 bg-slate-900/35 text-slate-100 hover:bg-white/10"
                          onClick={() => {
                            setActiveTab("management");
                            setManagementSection("matching");
                          }}
                        >
                          Matching in Verwaltung oeffnen
                        </Button>
                        <Button size="sm" onClick={() => void handleMarkMatchingReviewed()}>
                          Matching geprueft
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {activeJourneyStepId === "management" ? (
                    <div className="space-y-4 rounded-xl border border-white/15 bg-white/5 p-4">
                      <div>
                        <p className="font-semibold text-slate-100">6. Verwaltung kurz erklaert</p>
                        <p className="mt-1 text-xs text-slate-300">
                          Hier steuerst du Matching, Preise und Exclude-Logik fuer deine Items.
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-lg border border-white/15 bg-slate-900/50 p-3">
                          <p className="text-xs font-semibold uppercase text-slate-200">Matching</p>
                          <p className="mt-1 text-xs text-slate-300">Vorschlaege bestaetigen oder korrigieren.</p>
                        </div>
                        <div className="rounded-lg border border-white/15 bg-slate-900/50 p-3">
                          <p className="text-xs font-semibold uppercase text-slate-200">Preise</p>
                          <p className="mt-1 text-xs text-slate-300">Fehlende Einkaufswerte schnell nachpflegen.</p>
                        </div>
                        <div className="rounded-lg border border-white/15 bg-slate-900/50 p-3">
                          <p className="text-xs font-semibold uppercase text-slate-200">Exclude</p>
                          <p className="mt-1 text-xs text-slate-300">Positionen aus Kennzahlen ausblenden.</p>
                        </div>
                      </div>
                      <label className="flex items-start gap-3 rounded-md border border-white/15 bg-slate-900/40 p-3 text-xs text-slate-200">
                        <input
                          type="checkbox"
                          checked={Boolean(journeyState?.managementHintsSeenAt)}
                          onChange={(event) => {
                            if (event.target.checked) {
                              void handleManagementHintsSeen();
                            }
                          }}
                          className="mt-0.5 h-4 w-4 accent-cyan-400"
                        />
                        <span>Hinweise verstanden.</span>
                      </label>
                      <Button
                        onClick={() => void handleCompleteJourney()}
                        disabled={!journeyState?.managementHintsSeenAt}
                      >
                        Setup abschliessen
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {journeyStarted ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-slate-200 hover:bg-white/10 hover:text-slate-50"
                      onClick={() => void handleGoBackJourneyStep()}
                      disabled={activeJourneyStepId === JOURNEY_STEP_ORDER[0]}
                    >
                      Zurueck
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-slate-200 hover:bg-white/10 hover:text-slate-50"
                      onClick={() => navigate("/settings", { replace: true })}
                    >
                      Einstellungen
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-slate-200 hover:bg-white/10 hover:text-slate-50"
                      onClick={() => void handleSkipJourney()}
                    >
                      Journey beenden
                    </Button>
                    {activeJourneyStepId !== "management" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-white/30 bg-slate-900/35 text-slate-100 hover:bg-white/10"
                        onClick={() => void handleGoNextJourneyStep()}
                      >
                        Schritt ueberspringen
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {!showSetupJourney ? (
        <div className={useDesktopSidebarShell ? "w-full lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[88px_minmax(0,1fr)]" : "w-full"}>
          {useDesktopSidebarShell ? (
            <aside className="hidden lg:block lg:h-full lg:min-h-0">
              <div className="sticky top-0 h-full min-h-0 w-[88px] overflow-hidden border-r border-border/70 bg-card/90 backdrop-blur">
                <div className="flex h-full flex-col items-center py-4">
                  <nav className="flex w-full flex-col items-center gap-2 px-2">
                    {DESKTOP_SIDEBAR_TABS
                      .filter((tab) => runtimeTabs.includes(tab.key) && (!tab.desktopOnly || isDesktopRuntime))
                      .map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.key;
                        return (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => handleTabSelect(tab.key)}
                            className={`group flex h-12 w-12 items-center justify-center rounded-xl border transition-colors ${
                              isActive
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground"
                            }`}
                            title={tab.label}
                            aria-label={tab.label}
                          >
                            <Icon className="h-5 w-5" />
                          </button>
                        );
                      })}
                  </nav>

                  <div className="mt-auto flex w-full flex-col items-center gap-2 px-2 pb-2">
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
                      <DropdownMenuContent side="right" align="end" className="w-80">
                        {renderNotificationsDropdownContent()}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <UserMenu />
                  </div>
                </div>
              </div>
            </aside>
          ) : null}

          <Tabs
            value={activeTab}
            onValueChange={handleTabSelect}
            className={`w-full min-w-0 ${useDesktopSidebarShell ? "lg:min-h-0 lg:px-6 xl:px-8" : ""}`}
          >
            {error && (
              <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            {/* Tab Navigation - auf Desktop Runtime durch Sidebar ersetzt */}
            <div className={isDesktopRuntime ? "hidden sm:block lg:hidden" : "hidden sm:block"}>
              <TabsList className={`grid w-full gap-1 sm:max-w-200 ${isDesktopRuntime ? "grid-cols-4" : "grid-cols-3"}`}>
                <TabsTrigger value="overview" className="text-xs sm:text-sm">Uebersicht</TabsTrigger>
                <TabsTrigger value="inventory" className="text-xs sm:text-sm">Inventar</TabsTrigger>
                <TabsTrigger value="watchlist" className="text-xs sm:text-sm">Watchlist</TabsTrigger>
                {isDesktopRuntime ? <TabsTrigger value="management" className="text-xs sm:text-sm">Verwaltung</TabsTrigger> : null}
              </TabsList>
            </div>

          <TabsContent value="overview" className="space-y-4 sm:space-y-5 lg:space-y-4">
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
                value={headerPortfolioValueLabel}
                isPositive={headerPortfolioPositive}
              />
              <StatCard
                title="Gesamt Zuwachs"
                value={`${headerProfitEuro >= 0 ? "+" : "-"}${formatPrice(Math.abs(headerProfitEuro))}`}
                subValue={`${headerProfitPercent >= 0 ? "+" : ""}${headerProfitPercent.toFixed(2)}%${
                  hoveredChartData?.date ? ` | ${formatDateSafe(hoveredChartData.date)}` : ""
                }`}
                isPositive={headerPortfolioPositive}
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

            <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2">
              <PortfolioChart
                history={portfolioHistory}
                isLoading={portfolioLoading}
                onHoverChange={setHoveredChartData}
                metricsScope={metricsScope}
                onMetricsScopeChange={
                  portfolioPreferences.metricsDisplayMode === "toggle_mode"
                    ? (nextScope) => void handleMetricsScopeChange(nextScope)
                    : null
                }
              />
              <div className="hidden md:block">
                <WatchlistOverview
                  maxItems={useDesktopSidebarShell ? 4 : 5}
                  allowExpand={!useDesktopSidebarShell}
                  onOpenItem={handleOpenWatchlistItem}
                />
              </div>
            </div>

            {/* Mobile: Watchlist full-width */}
            <div className="sm:hidden">
              <WatchlistOverview maxItems={5} onOpenItem={handleOpenWatchlistItem} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:gap-5">
              <div>
                <h3 className="mb-4 text-lg font-semibold">Portfolio Zusammensetzung</h3>
                {compositionLoading ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                      <div className="flex justify-center lg:col-span-2">
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
            {/*
            
                  Manueller CSFloat-Sync: zuerst Preview prüfen, dann Import starten.


            */}
            <div className="md:col-span-2 space-y-2">
              <h3 className="text-base font-semibold">Ansicht</h3>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={inventoryScope === "investment" ? "default" : "outline"}
                  onClick={() => setInventoryScope("investment")}
                >
                  Investments
                </Button>
                <Button
                  size="sm"
                  variant={inventoryScope === "inventory" ? "default" : "outline"}
                  onClick={() => setInventoryScope("inventory")}
                >
                  Inventar
                </Button>
                <Button
                  size="sm"
                  variant={inventoryScope === "all" ? "default" : "outline"}
                  onClick={() => setInventoryScope("all")}
                >
                  Alles
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto md:col-span-1 sm:rounded-lg sm:border sm:bg-card">
              <InventoryTable
                investments={inventoryTabItems}
                onSelectItem={(item) => {
                  setSelectedItem(item);
                  if (window.innerWidth < BREAKPOINTS.MOBILE) {
                    openModal("itemDetail", { item });
                  }
                }}
              />
            </div>

            <div className="hidden md:col-span-1 md:sticky md:top-20 md:block md:self-start md:max-h-[calc(100vh-6rem)] md:overflow-y-auto">
              <ItemDetailPanel
                item={selectedItemWithLive || selectedItem}
                history={selectedItemHistory}
                historyLoading={selectedItemHistoryLoading}
                onExcludeChange={isDesktopRuntime ? handleExcludeChange : undefined}
                onBucketChange={isDesktopRuntime ? handleMoveItemBucket : undefined}
                canToggleExclude={isDesktopRuntime}
              />
            </div>

            {modals.map((modal) =>
              modal.type === "itemDetail" ? (() => {
                const liveModalItem =
                  resolveLiveClusterItem(modal?.data?.item, enrichedInvestments) || modal?.data?.item || null;
                return (
                  <ItemDetailsModal
                    key={modal.id}
                    isOpen={true}
                    onClose={() => closeModal(modal.id)}
                    item={liveModalItem}
                    history={selectedItemHistory}
                    historyLoading={selectedItemHistoryLoading}
                    onToggleExclude={isDesktopRuntime ? handleModalExcludeToggle : undefined}
                    onBucketChange={isDesktopRuntime ? handleMoveItemBucket : undefined}
                    canToggleExclude={isDesktopRuntime}
                  />
                );
              })() : null,
            )}
          </TabsContent>

          <TabsContent value="watchlist" className="space-y-4 sm:space-y-6">
            <Watchlist focusTarget={watchlistFocusTarget} />
          </TabsContent>

          {isDesktopRuntime ? (
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
                    <Button size="sm" variant="outline" onClick={() => setIsCsFloatSyncOpen(true)}>
                      CSFloat Sync
                    </Button>
                  </div>
                  <TooltipProvider delayDuration={140}>
                    <div className="flex flex-wrap items-center gap-2">
                      {managementQuickHints.map((hint) => (
                        <Tooltip key={hint.id}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              <Info className="h-3.5 w-3.5" />
                              <span>{hint.title}</span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[260px] text-xs leading-relaxed">
                            {hint.text}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </TooltipProvider>
                  {steamSyncError ? (
                    <p className="text-xs text-destructive">{steamSyncError}</p>
                  ) : null}
                  <p className="text-[11px] text-muted-foreground">
                    Datenabruf erfolgt nur lokal fuer deinen Account. Auto-Sync laeuft maximal alle 30 Minuten
                    pro App-Instanz und kann jederzeit deaktiviert werden.
                  </p>
                </div>
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
                  <Button
                    variant={managementSection === "create" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setManagementSection("create")}
                  >
                    Hinzufuegen
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
                              const nameKey = getItemNameKey(item);
                              const suggestion = suggestedPriceByNameKey.get(nameKey) || null;
                              const suggestedPrice = Number(suggestion?.value ?? 0);
                              const hasSuggestion = Number.isFinite(suggestedPrice) && suggestedPrice > 0;
                              const draftValue = priceDrafts[item.id] ?? String(currentPrice > 0 ? currentPrice : "");
                              return (
                                <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-semibold">{item.name}</p>
                                    <p className="text-[11px] text-muted-foreground">
                                      Aktuell: {currentPrice > 0 ? `${currentPrice.toFixed(2)} USD` : "kein Preis gesetzt"}
                                    </p>
                                    {hasSuggestion ? (
                                      <p className="text-[11px] text-muted-foreground">
                                        Vorschlag: {suggestedPrice.toFixed(2)} USD ({String(suggestion?.source || "live")})
                                      </p>
                                    ) : null}
                                  </div>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={draftValue}
                                    onChange={(event) => handlePriceDraftChange(item.id, event.target.value)}
                                    className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
                                    placeholder={hasSuggestion ? `${suggestedPrice.toFixed(2)} USD` : "USD"}
                                  />
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={savingPriceItemId === item.id}
                                    onClick={() => void handleSaveSteamItemPrice(item)}
                                  >
                                    {savingPriceItemId === item.id ? "Speichert..." : "Speichern"}
                                  </Button>
                                  {hasSuggestion ? (
                                    <Button
                                      size="sm"
                                      variant="default"
                                      disabled={savingPriceItemId === item.id}
                                      onClick={() => void handleAcceptSuggestedPrice(item, suggestedPrice)}
                                    >
                                      Vorschlag annehmen
                                    </Button>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ) : null}

                {managementSection === "create" ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Item manuell hinzufuegen</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Fuege Positionen direkt in der Verwaltung hinzu (Preis, Quelle, Menge, Bucket).
                      </p>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <input
                          type="text"
                          value={manualItemDraft.name}
                          onChange={(event) => handleManualItemDraftChange("name", event.target.value)}
                          placeholder="Item Name (z. B. Karambit | Doppler)"
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={manualItemDraft.buyPriceUsd}
                          onChange={(event) => handleManualItemDraftChange("buyPriceUsd", event.target.value)}
                          placeholder="Einkaufspreis USD"
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        />
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={manualItemDraft.quantity}
                          onChange={(event) => handleManualItemDraftChange("quantity", event.target.value)}
                          placeholder="Menge"
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        />
                        <select
                          value={manualItemDraft.platform}
                          onChange={(event) => handleManualItemDraftChange("platform", event.target.value)}
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        >
                          <option value="manual">Quelle: Manual</option>
                          <option value="csfloat">Quelle: CSFloat</option>
                          <option value="steam_inventory">Quelle: Steam Inventory</option>
                          <option value="other">Quelle: Other</option>
                        </select>
                        <select
                          value={manualItemDraft.bucket}
                          onChange={(event) => handleManualItemDraftChange("bucket", event.target.value)}
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        >
                          <option value="investment">Bucket: Investment</option>
                          <option value="inventory">Bucket: Inventory</option>
                        </select>
                        <select
                          value={manualItemDraft.fundingMode}
                          onChange={(event) => handleManualItemDraftChange("fundingMode", event.target.value)}
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        >
                          <option value="wallet_funded">Funding: Wallet</option>
                          <option value="balance_funded">Funding: Balance</option>
                        </select>
                        <select
                          value={manualItemDraft.type}
                          onChange={(event) => handleManualItemDraftChange("type", event.target.value)}
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm md:col-span-2"
                        >
                          <option value="skin">Typ: Skin</option>
                          <option value="case">Typ: Case</option>
                          <option value="sticker">Typ: Sticker</option>
                          <option value="agent">Typ: Agent</option>
                          <option value="other">Typ: Other</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          disabled={manualItemSaving}
                          onClick={() => void handleCreateManualInvestment()}
                        >
                          {manualItemSaving ? "Speichert..." : "Item anlegen"}
                        </Button>
                      </div>
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
                      const steamIdsInCluster = new Set(
                        cluster.positions
                          .filter((position) =>
                            position.platform === "steam_inventory" ||
                            Boolean(position.steamAssetId),
                          )
                          .map((position) => String(position.id)),
                      );
                      const visiblePositions = cluster.positions.filter((position) => {
                        const positionId = String(position.id);
                        const matchedSteamId = confirmedOrAutoMatchByCsfloatId.get(positionId);
                        if (!matchedSteamId) {
                          return true;
                        }
                        return !steamIdsInCluster.has(String(matchedSteamId));
                      });
                      const visibleExcludedCount = visiblePositions.filter((position) => position.excluded).length;
                      const visibleActiveCount = Math.max(0, visiblePositions.length - visibleExcludedCount);
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
                                    {visiblePositions.length} Stueck | excluded: {visibleExcludedCount} | aktiv: {visibleActiveCount}
                                    {visiblePositions.length !== cluster.positions.length
                                      ? ` | ${cluster.positions.length - visiblePositions.length} gematchte Duplikate ausgeblendet`
                                      : ""}
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
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleManagementClusterBucketToggle(cluster, "investment")}
                                >
                                  Cluster zu Investments
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleManagementClusterBucketToggle(cluster, "inventory")}
                                >
                                  Cluster zu Inventar
                                </Button>
                              </div>
                            </div>

                            {isExpanded ? (
                              <div className="space-y-2 rounded-md border p-2 sm:p-3">
                                {visiblePositions.map((position) => (
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
                                      <Badge variant="secondary">
                                        {position.bucket === "inventory" ? "Inventar" : "Investment"}
                                      </Badge>
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
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                          void handleManagementBucketToggle(
                                            position.id,
                                            position.bucket === "inventory" ? "investment" : "inventory",
                                          )
                                        }
                                      >
                                        {position.bucket === "inventory" ? "Zu Investments" : "Zu Inventar"}
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
                    ) : pendingMatchingRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Keine offenen Matching-Vorschlaege vorhanden.
                      </p>
                    ) : (
                      pendingMatchingRows.slice(0, 40).map((row) => {
                        const matchScore = Number(row.matchScore);
                        const matchScoreLabel = Number.isFinite(matchScore) ? matchScore.toFixed(0) : "-";

                        return (
                          <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold">
                                Steam: {row.steamItemName}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                Score: {matchScoreLabel} | Confidence: {row.confidence} | Status: {row.status}
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
                        );
                      })
                    )}
                  </CardContent>
                </Card>
                ) : null}
              </>
            )}
          </TabsContent>
          ) : null}
        </Tabs>
        </div>
        ) : null}

        <CsFloatTradeSyncModal
          isOpen={isCsFloatSyncOpen}
          onClose={() => setIsCsFloatSyncOpen(false)}
          onSynced={async () => {
            await refreshPortfolio();
            setCompositionRefreshToken((current) => current + 1);
            const nextState = {
              ...journeyState,
              skipped: false,
              csfloatImportCompletedAt: new Date().toISOString(),
              csfloatImportSkippedAt: null,
              currentStepId: "matching",
            };
            setJourneyState(nextState);
            await writeJourneyState(nextState);
            setActiveTab("management");
            setManagementSection("matching");
            setIsCsFloatSyncOpen(false);
          }}
        />
      </div>
    </div>
  );
}
