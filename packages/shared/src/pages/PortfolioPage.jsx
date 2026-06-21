import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Bell, Cog, Eye, FolderCog, Info, LayoutGrid, Newspaper, Package, Search, TrendingDown, TrendingUp } from "lucide-react";

import { useModal } from "@shared/contexts";
import { PortfolioChart } from "@shared/components";
import { PortfolioCompositionChart } from "@shared/components";
import { PortfolioHeaderCard } from "@shared/components";
import { StatCard } from "@shared/components";
import { SteamLoginPrompt } from "@shared/components";
import { ThemeToggle } from "@shared/components";
import { UserMenu } from "@shared/components";
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
import { usePortfolio, usePortfolioComposition } from "@shared/hooks";
import {
  fetchItemPriceHistory,
  fetchPortfolioGroupsSetting,
  fetchPortfolioInvestmentHistory,
  searchWatchlistItems,
  updatePortfolioGroupsSetting,
  updateInvestmentBucket,
} from "../lib/apiClient";
import { useCsUpdatesFeed } from "@shared/hooks";
import {
  fetchCS2Inventory,
  fetchCsFloatBuyOrdersData,
  fetchWatchlistData,
  getPortfolioPreferences,
  getCurrentUser,
  importInventoryAsInvestments,
  resolveDesktopLocalUserId as resolveDesktopRuntimeUserId,
  resolveMetricsScopeFromPreferences,
  createWatchlistItemData,
  fetchCsFloatApiKeyStatus,
  fetchSkinBaronApiKeyStatus,
  updateCsFloatApiKey,
  toggleExcludeInvestment,
  updatePortfolioPreferences,
} from "@shared/lib";
import { BREAKPOINTS } from "@shared/lib";
import { useKeyboard } from "@shared/hooks";
import { useCurrency } from "@shared/contexts/CurrencyContext";
import { runDesktopSyncNowIfDue } from "@shared/lib/desktopSync.js";
import { deriveSteamPaletteFromUser } from "@shared/components/SteamLoginPrompt.jsx";
import { normalizeServerHostInput } from "@shared/lib/serverConfig";
import {
  PORTFOLIO_GROUPS_STORAGE_KEY,
  buildPortfolioGroupSummaries,
  buildPortfolioGroupMembershipMap,
  summarizeManagementClusterAssignment,
  createPortfolioGroupDraft,
  normalizePortfolioGroups,
} from "@shared/lib/portfolioGroups.js";
import {
  formatDateSafe,
  resolveWatchlistChangePercent,
  normalizeSearchText,
  withBuyOrderFields,
  deriveCsUpdateImpact,
  getClusterUpdatedAt,
  normalizeBucket,
  resolveLiveClusterItem,
  buildGroupDetailSelection,
  buildGroupClusterDetailSelection,
  getItemNameKey,
} from "../lib/portfolioHelpers.js";
import {
  PortfolioOverviewSection,
  PortfolioInventorySection,
  PortfolioWatchlistSection,
  PortfolioSearchSection,
  PortfolioManagementSection,
} from "@shared/components";

const InventoryTable = lazy(() =>
  import("../components/InventoryTable.jsx").then((module) => ({
    default: module.InventoryTable,
  })),
);
const ItemDetailsModal = lazy(() =>
  import("../components/ItemDetailsModal.jsx").then((module) => ({
    default: module.ItemDetailsModal,
  })),
);
const ItemDetailPanel = lazy(() =>
  import("../components/ItemDetailPanel.jsx").then((module) => ({
    default: module.ItemDetailPanel,
  })),
);
const CsFloatTradeSyncModal = lazy(() =>
  import("../components/CsFloatTradeSyncModal.jsx").then((module) => ({
    default: module.CsFloatTradeSyncModal,
  })),
);
const SkinBaronSalesSyncModal = lazy(() =>
  import("../components/SkinBaronSalesSyncModal.jsx").then((module) => ({
    default: module.SkinBaronSalesSyncModal,
  })),
);
const Watchlist = lazy(() =>
  import("../components/Watchlist.jsx").then((module) => ({
    default: module.Watchlist,
  })),
);
const ItemSearch = lazy(() =>
  import("../components/ItemSearch.jsx").then((module) => ({
    default: module.ItemSearch,
  })),
);


function getCsUpdateBannerTone(level) {
  if (level === "high") {
    return {
      wrapper:
        "steam-avatar-gradient-banner border-red-500/35 shadow-[0_16px_38px_rgba(127,29,29,0.35)]",
      eyebrow: "text-red-300",
      panel: "border-red-500/35 bg-red-950/35",
    };
  }

  if (level === "medium") {
    return {
      wrapper:
        "steam-avatar-gradient-banner border-amber-500/35 shadow-[0_14px_30px_rgba(146,64,14,0.22)]",
      eyebrow: "text-amber-300",
      panel: "border-amber-500/35 bg-amber-950/30",
    };
  }

  if (level === "pending") {
    return {
      wrapper:
        "steam-avatar-gradient-banner border-cyan-400/30 shadow-[0_12px_26px_rgba(8,47,73,0.25)]",
      eyebrow: "text-cyan-300",
      panel: "border-cyan-400/30 bg-cyan-950/30",
    };
  }

  return {
    wrapper:
      "steam-avatar-gradient-banner border-cyan-400/25 shadow-[0_12px_30px_rgba(0,0,0,0.2)]",
    eyebrow: "text-cyan-300",
    panel: "border-border/70 bg-card/70",
  };
}

const JOURNEY_STORAGE_KEY = "onboarding:journey:v1";
const STEAM_SYNC_META_KEY = "steam:sync:meta:v1";
const STEAM_SYNC_PREF_KEY = "steam:sync:auto-enabled:v1";
const STEAM_SYNC_COOLDOWN_MS = 1000 * 60 * 30;
const STARTUP_WELCOME_DISMISS_KEY = "startup:welcome:dismissed:v1";
const GLOBAL_SEARCH_RECENTS_KEY = "global-search:recent:v1";
const CS_UPDATES_SEEN_KEY = "cs-updates:last-seen-id:v1";
const BAN_WAVE_NOTIFIED_KEY = "ban-wave:last-notified-id:v1";
const DEFAULT_CS_UPDATES_BANNER_VISIBLE_HOURS = 24 * 7;
const JOURNEY_STEP_ORDER = ["server", "import_defaults", "csfloat_key", "csfloat_import", "push_notifications", "matching", "management"];
const DESKTOP_SIDEBAR_TABS = [
  { key: "overview", label: "Uebersicht", icon: LayoutGrid },
  { key: "inventory", label: "Inventar", icon: Package },
  { key: "watchlist", label: "Watchlist", icon: Eye },
  { key: "management", label: "Verwaltung", icon: FolderCog, desktopOnly: true },
  { key: "updates", label: "Updates", icon: Newspaper, route: "/cs-updates" },
  { key: "settings", label: "Einstellungen", icon: Cog, route: "/settings" },
];
const GLOBAL_SEARCH_CATEGORIES = [
  { key: "all", label: "All" },
  { key: "skins", label: "Skins" },
  { key: "cases", label: "Cases" },
  { key: "stickers", label: "Sticker" },
  { key: "agents", label: "Agents" },
  { key: "capsules", label: "Capsules" },
  { key: "everything_else", label: "Everything else" },
];

function normalizeGlobalSearchInput(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function resolveCatalogCategory(itemType) {
  const normalized = String(itemType || "").trim().toLowerCase();
  if (normalized === "skin") {
    return "skins";
  }
  if (normalized === "case" || normalized === "souvenir_package" || normalized === "container") {
    return "cases";
  }
  if (normalized === "sticker" || normalized === "patch" || normalized === "graffiti" || normalized === "charm") {
    return "stickers";
  }
  if (normalized === "agent") {
    return "agents";
  }
  if (normalized === "sticker_capsule") {
    return "capsules";
  }
  return "everything_else";
}

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

function readLastSeenCsUpdateId() {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return String(localStorage.getItem(CS_UPDATES_SEEN_KEY) || "");
  } catch {
    return "";
  }
}

function writeLastSeenCsUpdateId(value) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(CS_UPDATES_SEEN_KEY, String(value || ""));
  } catch {
    // Ignore storage failures and continue with in-memory state.
  }
}

function normalizeInvestmentId(value) {
  return String(value || "").trim();
}

function uniqueInvestmentIds(values = []) {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const normalized = normalizeInvestmentId(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
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

function normalizeJourneyState(value) {
  const baseState = value && typeof value === "object" ? value : { skipped: false };
  if (typeof baseState.pushNotificationsWanted === "boolean") {
    return baseState;
  }

  return {
    ...baseState,
    pushNotificationsWanted: false,
  };
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
      imageUrl: item.imageUrl || group.imageUrl || null,
      externalTradeId: item.externalTradeId || null,
      purchasedAt: item.purchasedAt || null,
      updatedAt: item.updatedAt || item.purchasedAt || item.createdAt || null,
      platform: String(item.platform || item.source || "").toLowerCase(),
      steamAssetId: item.steamAssetId ? String(item.steamAssetId) : null,
      bucket: normalizeBucket(item.bucket),
      excluded: Boolean(item.excluded ?? item.isExcluded),
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

function formatApiWarningMetaLine(warning) {
  const metaParts = [];
  if (warning?.statusCode) {
    metaParts.push(`HTTP ${warning.statusCode}`);
  }
  if (warning?.occurrences > 1) {
    metaParts.push(`${warning.occurrences} Vorgaenge`);
  }
  if (Array.isArray(warning?.items) && warning.items.length > 0) {
    metaParts.push(`Items: ${warning.items.join(", ")}`);
  }
  return metaParts.join(" | ");
}

function mapWarningsToNotifications(warnings, { sourceKey, sourceLabel }) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return [];
  }

  return warnings.map((warning, index) => {
    const warningMeta = formatApiWarningMetaLine(warning);
    const metaParts = [];
    if (sourceLabel) {
      metaParts.push(`Quelle: ${sourceLabel}`);
    }
    if (warningMeta) {
      metaParts.push(warningMeta);
    }

    return {
      id: `csfloat-warning-${sourceKey}-${warning?.code || "warning"}-${warning?.statusCode || "na"}-${index}`,
      message: warning?.message || "CSFloat Warnung",
      meta: metaParts.join(" | "),
    };
  });
}

export function PortfolioPage({ initialTab = "overview", useExternalDesktopSidebarShell = false }) {
  const isElectronRuntime = typeof window !== "undefined" && Boolean(window.electronAPI);
  const isDesktopRuntime = isElectronRuntime && Boolean(window.electronAPI?.localStore);
  const runtimeTabs = useMemo(
    () => (
      isDesktopRuntime
        ? ["overview", "inventory", "watchlist", "search", "management"]
        : ["overview", "inventory", "watchlist", "search"]
    ),
    [isDesktopRuntime],
  );
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const resolvedInitialTab = searchParams.get("tab") || initialTab;
  const searchPageInitialTerm = useMemo(
    () => String(searchParams.get("q") || "").trim(),
    [searchParams],
  );
  const [showStartupWelcome, setShowStartupWelcome] = useState(
    () => isElectronRuntime && !readStartupWelcomeDismissed(),
  );
  const [portfolioPreferences, setPortfolioPreferences] = useState({
    steamImportBucket: "inventory",
    csfloatImportBucket: "investment",
    skinBaronImportBucket: "investment",
    metricsDisplayMode: "toggle_mode",
    metricsScopeDefault: "investments",
    notifyBanWaveDesktop: true,
    notifyBanWaveDesktopMinLevel: "low",
    notifyCsUpdatesDesktop: true,
    notifyCsUpdatesDesktopMinLevel: "medium",
    notifySteamSyncDesktop: true,
    notifyBanWaveWebPush: false,
    notifyBanWaveWebPushMinLevel: "medium",
    notifyCsUpdatesWebPush: false,
    notifyCsUpdatesWebPushMinLevel: "high",
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
  } = usePortfolio({ scope: metricsScope, rowScope: "all" });
  const {
    items: csUpdatesItems,
    freshItemIds: csUpdatesFreshItemIds,
    latestItem: latestCsUpdate,
    latestItemAgeHours: latestCsUpdateAgeHours,
    meta: csUpdatesMeta,
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
  const [inventoryBuyOrderSummary, setInventoryBuyOrderSummary] = useState([]);
  const initialVisitedTab = runtimeTabs.includes(resolvedInitialTab) ? resolvedInitialTab : runtimeTabs[0];
  const [activeTab, setActiveTab] = useState(initialVisitedTab);
  const [visitedTabs, setVisitedTabs] = useState(() => new Set([initialVisitedTab]));
  const [watchlistFocusTarget, setWatchlistFocusTarget] = useState(null);
  const [, setInventoryGroupFocusId] = useState("");
  const [isCsFloatSyncOpen, setIsCsFloatSyncOpen] = useState(false);
  const [isSkinBaronSyncOpen, setIsSkinBaronSyncOpen] = useState(false);
  const [hoveredChartData, setHoveredChartData] = useState(null);
  const [chartTrendData, setChartTrendData] = useState({
    rangeLabel: "90T",
    deltaValue: 0,
    deltaPercent: 0,
    isPositive: true,
  });
  const [managementInvestments, setManagementInvestments] = useState([]);
  const [managementLoading, setManagementLoading] = useState(false);
  const [managementError, setManagementError] = useState("");
  const [matchingRows, setMatchingRows] = useState([]);
  const [matchingLoading, setMatchingLoading] = useState(false);
  const [expandedClusters, setExpandedClusters] = useState({});
  const [managementFilter, setManagementFilter] = useState("all");
  const [managementSearchTerm, setManagementSearchTerm] = useState("");
  const [managementTypeFilter, setManagementTypeFilter] = useState("all");
  const [managementBucketFilter, setManagementBucketFilter] = useState("all");
  const [managementSortBy, setManagementSortBy] = useState("name_asc");
  const [managementSection, setManagementSection] = useState("matching");
  const [portfolioGroups, setPortfolioGroups] = useState([]);
  const [portfolioGroupsLoading, setPortfolioGroupsLoading] = useState(true);
  const [portfolioGroupDraft, setPortfolioGroupDraft] = useState(createPortfolioGroupDraft);
  const [portfolioGroupEditorId, setPortfolioGroupEditorId] = useState("");
  const [portfolioGroupMessage, setPortfolioGroupMessage] = useState("");
  const [portfolioGroupError, setPortfolioGroupError] = useState("");
  const [expandedGroupManagementClusters, setExpandedGroupManagementClusters] = useState({});
  const [groupSearchTerm, setGroupSearchTerm] = useState("");
  const [groupSortBy, setGroupSortBy] = useState("name_asc");
  const [priceSearchTerm, setPriceSearchTerm] = useState("");
  const [priceSortBy, setPriceSortBy] = useState("name_asc");
  const [priceMissingOnly, setPriceMissingOnly] = useState(false);
  const [matchingSearchTerm, setMatchingSearchTerm] = useState("");
  const [matchingSortBy, setMatchingSortBy] = useState("score_desc");
  const [matchingConfidenceFilter, setMatchingConfidenceFilter] = useState("all");
  const [showMatchedMatchingRows, setShowMatchedMatchingRows] = useState(false);
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
  const [manualNameSuggestions, setManualNameSuggestions] = useState([]);
  const [_manualNameSuggestionsLoading, setManualNameSuggestionsLoading] = useState(false);
  const [_manualNameSuggestionsError, setManualNameSuggestionsError] = useState("");
  const [manualSelectedSuggestion, setManualSelectedSuggestion] = useState(null);
  const [manualItemSaving, setManualItemSaving] = useState(false);
  const [syncNotification, setSyncNotification] = useState({
    newItemsCount: 0,
    lastSyncedAt: null,
  });
  const [syncNotifications, setSyncNotifications] = useState([]);
  const [uiWarningNotificationsBySource, setUiWarningNotificationsBySource] = useState({});
  const [appUpdateNotification, setAppUpdateNotification] = useState({
    state: "idle",
    version: null,
    percent: 0,
    message: "",
  });
  const [seenCsUpdateId, setSeenCsUpdateId] = useState("");
  const [installedAppVersion, setInstalledAppVersion] = useState("");
  const [appUpdateUnread, setAppUpdateUnread] = useState(false);
  const [journeyState, setJourneyState] = useState({ skipped: false });
  const [journeyLoading, setJourneyLoading] = useState(true);
  const [journeyUserName, setJourneyUserName] = useState("");
  const [hasCsFloatKey, setHasCsFloatKey] = useState(false);
  const [hasSkinBaronImportReady, setHasSkinBaronImportReady] = useState(false);
  const [journeyApiKey, setJourneyApiKey] = useState("");
  const [journeyApiKeySaving, setJourneyApiKeySaving] = useState(false);
  const [journeyApiKeyError, setJourneyApiKeyError] = useState("");
  const [journeyApiKeySuccess, setJourneyApiKeySuccess] = useState("");
  const [journeyApiKeyHelper, setJourneyApiKeyHelper] = useState("");
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [isSteamSyncing, setIsSteamSyncing] = useState(false);
  const [steamSyncError, setSteamSyncError] = useState("");
  const [manualSteamSyncInfo, setManualSteamSyncInfo] = useState("");
  const [showStartupAutoSyncEmptyHint, setShowStartupAutoSyncEmptyHint] = useState(false);
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
  const manualSteamSyncInfoTimeoutRef = useRef(null);
  const startupAutoSyncHintTimeoutRef = useRef(null);
  const globalSearchInputRef = useRef(null);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchTerm, setGlobalSearchTerm] = useState("");
  const [globalSearchCommittedTerm, setGlobalSearchCommittedTerm] = useState("");
  const [globalSearchCategory, setGlobalSearchCategory] = useState("all");
  const [globalSearchCatalogResults, _setGlobalSearchCatalogResults] = useState([]);
  const [globalSearchCatalogLoading, _setGlobalSearchCatalogLoading] = useState(false);
  const [globalSearchCatalogError, setGlobalSearchCatalogError] = useState("");
  const [globalSearchWatchlistItems, setGlobalSearchWatchlistItems] = useState([]);
  const [dashboardWatchlistItems, setDashboardWatchlistItems] = useState([]);
  const [globalSearchAddingItem, setGlobalSearchAddingItem] = useState("");
  const [globalSearchRecentTerms, setGlobalSearchRecentTerms] = useState([]);
  const [globalSearchActiveIndex, setGlobalSearchActiveIndex] = useState(-1);
  const portfolioChartCardRef = useRef(null);
  const [watchlistMoverCardHeight, setWatchlistMoverCardHeight] = useState(null);
  const shouldPrepareInventoryData = activeTab === "inventory";
  const shouldPrepareManagementData =
    isDesktopRuntime && activeTab === "management";
  const shouldLoadPortfolioGroups =
    shouldPrepareInventoryData || shouldPrepareManagementData || globalSearchOpen;
  const shouldLoadGlobalSearchWatchlist =
    globalSearchOpen || activeTab === "search";
  const scopedPortfolioHistory = useMemo(() => {
    if (!Array.isArray(portfolioHistory) || portfolioHistory.length === 0) {
      return [];
    }

    const normalizedScope = String(metricsScope || "investments").toLowerCase();
    if (normalizedScope !== "all") {
      return portfolioHistory;
    }

    const totalValueAll = Number(stats.totalValue || 0);
    if (!Number.isFinite(totalValueAll) || totalValueAll <= 0) {
      return portfolioHistory;
    }

    let latestHistoryValue = null;
    let latestHistoryInvested = null;
    for (let index = portfolioHistory.length - 1; index >= 0; index -= 1) {
      const entry = portfolioHistory[index];
      const value = Number(
        entry?.wert ?? entry?.value ?? entry?.priceEur ?? entry?.price_eur ?? entry?.price ?? 0,
      );
      if (!Number.isFinite(value) || value <= 0) {
        continue;
      }

      latestHistoryValue = value;
      const invested = Number(
        entry?.invested ??
          entry?.investedValue ??
          entry?.invested_value ??
          entry?.totalInvested ??
          entry?.total_invested ??
          0,
      );
      latestHistoryInvested = Number.isFinite(invested) && invested > 0 ? invested : null;
      break;
    }

    if (!Number.isFinite(latestHistoryValue) || latestHistoryValue <= 0) {
      return portfolioHistory;
    }

    const valueDeltaRatio = Math.abs(totalValueAll - latestHistoryValue) / latestHistoryValue;
    if (valueDeltaRatio <= 0.03) {
      return portfolioHistory;
    }

    const totalInvestedAll = Number(stats.totalInvested || 0);
    const valueScaleFactor = totalValueAll / latestHistoryValue;
    const investedScaleFactor =
      Number.isFinite(totalInvestedAll) &&
      totalInvestedAll > 0 &&
      Number.isFinite(latestHistoryInvested) &&
      latestHistoryInvested > 0
        ? totalInvestedAll / latestHistoryInvested
        : valueScaleFactor;

    if (!Number.isFinite(valueScaleFactor) || valueScaleFactor <= 0) {
      return portfolioHistory;
    }

    return portfolioHistory.map((entry) => {
      const value = Number(
        entry?.wert ?? entry?.value ?? entry?.priceEur ?? entry?.price_eur ?? entry?.price ?? 0,
      );
      const invested = Number(
        entry?.invested ??
          entry?.investedValue ??
          entry?.invested_value ??
          entry?.totalInvested ??
          entry?.total_invested ??
          0,
      );
      const scaledValue = Number.isFinite(value) ? value * valueScaleFactor : value;
      const scaledInvested = Number.isFinite(invested) ? invested * investedScaleFactor : invested;
      const scaledGrowthPercent =
        Number.isFinite(scaledInvested) && scaledInvested > 0
          ? ((scaledValue - scaledInvested) / scaledInvested) * 100
          : 0;

      return {
        ...entry,
        wert: Number.isFinite(scaledValue) ? scaledValue : entry?.wert,
        value: Number.isFinite(scaledValue) ? scaledValue : entry?.value,
        invested: Number.isFinite(scaledInvested) ? scaledInvested : entry?.invested,
        investedValue: Number.isFinite(scaledInvested) ? scaledInvested : entry?.investedValue,
        growthPercent: scaledGrowthPercent,
      };
    });
  }, [metricsScope, portfolioHistory, stats.totalInvested, stats.totalValue]);

  // Keyboard shortcuts for tab navigation and search
  useKeyboard({
    onArrowLeft: () => {
      const currentIndex = runtimeTabs.indexOf(activeTab);
      if (currentIndex > 0) {
        const newTab = runtimeTabs[currentIndex - 1];
        setActiveTab(newTab);
        navigate(newTab === "search" ? "/search" : `/?tab=${newTab}`, { replace: true });
      }
    },
    onArrowRight: () => {
      const currentIndex = runtimeTabs.indexOf(activeTab);
      if (currentIndex < runtimeTabs.length - 1) {
        const newTab = runtimeTabs[currentIndex + 1];
        setActiveTab(newTab);
        navigate(newTab === "search" ? "/search" : `/?tab=${newTab}`, { replace: true });
      }
    },
    onSearch: () => {
      if (activeTab === "search") {
        setGlobalSearchOpen(false);
        setTimeout(() => globalSearchInputRef.current?.focus(), 40);
        return;
      }
      setGlobalSearchOpen(true);
      setTimeout(() => globalSearchInputRef.current?.focus(), 40);
    }
  }, true);

  useEffect(() => {
    const normalizedTab = runtimeTabs.includes(resolvedInitialTab) ? resolvedInitialTab : runtimeTabs[0];
    setActiveTab((current) => (current === normalizedTab ? current : normalizedTab));
  }, [resolvedInitialTab, runtimeTabs]);

  useEffect(() => {
    if (!runtimeTabs.includes(activeTab)) {
      return;
    }
    setVisitedTabs((current) => {
      if (current.has(activeTab)) {
        return current;
      }
      const next = new Set(current);
      next.add(activeTab);
      return next;
    });
  }, [activeTab, runtimeTabs]);

  useEffect(() => {
    if (location.pathname !== "/search") {
      return;
    }
    setGlobalSearchTerm((current) => (current === searchPageInitialTerm ? current : searchPageInitialTerm));
    setGlobalSearchCommittedTerm((current) =>
      current === searchPageInitialTerm ? current : searchPageInitialTerm,
    );
  }, [location.pathname, searchPageInitialTerm]);

  useEffect(() => {
    setSeenCsUpdateId(readLastSeenCsUpdateId());
  }, []);

  useEffect(() => {
    const loadJourneyState = async () => {
      setJourneyLoading(true);
      try {
        const [savedJourney, currentUser] = await Promise.all([
          readJourneyState(),
          getCurrentUser(),
        ]);
        const [csFloatKeyStatus, skinBaronKeyStatus] = isDesktopRuntime
          ? await Promise.all([
              fetchCsFloatApiKeyStatus(),
              fetchSkinBaronApiKeyStatus(),
            ])
          : [null, null];
        setJourneyState(normalizeJourneyState(savedJourney));
        setJourneyUserName(String(currentUser?.name || currentUser?.steamName || ""));
        const csFloatKeyConnected = Boolean(
          csFloatKeyStatus?.data?.hasKey || csFloatKeyStatus?.data?.configured,
        );
        const skinBaronImportReady = Boolean(
          skinBaronKeyStatus?.data?.importReady
            || skinBaronKeyStatus?.data?.sessionCookieAccess?.allowed
            || (
              skinBaronKeyStatus?.data?.sessionCookieConfigured
              && skinBaronKeyStatus?.data?.sessionCookieHasAuthId
            ),
        );
        setHasCsFloatKey(csFloatKeyConnected);
        setHasSkinBaronImportReady(skinBaronImportReady);
      } catch (journeyError) {
        console.warn("Failed to load onboarding journey state", journeyError);
      } finally {
        setJourneyLoading(false);
      }
    };

    void loadJourneyState();
  }, [isDesktopRuntime]);

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
    let cancelled = false;

    const loadPortfolioGroups = async () => {
      if (!shouldLoadPortfolioGroups) {
        return;
      }
      setPortfolioGroupsLoading(true);
      try {
        const stored = await readLocalState(PORTFOLIO_GROUPS_STORAGE_KEY, { groups: [] });
        const localGroups = normalizePortfolioGroups(stored);

        let remoteGroups = [];
        try {
          const remoteResponse = await fetchPortfolioGroupsSetting();
          remoteGroups = normalizePortfolioGroups(remoteResponse?.data?.groups || []);
        } catch (remoteLoadError) {
          console.warn("Failed to load remote portfolio groups", remoteLoadError);
        }

        const nextGroups = remoteGroups.length > 0 ? remoteGroups : localGroups;
        if (remoteGroups.length === 0 && localGroups.length > 0) {
          try {
            await updatePortfolioGroupsSetting(localGroups);
          } catch (migrationError) {
            console.warn("Failed to migrate local portfolio groups to server", migrationError);
          }
        }

        await writeLocalState(PORTFOLIO_GROUPS_STORAGE_KEY, { groups: nextGroups });
        if (cancelled) {
          return;
        }
        setPortfolioGroups(nextGroups);
        setPortfolioGroupError("");
      } catch (groupLoadError) {
        if (cancelled) {
          return;
        }
        console.warn("Failed to load portfolio groups", groupLoadError);
        setPortfolioGroups([]);
        setPortfolioGroupError("Gruppen konnten nicht geladen werden.");
      } finally {
        if (!cancelled) {
          setPortfolioGroupsLoading(false);
        }
      }
    };

    void loadPortfolioGroups();
    return () => {
      cancelled = true;
    };
  }, [shouldLoadPortfolioGroups]);

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
      if (!shouldPrepareManagementData && !shouldPrepareInventoryData) {
        return;
      }
      if (!isDesktopRuntime) {
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
  }, [compositionRefreshToken, isDesktopRuntime, shouldPrepareInventoryData, shouldPrepareManagementData]);

  useEffect(() => {
    if (managementSection !== "create") {
      return;
    }

    const query = normalizeSearchText(manualItemDraft.name);
    if (query.length < 2) {
      setManualNameSuggestions([]);
      setManualNameSuggestionsLoading(false);
      setManualNameSuggestionsError("");
      return;
    }
    const selectedName = normalizeSearchText(
      manualSelectedSuggestion?.marketHashName || manualSelectedSuggestion?.displayName || "",
    );
    if (selectedName && selectedName === query) {
      setManualNameSuggestions([]);
      setManualNameSuggestionsLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        setManualNameSuggestionsLoading(true);
        setManualNameSuggestionsError("");

        const response = await searchWatchlistItems(
          query,
          {
            itemType: manualItemDraft.type && manualItemDraft.type !== "other"
              ? manualItemDraft.type
              : undefined,
            sortBy: "relevance",
          },
          6,
          1,
        );
        const items = Array.isArray(response?.data?.items) ? response.data.items : [];
        if (!cancelled) {
          setManualNameSuggestions(items);
        }
      } catch (error) {
        if (!cancelled) {
          setManualNameSuggestions([]);
          setManualNameSuggestionsError(error?.message || "Vorschlaege konnten nicht geladen werden.");
        }
      } finally {
        if (!cancelled) {
          setManualNameSuggestionsLoading(false);
        }
      }
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [managementSection, manualItemDraft.name, manualItemDraft.type, manualSelectedSuggestion]);

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
      if (imported > 0 && portfolioPreferences.notifySteamSyncDesktop && window.electronAPI?.localStore?.createNotification) {
        await window.electronAPI.localStore.createNotification({
          userId,
          category: "steam_sync",
          title: "Neue Steam Items",
          message: `${imported} neue Items durch Steam Sync`,
          // Keep the dedupe payload stable: a fresh `syncedAt` (or volatile
          // `updated` count) on every sync made stableSerialize() differ each
          // time, so the 24h dedupe never matched and an identical "N neue
          // Items" notification was recreated (unread) on every sync. The
          // timestamp lives in `createdAt`; identity is the imported count.
          payload: {
            imported,
          },
          createdAt: syncedAt,
        });
      }
      if (imported > 0) {
        setSyncNotification({
          newItemsCount: imported,
          lastSyncedAt: syncedAt,
        });
        if (manual) {
          setManualSteamSyncInfo("");
        }
      } else {
        setSyncNotification((current) => ({
          ...current,
          lastSyncedAt: syncedAt,
        }));
        if (manual) {
          setManualSteamSyncInfo("Keine neuen Steam Items gefunden.");
          if (manualSteamSyncInfoTimeoutRef.current) {
            window.clearTimeout(manualSteamSyncInfoTimeoutRef.current);
          }
          manualSteamSyncInfoTimeoutRef.current = window.setTimeout(() => {
            setManualSteamSyncInfo("");
            manualSteamSyncInfoTimeoutRef.current = null;
          }, 5000);
        } else if (isElectronRuntime) {
          setShowStartupAutoSyncEmptyHint(true);
          if (startupAutoSyncHintTimeoutRef.current) {
            window.clearTimeout(startupAutoSyncHintTimeoutRef.current);
          }
          startupAutoSyncHintTimeoutRef.current = window.setTimeout(() => {
            setShowStartupAutoSyncEmptyHint(false);
            startupAutoSyncHintTimeoutRef.current = null;
          }, 3000);
        }
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
  }, [authRequired, isElectronRuntime, isSteamSyncing, portfolioPreferences.steamImportBucket, portfolioPreferences.notifySteamSyncDesktop, refreshPortfolio]);

  useEffect(() => () => {
    if (manualSteamSyncInfoTimeoutRef.current) {
      window.clearTimeout(manualSteamSyncInfoTimeoutRef.current);
    }
    if (startupAutoSyncHintTimeoutRef.current) {
      window.clearTimeout(startupAutoSyncHintTimeoutRef.current);
    }
  }, []);

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
    const isDesktopLocal =
      typeof window !== "undefined" && Boolean(window.electronAPI?.localStore);
    if (
      !isDesktopLocal ||
      authRequired ||
      autoSyncStartedRef.current ||
      !autoSyncEnabled ||
      portfolioLoading
    ) {
      return;
    }

    let cancelled = false;
    let timeoutId = null;
    let idleId = null;

    const trigger = async () => {
      if (cancelled || autoSyncStartedRef.current) {
        return;
      }
      autoSyncStartedRef.current = true;
      await runSteamSync({ manual: false });
    };

    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(() => {
        void trigger();
      }, { timeout: 3000 });
    } else if (typeof window !== "undefined") {
      timeoutId = window.setTimeout(() => {
        void trigger();
      }, 1200);
    } else {
      void trigger();
    }

    return () => {
      cancelled = true;
      if (timeoutId !== null && typeof window !== "undefined") {
        window.clearTimeout(timeoutId);
      }
      if (
        idleId !== null &&
        typeof window !== "undefined" &&
        typeof window.cancelIdleCallback === "function"
      ) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [authRequired, autoSyncEnabled, portfolioLoading, runSteamSync]);

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
    if (selectedItem.__detailKind === "group" || selectedItem.__detailKind === "group-cluster") {
      return selectedItem;
    }

    return resolveLiveClusterItem(selectedItem, enrichedInvestments);
  }, [selectedItem, enrichedInvestments]);

  const selectedItemWithLiveAndBuyOrders = useMemo(
    () => withBuyOrderFields(selectedItemWithLive, inventoryBuyOrderSummary),
    [selectedItemWithLive, inventoryBuyOrderSummary],
  );

  useEffect(() => {
    if (!isDesktopRuntime || activeTab !== "inventory") {
      return;
    }

    let isCancelled = false;
    const loadInventoryBuyOrders = async () => {
      try {
        const buyOrderResponse = await fetchCsFloatBuyOrdersData();
        let nextSummary = Array.isArray(buyOrderResponse?.data?.summaryByMarketHashName)
          ? buyOrderResponse.data.summaryByMarketHashName
          : [];

        if (nextSummary.length === 0) {
          const liveResponse = await fetchCsFloatBuyOrdersData({
            syncNow: true,
            limit: 200,
            maxPages: 8,
          });
          nextSummary = Array.isArray(liveResponse?.data?.summaryByMarketHashName)
            ? liveResponse.data.summaryByMarketHashName
            : [];
        }

        if (!isCancelled) {
          setInventoryBuyOrderSummary(nextSummary);
        }
      } catch (buyOrderError) {
        console.warn("[inventory] CSFloat buyorders unavailable", buyOrderError);
      }
    };

    void loadInventoryBuyOrders();
    return () => {
      isCancelled = true;
    };
  }, [activeTab, isDesktopRuntime]);

  useEffect(() => {
    const loadItemHistory = async () => {
      if (!selectedItemWithLive) {
        setSelectedItemHistory([]);
        setSelectedItemHistoryLoading(false);
        return;
      }
      if (selectedItemWithLive.__detailKind === "group" || selectedItemWithLive.__detailKind === "group-cluster") {
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

  const handleTabSelect = useCallback((nextTab) => {
    if (!runtimeTabs.includes(nextTab)) {
      return;
    }
    const targetPath =
      nextTab === "search"
        ? location.pathname === "/search"
          ? `${location.pathname}${location.search || ""}`
          : "/search"
        : `/?tab=${nextTab}`;
    const currentPathWithQuery = `${location.pathname}${location.search || ""}`;
    if (nextTab === activeTab && currentPathWithQuery === targetPath) {
      return;
    }
    setActiveTab((current) => (current === nextTab ? current : nextTab));
    if (currentPathWithQuery !== targetPath) {
      navigate(targetPath, { replace: true });
    }
  }, [activeTab, location.pathname, location.search, navigate, runtimeTabs]);

  const persistPortfolioGroups = useCallback(async (nextGroups) => {
    const normalizedGroups = normalizePortfolioGroups(nextGroups);
    setPortfolioGroups(normalizedGroups);
    await writeLocalState(PORTFOLIO_GROUPS_STORAGE_KEY, { groups: normalizedGroups });
    try {
      const remoteResponse = await updatePortfolioGroupsSetting(normalizedGroups);
      const remoteGroups = normalizePortfolioGroups(remoteResponse?.data?.groups || normalizedGroups);
      setPortfolioGroups(remoteGroups);
      await writeLocalState(PORTFOLIO_GROUPS_STORAGE_KEY, { groups: remoteGroups });
      return remoteGroups;
    } catch (groupSyncError) {
      console.warn("Failed to sync portfolio groups to server", groupSyncError);
      return normalizedGroups;
    }
  }, []);

  const resetPortfolioGroupEditor = useCallback(() => {
    setPortfolioGroupEditorId("");
    setPortfolioGroupDraft(createPortfolioGroupDraft());
    setPortfolioGroupMessage("");
    setPortfolioGroupError("");
  }, []);

  const handleStartCreatePortfolioGroup = useCallback(() => {
    resetPortfolioGroupEditor();
    setManagementSection("groups");
    if (isDesktopRuntime) {
      handleTabSelect("management");
    }
  }, [handleTabSelect, isDesktopRuntime, resetPortfolioGroupEditor]);

  const handleEditPortfolioGroup = useCallback((group) => {
    if (!group) {
      resetPortfolioGroupEditor();
      return;
    }
    setPortfolioGroupEditorId(group.id);
    setPortfolioGroupDraft({
      id: group.id,
      name: group.name || "",
      thesis: group.thesis || "",
    });
    setPortfolioGroupMessage("");
    setPortfolioGroupError("");
  }, [resetPortfolioGroupEditor]);

  const handlePortfolioGroupDraftChange = useCallback((field, value) => {
    setPortfolioGroupDraft((current) => ({
      ...current,
      [field]: value,
    }));
    setPortfolioGroupMessage("");
    setPortfolioGroupError("");
  }, []);

  const handleSavePortfolioGroup = useCallback(async () => {
    const name = String(portfolioGroupDraft?.name || "").trim();
    const thesis = String(portfolioGroupDraft?.thesis || "").trim();
    if (!name) {
      setPortfolioGroupError("Bitte einen Gruppennamen vergeben.");
      return;
    }

    const now = new Date().toISOString();
    const existingGroup = portfolioGroupEditorId
      ? portfolioGroups.find((group) => group.id === portfolioGroupEditorId) || null
      : null;
    const nextGroupId = existingGroup?.id || `group-${Date.now()}`;
    const nextGroups = existingGroup
      ? portfolioGroups.map((group) =>
          group.id === existingGroup.id
            ? {
                ...group,
                name,
                thesis,
                updatedAt: now,
              }
            : group,
        )
      : [
          ...portfolioGroups,
          {
            id: nextGroupId,
            name,
            thesis,
            memberInvestmentIds: [],
            createdAt: now,
            updatedAt: now,
          },
        ];

    try {
      const persistedGroups = await persistPortfolioGroups(nextGroups);
      const savedGroup = persistedGroups.find((group) => group.id === nextGroupId) || null;
      if (savedGroup) {
        setPortfolioGroupEditorId(savedGroup.id);
        setPortfolioGroupDraft({
          id: savedGroup.id,
          name: savedGroup.name,
          thesis: savedGroup.thesis || "",
        });
      }
      setPortfolioGroupMessage(existingGroup ? "Gruppe aktualisiert." : "Gruppe angelegt.");
      setPortfolioGroupError("");
    } catch (groupSaveError) {
      console.warn("Failed to persist portfolio group", groupSaveError);
      setPortfolioGroupError("Gruppe konnte nicht gespeichert werden.");
    }
  }, [
    persistPortfolioGroups,
    portfolioGroupDraft,
    portfolioGroupEditorId,
    portfolioGroups,
  ]);

  const handleDeletePortfolioGroup = useCallback(async (groupId) => {
    const normalizedGroupId = String(groupId || "").trim();
    if (!normalizedGroupId) {
      return;
    }

    try {
      await persistPortfolioGroups(
        portfolioGroups.filter((group) => group.id !== normalizedGroupId),
      );
      if (portfolioGroupEditorId === normalizedGroupId) {
        resetPortfolioGroupEditor();
      }
      setPortfolioGroupMessage("Gruppe geloescht.");
      setPortfolioGroupError("");
    } catch (groupDeleteError) {
      console.warn("Failed to delete portfolio group", groupDeleteError);
      setPortfolioGroupError("Gruppe konnte nicht geloescht werden.");
    }
  }, [
    persistPortfolioGroups,
    portfolioGroupEditorId,
    portfolioGroups,
    resetPortfolioGroupEditor,
  ]);

  const toggleExpandedGroupManagementCluster = useCallback((clusterKey) => {
    setExpandedGroupManagementClusters((current) => ({
      ...current,
      [clusterKey]: !current[clusterKey],
    }));
  }, []);

  const handleAssignInvestmentIdsToGroup = useCallback(async (groupId, investmentIds = []) => {
    const normalizedGroupId = String(groupId || "").trim();
    const nextIds = uniqueInvestmentIds(investmentIds);
    const nextIdSet = new Set(nextIds);
    if (!normalizedGroupId || nextIds.length === 0) {
      return;
    }

    try {
      await persistPortfolioGroups(
        portfolioGroups.map((group) => {
          const filteredIds = group.memberInvestmentIds.filter((investmentId) => !nextIdSet.has(investmentId));
          if (group.id === normalizedGroupId) {
            return {
              ...group,
              memberInvestmentIds: uniqueInvestmentIds([...filteredIds, ...nextIds]),
              updatedAt: new Date().toISOString(),
            };
          }
          return {
            ...group,
            memberInvestmentIds: filteredIds,
            updatedAt:
              filteredIds.length === group.memberInvestmentIds.length
                ? group.updatedAt
                : new Date().toISOString(),
          };
        }),
      );
      setPortfolioGroupMessage("Mitglieder zur Gruppe hinzugefuegt.");
      setPortfolioGroupError("");
    } catch (groupAssignError) {
      console.warn("Failed to assign investments to group", groupAssignError);
      setPortfolioGroupError("Mitglieder konnten nicht zur Gruppe hinzugefuegt werden.");
    }
  }, [persistPortfolioGroups, portfolioGroups]);

  const handleRemoveInvestmentIdsFromGroup = useCallback(async (groupId, investmentIds = []) => {
    const normalizedGroupId = String(groupId || "").trim();
    const nextIds = uniqueInvestmentIds(investmentIds);
    const nextIdSet = new Set(nextIds);
    if (!normalizedGroupId || nextIds.length === 0) {
      return;
    }

    try {
      await persistPortfolioGroups(
        portfolioGroups.map((group) =>
          group.id === normalizedGroupId
            ? {
                ...group,
                memberInvestmentIds: group.memberInvestmentIds.filter(
                  (investmentId) => !nextIdSet.has(investmentId),
                ),
                updatedAt: new Date().toISOString(),
              }
            : group,
        ),
      );
      setPortfolioGroupMessage("Mitglieder aus der Gruppe entfernt.");
      setPortfolioGroupError("");
    } catch (groupRemoveError) {
      console.warn("Failed to remove investments from group", groupRemoveError);
      setPortfolioGroupError("Mitglieder konnten nicht aus der Gruppe entfernt werden.");
    }
  }, [persistPortfolioGroups, portfolioGroups]);

  const handleOpenPortfolioGroupInInventory = useCallback((groupId) => {
    const normalizedGroupId = String(groupId || "").trim();
    if (!normalizedGroupId) {
      return;
    }

    setInventoryScope("all");
    setInventoryGroupFocusId(normalizedGroupId);
    setGlobalSearchOpen(false);
    handleTabSelect("inventory");
  }, [handleTabSelect]);

  const handleOpenPortfolioGroupInManagement = useCallback((groupId) => {
    const normalizedGroupId = String(groupId || "").trim();
    if (!normalizedGroupId) {
      return;
    }

    const group = portfolioGroups.find((entry) => entry.id === normalizedGroupId) || null;
    if (group) {
      handleEditPortfolioGroup(group);
    }
    setManagementSection("groups");
    setGlobalSearchOpen(false);
    handleTabSelect("management");
  }, [handleEditPortfolioGroup, handleTabSelect, portfolioGroups]);

  const loadGlobalSearchWatchlistItems = useCallback(async () => {
    try {
      const response = await fetchWatchlistData({
        syncLive: false,
        skipDesktopSync: true,
      });
      setGlobalSearchWatchlistItems(Array.isArray(response?.data) ? response.data : []);
    } catch (watchlistError) {
      console.warn("Failed to preload watchlist for global search", watchlistError);
      setGlobalSearchWatchlistItems([]);
    }
  }, []);

  const loadDashboardWatchlistItems = useCallback(async () => {
    try {
      const response = await fetchWatchlistData({
        syncLive: true,
      });
      setDashboardWatchlistItems(Array.isArray(response?.data) ? response.data : []);
    } catch (watchlistError) {
      console.warn("Failed to load dashboard watchlist movers", watchlistError);
      try {
        const fallbackResponse = await fetchWatchlistData({
          syncLive: false,
        });
        setDashboardWatchlistItems(Array.isArray(fallbackResponse?.data) ? fallbackResponse.data : []);
      } catch {
        setDashboardWatchlistItems([]);
      }
    }
  }, []);

  useEffect(() => {
    if (!shouldLoadGlobalSearchWatchlist) {
      return;
    }
    void loadGlobalSearchWatchlistItems();
  }, [compositionRefreshToken, loadGlobalSearchWatchlistItems, shouldLoadGlobalSearchWatchlist]);

  useEffect(() => {
    if (activeTab !== "overview" || portfolioLoading) {
      return;
    }

    let cancelled = false;
    let timeoutId = null;
    let idleId = null;

    const scheduleLoad = () => {
      if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(() => {
          if (!cancelled) {
            void loadDashboardWatchlistItems();
          }
        }, { timeout: 1500 });
        return;
      }

      timeoutId = window.setTimeout(() => {
        if (!cancelled) {
          void loadDashboardWatchlistItems();
        }
      }, 250);
    };

    scheduleLoad();

    return () => {
      cancelled = true;
      if (timeoutId !== null && typeof window !== "undefined") {
        window.clearTimeout(timeoutId);
      }
      if (
        idleId !== null &&
        typeof window !== "undefined" &&
        typeof window.cancelIdleCallback === "function"
      ) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [activeTab, compositionRefreshToken, loadDashboardWatchlistItems, portfolioLoading]);

  useEffect(() => {
    let cancelled = false;
    const loadRecentSearches = async () => {
      const stored = await readLocalState(GLOBAL_SEARCH_RECENTS_KEY, { terms: [] });
      if (cancelled) {
        return;
      }
      const terms = Array.isArray(stored?.terms)
        ? stored.terms.map((entry) => normalizeGlobalSearchInput(entry)).filter(Boolean).slice(0, 8)
        : [];
      setGlobalSearchRecentTerms(terms);
    };

    void loadRecentSearches();
    return () => {
      cancelled = true;
    };
  }, []);

  const storeGlobalRecentSearch = useCallback((term) => {
    const normalized = normalizeGlobalSearchInput(term);
    if (normalized.length < 2) {
      return;
    }

    setGlobalSearchRecentTerms((current) => {
      const next = [normalized, ...current.filter((entry) => entry !== normalized)].slice(0, 8);
      void writeLocalState(GLOBAL_SEARCH_RECENTS_KEY, { terms: next });
      return next;
    });
  }, []);

  const clearGlobalRecentSearches = useCallback(() => {
    setGlobalSearchRecentTerms([]);
    void writeLocalState(GLOBAL_SEARCH_RECENTS_KEY, { terms: [] });
  }, []);

  const globalSearchTermNormalized = useMemo(
    () => normalizeSearchText(normalizeGlobalSearchInput(globalSearchTerm)),
    [globalSearchTerm],
  );
  const canRunGlobalCatalogSearch = globalSearchTermNormalized.length >= 2;
  const hasPendingCatalogSearch =
    canRunGlobalCatalogSearch &&
    normalizeSearchText(globalSearchCommittedTerm) !== globalSearchTermNormalized;

  const globalSearchKnownItems = useMemo(() => {
    const grouped = new Map();

    enrichedInvestments.forEach((item) => {
      const name = String(item?.name || item?.marketHashName || item?.itemName || "").trim();
      if (!name) {
        return;
      }
      const bucket = normalizeBucket(item?.bucket, "investment");
      const source = bucket === "inventory" ? "inventory" : "investment";
      const key = `${source}:${normalizeSearchText(name)}`;
      const quantity = Math.max(1, Number(item?.quantity || 1));
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          source,
          sourcePriority: source === "investment" ? 0 : 1,
          sourceLabel: source === "investment" ? "Investments" : "Inventar",
          sourceItemId: item?.id || null,
          name,
          nameKey: normalizeSearchText(name),
          quantity,
          itemType: String(item?.type || item?.itemType || "other").trim().toLowerCase(),
          imageUrl: item?.imageUrl || item?.iconUrl || null,
          currentPrice: item?.currentPrice ?? item?.livePrice ?? null,
          priceHistory: Array.isArray(item?.priceHistory) ? item.priceHistory : [],
          priceChangePercent: Number.isFinite(Number(item?.priceChangePercent))
            ? Number(item.priceChangePercent)
            : null,
          matchPayload: { source, nameKey: normalizeSearchText(name) },
          searchText: normalizeSearchText(
            [
              name,
              item?.marketHashName,
              item?.itemName,
              item?.type,
              item?.itemType,
              item?.wear,
              item?.wearLabel,
            ]
              .filter(Boolean)
              .join(" "),
          ),
        });
        return;
      }

      const existing = grouped.get(key);
      existing.quantity += quantity;
      if (!existing.imageUrl) {
        existing.imageUrl = item?.imageUrl || item?.iconUrl || null;
      }
      if (!Number.isFinite(Number(existing.currentPrice)) && Number.isFinite(Number(item?.currentPrice ?? item?.livePrice))) {
        existing.currentPrice = Number(item.currentPrice ?? item.livePrice);
      }
      if ((!Array.isArray(existing.priceHistory) || existing.priceHistory.length === 0) && Array.isArray(item?.priceHistory)) {
        existing.priceHistory = item.priceHistory;
      }
    });

    globalSearchWatchlistItems.forEach((item) => {
      const name = String(item?.name || item?.marketHashName || "").trim();
      if (!name) {
        return;
      }
      const key = `watchlist:${normalizeSearchText(name)}`;
      const quantity = Math.max(1, Number(item?.quantity || 1));
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          source: "watchlist",
          sourcePriority: 2,
          sourceLabel: "Watchlist",
          sourceItemId: item?.id || null,
          name,
          nameKey: normalizeSearchText(name),
          quantity,
          itemType: String(item?.type || item?.itemType || "other").trim().toLowerCase(),
          imageUrl: item?.imageUrl || item?.iconUrl || null,
          currentPrice: item?.currentPrice ?? null,
          priceHistory: Array.isArray(item?.priceHistory) ? item.priceHistory : [],
          priceChangePercent: Number.isFinite(Number(item?.priceChangePercent))
            ? Number(item.priceChangePercent)
            : null,
          matchPayload: { source: "watchlist", id: item?.id, nameKey: normalizeSearchText(name) },
          searchText: normalizeSearchText(
            [
              name,
              item?.marketHashName,
              item?.type,
              item?.itemType,
              item?.wear,
              item?.wearLabel,
            ]
              .filter(Boolean)
              .join(" "),
          ),
        });
        return;
      }

      const existing = grouped.get(key);
      existing.quantity += quantity;
      if (!existing.imageUrl) {
        existing.imageUrl = item?.imageUrl || item?.iconUrl || null;
      }
      if (!Number.isFinite(Number(existing.currentPrice)) && Number.isFinite(Number(item?.currentPrice))) {
        existing.currentPrice = Number(item.currentPrice);
      }
      if ((!Array.isArray(existing.priceHistory) || existing.priceHistory.length === 0) && Array.isArray(item?.priceHistory)) {
        existing.priceHistory = item.priceHistory;
      }
    });

    return Array.from(grouped.values());
  }, [enrichedInvestments, globalSearchWatchlistItems]);

  const globalSearchKnownItemsByName = useMemo(() => {
    const map = new Map();
    globalSearchKnownItems.forEach((entry) => {
      const nameKey = normalizeSearchText(entry?.name || "");
      if (!nameKey) {
        return;
      }
      const existing = map.get(nameKey) || {
        hasInvestment: false,
        hasInventory: false,
        hasWatchlist: false,
      };
      existing.hasInvestment = existing.hasInvestment || entry.source === "investment";
      existing.hasInventory = existing.hasInventory || entry.source === "inventory";
      existing.hasWatchlist = existing.hasWatchlist || entry.source === "watchlist";
      map.set(nameKey, existing);
    });
    return map;
  }, [globalSearchKnownItems]);

  const globalSearchKnownPrimaryByName = useMemo(() => {
    const map = new Map();
    globalSearchKnownItems.forEach((entry) => {
      const nameKey = normalizeSearchText(entry?.name || "");
      if (!nameKey) {
        return;
      }
      const existing = map.get(nameKey);
      if (!existing || entry.sourcePriority < existing.sourcePriority) {
        map.set(nameKey, entry);
      }
    });
    return map;
  }, [globalSearchKnownItems]);

  const globalSearchLocalSuggestions = useMemo(() => {
    if (!globalSearchTermNormalized) {
      return [];
    }

    return globalSearchKnownItems
      .filter((entry) => entry.searchText.includes(globalSearchTermNormalized))
      .map((entry) => {
        const startsWith = entry.searchText.startsWith(globalSearchTermNormalized);
        return {
          ...entry,
          matchScore: startsWith ? 0 : 1,
        };
      })
      .sort((left, right) => {
        if (left.sourcePriority !== right.sourcePriority) {
          return left.sourcePriority - right.sourcePriority;
        }
        if (left.matchScore !== right.matchScore) {
          return left.matchScore - right.matchScore;
        }
        return left.name.localeCompare(right.name, "de");
      })
      .slice(0, 8);
  }, [globalSearchKnownItems, globalSearchTermNormalized]);
  const globalSearchLocalSuggestionGroups = useMemo(() => {
    const order = [
      { key: "investment", label: "Investments" },
      { key: "inventory", label: "Inventar" },
      { key: "watchlist", label: "Watchlist" },
    ];
    return order
      .map((group) => ({
        ...group,
        entries: globalSearchLocalSuggestions.filter((entry) => entry.source === group.key),
      }))
      .filter((group) => group.entries.length > 0);
  }, [globalSearchLocalSuggestions]);

  const globalSearchFilteredCatalogResults = useMemo(() => {
    if (globalSearchCategory === "all") {
      return globalSearchCatalogResults;
    }
    return globalSearchCatalogResults.filter(
      (candidate) => resolveCatalogCategory(candidate?.itemType || candidate?.type) === globalSearchCategory,
    );
  }, [globalSearchCatalogResults, globalSearchCategory]);

  const openGlobalSearchBrowser = useCallback(
    (rawTerm) => {
      const query = normalizeGlobalSearchInput(rawTerm);
      if (query.length >= 2) {
        storeGlobalRecentSearch(query);
      }
      const queryParam = query ? `?q=${encodeURIComponent(query)}` : "";
      setGlobalSearchOpen(false);
      navigate(`/search${queryParam}`);
    },
    [navigate, storeGlobalRecentSearch],
  );

  const handleGlobalSearchSubmit = useCallback(
    async (event) => {
      event?.preventDefault?.();
      openGlobalSearchBrowser(globalSearchTerm);
    },
    [globalSearchTerm, openGlobalSearchBrowser],
  );

  const handleGlobalSearchSelectKnownItem = useCallback(
    (entry) => {
      if (!entry?.matchPayload) {
        return;
      }

      if (entry.matchPayload.source === "watchlist") {
        const fallbackWatchlist = globalSearchWatchlistItems.find(
          (item) => normalizeSearchText(item?.name || item?.marketHashName || "") === entry.matchPayload.nameKey,
        );
        const watchlistId = Number(entry.matchPayload.id || fallbackWatchlist?.id || 0);
        if (watchlistId > 0) {
          setWatchlistFocusTarget({
            id: watchlistId,
            requestedAt: Date.now(),
          });
        }
        handleTabSelect("watchlist");
        setGlobalSearchOpen(false);
        return;
      }

      const targetBucket = entry.matchPayload.source === "inventory" ? "inventory" : "investment";
      const item = enrichedInvestments.find((candidate) => {
        const candidateName = normalizeSearchText(
          candidate?.name || candidate?.marketHashName || candidate?.itemName || "",
        );
        const candidateBucket = normalizeBucket(candidate?.bucket, "investment");
        return candidateName === entry.matchPayload.nameKey && candidateBucket === targetBucket;
      });

      setInventoryScope(targetBucket);
      if (item) {
        setSelectedItem(item);
      }
      handleTabSelect("inventory");
      setGlobalSearchOpen(false);
    },
    [enrichedInvestments, globalSearchWatchlistItems, handleTabSelect],
  );

  const handleGlobalSearchAddToWatchlist = useCallback(
    async (candidate) => {
      const marketHashName = String(candidate?.marketHashName || candidate?.displayName || "").trim();
      if (!marketHashName) {
        return;
      }

      try {
        setGlobalSearchAddingItem(marketHashName);
        await createWatchlistItemData(marketHashName, String(candidate?.itemType || "other"));
        await loadGlobalSearchWatchlistItems();
      } catch (watchlistError) {
        setGlobalSearchCatalogError(watchlistError?.message || "Konnte Item nicht zur Watchlist hinzufuegen.");
      } finally {
        setGlobalSearchAddingItem("");
      }
    },
    [loadGlobalSearchWatchlistItems],
  );

  const globalSearchKeyboardEntries = useMemo(() => {
    const entries = [];
    if (!globalSearchTermNormalized) {
      globalSearchRecentTerms.forEach((term, index) => {
        entries.push({
          kind: "recent",
          id: `recent:${term}:${index}`,
          payload: term,
        });
      });
    }
    globalSearchLocalSuggestions.forEach((entry) => {
      entries.push({ kind: "local", id: `local:${entry.key}`, payload: entry });
    });
    if (canRunGlobalCatalogSearch) {
      entries.push({ kind: "search_action", id: "search-action", payload: null });
    }
    if (globalSearchCommittedTerm && !globalSearchCatalogLoading && !globalSearchCatalogError) {
      globalSearchFilteredCatalogResults.slice(0, 10).forEach((entry, index) => {
        const key = String(entry?.marketHashName || entry?.displayName || `catalog-${index}`);
        entries.push({
          kind: "catalog",
          id: `catalog:${key}:${index}`,
          payload: entry,
        });
      });
    }
    return entries;
  }, [
    canRunGlobalCatalogSearch,
    globalSearchCatalogError,
    globalSearchCatalogLoading,
    globalSearchCommittedTerm,
    globalSearchFilteredCatalogResults,
    globalSearchLocalSuggestions,
    globalSearchRecentTerms,
    globalSearchTermNormalized,
  ]);
  const globalSearchActiveEntryId =
    globalSearchActiveIndex >= 0 && globalSearchActiveIndex < globalSearchKeyboardEntries.length
      ? globalSearchKeyboardEntries[globalSearchActiveIndex].id
      : null;

  const handleGlobalSearchSelectCatalogItem = useCallback(
    async (candidate) => {
      const marketHashName = String(candidate?.marketHashName || candidate?.displayName || "").trim();
      if (!marketHashName) {
        return;
      }
      const nameKey = normalizeSearchText(marketHashName);
      const known = globalSearchKnownPrimaryByName.get(nameKey) || null;
      if (known) {
        handleGlobalSearchSelectKnownItem(known);
        return;
      }
      await handleGlobalSearchAddToWatchlist(candidate);
    },
    [globalSearchKnownPrimaryByName, handleGlobalSearchAddToWatchlist, handleGlobalSearchSelectKnownItem],
  );

  const handleGlobalSearchExecuteKeyboardEntry = useCallback(
    async (entry) => {
      if (!entry) {
        return;
      }
      if (entry.kind === "local") {
        handleGlobalSearchSelectKnownItem(entry.payload);
        return;
      }
      if (entry.kind === "search_action") {
        openGlobalSearchBrowser(globalSearchTerm);
        return;
      }
      if (entry.kind === "recent") {
        openGlobalSearchBrowser(entry.payload);
        return;
      }
      if (entry.kind === "catalog") {
        await handleGlobalSearchSelectCatalogItem(entry.payload);
      }
    },
    [
      globalSearchTerm,
      handleGlobalSearchSelectCatalogItem,
      handleGlobalSearchSelectKnownItem,
      openGlobalSearchBrowser,
    ],
  );

  const handleGlobalSearchInputKeyDown = useCallback(
    (event) => {
      if (!globalSearchOpen) {
        return;
      }
      const totalEntries = globalSearchKeyboardEntries.length;
      if (event.key === "ArrowDown" && totalEntries > 0) {
        event.preventDefault();
        setGlobalSearchActiveIndex((current) => (current + 1 + totalEntries) % totalEntries);
        return;
      }
      if (event.key === "ArrowUp" && totalEntries > 0) {
        event.preventDefault();
        setGlobalSearchActiveIndex((current) => (current - 1 + totalEntries) % totalEntries);
        return;
      }
      if (event.key === "Enter" && globalSearchActiveIndex >= 0 && totalEntries > 0) {
        event.preventDefault();
        const entry = globalSearchKeyboardEntries[globalSearchActiveIndex];
        void handleGlobalSearchExecuteKeyboardEntry(entry);
        return;
      }
      if (
        event.key === "Enter" &&
        globalSearchTermNormalized.length === 0 &&
        globalSearchRecentTerms.length > 0 &&
        globalSearchActiveIndex < 0
      ) {
        event.preventDefault();
        setGlobalSearchActiveIndex(0);
      }
    },
    [
      globalSearchActiveIndex,
      globalSearchKeyboardEntries,
      globalSearchOpen,
      globalSearchRecentTerms.length,
      globalSearchTermNormalized.length,
      handleGlobalSearchExecuteKeyboardEntry,
    ],
  );

  useEffect(() => {
    if (!globalSearchOpen) {
      setGlobalSearchActiveIndex(-1);
      return;
    }
    if (globalSearchKeyboardEntries.length === 0) {
      setGlobalSearchActiveIndex(-1);
      return;
    }
    setGlobalSearchActiveIndex((current) =>
      current >= 0 && current < globalSearchKeyboardEntries.length ? current : 0,
    );
  }, [globalSearchKeyboardEntries, globalSearchOpen]);

  useEffect(() => {
    if (!globalSearchOpen || typeof document === "undefined") {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => globalSearchInputRef.current?.focus(), 50);

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setGlobalSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [globalSearchOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const target = portfolioChartCardRef.current;
    if (!target) {
      return undefined;
    }

    const desktopMediaQuery = window.matchMedia("(min-width: 1024px)");
    const updateMeasuredHeight = () => {
      if (!desktopMediaQuery.matches) {
        setWatchlistMoverCardHeight(null);
        return;
      }

      const nextHeight = Math.round(target.getBoundingClientRect().height);
      if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
        return;
      }

      setWatchlistMoverCardHeight((current) => (current === nextHeight ? current : nextHeight));
    };

    updateMeasuredHeight();

    let resizeObserver;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        updateMeasuredHeight();
      });
      resizeObserver.observe(target);
    }

    if (desktopMediaQuery.addEventListener) {
      desktopMediaQuery.addEventListener("change", updateMeasuredHeight);
    } else {
      desktopMediaQuery.addListener(updateMeasuredHeight);
    }
    window.addEventListener("resize", updateMeasuredHeight);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (desktopMediaQuery.removeEventListener) {
        desktopMediaQuery.removeEventListener("change", updateMeasuredHeight);
      } else {
        desktopMediaQuery.removeListener(updateMeasuredHeight);
      }
      window.removeEventListener("resize", updateMeasuredHeight);
    };
  }, [activeTab, portfolioLoading, scopedPortfolioHistory.length]);

  const liveItems = Number(stats.liveItemsCount || 0);
  const staleItems = Number(stats.staleLiveItemsCount || 0);
  const watchlistMoverPanelHeight = Number.isFinite(Number(watchlistMoverCardHeight))
    ? Math.min(Math.max(Number(watchlistMoverCardHeight), 340), 560)
    : null;

  // Price freshness is cron-owned: the web never live-fetches prices. This page
  // previously auto-called refresh-stale (a synchronous CSFloat lookup) whenever it
  // detected stale prices; that was removed so passive web reads make zero external
  // calls. The cron (backend/sync-prices.php) is the sole price updater.

  const fallbackRangeDeltaPercent = Number(chartTrendData?.deltaPercent);
  const fallbackRangeDeltaValue = Number(chartTrendData?.deltaValue);
  const latestHistorySnapshot = useMemo(() => {
    if (!Array.isArray(scopedPortfolioHistory) || scopedPortfolioHistory.length === 0) {
      return null;
    }

    for (let index = scopedPortfolioHistory.length - 1; index >= 0; index -= 1) {
      const entry = scopedPortfolioHistory[index];
      const value = Number(
        entry?.wert ??
          entry?.value ??
          entry?.priceEur ??
          entry?.price_eur ??
          entry?.price ??
          0,
      );
      if (Number.isFinite(value) && value > 0) {
        const invested = Number(
          entry?.invested ??
            entry?.investedValue ??
            entry?.invested_value ??
            entry?.totalInvested ??
            entry?.total_invested ??
            0,
        );
        const growthPercent = Number(
          entry?.growthPercent ??
            entry?.growth_percent ??
            entry?.percentChange ??
            entry?.percent_change,
        );
        const profitEuro = Number.isFinite(invested) ? value - invested : null;
        return {
          value,
          invested: Number.isFinite(invested) ? invested : null,
          growthPercent: Number.isFinite(growthPercent) ? growthPercent : null,
          profitEuro: Number.isFinite(profitEuro) ? profitEuro : null,
        };
      }
    }

    return null;
  }, [scopedPortfolioHistory]);
  const statsTotalValue = Number(stats.totalValue);
  const hasStatsTotalValue = Number.isFinite(statsTotalValue) && statsTotalValue > 0;
  const historyValue = Number(latestHistorySnapshot?.value);
  const hasHistoryValue = Number.isFinite(historyValue) && historyValue > 0;
  const shouldPreferHistorySummary = !hasStatsTotalValue && hasHistoryValue;
  const historyProfitEuro = Number(latestHistorySnapshot?.profitEuro);
  const historyGrowthPercent = Number(latestHistorySnapshot?.growthPercent);
  const hasHistoryProfitEuro = Number.isFinite(historyProfitEuro);
  const hasHistoryGrowthPercent = Number.isFinite(historyGrowthPercent);
  const portfolioTotalValueForDisplay =
    hasStatsTotalValue
      ? statsTotalValue
      : hasHistoryValue
        ? historyValue
        : 0;
  const headerPortfolioValue = hoveredChartData?.wert ?? portfolioTotalValueForDisplay;
  const statsProfitEuro = Number(stats.totalProfitEuro);
  const statsRoiPercent = Number(stats.totalRoiPercent);
  const hasStatsProfitEuro = Number.isFinite(statsProfitEuro);
  const hasStatsRoiPercent = Number.isFinite(statsRoiPercent);
  const hasRangeDeltaPercent = Number.isFinite(fallbackRangeDeltaPercent);
  const hasRangeDeltaValue = Number.isFinite(fallbackRangeDeltaValue);
  const defaultProfitEuro = shouldPreferHistorySummary && hasHistoryProfitEuro
    ? historyProfitEuro
    : hasStatsTotalValue && hasStatsProfitEuro
      ? statsProfitEuro
      : hasRangeDeltaValue
        ? fallbackRangeDeltaValue
        : hasStatsProfitEuro
          ? statsProfitEuro
          : 0;
  const defaultProfitPercent = shouldPreferHistorySummary && hasHistoryGrowthPercent
    ? historyGrowthPercent
    : hasStatsTotalValue && hasStatsRoiPercent
      ? statsRoiPercent
      : hasRangeDeltaPercent
        ? fallbackRangeDeltaPercent
        : hasStatsRoiPercent
          ? statsRoiPercent
          : 0;
  const headerPortfolioPercent = hoveredChartData?.growthPercent ?? defaultProfitPercent;
  const hoveredProfitEuro = Number(hoveredChartData?.profitEuro);
  const headerProfitEuro = hoveredChartData
    ? Number.isFinite(hoveredProfitEuro)
      ? hoveredProfitEuro
      : (headerPortfolioValue || 0) - Number(stats.totalInvested || 0)
    : defaultProfitEuro;
  const headerProfitPositive = headerProfitEuro >= 0;
  const headerPortfolioPositive = hoveredChartData
    ? headerProfitPositive
    : shouldPreferHistorySummary
      ? headerProfitPositive
      : (hasStatsProfitEuro ? statsProfitEuro >= 0 : Boolean(stats.isPositive));
  const csUpdateBannerVisibleHoursRaw = Number(csUpdatesMeta?.bannerVisibleHours);
  const csUpdateBannerVisibleHours = Number.isFinite(csUpdateBannerVisibleHoursRaw)
    ? Math.max(1, csUpdateBannerVisibleHoursRaw)
    : DEFAULT_CS_UPDATES_BANNER_VISIBLE_HOURS;
  const showCsUpdateBanner =
    !csUpdatesLoading &&
    Boolean(latestCsUpdate) &&
    Number.isFinite(latestCsUpdateAgeHours) &&
    latestCsUpdateAgeHours <= csUpdateBannerVisibleHours;
  const latestCsUpdateImpact = useMemo(
    () => deriveCsUpdateImpact(latestCsUpdate),
    [latestCsUpdate],
  );
  const latestCsUpdateBannerTone = useMemo(
    () => getCsUpdateBannerTone(latestCsUpdateImpact.level),
    [latestCsUpdateImpact.level],
  );
  const latestCsUpdateAiModelLabel = String(latestCsUpdate?.aiModel || "").trim();
  const hasUrgentCsUpdate =
    showCsUpdateBanner &&
    (latestCsUpdateImpact.level === "high" ||
      (Number.isFinite(latestCsUpdateAgeHours) && latestCsUpdateAgeHours <= 24));
  const hasUnreadCsUpdate =
    hasUrgentCsUpdate &&
    String(latestCsUpdate?.id || "") !== "" &&
    String(latestCsUpdate?.id || "") !== String(seenCsUpdateId || "");
  const markLatestCsUpdateSeen = useCallback(() => {
    const latestId = String(latestCsUpdate?.id || "").trim();
    if (!latestId) {
      return;
    }
    setSeenCsUpdateId(latestId);
    writeLastSeenCsUpdateId(latestId);
  }, [latestCsUpdate?.id]);
  const handleOpenLatestCsUpdateFeed = useCallback(() => {
    const latestId = String(latestCsUpdate?.id || "").trim();
    markLatestCsUpdateSeen();
    if (!latestId) {
      navigate("/cs-updates");
      return;
    }
    navigate(`/cs-updates?item=${encodeURIComponent(latestId)}`);
  }, [latestCsUpdate?.id, markLatestCsUpdateSeen, navigate]);

  const freshBanWaveItem = useMemo(() => {
    if (!csUpdatesItems || csUpdatesFreshItemIds.length === 0) return null;
    return (
      csUpdatesItems.find(
        (item) => item.source === "ban_wave_detected" && csUpdatesFreshItemIds.includes(item.id),
      ) ?? null
    );
  }, [csUpdatesItems, csUpdatesFreshItemIds]);

  // Don't show a separate banner if the main CS update banner already shows this item
  const showBanWaveBanner =
    Boolean(freshBanWaveItem) &&
    !(showCsUpdateBanner && String(latestCsUpdate?.id) === String(freshBanWaveItem?.id));

  const handleOpenBanWaveFeed = useCallback(() => {
    if (!freshBanWaveItem?.id) {
      navigate("/cs-updates");
      return;
    }
    navigate(`/cs-updates?item=${encodeURIComponent(String(freshBanWaveItem.id))}`);
  }, [freshBanWaveItem?.id, navigate]);

  useEffect(() => {
    if (!freshBanWaveItem || !isDesktopRuntime) return;
    if (!portfolioPreferences.notifyBanWaveDesktop) return;

    const lastNotifiedId = localStorage.getItem(BAN_WAVE_NOTIFIED_KEY) || "";
    if (String(freshBanWaveItem.id) === lastNotifiedId) return;

    // Check impact level against minimum threshold
    const impactOrder = { none: 0, low: 1, medium: 2, high: 3 };
    const itemLevel = impactOrder[String(freshBanWaveItem.aiImpactLevel || "").toLowerCase()] ?? 1;
    const minLevel = impactOrder[portfolioPreferences.notifyBanWaveDesktopMinLevel] ?? 0;
    if (itemLevel < minLevel) {
      localStorage.setItem(BAN_WAVE_NOTIFIED_KEY, String(freshBanWaveItem.id));
      return;
    }

    const trigger = async () => {
      try {
        const user = await getCurrentUser();
        const userId = resolveDesktopRuntimeUserId(user, 1);
        if (window.electronAPI?.localStore?.createNotification) {
          await window.electronAPI.localStore.createNotification({
            userId,
            category: "cs_updates",
            title: "VAC Ban-Welle erkannt",
            message: freshBanWaveItem.title || "Erhöhte Ban-Aktivität in CS2",
            payload: { source: "ban_wave", itemId: freshBanWaveItem.id },
            createdAt: freshBanWaveItem.publishedAt || new Date().toISOString(),
          });
        }
      } catch {
        // non-critical
      }
      if (typeof window.Notification !== "undefined" && Notification.permission === "granted") {
        new window.Notification("VAC Ban-Welle erkannt", {
          body: freshBanWaveItem.title || "Erhöhte Ban-Aktivität in CS2 — Marktbewegung möglich",
        });
      }
      localStorage.setItem(BAN_WAVE_NOTIFIED_KEY, String(freshBanWaveItem.id));
    };

    void trigger();
  }, [freshBanWaveItem, isDesktopRuntime, portfolioPreferences.notifyBanWaveDesktop, portfolioPreferences.notifyBanWaveDesktopMinLevel]);

  const portfolioValueLabel = formatPrice(portfolioTotalValueForDisplay, {
    useUsd: true,
    buyPriceUsd: portfolioTotalValueForDisplay,
  });
  const formatUsdPrice = useCallback(
    (value, decimals = 2) =>
      formatPrice(Number(value || 0), {
        useUsd: true,
        buyPriceUsd: Number(value || 0),
        decimals,
      }),
    [formatPrice],
  );
  const headerPortfolioValueLabel = formatPrice(headerPortfolioValue || 0, {
    useUsd: true,
    buyPriceUsd: headerPortfolioValue || 0,
  });
  const headerProfitPercent = hoveredChartData
    ? Number(headerPortfolioPercent || 0)
    : defaultProfitPercent;
  const headerProfitSubLabel = hoveredChartData?.date
    ? formatDateSafe(hoveredChartData.date)
    : shouldPreferHistorySummary || (hasStatsTotalValue && hasStatsRoiPercent)
      ? "ROI gesamt"
      : `ROI ${String(chartTrendData?.rangeLabel || "90T")}`;
  const managementClusters = buildManagementClusters(managementInvestments);
  const managementInvestmentById = new Map(
    managementInvestments.map((item) => [String(item.id), item]),
  );
  const portfolioGroupSummaries = useMemo(
    () =>
      buildPortfolioGroupSummaries({
        groups: portfolioGroups,
        clusteredInvestments: enrichedInvestments,
        rawInvestments: managementInvestments,
      }),
    [enrichedInvestments, managementInvestments, portfolioGroups],
  );
  const portfolioGroupSummaryById = useMemo(
    () => new Map(portfolioGroupSummaries.map((group) => [String(group.id), group])),
    [portfolioGroupSummaries],
  );
  const portfolioGroupMembershipMap = useMemo(
    () => buildPortfolioGroupMembershipMap(portfolioGroups),
    [portfolioGroups],
  );
  const portfolioGroupsById = useMemo(
    () => new Map(portfolioGroups.map((group) => [String(group.id), group])),
    [portfolioGroups],
  );
  const managementGroupsByClusterKey = useMemo(() => {
    const map = new Map();
    managementClusters.forEach((cluster) => {
      map.set(
        cluster.key,
        summarizeManagementClusterAssignment(cluster, portfolioGroupMembershipMap, portfolioGroupsById),
      );
    });
    return map;
  }, [managementClusters, portfolioGroupMembershipMap, portfolioGroupsById]);
  const managementSearchQuery = normalizeSearchText(managementSearchTerm);
  const filteredManagementClusters = (() => {
    let rows = [...managementClusters];

    if (managementFilter === "excluded") {
      rows = rows.filter((cluster) => cluster.excludedCount > 0);
    } else if (managementFilter === "active") {
      rows = rows.filter((cluster) => cluster.activeCount > 0);
    }

    if (managementTypeFilter !== "all") {
      rows = rows.filter((cluster) => String(cluster.type || "").toLowerCase() === managementTypeFilter);
    }

    if (managementBucketFilter !== "all") {
      rows = rows.filter((cluster) =>
        cluster.positions.some((position) => normalizeBucket(position.bucket) === managementBucketFilter),
      );
    }

    if (managementSearchQuery) {
      rows = rows.filter((cluster) =>
        normalizeSearchText(cluster.name).includes(managementSearchQuery) ||
        cluster.positions.some((position) => normalizeSearchText(position.externalTradeId).includes(managementSearchQuery)),
      );
    }

    rows.sort((left, right) => {
      if (managementSortBy === "name_desc") {
        return right.name.localeCompare(left.name, "de");
      }
      if (managementSortBy === "qty_desc") {
        return right.totalCount - left.totalCount || left.name.localeCompare(right.name, "de");
      }
      if (managementSortBy === "qty_asc") {
        return left.totalCount - right.totalCount || left.name.localeCompare(right.name, "de");
      }
      if (managementSortBy === "updated_desc") {
        return getClusterUpdatedAt(right) - getClusterUpdatedAt(left) || left.name.localeCompare(right.name, "de");
      }
      return left.name.localeCompare(right.name, "de");
    });
    return rows;
  })();
  const groupSearchQuery = normalizeSearchText(groupSearchTerm);
  const filteredGroupManagementClusters = useMemo(() => {
    let rows = [...managementClusters];

    if (groupSearchQuery) {
      rows = rows.filter((cluster) => {
        const assignment = managementGroupsByClusterKey.get(cluster.key);
        return (
          normalizeSearchText(cluster.name).includes(groupSearchQuery) ||
          normalizeSearchText(assignment?.assignedGroupName || "").includes(groupSearchQuery) ||
          cluster.positions.some((position) =>
            normalizeSearchText(position.externalTradeId).includes(groupSearchQuery),
          )
        );
      });
    }

    rows.sort((left, right) => {
      if (groupSortBy === "updated_desc") {
        return getClusterUpdatedAt(right) - getClusterUpdatedAt(left) || left.name.localeCompare(right.name, "de");
      }
      return left.name.localeCompare(right.name, "de");
    });
    return rows;
  }, [groupSearchQuery, groupSortBy, managementClusters, managementGroupsByClusterKey]);
  const managementTypeOptions = (() => {
    const uniqueTypes = Array.from(
      new Set(
        managementClusters
          .map((cluster) => String(cluster.type || "").trim().toLowerCase())
          .filter(Boolean),
      ),
    );
    uniqueTypes.sort((left, right) => left.localeCompare(right, "de"));
    return uniqueTypes;
  })();
  const portfolioGroupEditor = portfolioGroups.find((group) => group.id === portfolioGroupEditorId) || null;
  const globalSearchGroupSuggestions = useMemo(() => {
    if (!globalSearchTermNormalized) {
      return [];
    }

    return portfolioGroups
      .map((group) => {
        const summary = portfolioGroupSummaryById.get(String(group.id)) || null;
        const searchText = normalizeSearchText(
          [group.name, group.thesis, summary?.clusters?.map((cluster) => cluster.name).join(" ")]
            .filter(Boolean)
            .join(" "),
        );
        if (!searchText.includes(globalSearchTermNormalized)) {
          return null;
        }

        return {
          ...group,
          summary,
          searchText,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const leftValue = Number(left?.summary?.totalValue || 0);
        const rightValue = Number(right?.summary?.totalValue || 0);
        return rightValue - leftValue || String(left.name || "").localeCompare(String(right.name || ""), "de");
      })
      .slice(0, 8);
  }, [globalSearchTermNormalized, portfolioGroupSummaryById, portfolioGroups]);
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
  const confirmedOrAutoMatchedSteamKeys = new Set(
    Array.from(confirmedOrAutoMatchByCsfloatId.values())
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  const matchingSearchQuery = normalizeSearchText(matchingSearchTerm);
  const matchingDisplayRows = showMatchedMatchingRows
    ? matchingRows.filter((row) => {
      const status = String(row?.status || "").toLowerCase();
      return status === "suggested" || status === "manual_confirmed" || status === "auto_linked";
    })
    : pendingMatchingRows;
  const filteredMatchingRows = (() => {
    let rows = [...matchingDisplayRows];
    if (matchingSearchQuery) {
      rows = rows.filter((row) => {
        const steamItem = managementInvestmentById.get(String(row?.steamAssetId || ""));
        const csfloatItem = managementInvestmentById.get(String(row?.csfloatInvestmentId || ""));
        return [
          row?.steamItemName,
          row?.csfloatItemName,
          steamItem?.name,
          csfloatItem?.name,
          row?.reason,
        ].some((value) => normalizeSearchText(value).includes(matchingSearchQuery));
      });
    }

    if (matchingConfidenceFilter !== "all") {
      rows = rows.filter(
        (row) => String(row?.confidence || "").toLowerCase() === matchingConfidenceFilter,
      );
    }

    rows.sort((left, right) => {
      const leftScore = Number(left?.matchScore || 0);
      const rightScore = Number(right?.matchScore || 0);

      if (matchingSortBy === "score_asc") {
        return leftScore - rightScore;
      }
      if (matchingSortBy === "newest") {
        return Date.parse(String(right?.createdAt || "")) - Date.parse(String(left?.createdAt || ""));
      }
      return rightScore - leftScore;
    });
    return rows;
  })();
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
  const watchlistTopMovers = useMemo(() => {
    const rows = (Array.isArray(dashboardWatchlistItems) ? dashboardWatchlistItems : [])
      .map((item) => ({
        ...item,
        moverId: String(item?.id || "").trim(),
        changePercentValue: resolveWatchlistChangePercent(item),
      }))
      .filter((item) => item.moverId !== "" && Number.isFinite(item.changePercentValue));

    const allGainers = rows
      .filter((item) => item.changePercentValue > 0)
      .sort((left, right) => right.changePercentValue - left.changePercentValue)
      ;
    const allLosers = rows
      .filter((item) => item.changePercentValue < 0)
      .sort((left, right) => left.changePercentValue - right.changePercentValue)
      ;
    const gainers = allGainers.slice(0, 2);
    const losers = allLosers.slice(0, 2);
    const usedIds = new Set([...gainers, ...losers].map((item) => item.moverId));
    const remainingSlots = Math.max(0, 8 - (gainers.length + losers.length));
    const extras = rows
      .filter((item) => !usedIds.has(item.moverId))
      .sort((left, right) => Math.abs(right.changePercentValue) - Math.abs(left.changePercentValue))
      .slice(0, remainingSlots);

    return {
      gainers,
      losers,
      extras,
      sourceCount: rows.length,
      hasAny: rows.length > 0,
    };
  }, [dashboardWatchlistItems]);
  const steamInventoryItemsAll = managementInvestments.filter((item) => {
    const platform = String(item.platform || item.source || "").toLowerCase();
    return platform === "steam_inventory" || Boolean(item.steamAssetId);
  });
  const rawSteamInventoryItems = steamInventoryItemsAll.filter((item) => {
    const matchKeys = [
      String(item?.id || "").trim(),
      String(item?.steamAssetId || "").trim(),
      String(item?.externalTradeId || "").trim(),
    ].filter(Boolean);
    return !matchKeys.some((key) => confirmedOrAutoMatchedSteamKeys.has(key));
  });
  const matchedSteamInventoryItemsCount = Math.max(0, steamInventoryItemsAll.length - rawSteamInventoryItems.length);
  const priceSearchQuery = normalizeSearchText(priceSearchTerm);
  const filteredPriceItems = (() => {
    let rows = [...rawSteamInventoryItems];

    if (priceMissingOnly) {
      rows = rows.filter((item) => {
        const price = Number(item.buyPriceUsd ?? item.buyPrice ?? 0);
        return !Number.isFinite(price) || price <= 0;
      });
    }

    if (priceSearchQuery) {
      rows = rows.filter((item) => normalizeSearchText(item.name).includes(priceSearchQuery));
    }

    rows.sort((left, right) => {
      const leftPrice = Number(left.buyPriceUsd ?? left.buyPrice ?? 0);
      const rightPrice = Number(right.buyPriceUsd ?? right.buyPrice ?? 0);
      const leftQuantity = Number(left.quantity || 0);
      const rightQuantity = Number(right.quantity || 0);

      if (priceSortBy === "name_desc") {
        return String(right.name || "").localeCompare(String(left.name || ""), "de");
      }
      if (priceSortBy === "price_desc") {
        return rightPrice - leftPrice;
      }
      if (priceSortBy === "price_asc") {
        return leftPrice - rightPrice;
      }
      if (priceSortBy === "qty_desc") {
        return rightQuantity - leftQuantity;
      }
      return String(left.name || "").localeCompare(String(right.name || ""), "de");
    });
    return rows;
  })();
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
  const priceMissingCount = rawSteamInventoryItems.filter((item) => {
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
    const normalizedPrice = Number(nextPrice.toFixed(2));

    setSavingPriceItemId(item.id);
    try {
      await window.electronAPI.localStore.upsertInvestment({
        ...item,
        id: item.id,
        buyPriceUsd: normalizedPrice,
        buyPrice: normalizedPrice,
        priceSetMode: "user_confirmed",
        platform: "steam_inventory",
        source: "steam_inventory",
      });
      setManagementInvestments((current) =>
        current.map((entry) =>
          String(entry?.id || "") === String(item?.id || "")
            ? {
                ...entry,
                buyPriceUsd: normalizedPrice,
                buyPrice: normalizedPrice,
                priceSetMode: "user_confirmed",
              }
            : entry,
        ),
      );
      setPriceDrafts((current) => ({
        ...current,
        [item.id]: normalizedPrice > 0 ? normalizedPrice.toFixed(2) : "",
      }));
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
    if (key === "name") {
      const nextName = normalizeSearchText(value);
      const selectedName = normalizeSearchText(manualSelectedSuggestion?.marketHashName || "");
      if (nextName !== selectedName) {
        setManualSelectedSuggestion(null);
      }
      setManualNameSuggestionsError("");
    }
    if (key === "type") {
      setManualSelectedSuggestion(null);
      setManualNameSuggestionsError("");
    }
    setManualItemDraft((current) => ({
      ...current,
      [key]: value,
    }));
  };
  const handleManualSuggestionPick = (candidate) => {
    if (!candidate) {
      return;
    }

    setManualSelectedSuggestion(candidate);
    setManualNameSuggestions([]);
    setManualNameSuggestionsError("");
    setManualItemDraft((current) => ({
      ...current,
      name: String(candidate.marketHashName || candidate.displayName || current.name || "").trim(),
      type: String(candidate.itemType || current.type || "skin").trim().toLowerCase() || "skin",
    }));
  };
  const handleCreateManualInvestment = async () => {
    if (!window.electronAPI?.localStore?.upsertInvestment) {
      return;
    }

    const normalizedManualName = normalizeSearchText(manualItemDraft.name);
    const exactSuggestion = manualNameSuggestions.find(
      (candidate) => normalizeSearchText(candidate?.marketHashName || "") === normalizedManualName,
    );
    const chosenSuggestion = manualSelectedSuggestion || exactSuggestion || null;
    const name = String(
      chosenSuggestion?.marketHashName ||
      chosenSuggestion?.displayName ||
      manualItemDraft.name ||
      "",
    ).trim();
    const quantity = Number(manualItemDraft.quantity);
    const buyPriceUsd = Number(manualItemDraft.buyPriceUsd);
    const bucket = manualItemDraft.bucket === "inventory" ? "inventory" : "investment";
    const platform = String(manualItemDraft.platform || "manual").trim().toLowerCase() || "manual";
    const fundingMode =
      String(manualItemDraft.fundingMode || "wallet_funded").trim().toLowerCase() === "balance_funded"
        ? "balance_funded"
        : "wallet_funded";
    const type = String(chosenSuggestion?.itemType || manualItemDraft.type || "skin").trim().toLowerCase() || "skin";
    const suggestionImageUrl = String(chosenSuggestion?.iconUrl || "").trim() || null;

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
        imageUrl: suggestionImageUrl,
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
      setManualSelectedSuggestion(null);
      setManualNameSuggestions([]);
      setManualNameSuggestionsError("");
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
      return "w-full rounded-xl border border-emerald-400/35 bg-emerald-500/12 px-2 py-2 text-left hover:bg-emerald-500/18";
    }
    if (appUpdateState === "downloading") {
      return "w-full rounded-xl border border-blue-400/35 bg-blue-500/12 px-2 py-2 text-left hover:bg-blue-500/18";
    }
    if (appUpdateState === "available") {
      return "w-full rounded-xl border border-amber-400/35 bg-amber-500/12 px-2 py-2 text-left hover:bg-amber-500/18";
    }
    if (appUpdateState === "error") {
      return "w-full rounded-xl border border-destructive/60 bg-destructive/12 px-2 py-2 text-left hover:bg-destructive/20";
    }
    return "w-full rounded-xl border border-border/70 bg-card/70 px-2 py-2 text-left hover:bg-accent/70";
  })();
  const appUpdateHintLabel = (() => {
    if (appUpdateState === "downloaded") {
      return "Klick: Jetzt updaten.";
    }
    if (appUpdateState === "downloading") {
      return "Download laeuft im Hintergrund.";
    }
    if (appUpdateState === "available") {
      return "Klick: Jetzt updaten oder spaeter.";
    }
    if (appUpdateState === "error") {
      return "Klick: Fehlerdetails ansehen.";
    }
    return "Klick: Update-Status ansehen.";
  })();
  const hasVisibleAppUpdateNotification = ["available", "downloading", "downloaded", "error"].includes(appUpdateState);
  const hasUnreadAppUpdate =
    appUpdateUnread && ["available", "downloading", "downloaded", "error"].includes(appUpdateState);
  const handleUiWarningsChange = useCallback((sourceKey, sourceLabel, nextWarnings = []) => {
    const mappedNotifications = mapWarningsToNotifications(nextWarnings, {
      sourceKey,
      sourceLabel,
    });

    setUiWarningNotificationsBySource((current) => {
      if (mappedNotifications.length === 0) {
        if (!current[sourceKey]) {
          return current;
        }
        const nextState = { ...current };
        delete nextState[sourceKey];
        return nextState;
      }

      return {
        ...current,
        [sourceKey]: mappedNotifications,
      };
    });
  }, []);
  const handleWatchlistWarningsChange = useCallback((nextWarnings = []) => {
    handleUiWarningsChange("watchlist-live", "Watchlist", nextWarnings);
  }, [handleUiWarningsChange]);
  const portfolioWarningNotifications = useMemo(
    () => mapWarningsToNotifications(warnings, { sourceKey: "portfolio", sourceLabel: "Portfolio" }),
    [warnings],
  );
  const uiWarningNotifications = useMemo(
    () => Object.values(uiWarningNotificationsBySource).flat(),
    [uiWarningNotificationsBySource],
  );
  const warningNotifications = useMemo(() => {
    const uniqueById = new Map();
    [...portfolioWarningNotifications, ...uiWarningNotifications].forEach((entry) => {
      uniqueById.set(entry.id, entry);
    });
    return Array.from(uniqueById.values());
  }, [portfolioWarningNotifications, uiWarningNotifications]);
  const unreadNotificationCount =
    syncNotification.newItemsCount +
    (hasUnreadAppUpdate ? 1 : 0) +
    (hasUnreadCsUpdate ? 1 : 0) +
    (warningNotifications.length > 0 ? 1 : 0);
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
  const unreadSteamSyncNotifications = useMemo(
    () => syncNotifications.filter((entry) => entry.category === "steam_sync" && entry.unread),
    [syncNotifications],
  );
  const handleNotificationClick = async (entry) => {
    if (window.electronAPI?.localStore?.markNotificationRead) {
      await window.electronAPI.localStore.markNotificationRead(entry.id);
    }
    setSyncNotifications((current) =>
      current.map((item) => (item.id === entry.id ? { ...item, unread: false, readAt: new Date().toISOString() } : item)),
    );
    setSyncNotification((current) => ({
      ...current,
      newItemsCount: Math.max(0, Number(current.newItemsCount || 0) - 1),
    }));
    const target = resolveNotificationActionTarget();
    setActiveTab("management");
    setManagementSection(target.section);
    navigate("/?tab=management", { replace: true });
    setCompositionRefreshToken((current) => current + 1);
  };
  const handleMarkAllSteamNotificationsRead = async () => {
    const user = await getCurrentUser();
    const userId = resolveDesktopRuntimeUserId(user, 1);
    if (window.electronAPI?.localStore?.markAllNotificationsRead) {
      await window.electronAPI.localStore.markAllNotificationsRead(userId, "steam_sync");
    }
    setSyncNotifications((current) =>
      current.map((entry) =>
        entry.category === "steam_sync" && entry.unread
          ? { ...entry, unread: false, readAt: new Date().toISOString() }
          : entry,
      ),
    );
    setSyncNotification((current) => ({
      ...current,
      newItemsCount: 0,
    }));
    setCompositionRefreshToken((current) => current + 1);
  };
  const handleAppUpdateInstall = async () => {
    if (!window.electronAPI?.updater?.install) {
      return;
    }
    await window.electronAPI.updater.install();
  };
  const runAppUpdateDownload = async () => {
    if (!window.electronAPI?.updater?.download) {
      window.alert(`${appUpdateVersionLabel} ist verfuegbar.`);
      return;
    }

    const result = await window.electronAPI.updater.download();
    if (!result || result.ok !== false) {
      return;
    }
    if (result.reason === "no-update-info") {
      window.alert(
        `${appUpdateVersionLabel}: Updater-Metadaten sind noch nicht bereit. Bitte in ein paar Sekunden erneut versuchen.`,
      );
      return;
    }
    if (result.reason === "not-packaged") {
      window.alert("Updates sind nur in der installierten Desktop-App verfuegbar.");
      return;
    }
    window.alert(String(result.error || "Update-Download konnte nicht gestartet werden."));
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
      await runAppUpdateDownload();
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
        {showCsUpdateBanner && latestCsUpdate ? (
          <button
            type="button"
            onClick={() => {
              markLatestCsUpdateSeen();
              navigate("/cs-updates");
            }}
            className="w-full rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-2 py-2 text-left hover:bg-cyan-500/15"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">CS Update Feed</p>
              {hasUnreadCsUpdate ? (
                <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  neu
                </span>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {latestCsUpdateImpact.label} - {latestCsUpdateImpact.actionLabel}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">{latestCsUpdate.title}</p>
          </button>
        ) : null}

        {warningNotifications.length > 0 ? (
          <div className="rounded-xl border border-amber-400/35 bg-amber-500/12 p-2">
            <p className="text-xs font-semibold">Systemhinweise</p>
            <div className="mt-1.5 space-y-1.5">
              {warningNotifications.slice(0, 4).map((entry) => (
                <div key={entry.id} className="rounded-lg border border-amber-300/25 bg-amber-500/8 px-2 py-1.5">
                  <p className="text-sm">{entry.message}</p>
                  {entry.meta ? (
                    <p className="text-[11px] text-amber-200/80">{entry.meta}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-md border p-2">
          <p className="text-xs font-semibold">Neue Steam Items</p>
          {syncNotification.newItemsCount > 0 ? (
            <div className="mt-1 space-y-1">
              {unreadSteamSyncNotifications.slice(0, 5).map((entry) => (
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
          ) : null}
          {manualSteamSyncInfo ? (
            <p className="mt-1 text-[11px] text-muted-foreground">{manualSteamSyncInfo}</p>
          ) : null}
          {unreadSteamSyncNotifications.length > 0 ? (
            <div className="mt-2">
              <Button size="sm" variant="ghost" onClick={() => void handleMarkAllSteamNotificationsRead()}>
                Alle als gelesen
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
  const csFloatKeySkipped = Boolean(journeyState?.csfloatKeySkippedAt);
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
      label: hasCsFloatKey
        ? "CSFloat API Key hinterlegt"
        : csFloatKeySkipped
          ? "CSFloat ohne Key uebersprungen"
          : "CSFloat API Key entschieden",
      done: hasCsFloatKey || csFloatKeySkipped,
    },
    {
      id: "csfloat_import",
      label: "CSFloat-Import entschieden",
      done: Boolean(journeyState?.csfloatImportCompletedAt || journeyState?.csfloatImportSkippedAt || csFloatKeySkipped),
    },
    {
      id: "push_notifications",
      label: "Push-Benachrichtigung entschieden",
      done: Boolean(journeyState?.pushPreferenceSetAt),
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
  const normalizedServerSetupHost = normalizeServerHostInput(serverSetup.serverUrl || "");
  const mobileCompanionSetupUrl = useMemo(() => {
    if (!normalizedServerSetupHost) {
      return "";
    }
    const isLocalHost =
      normalizedServerSetupHost === "localhost" ||
      normalizedServerSetupHost.startsWith("127.") ||
      normalizedServerSetupHost.startsWith("192.168.") ||
      normalizedServerSetupHost.startsWith("10.");
    const protocol = isLocalHost ? "http" : "https";
    return `${protocol}://${normalizedServerSetupHost}/#/settings?settingsTab=general&section=push-notifications`;
  }, [normalizedServerSetupHost]);
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
  const handleMarkCsFloatKeySkipped = async () => {
    const now = new Date().toISOString();
    await updateJourneyState({
      csfloatKeySkippedAt: now,
      csfloatImportSkippedAt: journeyState?.csfloatImportSkippedAt || now,
      currentStepId: resolveNextJourneyStepId("csfloat_import"),
    });
    setJourneyApiKey("");
    setJourneyApiKeyError("");
    setJourneyApiKeySuccess("CSFloat wurde uebersprungen. Du kannst spaeter in den Einstellungen einen Key hinterlegen.");
    setJourneyApiKeyHelper("");
  };
  const handleGoNextJourneyStep = async () => {
    if (!journeyStarted || activeJourneyStepId === "intro") {
      return;
    }
    if (activeJourneyStepId === "csfloat_key" && !hasCsFloatKey) {
      await handleMarkCsFloatKeySkipped();
      return;
    }
    if (activeJourneyStepId === "push_notifications" && !journeyState?.pushPreferenceSetAt) {
      await handleSetJourneyPushPreference(false);
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
  const handleSetJourneyPushPreference = async (enabled) => {
    await updateJourneyState({
      pushNotificationsWanted: Boolean(enabled),
      pushPreferenceSetAt: new Date().toISOString(),
      currentStepId: resolveNextJourneyStepId("push_notifications"),
    });
  };
  const handleOpenMobileCompanionPushSetup = async () => {
    if (!mobileCompanionSetupUrl) {
      return;
    }
    if (window.electronAPI?.openExternal) {
      await window.electronAPI.openExternal(mobileCompanionSetupUrl);
      return;
    }
    if (typeof window !== "undefined" && window.open) {
      window.open(mobileCompanionSetupUrl, "_blank", "noopener,noreferrer");
    }
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
          csfloatKeySkippedAt: null,
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

  // Keep this return after all hooks. Returning before the other hooks run changes
  // hook order after login and triggers React's minified error #310.
  if (isElectronRuntime && showStartupWelcome) {
    return (
      <div className="steam-startup-shell steam-startup-shell-overlay flex items-center justify-center overflow-auto p-4">
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

  const useDesktopSidebarShell = !showSetupJourney;
  const renderLocalDesktopSidebar = useDesktopSidebarShell && !useExternalDesktopSidebarShell;

  return (
    <div
      className={`${isElectronRuntime ? "h-full box-border" : "min-h-screen"} ${
        renderLocalDesktopSidebar
          ? "lg:h-full lg:min-h-0 lg:overflow-hidden"
          : ""
      } ${
        showSetupJourney && useExternalDesktopSidebarShell ? "lg:-ml-6 lg:w-[calc(100%+1.5rem)]" : ""
      } font-sans text-foreground pb-[calc(8.5rem+env(safe-area-inset-bottom))] md:pb-0 touch-pan-y ${
        showSetupJourney ? "steam-startup-shell" : "bg-background"
      }`}
    >
      <div
        className={
          showSetupJourney
            ? "mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 pb-12 pt-8 sm:p-8"
            : useDesktopSidebarShell
              ? "flex w-full flex-col gap-6 px-3.5 pb-6 pt-3 sm:gap-8 sm:p-6 md:p-8 lg:h-full lg:min-h-0 lg:gap-0 lg:p-0"
              : "mx-auto flex max-w-7xl flex-col gap-6 px-3.5 pb-6 pt-3 sm:gap-8 sm:p-6 md:p-8"
        }
      >
        {!showSetupJourney ? (
          <>
            {/* Mobile Header - nur auf Mobile sichtbar */}
            <header className="flex items-center justify-between pt-[max(0.35rem,env(safe-area-inset-top))] sm:hidden">
              <div className="flex items-end gap-3">
                <h1 className="text-[1.9rem] font-extrabold leading-none tracking-tight text-foreground">Portfolio</h1>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="relative h-10 w-10 rounded-full border-border/80 bg-card/75 p-0">
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
                <h1 className="text-2xl font-extrabold tracking-tight text-foreground md:text-3xl">Portfolio</h1>
                <p className="text-sm text-muted-foreground md:text-base">Investments, Inventar und Watchlist</p>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="relative h-11 w-11 rounded-full border-border/80 bg-card/75 p-0">
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
          </>
        ) : null}
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
          <Card className="steam-journey-card relative overflow-hidden border-white/15 bg-slate-950/58 text-slate-100 shadow-2xl backdrop-blur-xl">
            <CardHeader className="space-y-2 pb-3">
              <CardTitle className="text-2xl tracking-tight text-slate-50">
                Setup Journey{journeyUserName ? ` fuer ${journeyUserName}` : ""}
              </CardTitle>
              <p className="text-sm text-slate-300">
                Wir teilen alles in klare Schritte auf. Du kannst spaeter in den Einstellungen jeden Punkt wieder aendern.
              </p>
            </CardHeader>
            <CardContent className="space-y-6 text-sm">
              {showStartupAutoSyncEmptyHint ? (
                <div className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">
                  Keine neuen Steam Items beim letzten Auto-Sync.
                </div>
              ) : null}
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
                    Reihenfolge: Login, Server, Steam-Importziel, CSFloat-Key, CSFloat-Import, Push, Matching, Verwaltung.
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
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                            <option value="inventory">Inventar einsortieren</option>
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
                        <div className="space-y-1">
                          <label className="text-xs text-slate-300">SkinBaron-Import</label>
                          <select
                            className="h-10 w-full rounded-md border border-white/20 bg-slate-900/65 px-3 text-sm text-slate-100"
                            value={portfolioPreferences.skinBaronImportBucket}
                            onChange={async (event) => {
                              const updated = await updatePortfolioPreferences({
                                skinBaronImportBucket: event.target.value,
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
                            onClick={() => void handleRefreshCsFloatStatus()}
                          >
                            Status aktualisieren
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-cyan-100 hover:bg-white/10 hover:text-white"
                            onClick={() => void handleMarkCsFloatKeySkipped()}
                          >
                            Ohne CSFloat weiter
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
                  {activeJourneyStepId === "push_notifications" ? (
                    <div className="space-y-4 rounded-xl border border-white/15 bg-white/5 p-4">
                      <div>
                        <p className="font-semibold text-slate-100">5. Push-Benachrichtigungen fuer CS-Updates</p>
                        <p className="mt-1 text-xs text-slate-300">
                          Browser Push ist fuer Mobile gedacht. In Electron reicht der integrierte Feed, daher aktivierst du Push am besten im Mobile Companion.
                        </p>
                      </div>
                      <div className="rounded-md border border-cyan-300/25 bg-cyan-500/10 p-3 text-xs text-cyan-100">
                        Empfehlung: Server auf dem Handy oeffnen, einloggen und unter Einstellungen - Allgemein Browser Push aktivieren.
                      </div>
                      {mobileCompanionSetupUrl ? (
                        <div className="rounded-md border border-white/15 bg-slate-900/40 p-3 text-xs text-slate-200">
                          Server-Link fuer Mobile Setup:{" "}
                          <span className="font-mono text-[11px] text-cyan-200">{mobileCompanionSetupUrl}</span>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={() => void handleSetJourneyPushPreference(false)}>
                          Ohne Push weiter (Standard)
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-white/30 bg-slate-900/35 text-slate-100 hover:bg-white/10"
                          onClick={async () => {
                            await handleOpenMobileCompanionPushSetup();
                            await handleSetJourneyPushPreference(true);
                          }}
                        >
                          Mobile Push einrichten (Server oeffnen)
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {activeJourneyStepId === "matching" ? (
                    <div className="space-y-4 rounded-xl border border-white/15 bg-white/5 p-4">
                      <div>
                        <p className="font-semibold text-slate-100">6. Steam und CSFloat Matching pruefen</p>
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
                        <p className="font-semibold text-slate-100">7. Verwaltung kurz erklaert</p>
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
                          <p className="mt-1 text-xs text-slate-300">Fehlende Einkaufspreise schnell nachpflegen.</p>
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
        <div
          className={
            renderLocalDesktopSidebar
              ? "w-full lg:grid lg:min-h-0 lg:grid-cols-[92px_minmax(0,1fr)] lg:gap-6 lg:px-0 xl:px-0"
              : "w-full"
          }
        >
          {renderLocalDesktopSidebar ? (
            <aside className="hidden lg:flex lg:justify-center lg:pt-2">
              <div className="tr-desktop-rail h-[98vh] w-[92px] overflow-hidden rounded-2xl">
                <div className="flex h-full flex-col items-center py-4">
                  <nav className="flex w-full flex-col items-center gap-2 px-2">
                    {DESKTOP_SIDEBAR_TABS
                      .filter(
                        (tab) =>
                          (runtimeTabs.includes(tab.key) || tab.route) &&
                          (!tab.desktopOnly || isDesktopRuntime),
                      )
                      .map((tab) => {
                        const Icon = tab.icon;
                        const isActive = tab.route
                          ? location.pathname === tab.route
                          : activeTab === tab.key;
                        return (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => {
                              if (tab.route) {
                                navigate(tab.route, { replace: true });
                                return;
                              }
                              handleTabSelect(tab.key);
                            }}
                            className={`group flex h-12 w-12 items-center justify-center rounded-xl border transition-colors ${
                              isActive
                                ? "border-primary/35 bg-primary text-primary-foreground shadow-none dark:shadow-[0_10px_24px_rgba(255,255,255,0.14)]"
                                : "border-transparent bg-transparent text-muted-foreground hover:border-border/80 hover:bg-accent/70 hover:text-foreground"
                            }`}
                            title={tab.label}
                            aria-label={tab.label}
                          >
                            <span className="relative inline-flex">
                              <Icon className="h-5 w-5" />
                              {tab.key === "updates" && hasUnreadCsUpdate ? (
                                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-400" />
                              ) : null}
                            </span>
                          </button>
                        );
                      })}
                  </nav>

                  <div className="mt-auto flex w-full flex-col items-center gap-2 px-2 pb-2">
                    <ThemeToggle />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="relative h-11 w-11 rounded-full border-border/80 bg-card/75 p-0">
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
                    <UserMenu menuSide="right" menuAlign="end" menuSideOffset={8} />
                  </div>
                </div>
              </div>
            </aside>
          ) : null}

          <Tabs
            value={activeTab}
            onValueChange={handleTabSelect}
            className={`w-full min-w-0 ${renderLocalDesktopSidebar ? "lg:min-h-0 lg:overflow-y-auto lg:px-6 xl:px-8" : ""}`}
          >
            {useDesktopSidebarShell ? (
              <div className="hidden lg:flex lg:sticky lg:top-0 lg:z-20 lg:mb-4 lg:items-center lg:justify-between lg:gap-6 lg:border-b lg:border-border/60 lg:bg-background/92 lg:px-2 lg:py-4 lg:backdrop-blur-xl">
                <div className={`flex min-w-0 items-center ${activeTab === "search" ? "w-full justify-center" : "gap-3"}`}>
                  <form
                    className={`relative ${activeTab === "search" ? "w-[min(920px,72vw)]" : "w-[340px] max-w-[46vw]"}`}
                    onSubmit={(event) => {
                      void handleGlobalSearchSubmit(event);
                    }}
                  >
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      ref={globalSearchInputRef}
                      value={globalSearchTerm}
                      onFocus={() => {
                        if (activeTab !== "search") {
                          setGlobalSearchOpen(true);
                        }
                      }}
                      onChange={(event) => {
                        setGlobalSearchTerm(event.target.value);
                        if (activeTab !== "search") {
                          setGlobalSearchOpen(true);
                        }
                      }}
                      onKeyDown={handleGlobalSearchInputKeyDown}
                      placeholder="Suche nach Item, Typ oder Kategorie..."
                      className="flex h-11 w-full items-center rounded-md border border-border bg-transparent pl-10 pr-3 text-sm text-foreground shadow-none outline-none transition-colors focus:border-border dark:rounded-xl dark:border-border/70 dark:bg-card/75 dark:shadow-[0_12px_28px_rgba(0,0,0,0.2)]"
                    />
                  </form>
                </div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <button
                    type="button"
                    onClick={() => handleTabSelect("overview")}
                    className={`rounded-lg px-3 py-1.5 transition-colors ${activeTab === "overview" ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent/70"}`}
                  >
                    Portfolio
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTabSelect("inventory")}
                    className={`rounded-lg px-3 py-1.5 transition-colors ${activeTab === "inventory" ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent/70"}`}
                  >
                    Inventar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTabSelect("watchlist")}
                    className={`rounded-lg px-3 py-1.5 transition-colors ${activeTab === "watchlist" ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent/70"}`}
                  >
                    Watchlist
                  </button>
                  {isDesktopRuntime ? (
                    <button
                      type="button"
                      onClick={() => handleTabSelect("management")}
                      className={`rounded-lg px-3 py-1.5 transition-colors ${activeTab === "management" ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent/70"}`}
                    >
                      Verwaltung
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className={`${useDesktopSidebarShell ? "mb-3 lg:hidden" : "mb-3"} px-0`}>
              <form
                className="relative"
                onSubmit={(event) => {
                  void handleGlobalSearchSubmit(event);
                }}
              >
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={globalSearchTerm}
                  onFocus={() => {
                    if (activeTab !== "search") {
                      setGlobalSearchOpen(true);
                    }
                  }}
                  onChange={(event) => {
                    setGlobalSearchTerm(event.target.value);
                    if (activeTab !== "search") {
                      setGlobalSearchOpen(true);
                    }
                  }}
                  onKeyDown={handleGlobalSearchInputKeyDown}
                  placeholder="Suche nach Item, Typ oder Kategorie..."
                  className="h-11 w-full rounded-md border border-border bg-transparent pl-10 pr-3 text-sm text-foreground shadow-none outline-none focus:border-border dark:rounded-xl dark:border-border/70 dark:bg-card/75"
                />
              </form>
            </div>
            {error && (
              <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            {/* Tab Navigation - auf Desktop Runtime durch Sidebar ersetzt */}
            <div className={useDesktopSidebarShell ? "hidden sm:block lg:hidden" : "hidden sm:block"}>
              <TabsList className={`grid w-full gap-1 sm:max-w-200 ${isDesktopRuntime ? "grid-cols-5" : "grid-cols-4"}`}>
                <TabsTrigger value="overview" className="text-xs sm:text-sm">Uebersicht</TabsTrigger>
                <TabsTrigger value="inventory" className="text-xs sm:text-sm">Inventar</TabsTrigger>
                <TabsTrigger value="watchlist" className="text-xs sm:text-sm">Watchlist</TabsTrigger>
                <TabsTrigger value="search" className="text-xs sm:text-sm">Suche</TabsTrigger>
                {isDesktopRuntime ? <TabsTrigger value="management" className="text-xs sm:text-sm">Verwaltung</TabsTrigger> : null}
              </TabsList>
            </div>

          <TabsContent value="overview" forceMount={visitedTabs.has("overview") || undefined}>
          <PortfolioOverviewSection
            forceMount={visitedTabs.has("overview")}
            stats={stats}
            portfolioLoading={portfolioLoading}
            metricsScope={metricsScope}
            portfolioPreferences={portfolioPreferences}
            headerPortfolioValue={headerPortfolioValue}
            headerPortfolioPercent={headerPortfolioPercent}
            headerPortfolioPositive={headerPortfolioPositive}
            headerPortfolioValueLabel={headerPortfolioValueLabel}
            headerProfitEuro={headerProfitEuro}
            headerProfitPercent={headerProfitPercent}
            headerProfitSubLabel={headerProfitSubLabel}
            headerProfitPositive={headerProfitPositive}
            liveItems={liveItems}
            staleItems={staleItems}
            showCsUpdateBanner={showCsUpdateBanner}
            latestCsUpdate={latestCsUpdate}
            latestCsUpdateAgeHours={latestCsUpdateAgeHours}
            latestCsUpdateImpact={latestCsUpdateImpact}
            latestCsUpdateBannerTone={latestCsUpdateBannerTone}
            latestCsUpdateAiModelLabel={latestCsUpdateAiModelLabel}
            hasUnreadCsUpdate={hasUnreadCsUpdate}
            handleOpenLatestCsUpdateFeed={handleOpenLatestCsUpdateFeed}
            showBanWaveBanner={showBanWaveBanner}
            freshBanWaveItem={freshBanWaveItem}
            handleOpenBanWaveFeed={handleOpenBanWaveFeed}
            scopedPortfolioHistory={scopedPortfolioHistory}
            portfolioChartCardRef={portfolioChartCardRef}
            onChartHoverChange={setHoveredChartData}
            onChartTrendChange={setChartTrendData}
            handleMetricsScopeChange={handleMetricsScopeChange}
            watchlistTopMovers={watchlistTopMovers}
            watchlistMoverPanelHeight={watchlistMoverPanelHeight}
            setWatchlistFocusTarget={setWatchlistFocusTarget}
            handleTabSelect={handleTabSelect}
            compositionData={compositionData}
            compositionLoading={compositionLoading}
            compositionError={compositionError}
            portfolioTotalValueForDisplay={portfolioTotalValueForDisplay}
            portfolioValueLabel={portfolioValueLabel}
          />
          </TabsContent>

          <TabsContent value="inventory" forceMount={visitedTabs.has("inventory") || undefined}>
          <PortfolioInventorySection
            forceMount={visitedTabs.has("inventory")}
            inventoryScope={inventoryScope}
            onInventoryScopeChange={setInventoryScope}
            inventoryTabItems={inventoryTabItems}
            portfolioGroupSummaries={portfolioGroupSummaries}
            onSelectItem={(item) => {
              setSelectedItem(item);
              if (window.innerWidth < BREAKPOINTS.MOBILE) {
                openModal("itemDetail", { item });
              }
            }}
            onSelectGroup={(group) => {
              setSelectedItem(buildGroupDetailSelection(group));
            }}
            onSelectCluster={(group, cluster) => {
              setSelectedItem(buildGroupClusterDetailSelection(group, cluster));
            }}
            selectedItemWithLiveAndBuyOrders={selectedItemWithLiveAndBuyOrders}
            selectedItem={selectedItem}
            selectedItemHistory={selectedItemHistory}
            selectedItemHistoryLoading={selectedItemHistoryLoading}
            isDesktopRuntime={isDesktopRuntime}
            onExcludeChange={handleExcludeChange}
            onBucketChange={handleMoveItemBucket}
            canToggleExclude={
              isDesktopRuntime &&
              selectedItemWithLiveAndBuyOrders?.__detailKind !== "group" &&
              selectedItemWithLiveAndBuyOrders?.__detailKind !== "group-cluster"
            }
            onModalExcludeToggle={handleModalExcludeToggle}
            modals={modals}
            onCloseModal={closeModal}
            enrichedInvestments={enrichedInvestments}
            inventoryBuyOrderSummary={inventoryBuyOrderSummary}
          />
          </TabsContent>

          <TabsContent value="watchlist" forceMount={visitedTabs.has("watchlist") || undefined}>
          <PortfolioWatchlistSection
            forceMount={visitedTabs.has("watchlist")}
            watchlistFocusTarget={watchlistFocusTarget}
            handleWatchlistWarningsChange={handleWatchlistWarningsChange}
          />
          </TabsContent>
          <TabsContent value="search" forceMount={visitedTabs.has("search") || undefined}>
          <PortfolioSearchSection
            forceMount={visitedTabs.has("search")}
            loadGlobalSearchWatchlistItems={loadGlobalSearchWatchlistItems}
            globalSearchWatchlistItems={globalSearchWatchlistItems}
            handleUiWarningsChange={handleUiWarningsChange}
            searchPageInitialTerm={searchPageInitialTerm}
          />
          </TabsContent>
          {isDesktopRuntime ? (
          <TabsContent value="management" forceMount={visitedTabs.has("management") || undefined}>
          <PortfolioManagementSection
            forceMount={visitedTabs.has("management")}
            syncNotification={syncNotification}
            autoSyncEnabled={autoSyncEnabled}
            isSteamSyncing={isSteamSyncing}
            steamSyncError={steamSyncError}
            hasCsFloatKey={hasCsFloatKey}
            hasSkinBaronImportReady={hasSkinBaronImportReady}
            isCsFloatSyncOpen={isCsFloatSyncOpen}
            isSkinBaronSyncOpen={isSkinBaronSyncOpen}
            setIsCsFloatSyncOpen={setIsCsFloatSyncOpen}
            setIsSkinBaronSyncOpen={setIsSkinBaronSyncOpen}
            runSteamSync={runSteamSync}
            handleToggleAutoSync={handleToggleAutoSync}
            managementInvestments={managementInvestments}
            managementLoading={managementLoading}
            managementError={managementError}
            managementSection={managementSection}
            setManagementSection={setManagementSection}
            managementFilter={managementFilter}
            setManagementFilter={setManagementFilter}
            managementSearchTerm={managementSearchTerm}
            setManagementSearchTerm={setManagementSearchTerm}
            managementTypeFilter={managementTypeFilter}
            setManagementTypeFilter={setManagementTypeFilter}
            managementBucketFilter={managementBucketFilter}
            setManagementBucketFilter={setManagementBucketFilter}
            managementSortBy={managementSortBy}
            setManagementSortBy={setManagementSortBy}
            expandedClusters={expandedClusters}
            setExpandedClusters={setExpandedClusters}
            handleManagementExcludeToggle={handleManagementExcludeToggle}
            handleManagementBucketToggle={handleManagementBucketToggle}
            handleManagementClusterToggle={handleManagementClusterToggle}
            handleManagementClusterBucketToggle={handleManagementClusterBucketToggle}
            handleExcludeChange={handleExcludeChange}
            matchingRows={matchingRows}
            matchingLoading={matchingLoading}
            matchingSearchTerm={matchingSearchTerm}
            setMatchingSearchTerm={setMatchingSearchTerm}
            matchingSortBy={matchingSortBy}
            setMatchingSortBy={setMatchingSortBy}
            matchingConfidenceFilter={matchingConfidenceFilter}
            setMatchingConfidenceFilter={setMatchingConfidenceFilter}
            showMatchedMatchingRows={showMatchedMatchingRows}
            setShowMatchedMatchingRows={setShowMatchedMatchingRows}
            handleMatchStatusUpdate={handleMatchStatusUpdate}
            managementInvestmentById={managementInvestmentById}
            matchingDisplayRows={matchingDisplayRows}
            handleEditPortfolioGroup={handleEditPortfolioGroup}
            rawSteamInventoryItems={rawSteamInventoryItems}
            steamInventoryItemsAll={steamInventoryItemsAll}
            priceSearchTerm={priceSearchTerm}
            setPriceSearchTerm={setPriceSearchTerm}
            priceSortBy={priceSortBy}
            setPriceSortBy={setPriceSortBy}
            priceMissingOnly={priceMissingOnly}
            setPriceMissingOnly={setPriceMissingOnly}
            priceDrafts={priceDrafts}
            setPriceDrafts={setPriceDrafts}
            savingPriceItemId={savingPriceItemId}
            setSavingPriceItemId={setSavingPriceItemId}
            handlePriceDraftChange={handlePriceDraftChange}
            handleSaveSteamItemPrice={handleSaveSteamItemPrice}
            handleAcceptSuggestedPrice={handleAcceptSuggestedPrice}
            manualItemDraft={manualItemDraft}
            setManualItemDraft={setManualItemDraft}
            manualSelectedSuggestion={manualSelectedSuggestion}
            setManualSelectedSuggestion={setManualSelectedSuggestion}
            manualItemSaving={manualItemSaving}
            setManualItemSaving={setManualItemSaving}
            handleManualItemDraftChange={handleManualItemDraftChange}
            handleManualSuggestionPick={handleManualSuggestionPick}
            handleCreateManualInvestment={handleCreateManualInvestment}
            portfolioGroups={portfolioGroups}
            portfolioGroupsLoading={portfolioGroupsLoading}
            portfolioGroupDraft={portfolioGroupDraft}
            portfolioGroupEditorId={portfolioGroupEditorId}
            portfolioGroupMessage={portfolioGroupMessage}
            portfolioGroupError={portfolioGroupError}
            expandedGroupManagementClusters={expandedGroupManagementClusters}
            setExpandedGroupManagementClusters={setExpandedGroupManagementClusters}
            groupSearchTerm={groupSearchTerm}
            setGroupSearchTerm={setGroupSearchTerm}
            groupSortBy={groupSortBy}
            setGroupSortBy={setGroupSortBy}
            portfolioGroupEditor={portfolioGroupEditor}
            handleStartCreatePortfolioGroup={handleStartCreatePortfolioGroup}
            resetPortfolioGroupEditor={resetPortfolioGroupEditor}
            handlePortfolioGroupDraftChange={handlePortfolioGroupDraftChange}
            handleSavePortfolioGroup={handleSavePortfolioGroup}
            handleDeletePortfolioGroup={handleDeletePortfolioGroup}
            handleAssignInvestmentIdsToGroup={handleAssignInvestmentIdsToGroup}
            handleRemoveInvestmentIdsFromGroup={handleRemoveInvestmentIdsFromGroup}
            handleOpenPortfolioGroupInInventory={handleOpenPortfolioGroupInInventory}
            handleOpenPortfolioGroupInManagement={handleOpenPortfolioGroupInManagement}
            setPortfolioGroupEditorId={setPortfolioGroupEditorId}
            toggleExpandedGroupManagementCluster={toggleExpandedGroupManagementCluster}
            filteredGroupManagementClusters={filteredGroupManagementClusters}
            managementGroupsByClusterKey={managementGroupsByClusterKey}
            portfolioGroupMembershipMap={portfolioGroupMembershipMap}
            portfolioGroupsById={portfolioGroupsById}
            filteredManagementClusters={filteredManagementClusters}
            managementTypeOptions={managementTypeOptions}
            managementQuickHints={managementQuickHints}
            filteredMatchingRows={filteredMatchingRows}
            matchingSuggestedCount={matchingSuggestedCount}
            matchedSteamInventoryItemsCount={matchedSteamInventoryItemsCount}
            filteredPriceItems={filteredPriceItems}
            suggestedPriceByNameKey={suggestedPriceByNameKey}
            priceMissingCount={priceMissingCount}
          />
          </TabsContent>
          ) : null}
        </Tabs>
        </div>
        ) : null}

        {globalSearchOpen ? (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => setGlobalSearchOpen(false)}
          >
            <div
              className="mx-auto mt-4 flex h-[calc(100vh-2rem)] w-[min(1080px,96vw)] flex-col overflow-hidden rounded-xl border border-border/70 bg-background shadow-none dark:rounded-2xl dark:bg-card/96 dark:shadow-[0_22px_60px_rgba(0,0,0,0.55)]"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Globale Suche"
              data-keyboard-scope="modal"
              tabIndex={-1}
            >
              <div className="border-b border-border/70 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <form
                    className="relative min-w-0 flex-1"
                    onSubmit={(event) => {
                      void handleGlobalSearchSubmit(event);
                    }}
                  >
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      ref={globalSearchInputRef}
                      value={globalSearchTerm}
                      onChange={(event) => setGlobalSearchTerm(event.target.value)}
                      onKeyDown={handleGlobalSearchInputKeyDown}
                      placeholder="Suche nach Item, Typ oder Kategorie..."
                      className="h-11 w-full rounded-md border border-border bg-background pl-10 pr-3 text-sm text-foreground outline-none focus:border-border/80 dark:rounded-xl dark:border-border/70 dark:bg-card/85"
                    />
                  </form>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setGlobalSearchOpen(false)}
                    data-keyboard-cancel
                  >
                    Schliessen
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
                <div className="space-y-5">
                  {!globalSearchTermNormalized && globalSearchRecentTerms.length > 0 ? (
                    <section className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-foreground">Letzte Suchvorgaenge</h3>
                        <button
                          type="button"
                          onClick={clearGlobalRecentSearches}
                          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        >
                          Verlauf loeschen
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {globalSearchRecentTerms.map((term, index) => {
                          const keyboardEntryId = `recent:${term}:${index}`;
                          const isKeyboardActive = globalSearchActiveEntryId === keyboardEntryId;
                          return (
                          <button
                            key={`recent-${term}`}
                            type="button"
                            onClick={() => {
                              openGlobalSearchBrowser(term);
                            }}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                              isKeyboardActive
                                ? "border-primary/55 bg-primary/10"
                                : "border-border/70 bg-transparent hover:bg-accent/55"
                            }`}
                          >
                            {term}
                          </button>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}

                  {globalSearchLocalSuggestions.length > 0 ? (
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-foreground">Bereits in deinem Bestand</h3>
                      <div className="space-y-3">
                        {globalSearchLocalSuggestionGroups.map((group, groupIndex) => (
                          <div
                            key={group.key}
                            className={`${groupIndex > 0 ? "border-t border-border/60 pt-3" : ""}`}
                          >
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                              {group.label}
                            </p>
                            <div className="space-y-2">
                              {group.entries.map((entry) => {
                                const keyboardEntryId = `local:${entry.key}`;
                                const isKeyboardActive = globalSearchActiveEntryId === keyboardEntryId;
                                return (
                                  <button
                                    key={entry.key}
                                    type="button"
                                    onClick={() => handleGlobalSearchSelectKnownItem(entry)}
                                    className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors dark:rounded-xl ${
                                      isKeyboardActive
                                        ? "border-primary/55 bg-primary/10"
                                        : "border-border bg-transparent hover:bg-accent/45 dark:border-border/70 dark:bg-card/65"
                                    }`}
                                  >
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/25">
                                      {entry.imageUrl ? (
                                        <img
                                          src={entry.imageUrl}
                                          alt={entry.name}
                                          className="h-full w-full object-cover"
                                        />
                                      ) : (
                                        <span className="text-[11px] text-muted-foreground">N/A</span>
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-semibold">{entry.name}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {entry.sourceLabel} | {entry.quantity} Stk.
                                      </p>
                                    </div>
                                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                                      {entry.sourceLabel}
                                    </Badge>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {globalSearchGroupSuggestions.length > 0 ? (
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-foreground">Investment Gruppen</h3>
                      <div className="space-y-2">
                        {globalSearchGroupSuggestions.map((group) => {
                          const summary = group.summary || null;
                          const topVisual = Array.isArray(summary?.topVisuals) ? summary.topVisuals[0] : null;
                          const canOpenInventory = Boolean(summary);
                          return (
                            <div
                              key={`group-search-${group.id}`}
                              className="flex items-center gap-3 rounded-md border border-border/70 bg-background/35 px-3 py-2.5 dark:rounded-xl dark:bg-card/65"
                            >
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/25">
                                {topVisual?.imageUrl ? (
                                  <img
                                    src={topVisual.imageUrl}
                                    alt={group.name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">GR</span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold">{group.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {summary
                                    ? `${summary.clusterCount} Cluster | ${summary.memberCount} Positionen | ${formatUsdPrice(summary.totalValue)}`
                                    : "Noch leer - nur in Verwaltung sichtbar"}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={!canOpenInventory}
                                  onClick={() => handleOpenPortfolioGroupInInventory(group.id)}
                                >
                                  Im Inventar
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleOpenPortfolioGroupInManagement(group.id)}
                                >
                                  Verwaltung
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}

                  {canRunGlobalCatalogSearch ? (
                    <section className="space-y-2">
                      <button
                        type="button"
                        onClick={() => openGlobalSearchBrowser(globalSearchTerm)}
                        className={`flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left transition-colors dark:rounded-xl ${
                          globalSearchActiveEntryId === "search-action"
                            ? "border-primary/55 bg-primary/10"
                            : "border-border bg-transparent hover:bg-accent/50 dark:border-border/70 dark:bg-card/65"
                        }`}
                      >
                        <span className="truncate text-sm font-semibold">
                          Alle Produkte durchsuchen: "{normalizeGlobalSearchInput(globalSearchTerm)}"
                        </span>
                        <span className="text-xs text-muted-foreground">Enter</span>
                      </button>
                      {hasPendingCatalogSearch ? (
                        <p className="text-xs text-muted-foreground">
                          Enter oeffnet die Produktsuche mit Filtern auf der Suchseite.
                        </p>
                      ) : null}
                    </section>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Mindestens 2 Zeichen eingeben, um den Item-Browser zu starten.
                    </p>
                  )}

                  {globalSearchCommittedTerm ? (
                    <section className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {GLOBAL_SEARCH_CATEGORIES.map((category) => (
                          <button
                            key={category.key}
                            type="button"
                            onClick={() => setGlobalSearchCategory(category.key)}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                              globalSearchCategory === category.key
                                ? "border-primary/55 bg-primary text-primary-foreground"
                                : "border-border/70 bg-transparent text-foreground hover:bg-accent/55"
                            }`}
                          >
                            {category.label}
                          </button>
                        ))}
                      </div>

                      {globalSearchCatalogLoading ? (
                        <div className="space-y-2">
                          <Skeleton className="h-14 w-full" />
                          <Skeleton className="h-14 w-full" />
                          <Skeleton className="h-14 w-full" />
                        </div>
                      ) : globalSearchCatalogError ? (
                        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                          {globalSearchCatalogError}
                        </div>
                      ) : globalSearchFilteredCatalogResults.length === 0 ? (
                        <div className="rounded-md border border-border/70 p-3 text-sm text-muted-foreground">
                          Keine Treffer im Katalog fuer "{globalSearchCommittedTerm}".
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {globalSearchFilteredCatalogResults.map((candidate, index) => {
                            const marketHashName = String(
                              candidate?.marketHashName || candidate?.displayName || "",
                            ).trim();
                            const keyboardEntryId = `catalog:${marketHashName}:${index}`;
                            const isKeyboardActive = globalSearchActiveEntryId === keyboardEntryId;
                            const nameKey = normalizeSearchText(marketHashName);
                            const knownPresence = globalSearchKnownItemsByName.get(nameKey) || null;
                            const canAddToWatchlist = !knownPresence?.hasWatchlist;
                            const preferredKnownMatch = globalSearchKnownPrimaryByName.get(nameKey) || null;

                            return (
                              <div
                                key={`${marketHashName}-${candidate?.itemType || candidate?.type || "other"}`}
                                className={`flex items-center gap-3 rounded-md border px-3 py-2.5 dark:rounded-xl ${
                                  isKeyboardActive
                                    ? "border-primary/55 bg-primary/10"
                                    : "border-border/70 bg-background/35 dark:bg-card/65"
                                }`}
                                onClick={() => void handleGlobalSearchSelectCatalogItem(candidate)}
                              >
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/25">
                                  {candidate?.iconUrl ? (
                                    <img
                                      src={candidate.iconUrl}
                                      alt={candidate.displayName || marketHashName}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <span className="text-[11px] text-muted-foreground">N/A</span>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold">
                                    {candidate?.displayName || marketHashName}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {candidate?.itemTypeLabel || candidate?.itemType || "Other"}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  {preferredKnownMatch ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleGlobalSearchSelectKnownItem(preferredKnownMatch);
                                      }}
                                    >
                                      Im Bestand
                                    </Button>
                                  ) : null}
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={canAddToWatchlist ? "default" : "outline"}
                                    disabled={!canAddToWatchlist || globalSearchAddingItem === marketHashName}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleGlobalSearchAddToWatchlist(candidate);
                                    }}
                                  >
                                    {!canAddToWatchlist
                                      ? "In Watchlist"
                                      : globalSearchAddingItem === marketHashName
                                        ? "Speichert..."
                                        : "Zur Watchlist"}
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {isCsFloatSyncOpen ? (
          <Suspense fallback={null}>
            <CsFloatTradeSyncModal
              isOpen={isCsFloatSyncOpen}
              onClose={() => setIsCsFloatSyncOpen(false)}
              onSynced={async () => {
                await refreshPortfolio();
                setCompositionRefreshToken((current) => current + 1);
                const shouldAdvanceJourney =
                  Boolean(journeyState?.startedAt) &&
                  !journeyState?.skipped &&
                  !journeyState?.completedAt;
                const nextState = {
                  ...journeyState,
                  csfloatImportCompletedAt: new Date().toISOString(),
                  csfloatImportSkippedAt: null,
                  currentStepId: shouldAdvanceJourney ? "matching" : journeyState?.currentStepId,
                };
                setJourneyState(nextState);
                await writeJourneyState(nextState);
                setActiveTab("management");
                setManagementSection("matching");
                setIsCsFloatSyncOpen(false);
              }}
            />
          </Suspense>
        ) : null}
        {isSkinBaronSyncOpen ? (
          <Suspense fallback={null}>
            <SkinBaronSalesSyncModal
              isOpen={isSkinBaronSyncOpen}
              onClose={() => setIsSkinBaronSyncOpen(false)}
              onSynced={async () => {
                await refreshPortfolio();
                setCompositionRefreshToken((current) => current + 1);
                setActiveTab("management");
                setManagementSection("matching");
                setIsSkinBaronSyncOpen(false);
              }}
            />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}
