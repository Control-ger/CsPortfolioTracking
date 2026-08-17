import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconCircleButton } from "@shared/components/ui/icon-circle-button";
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
import { Callout } from "@shared/components";
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
  buildPortfolioAllocationByType,
  calculatePortfolioSummary,
  filterRowsByScope,
  selectPortfolioMovers,
  fetchCS2Inventory,
  fetchCsFloatBuyOrdersData,
  fetchWatchlistData,
  getCachedPortfolioPreferences,
  getPortfolioPreferences,
  getCurrentUser,
  importInventoryAsInvestments,
  IMPACT_LEVELS,
  resolveDesktopLocalUserId as resolveDesktopRuntimeUserId,
  resolveMetricsScopeFromPreferences,
  createWatchlistItemData,
  fetchCsFloatApiKeyStatus,
  fetchSkinBaronApiKeyStatus,
  updateCsFloatApiKey,
  toggleExcludeInvestment,
  updatePortfolioPreferences,
  runAppUpdateAction,
} from "@shared/lib";
import { BREAKPOINTS } from "@shared/lib";
import { useKeyboard } from "@shared/hooks";
import { useAutoHideOnScroll } from "@shared/hooks";
import { useCurrency } from "@shared/contexts/CurrencyContext";
import { runDesktopSyncNowIfDue } from "@shared/lib/desktopSync.js";
import { deriveSteamPaletteFromUser } from "@shared/components/SteamLoginPrompt.jsx";
import { normalizeServerHostInput } from "@shared/lib/serverConfig";
import {
  PORTFOLIO_GROUPS_STORAGE_KEY,
  buildPortfolioGroupSummaries,
  buildWeightedGroupHistory,
  buildPortfolioGroupMembershipMap,
  summarizeManagementClusterAssignment,
  createPortfolioGroupDraft,
  normalizePortfolioGroups,
  mergePortfolioGroups,
  portfolioGroupsSignature,
  portfolioGroupsStorageKey,
  normalizePortfolioGroupColor,
  preservePortfolioGroupColors,
} from "@shared/lib/portfolioGroups.js";
import { useTranslation } from "react-i18next";
import { getActiveIntlLocale, translate } from "@shared/lib/i18n/index.js";
import {
  formatDateSafe,
  normalizeSearchText,
  withBuyOrderFields,
  deriveCsUpdateImpact,
  getClusterUpdatedAt,
  normalizeBucket,
  resolveLiveClusterItem,
  buildGroupDetailSelection,
  buildGroupClusterDetailSelection,
  getItemNameKey,
  formatPercent,
  MANUAL_ITEM_TYPES,
} from "../lib/portfolioHelpers.js";
import {
  PortfolioOverviewSection,
  PortfolioInventorySection,
  PortfolioWatchlistSection,
  PortfolioSearchSection,
  PortfolioManagementSection,
} from "@shared/components";
import { resolveWrappedSeason } from "../lib/yearWrapped.js";
import { resolveWatchlistTarget, TARGET_DIRECTION_ABOVE } from "../lib/watchlistTargets.js";

/**
 * Blank manual-investment draft. `purchaseDate` is the form's own field and is
 * written out as `purchasedAt`, the key resolveInvestmentDate looks at first.
 */
function createManualItemDraft() {
  return {
    name: "",
    buyPriceInput: "",
    quantity: "1",
    platform: "manual",
    fundingMode: "wallet_funded",
    type: "skin",
    bucket: "investment",
    purchaseDate: new Date().toISOString().slice(0, 10),
  };
}

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


// Neobroker-clean surface: one neutral card, impact conveyed only by a small
// accent dot + the impact badge. No gradients, no nested panels, light-safe.
function getCsUpdateBannerTone(level) {
  if (level === "high") {
    return { dot: "bg-danger" };
  }
  if (level === "medium") {
    return { dot: "bg-warn" };
  }
  if (level === "pending") {
    return { dot: "bg-info" };
  }
  return { dot: "bg-success" };
}

const JOURNEY_STORAGE_KEY = "onboarding:journey:v1";
const STEAM_SYNC_META_KEY = "steam:sync:meta:v1";
const STEAM_SYNC_PREF_KEY = "steam:sync:auto-enabled:v1";
const STEAM_SYNC_COOLDOWN_MS = 1000 * 60 * 30;
// Actionable, self-clearing notifications derived from portfolio state after a
// sync: items still needing a manual price / a match confirmation.
const ACTION_NOTIFICATION_CATEGORIES = ["action_match", "action_price"];
const STARTUP_WELCOME_DISMISS_KEY = "startup:welcome:dismissed:v1";
const GLOBAL_SEARCH_RECENTS_KEY = "global-search:recent:v1";
const CS_UPDATES_SEEN_KEY = "cs-updates:last-seen-id:v1";
const BAN_WAVE_NOTIFIED_KEY = "ban-wave:last-notified-id:v1";
const CS_UPDATE_NOTIFIED_KEY = "cs-update:last-notified-id:v1";
// Year-scoped so dismissing this season's banner does not hide the next one.
const YEAR_WRAPPED_DISMISS_KEY_PREFIX = "year-wrapped:dismissed:";
const DEFAULT_CS_UPDATES_BANNER_VISIBLE_HOURS = 24 * 7;
const JOURNEY_STEP_ORDER = ["server", "import_defaults", "csfloat_key", "csfloat_import", "push_notifications", "matching", "management"];
// Page-local copy of the rail (see architecture-overview.md §5); labels are
// keys for the same reason the shared rail's are.
const DESKTOP_SIDEBAR_TABS = [
  { key: "overview", labelKey: "tabs.overview", icon: LayoutGrid },
  { key: "inventory", labelKey: "tabs.inventory", icon: Package },
  { key: "watchlist", labelKey: "tabs.watchlist", icon: Eye },
  { key: "management", labelKey: "tabs.management", icon: FolderCog, desktopOnly: true },
  { key: "updates", labelKey: "tabs.updates", icon: Newspaper, route: "/cs-updates" },
  { key: "settings", labelKey: "tabs.settings", icon: Cog, route: "/settings" },
];
const GLOBAL_SEARCH_CATEGORIES = [
  { key: "all", labelKey: "categories.all" },
  { key: "skins", labelKey: "categories.skins" },
  { key: "cases", labelKey: "categories.cases" },
  { key: "stickers", labelKey: "categories.stickers" },
  { key: "agents", labelKey: "categories.agents" },
  { key: "capsules", labelKey: "categories.capsules" },
  { key: "everything_else", labelKey: "categories.everythingElse" },
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
        name: item.name || item.marketHashName || translate("portfolio:item.unknown"),
        type: item.type || "skin",
        imageUrl: item.imageUrl || null,
        positions: [],
      });
    }

    const group = groups.get(key);
    group.positions.push({
      id: item.id,
      name: item.name || group.name,
      type: item.type || group.type || null,
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
    .sort((a, b) => a.name.localeCompare(b.name, getActiveIntlLocale()));
}

function formatSteamSyncError(error) {
  const raw = String(error?.message || error || "");
  const upper = raw.toUpperCase();
  if (upper.includes("INVENTORY_ACCESS_DENIED")) {
    return translate("portfolio:steamSyncError.accessDenied");
  }
  if (upper.includes("RATE") || upper.includes("429")) {
    return translate("portfolio:steamSyncError.rateLimit");
  }
  if (upper.includes("INVALID RESPONSE") || upper.includes("JSON")) {
    return translate("portfolio:steamSyncError.invalidResponse");
  }
  if (upper.includes("FAILED TO FETCH") || upper.includes("NETWORK")) {
    return translate("portfolio:steamSyncError.network");
  }
  return raw || translate("portfolio:steamSyncError.generic");
}

function formatApiWarningMetaLine(warning) {
  const metaParts = [];
  if (warning?.statusCode) {
    metaParts.push(`HTTP ${warning.statusCode}`);
  }
  if (warning?.occurrences > 1) {
    metaParts.push(translate("portfolio:warnings.occurrences", { count: warning.occurrences }));
  }
  if (Array.isArray(warning?.items) && warning.items.length > 0) {
    metaParts.push(translate("portfolio:warnings.items", { items: warning.items.join(", ") }));
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
      metaParts.push(translate("portfolio:warnings.source", { source: sourceLabel }));
    }
    if (warningMeta) {
      metaParts.push(warningMeta);
    }

    return {
      id: `csfloat-warning-${sourceKey}-${warning?.code || "warning"}-${warning?.statusCode || "na"}-${index}`,
      message: warning?.message || translate("portfolio:warnings.csfloatFallback"),
      meta: metaParts.join(" | "),
    };
  });
}

export function PortfolioPage({ initialTab = "overview", useExternalDesktopSidebarShell = false }) {
  const { t } = useTranslation("portfolio");
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
  const { formatPrice, convertPrice, convertToUsd, convertFromUsd } = useCurrency();
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
  // Seeded from the synchronously readable preference cache: metricsScope feeds
  // the portfolio cache key, so starting on the default scope and switching one
  // tick later would cost a second full portfolio load on every mount.
  const [portfolioPreferences, setPortfolioPreferences] = useState(
    getCachedPortfolioPreferences,
  );
  // Ref so the startup auto-sync callback always reads the latest pref without
  // needing to be re-memoized (avoids the race where auto-sync fires before
  // loadPortfolioPreferences resolves and evaluates against the initial default).
  const notifySteamSyncDesktopRef = useRef(true);
  const [selectedMetricsScope, setSelectedMetricsScope] = useState(
    () => getCachedPortfolioPreferences().metricsScopeDefault || "investments",
  );
  const [inventoryScope, setInventoryScope] = useState("investment");
  const metricsScope = resolveMetricsScopeFromPreferences(
    portfolioPreferences,
    selectedMetricsScope,
  );
  const {
    enrichedInvestments,
    isLoading: portfolioLoading,
    statsPending,
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
  // Kept as a general "portfolio data changed" signal for the side-loads below;
  // the composition itself no longer needs it — it derives from the rows.
  const [compositionRefreshToken, setCompositionRefreshToken] = useState(0);
  // Mobile dashboard only: the allocation bar groups by catalogue category
  // (the donut's per-item grouping renders as slivers at 11px tall), and the
  // movers come from the held positions rather than the watchlist panel.
  const allocationByType = useMemo(
    () => buildPortfolioAllocationByType(enrichedInvestments, { scope: metricsScope }),
    [enrichedInvestments, metricsScope],
  );
  const portfolioMovers = useMemo(
    () => selectPortfolioMovers(enrichedInvestments, { scope: metricsScope, limit: 3 }),
    [enrichedInvestments, metricsScope],
  );
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
  const [priceMissingOnly, setPriceMissingOnly] = useState(true);
  const [matchingSearchTerm, setMatchingSearchTerm] = useState("");
  const [matchingSortBy, setMatchingSortBy] = useState("score_desc");
  const [matchingConfidenceFilter, setMatchingConfidenceFilter] = useState("all");
  const [showMatchedMatchingRows, setShowMatchedMatchingRows] = useState(false);
  const [priceDrafts, setPriceDrafts] = useState({});
  const [savingPriceItemId, setSavingPriceItemId] = useState(null);
  const [manualItemDraft, setManualItemDraft] = useState(() => createManualItemDraft());
  const [manualNameSuggestions, setManualNameSuggestions] = useState([]);
  const [manualNameSuggestionsLoading, setManualNameSuggestionsLoading] = useState(false);
  const [manualNameSuggestionsError, setManualNameSuggestionsError] = useState("");
  const [manualSelectedSuggestion, setManualSelectedSuggestion] = useState(null);
  const [manualItemSaving, setManualItemSaving] = useState(false);
  const [syncNotification, setSyncNotification] = useState({
    newItemsCount: 0,
    lastSyncedAt: null,
  });
  const [syncNotifications, setSyncNotifications] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [recentActivityLoading, setRecentActivityLoading] = useState(false);
  // Bumped after each Steam sync so the actionable notifications get re-derived
  // once the portfolio counts (needs price / needs match) have refreshed. A
  // token (not a ref) is used because it must trigger the refresh effect; the
  // "last processed" ref below ensures we only react to a genuine sync, never
  // to a mere count change (which would create a dismiss/reappear nag loop).
  const [actionNotificationRefreshToken, setActionNotificationRefreshToken] = useState(0);
  const lastProcessedActionTokenRef = useRef(0);
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
  const mobileSearchInputRef = useRef(null);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const { hidden: searchBarHidden, reveal: revealSearchBar } = useAutoHideOnScroll({
    disabled: globalSearchOpen,
  });
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
  const shouldPrepareInventoryData = activeTab === "inventory";
  const shouldPrepareManagementData =
    isDesktopRuntime && activeTab === "management";
  const shouldLoadPortfolioGroups =
    shouldPrepareInventoryData || shouldPrepareManagementData || globalSearchOpen;
  const shouldLoadGlobalSearchWatchlist =
    globalSearchOpen || activeTab === "search";
  // The snapshots behind portfolioHistory are captured investments-scope only
  // (PortfolioService::saveDailyValue runs getEnrichedInvestments with the
  // default scope), so an "all"-scope chart has to lift that curve by the
  // inventory share. The factor has to come from the *live* rows on both sides:
  // deriving it from stats.totalValue / lastSnapshotValue mixed two unrelated
  // quantities — the scope gap and every price move since the snapshot was
  // taken — so a stale snapshot silently rescaled the entire curve and moved
  // points that had been recorded correctly. Rows are fetched with rowScope
  // "all", so both summaries describe the same instant.
  const liveScopeScaleFactors = useMemo(() => {
    const investmentRows = filterRowsByScope(enrichedInvestments, "investments");
    const investmentsSummary = calculatePortfolioSummary(investmentRows);
    const allSummary = calculatePortfolioSummary(enrichedInvestments);

    const investmentsValue = Number(investmentsSummary.totalValue || 0);
    const allValue = Number(allSummary.totalValue || 0);
    if (!Number.isFinite(investmentsValue) || investmentsValue <= 0) {
      return null;
    }
    if (!Number.isFinite(allValue) || allValue <= 0) {
      return null;
    }

    const investmentsInvested = Number(investmentsSummary.totalInvested || 0);
    const allInvested = Number(allSummary.totalInvested || 0);
    const value = allValue / investmentsValue;

    return {
      value,
      invested:
        Number.isFinite(investmentsInvested) &&
        investmentsInvested > 0 &&
        Number.isFinite(allInvested) &&
        allInvested > 0
          ? allInvested / investmentsInvested
          : value,
    };
  }, [enrichedInvestments]);
  const scopedPortfolioHistory = useMemo(() => {
    if (!Array.isArray(portfolioHistory) || portfolioHistory.length === 0) {
      return [];
    }

    const normalizedScope = String(metricsScope || "investments").toLowerCase();
    if (normalizedScope !== "all") {
      return portfolioHistory;
    }

    if (!liveScopeScaleFactors) {
      return portfolioHistory;
    }

    const valueScaleFactor = Number(liveScopeScaleFactors.value);
    const investedScaleFactor = Number(liveScopeScaleFactors.invested);
    if (!Number.isFinite(valueScaleFactor) || valueScaleFactor <= 0) {
      return portfolioHistory;
    }

    // Nothing outside the investments bucket — the curve already is the
    // all-scope curve, so leave the recorded numbers untouched.
    if (Math.abs(valueScaleFactor - 1) <= 0.0001) {
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
  }, [liveScopeScaleFactors, metricsScope, portfolioHistory]);

  const focusGlobalSearchInput = useCallback(() => {
    const candidates = [globalSearchInputRef.current, mobileSearchInputRef.current];
    const target =
      candidates.find((element) => element && element.offsetParent !== null) ??
      candidates.find(Boolean);
    if (!target) {
      return;
    }
    target.focus();
    target.select?.();
  }, []);

  // Shared entry point for Strg+K / Strg+F: pin the search bar back into view,
  // open the overlay and focus the input (focus() alone does not fire onFocus
  // when the input already had focus).
  const openGlobalSearchShortcut = useCallback(() => {
    revealSearchBar();
    setGlobalSearchOpen(activeTab !== "search");
    setTimeout(() => focusGlobalSearchInput(), 40);
  }, [activeTab, focusGlobalSearchInput, revealSearchBar]);

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
    onSearch: openGlobalSearchShortcut
  }, true);

  useEffect(() => {
    const normalizedTab = runtimeTabs.includes(resolvedInitialTab) ? resolvedInitialTab : runtimeTabs[0];
    setActiveTab((current) => (current === normalizedTab ? current : normalizedTab));
  }, [resolvedInitialTab, runtimeTabs]);

  // Allow deep-linking a management sub-section via ?section= (used by the
  // system-notification bell, e.g. action_price -> prices, action_match -> matching).
  useEffect(() => {
    const requestedSection = String(searchParams.get("section") || "").trim().toLowerCase();
    const allowedSections = ["matching", "prices", "groups", "exclude", "create"];
    if (allowedSections.includes(requestedSection)) {
      setManagementSection(requestedSection);
    }
  }, [searchParams]);

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
        // Fail safe: a transient read error (IPC hiccup right after an update)
        // must not resurface the onboarding journey on an established install.
        setJourneyState({ skipped: true });
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
        notifySteamSyncDesktopRef.current = preferences.notifySteamSyncDesktop;
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
        const currentUser = await getCurrentUser();
        const groupsUserId = resolveDesktopRuntimeUserId(currentUser, 1);
        const storageKey = portfolioGroupsStorageKey(groupsUserId);

        let stored = await readLocalState(storageKey, null);
        if (!stored) {
          // One-time migration off the legacy global (un-scoped) key so groups
          // that only ever reached the local cache (never the server) are not
          // lost when the key becomes user-scoped. Adopt then clear the legacy
          // key so a later account switch on this machine cannot inherit it.
          const legacy = await readLocalState(PORTFOLIO_GROUPS_STORAGE_KEY, null);
          if (legacy && Array.isArray(legacy.groups) && legacy.groups.length > 0) {
            stored = legacy;
            await writeLocalState(storageKey, legacy);
            await writeLocalState(PORTFOLIO_GROUPS_STORAGE_KEY, { groups: [] });
          }
        }
        const localGroups = normalizePortfolioGroups(stored || { groups: [] });

        let remoteGroups = [];
        let remoteReachable = false;
        try {
          const remoteResponse = await fetchPortfolioGroupsSetting();
          remoteGroups = normalizePortfolioGroups(remoteResponse?.data?.groups || []);
          remoteReachable = true;
        } catch (remoteLoadError) {
          console.warn("Failed to load remote portfolio groups", remoteLoadError);
        }

        // Merge instead of letting the server wholesale-overwrite the local cache.
        // A group that only ever reached the local cache (e.g. saved while upstream
        // was unreachable and the sidecar returned a desktop-local-fallback success)
        // must not be dropped just because the server holds a different/older subset.
        // The server drops `color` until its whitelist ships, so a remote group
        // must not overwrite a colour the local cache still knows.
        const nextGroups = mergePortfolioGroups(
          localGroups,
          preservePortfolioGroupColors(remoteGroups, localGroups),
        );

        // If the merge carries anything the server does not already have (local-only
        // or locally-newer groups), push the merged set up so the server catches up.
        // Only attempt when the server was actually reachable — otherwise the cache
        // keeps the merged set and a later (online) load self-heals, instead of
        // firing a doomed PUT on every load while offline.
        if (
          remoteReachable &&
          portfolioGroupsSignature(nextGroups) !== portfolioGroupsSignature(remoteGroups)
        ) {
          try {
            await updatePortfolioGroupsSetting(nextGroups);
          } catch (migrationError) {
            console.warn("Failed to push merged portfolio groups to server", migrationError);
          }
        }

        // Never persist an EMPTY set over the cache after a failed/absent read:
        // a transient local-cache read failure (observed right after an app
        // update) would otherwise permanently wipe groups that only exist in
        // the local cache. Writing an empty set adds no information anyway.
        if (nextGroups.length > 0 || stored) {
          await writeLocalState(storageKey, { groups: nextGroups });
        }
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
        setPortfolioGroupError(t("errors.groupsLoad"));
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
  }, [shouldLoadPortfolioGroups, t]);

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
        setManagementError(loadError?.message || t("errors.managementLoad"));
        setManagementInvestments([]);
        setMatchingRows([]);
      } finally {
        setManagementLoading(false);
        setMatchingLoading(false);
      }
    };

    void loadManagementInvestments();
  }, [compositionRefreshToken, isDesktopRuntime, shouldPrepareInventoryData, shouldPrepareManagementData, t]);

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

        // The manual "Typ" vocabulary (weapon, knife, container, …) is not the
        // catalog's (skin, case, sticker_capsule, …), so forwarding it as a
        // filter matched nothing and returned an empty list. Since picking a
        // catalog hit is now required to create an investment, that made the
        // item unreachable as soon as a type was selected. Search unfiltered.
        const response = await searchWatchlistItems(
          query,
          { sortBy: "relevance" },
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
          setManualNameSuggestionsError(error?.message || t("errors.suggestionsLoad"));
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
  }, [managementSection, manualItemDraft.name, manualSelectedSuggestion, t]);

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
        const unreadCount = rows.filter(
          (row) => ACTION_NOTIFICATION_CATEGORIES.includes(row.category) && row.unread,
        ).length;
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

  // The activity feed reads the local sync queue, which only the desktop
  // runtime has — the server keeps no per-user operation log.
  useEffect(() => {
    const loadRecentActivity = async () => {
      const isDesktopLocal =
        typeof window !== "undefined" && Boolean(window.electronAPI?.localStore?.listOperations);
      if (!isDesktopLocal) {
        setRecentActivity([]);
        return;
      }

      setRecentActivityLoading(true);
      try {
        const user = await getCurrentUser();
        const userId = resolveDesktopRuntimeUserId(user, 1);
        const operations = await window.electronAPI.localStore.listOperations(userId, 12);
        setRecentActivity(Array.isArray(operations) ? operations : []);
      } catch (activityError) {
        console.warn("Failed to load recent activity", activityError);
        setRecentActivity([]);
      } finally {
        setRecentActivityLoading(false);
      }
    };

    void loadRecentActivity();
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

    const applyStatus = (payload) => {
      if (!payload || typeof payload !== "object") {
        return;
      }

      setAppUpdateNotification((current) => ({
        ...current,
        ...payload,
      }));

      const nextState = String(payload.state || "");
      // "installing" is user-initiated and needs no badge; "handoff" does,
      // because it leaves an action pending in another app.
      if (["available", "manual", "downloading", "downloaded", "handoff", "error"].includes(nextState)) {
        setAppUpdateUnread(true);
      }
      if (nextState === "not-available") {
        setAppUpdateUnread(false);
      }
    };

    let cancelled = false;
    let receivedLiveStatus = false;

    const unsubscribe = window.electronAPI.updater.onStatus((payload) => {
      receivedLiveStatus = true;
      applyStatus(payload);
    });

    // The automatic check runs shortly after app start and may have pushed its
    // result before this page existed — pull the last status once on mount.
    if (window.electronAPI.updater.getLastStatus) {
      void window.electronAPI.updater
        .getLastStatus()
        .then((payload) => {
          // A live push that landed while this call was in flight is newer,
          // so the snapshot must never overwrite it.
          if (cancelled || receivedLiveStatus) {
            return;
          }
          applyStatus(payload);
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
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
        throw new Error(inventoryResult?.error || t("errors.steamInventoryLoad"));
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
      // A sync no longer creates a "N neue Items" log entry. Instead we
      // re-derive the actionable notifications (items needing a price /
      // needing match confirmation) once the portfolio counts have refreshed;
      // see the actionNotificationRefreshToken effect below. The badge count
      // (newItemsCount) is set there too, so we only track the sync time here.
      if (notifySteamSyncDesktopRef.current) {
        setActionNotificationRefreshToken((token) => token + 1);
      }
      if (imported > 0) {
        setSyncNotification((current) => ({
          ...current,
          lastSyncedAt: syncedAt,
        }));
        if (manual) {
          setManualSteamSyncInfo("");
        }
      } else {
        setSyncNotification((current) => ({
          ...current,
          lastSyncedAt: syncedAt,
        }));
        if (manual) {
          setManualSteamSyncInfo(t("success.noNewSteamItems"));
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
  }, [authRequired, isElectronRuntime, isSteamSyncing, portfolioPreferences.steamImportBucket, refreshPortfolio, t]);

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
    let cancelled = false;
    const isDesktopLocal =
      typeof window !== "undefined" && Boolean(window.electronAPI?.localStore);

    // Load one item's price history (desktop-local first, then server). Returns raw
    // rows carrying priceUsd — the shared loader for single items and group members.
    const loadItemHistoryRows = async (itemId, name) => {
      const id = Number(itemId || 0);
      if (id <= 0) {
        return [];
      }
      if (isDesktopLocal) {
        try {
          const local = await window.electronAPI.localStore.listPriceHistory(id);
          if (Array.isArray(local) && local.length > 0) {
            return local;
          }
        } catch {
          // fall through to the server read
        }
      }
      const history = await fetchItemPriceHistory(id, { itemName: name });
      return Array.isArray(history) ? history : [];
    };

    // Bounded-concurrency map so a group with many clusters does not fan out into
    // dozens of simultaneous server reads.
    const mapWithConcurrency = async (items, limit, worker) => {
      const results = new Array(items.length);
      let cursor = 0;
      const runners = new Array(Math.max(1, Math.min(limit, items.length)))
        .fill(0)
        .map(async () => {
          for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) {
              return;
            }
            results[index] = await worker(items[index]);
          }
        });
      await Promise.all(runners);
      return results;
    };

    const loadItemHistory = async () => {
      if (!selectedItemWithLive) {
        setSelectedItemHistory([]);
        setSelectedItemHistoryLoading(false);
        return;
      }

      const kind = selectedItemWithLive.__detailKind;

      // Group: weighted total-value-over-time from the member clusters' histories.
      if (kind === "group") {
        setSelectedItemHistoryLoading(true);
        try {
          const clusters = Array.isArray(selectedItemWithLive.clusters)
            ? selectedItemWithLive.clusters
            : [];
          const members = clusters
            .map((cluster) => ({
              itemId: Number(cluster?.itemId || 0),
              quantity: Number(cluster?.quantity || 0),
              name: cluster?.name,
            }))
            .filter((member) => member.itemId > 0 && member.quantity > 0);
          const withHistory = await mapWithConcurrency(members, 6, async (member) => ({
            itemId: member.itemId,
            quantity: member.quantity,
            history: await loadItemHistoryRows(member.itemId, member.name),
          }));
          if (cancelled) {
            return;
          }
          setSelectedItemHistory(buildWeightedGroupHistory(withHistory));
        } catch (groupHistoryError) {
          console.error(t("errors.groupHistory"), groupHistoryError);
          if (!cancelled) {
            setSelectedItemHistory([]);
          }
        } finally {
          if (!cancelled) {
            setSelectedItemHistoryLoading(false);
          }
        }
        return;
      }

      // Single item or a single group cluster (both resolve to one catalog itemId).
      setSelectedItemHistoryLoading(true);
      try {
        const itemId = Number(selectedItemWithLive.itemId ?? selectedItemWithLive.item_id ?? 0);

        if (itemId > 0) {
          const history = await loadItemHistoryRows(itemId, selectedItemWithLive.name);
          if (!cancelled) {
            setSelectedItemHistory(history);
          }
          return;
        }

        // Legacy fallback (real investments only, not synthetic group-cluster ids).
        if (kind !== "group-cluster") {
          const history = await fetchPortfolioInvestmentHistory(selectedItemWithLive.id, {
            itemName: selectedItemWithLive.name,
          });
          if (!cancelled) {
            setSelectedItemHistory(history || []);
          }
          return;
        }

        if (!cancelled) {
          setSelectedItemHistory([]);
        }
      } catch (historyError) {
        console.error(t("errors.positionHistory"), historyError);
        if (!cancelled) {
          setSelectedItemHistory([]);
        }
      } finally {
        if (!cancelled) {
          setSelectedItemHistoryLoading(false);
        }
      }
    };

    void loadItemHistory();
    return () => {
      cancelled = true;
    };
  }, [selectedItemWithLive, t]);

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
    const currentUser = await getCurrentUser();
    const storageKey = portfolioGroupsStorageKey(resolveDesktopRuntimeUserId(currentUser, 1));
    await writeLocalState(storageKey, { groups: normalizedGroups });
    try {
      const remoteResponse = await updatePortfolioGroupsSetting(normalizedGroups);
      const remoteEcho = remoteResponse?.data?.groups;
      // Adopt the server echo only when it actually carries groups: a degraded
      // sidecar fallback or a silently-failed upstream write can echo an empty
      // list, which must not wipe the set we just saved locally.
      const remoteGroups =
        Array.isArray(remoteEcho) && (remoteEcho.length > 0 || normalizedGroups.length === 0)
          ? normalizePortfolioGroups(
              preservePortfolioGroupColors(remoteEcho, normalizedGroups),
            )
          : normalizedGroups;
      setPortfolioGroups(remoteGroups);
      await writeLocalState(storageKey, { groups: remoteGroups });
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
      color: normalizePortfolioGroupColor(group.color),
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
    const color = normalizePortfolioGroupColor(portfolioGroupDraft?.color);
    if (!name) {
      setPortfolioGroupError(t("errors.groupNameRequired"));
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
                color,
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
            color,
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
          color: normalizePortfolioGroupColor(savedGroup.color),
        });
      }
      setPortfolioGroupMessage(existingGroup ? t("success.groupUpdated") : t("success.groupCreated"));
      setPortfolioGroupError("");
    } catch (groupSaveError) {
      console.warn("Failed to persist portfolio group", groupSaveError);
      setPortfolioGroupError(t("errors.groupSaveFailed"));
    }
  }, [
    persistPortfolioGroups,
    portfolioGroupDraft,
    portfolioGroupEditorId,
    portfolioGroups,
    t,
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
      setPortfolioGroupMessage(t("success.groupDeleted"));
      setPortfolioGroupError("");
    } catch (groupDeleteError) {
      console.warn("Failed to delete portfolio group", groupDeleteError);
      setPortfolioGroupError(t("errors.groupDeleteFailed"));
    }
  }, [
    persistPortfolioGroups,
    portfolioGroupEditorId,
    portfolioGroups,
    resetPortfolioGroupEditor,
    t,
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
      setPortfolioGroupMessage(t("success.membersAdded"));
      setPortfolioGroupError("");
    } catch (groupAssignError) {
      console.warn("Failed to assign investments to group", groupAssignError);
      setPortfolioGroupError(t("errors.membersAddFailed"));
    }
  }, [persistPortfolioGroups, portfolioGroups, t]);

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
      setPortfolioGroupMessage(t("success.membersRemoved"));
      setPortfolioGroupError("");
    } catch (groupRemoveError) {
      console.warn("Failed to remove investments from group", groupRemoveError);
      setPortfolioGroupError(t("errors.membersRemoveFailed"));
    }
  }, [persistPortfolioGroups, portfolioGroups, t]);

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

  // Prefetch the watchlist view (data + lazy chunk) once during idle after the
  // initial dashboard load, so the first Watchlist tab visit paints instantly
  // from the module snapshot instead of blocking on live fetches.
  const watchlistPrefetchStartedRef = useRef(false);
  useEffect(() => {
    if (portfolioLoading || watchlistPrefetchStartedRef.current) {
      return;
    }

    let cancelled = false;
    let timeoutId = null;
    let idleId = null;

    const runPrefetch = () => {
      if (cancelled) {
        return;
      }
      watchlistPrefetchStartedRef.current = true;
      void import("../lib/watchlistViewSnapshot.js")
        .then((module) => module.prefetchWatchlistViewData?.())
        .catch((error) => {
          console.warn("[watchlist-prefetch] scheduling failed", error);
        });
    };

    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(runPrefetch, { timeout: 5000 });
    } else if (typeof window !== "undefined") {
      timeoutId = window.setTimeout(runPrefetch, 2000);
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
  }, [portfolioLoading]);

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
          sourceLabel: source === "investment" ? t("source.investments") : t("source.inventory"),
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
          sourceLabel: t("source.watchlist"),
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
  }, [enrichedInvestments, globalSearchWatchlistItems, t]);

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
        return left.name.localeCompare(right.name, getActiveIntlLocale());
      })
      .slice(0, 8);
  }, [globalSearchKnownItems, globalSearchTermNormalized]);
  const globalSearchLocalSuggestionGroups = useMemo(() => {
    const order = [
      { key: "investment", label: t("source.investments") },
      { key: "inventory", label: t("source.inventory") },
      { key: "watchlist", label: t("source.watchlist") },
    ];
    return order
      .map((group) => ({
        ...group,
        entries: globalSearchLocalSuggestions.filter((entry) => entry.source === group.key),
      }))
      .filter((group) => group.entries.length > 0);
  }, [globalSearchLocalSuggestions, t]);

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
        setGlobalSearchCatalogError(watchlistError?.message || t("errors.watchlistAddFailed"));
      } finally {
        setGlobalSearchAddingItem("");
      }
    },
    [loadGlobalSearchWatchlistItems, t],
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

  // Strg+K is handled by useKeyboard; Strg+F is the second, more "find"-ish
  // binding for the same action.
  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const handleShortcut = (event) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.key?.toLowerCase() !== "f") {
        return;
      }
      event.preventDefault();
      openGlobalSearchShortcut();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [openGlobalSearchShortcut]);

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
  // Two currencies meet in the hero, and which one wins depends on the branch:
  //
  //   - row-derived figures (`stats.*`) are EUR — they sum `displayPrice`/`buyPrice`,
  //     both of which descend from `PricingService::priceEur` (`priceUsd * usdToEur`);
  //   - chart-derived figures (`portfolioHistory.wert`, `chartTrendData`, the hover
  //     payload) are USD, as `PortfolioService::getHistory` states at the source.
  //
  // So every hero figure carries a flag naming its source and the formatter follows
  // that flag. Formatting the whole page as one currency is what made the hero print
  // 1.329 € beside an allocation legend summing to 1.538 € — the same portfolio,
  // divided by the USD rate once too often.
  const portfolioTotalValueForDisplay =
    hasStatsTotalValue
      ? statsTotalValue
      : hasHistoryValue
        ? historyValue
        : 0;
  const portfolioTotalValueIsUsd = !hasStatsTotalValue && hasHistoryValue;
  const headerPortfolioValue = hoveredChartData?.wert ?? portfolioTotalValueForDisplay;
  const headerPortfolioValueIsUsd =
    hoveredChartData?.wert != null ? true : portfolioTotalValueIsUsd;
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
  // Mirrors the chain above branch for branch: the history summary and the chart's
  // range delta are USD, `stats.totalProfitEuro` is EUR despite its name.
  const defaultProfitIsUsd = shouldPreferHistorySummary && hasHistoryProfitEuro
    ? true
    : hasStatsTotalValue && hasStatsProfitEuro
      ? false
      : hasRangeDeltaValue;
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
  // The subtraction fallback mixes the two sources: `headerPortfolioValue` is USD
  // while hovering, `stats.totalInvested` is EUR always. Lift the invested side into
  // the value's currency first — a difference between two currencies is wrong in
  // both, no matter which one it is later formatted as.
  const headerInvestedForHover = headerPortfolioValueIsUsd
    ? convertToUsd(convertPrice(Number(stats.totalInvested || 0)))
    : Number(stats.totalInvested || 0);
  const headerProfitEuro = hoveredChartData
    ? Number.isFinite(hoveredProfitEuro)
      ? hoveredProfitEuro
      : (headerPortfolioValue || 0) - headerInvestedForHover
    : defaultProfitEuro;
  const headerProfitIsUsd = hoveredChartData
    ? Number.isFinite(hoveredProfitEuro) || headerPortfolioValueIsUsd
    : defaultProfitIsUsd;
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
    const freshIdSet = new Set(csUpdatesFreshItemIds.map((id) => String(id)));
    return (
      csUpdatesItems.find(
        (item) => item.source === "ban_wave_detected" && freshIdSet.has(String(item.id)),
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

  // Seasonal Year-Wrapped entry point (Dec 15 - Jan 31). Desktop only: the
  // per-purchase dates Wrapped needs live exclusively in the local SQLite rows.
  const wrappedSeason = useMemo(() => resolveWrappedSeason(new Date()), []);
  const wrappedDismissKey = `${YEAR_WRAPPED_DISMISS_KEY_PREFIX}${wrappedSeason.year}`;
  const [wrappedBannerDismissed, setWrappedBannerDismissed] = useState(false);

  useEffect(() => {
    try {
      setWrappedBannerDismissed(localStorage.getItem(wrappedDismissKey) === "1");
    } catch {
      setWrappedBannerDismissed(false);
    }
  }, [wrappedDismissKey]);

  const showYearWrappedBanner =
    isDesktopRuntime && wrappedSeason.active && !wrappedBannerDismissed;

  const handleOpenYearWrapped = useCallback(() => {
    navigate(`/wrapped?year=${wrappedSeason.year}`);
  }, [navigate, wrappedSeason.year]);

  const handleDismissYearWrapped = useCallback(() => {
    try {
      localStorage.setItem(wrappedDismissKey, "1");
    } catch {
      // Ignore storage failures — the banner simply returns on next load.
    }
    setWrappedBannerDismissed(true);
  }, [wrappedDismissKey]);

  useEffect(() => {
    if (!freshBanWaveItem || !isDesktopRuntime) return;
    if (!portfolioPreferences.notifyBanWaveDesktop) return;

    // Capture primitives at effect entry to avoid stale closure during async IPC
    const itemId = String(freshBanWaveItem.id);
    const itemTitle = freshBanWaveItem.title || t("notifications.banWaveMessage");
    const itemPublishedAt = freshBanWaveItem.publishedAt || new Date().toISOString();
    const itemAiImpactLevel = String(freshBanWaveItem.aiImpactLevel || "").toLowerCase();

    const lastNotifiedId = localStorage.getItem(BAN_WAVE_NOTIFIED_KEY) || "";
    if (itemId === lastNotifiedId) return;

    const itemLevel = IMPACT_LEVELS.indexOf(itemAiImpactLevel);
    const minLevel = IMPACT_LEVELS.indexOf(portfolioPreferences.notifyBanWaveDesktopMinLevel);

    // Unrated (-1): skip without stamping so we retry once the item gets rated
    if (itemLevel === -1) return;
    // Below threshold: skip without stamping so user can lower threshold later and still get notified
    if (minLevel >= 0 && itemLevel < minLevel) return;

    const trigger = async () => {
      try {
        const user = await getCurrentUser();
        const userId = resolveDesktopRuntimeUserId(user, 1);
        if (window.electronAPI?.localStore?.createNotification) {
          await window.electronAPI.localStore.createNotification({
            userId,
            category: "cs_updates",
            title: t("notifications.banWaveTitle"),
            message: itemTitle,
            payload: { source: "ban_wave", itemId },
            createdAt: itemPublishedAt,
          });
        }
      } catch {
        // non-critical
      }
      localStorage.setItem(BAN_WAVE_NOTIFIED_KEY, itemId);
    };

    void trigger();
  }, [freshBanWaveItem, isDesktopRuntime, portfolioPreferences.notifyBanWaveDesktop, portfolioPreferences.notifyBanWaveDesktopMinLevel, t]);

  const freshCsUpdateItem = useMemo(() => {
    if (!csUpdatesItems || csUpdatesFreshItemIds.length === 0) return null;
    const freshIdSet = new Set(csUpdatesFreshItemIds.map((id) => String(id)));
    // Newest fresh item that is a regular CS update; ban-wave items are handled
    // by their own notification effect above to avoid double-firing.
    return (
      csUpdatesItems.find(
        (item) => item.source !== "ban_wave_detected" && freshIdSet.has(String(item.id)),
      ) ?? null
    );
  }, [csUpdatesItems, csUpdatesFreshItemIds]);

  useEffect(() => {
    if (!freshCsUpdateItem || !isDesktopRuntime) return;
    if (!portfolioPreferences.notifyCsUpdatesDesktop) return;

    // Capture primitives at effect entry to avoid stale closure during async IPC
    const itemId = String(freshCsUpdateItem.id);
    const itemTitle = freshCsUpdateItem.title || t("notifications.csUpdateTitle");
    const itemPublishedAt = freshCsUpdateItem.publishedAt || new Date().toISOString();
    const itemAiImpactLevel = String(freshCsUpdateItem.aiImpactLevel || "").toLowerCase();

    const lastNotifiedId = localStorage.getItem(CS_UPDATE_NOTIFIED_KEY) || "";
    if (itemId === lastNotifiedId) return;

    const itemLevel = IMPACT_LEVELS.indexOf(itemAiImpactLevel);
    const minLevel = IMPACT_LEVELS.indexOf(portfolioPreferences.notifyCsUpdatesDesktopMinLevel);

    // Unrated (-1): skip without stamping so we retry once the item gets rated
    if (itemLevel === -1) return;
    // Below threshold: skip without stamping so user can lower threshold later and still get notified
    if (minLevel >= 0 && itemLevel < minLevel) return;

    const trigger = async () => {
      try {
        const user = await getCurrentUser();
        const userId = resolveDesktopRuntimeUserId(user, 1);
        if (window.electronAPI?.localStore?.createNotification) {
          await window.electronAPI.localStore.createNotification({
            userId,
            category: "cs_updates",
            title: t("notifications.csUpdateTitle"),
            message: itemTitle,
            payload: { source: "cs_update", itemId },
            createdAt: itemPublishedAt,
          });
        }
      } catch {
        // non-critical
      }
      localStorage.setItem(CS_UPDATE_NOTIFIED_KEY, itemId);
    };

    void trigger();
  }, [freshCsUpdateItem, isDesktopRuntime, portfolioPreferences.notifyCsUpdatesDesktop, portfolioPreferences.notifyCsUpdatesDesktopMinLevel, t]);

  const formatUsdPrice = useCallback(
    (value, decimals = 2) =>
      formatPrice(Number(value || 0), {
        useUsd: true,
        buyPriceUsd: Number(value || 0),
        decimals,
      }),
    [formatPrice],
  );
  // Follows the source flag, not the page: `useUsd` on the EUR branch divides the
  // total by the USD rate a second time (see the note at `headerPortfolioValue`).
  const headerPortfolioValueLabel = headerPortfolioValueIsUsd
    ? formatUsdPrice(headerPortfolioValue || 0)
    : formatPrice(headerPortfolioValue || 0);
  const headerProfitSubLabel = hoveredChartData?.date
    ? formatDateSafe(hoveredChartData.date)
    : shouldPreferHistorySummary || (hasStatsTotalValue && hasStatsRoiPercent)
      ? t("header.roiTotal")
      : t("header.roiRange", { range: String(chartTrendData?.rangeLabel || "90T") });
  const managementClusters = buildManagementClusters(managementInvestments);
  const managementInvestmentById = new Map(
    managementInvestments.map((item) => [String(item.id), item]),
  );
  const portfolioGroupSummaries = useMemo(
    () =>
      buildPortfolioGroupSummaries({
        groups: portfolioGroups,
        clusteredInvestments: enrichedInvestments,
        // managementInvestments is desktop-only (local SQLite). On web the
        // enriched server rows are the raw source — without this fallback,
        // groups can never resolve members in the web runtime.
        rawInvestments:
          managementInvestments.length > 0 ? managementInvestments : enrichedInvestments,
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
        return right.name.localeCompare(left.name, getActiveIntlLocale());
      }
      if (managementSortBy === "qty_desc") {
        return right.totalCount - left.totalCount || left.name.localeCompare(right.name, getActiveIntlLocale());
      }
      if (managementSortBy === "qty_asc") {
        return left.totalCount - right.totalCount || left.name.localeCompare(right.name, getActiveIntlLocale());
      }
      if (managementSortBy === "updated_desc") {
        return getClusterUpdatedAt(right) - getClusterUpdatedAt(left) || left.name.localeCompare(right.name, getActiveIntlLocale());
      }
      return left.name.localeCompare(right.name, getActiveIntlLocale());
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
        return getClusterUpdatedAt(right) - getClusterUpdatedAt(left) || left.name.localeCompare(right.name, getActiveIntlLocale());
      }
      return left.name.localeCompare(right.name, getActiveIntlLocale());
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
    uniqueTypes.sort((left, right) => left.localeCompare(right, getActiveIntlLocale()));
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
        return rightValue - leftValue || String(left.name || "").localeCompare(String(right.name || ""), getActiveIntlLocale());
      })
      .slice(0, 8);
  }, [globalSearchTermNormalized, portfolioGroupSummaryById, portfolioGroups]);
  const pendingMatchingRows = matchingRows.filter((row) => row.status === "suggested");
  // Every matched steamAssetId must be collected — a Map keyed by csfloatInvestmentId
  // would drop all but the last steamId when one aggregated CSFloat row (e.g. a
  // quantity position) is matched against several individual Steam-inventory twins.
  const confirmedOrAutoMatchedSteamKeys = new Set();
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
    confirmedOrAutoMatchedSteamKeys.add(steamId);
  });
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
  /**
   * The dashboard's Watchlist-Alarme widget.
   *
   * Only rows that actually carry a target price qualify — the widget claims
   * "N aktiv", and counting targetless rows would make that number the
   * watchlist's size. Reached targets sort first (they are the ones asking for
   * a decision), the rest by how close they are.
   */
  const watchlistAlerts = useMemo(() => {
    const withTargets = (Array.isArray(dashboardWatchlistItems) ? dashboardWatchlistItems : [])
      .map((item) => ({ item, target: resolveWatchlistTarget(item) }))
      .filter((entry) => entry.target.hasTarget);

    const sorted = [...withTargets].sort((left, right) => {
      if (left.target.reached !== right.target.reached) {
        return left.target.reached ? -1 : 1;
      }
      const leftDistance = Number.isFinite(left.target.distancePercent)
        ? Math.abs(left.target.distancePercent)
        : Number.POSITIVE_INFINITY;
      const rightDistance = Number.isFinite(right.target.distancePercent)
        ? Math.abs(right.target.distancePercent)
        : Number.POSITIVE_INFINITY;
      return leftDistance - rightDistance;
    });

    const rows = sorted.slice(0, 4).map(({ item, target }) => {
      const targetLabel = formatPrice(target.targetPriceUsd, {
        useUsd: true,
        buyPriceUsd: target.targetPriceUsd,
      });
      // "Kauf"/"Verkauf", not "Kaufziel"/"Verkaufsziel": the note shares one row
      // with the item name, and the direction is the part that cannot be
      // inferred from the number beside it.
      const kind = target.direction === TARGET_DIRECTION_ABOVE ? t("target.sell") : t("target.buy");
      const suffix = target.reached
        ? t("target.reached")
        : Number.isFinite(target.distancePercent)
          ? formatPercent(Math.abs(target.distancePercent), 1)
          : null;

      return {
        id: String(item?.id || item?.name),
        name: item?.name || t("item.watchlistItem"),
        note: suffix ? `${kind} ${targetLabel} · ${suffix}` : `${kind} ${targetLabel}`,
        reached: target.reached,
      };
    });

    return { rows, activeCount: withTargets.length };
  }, [dashboardWatchlistItems, formatPrice, t]);
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
        return String(right.name || "").localeCompare(String(left.name || ""), getActiveIntlLocale());
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
      return String(left.name || "").localeCompare(String(right.name || ""), getActiveIntlLocale());
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
  // Group the (already filtered/sorted) price rows by name so identical items
  // (e.g. many single Steam-inventory copies of the same case) render as one row
  // with a quantity instead of one row per position.
  const filteredPriceClusters = (() => {
    const groups = new Map();
    filteredPriceItems.forEach((item) => {
      const key = getItemNameKey(item) || String(item.id || "");
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: item.name || item.marketHashName || translate("portfolio:item.unknown"),
          imageUrl: item.imageUrl || item.iconUrl || null,
          bucket: normalizeBucket(item.bucket, "inventory"),
          positions: [],
        });
      }
      groups.get(key).positions.push(item);
    });
    return Array.from(groups.values()).map((cluster) => {
      const totalQuantity = cluster.positions.reduce(
        (sum, position) => sum + Math.max(1, Number(position.quantity || 1)),
        0,
      );
      const prices = cluster.positions.map((position) =>
        Number(position.buyPriceUsd ?? position.buyPrice ?? 0),
      );
      const allSamePrice = prices.every((price) => price === prices[0]);
      return {
        ...cluster,
        totalQuantity,
        currentPrice: allSamePrice ? prices[0] : null,
        suggestion: suggestedPriceByNameKey.get(cluster.key) || null,
      };
    });
  })();
  const handleSaveClusterPrice = async (cluster, explicitPriceUsd = null) => {
    let usdPrice;
    if (explicitPriceUsd !== null && explicitPriceUsd !== undefined) {
      usdPrice = Number(explicitPriceUsd);
    } else {
      const typed = Number(priceDrafts[`cluster:${cluster.key}`]);
      if (!Number.isFinite(typed) || typed < 0) {
        return;
      }
      usdPrice = convertToUsd(typed);
    }
    if (!Number.isFinite(usdPrice) || usdPrice < 0) {
      return;
    }
    const normalizedPrice = Number(usdPrice.toFixed(2));
    const clusterSavingKey = `cluster:${cluster.key}`;

    // Positions in a cluster are identical, fungible items bought together, so one
    // price applies to all of them. Persist every position first and refresh the
    // portfolio only ONCE afterwards — delegating to handleSaveSteamItemPrice per
    // position would trigger N sequential portfolio refreshes for an N-item cluster.
    setSavingPriceItemId(clusterSavingKey);
    try {
      for (const position of cluster.positions) {
        await window.electronAPI.localStore.upsertInvestment({
          ...position,
          id: position.id,
          buyPriceUsd: normalizedPrice,
          buyPrice: normalizedPrice,
          priceSetMode: "user_confirmed",
          platform: "steam_inventory",
          source: "steam_inventory",
        });
      }
      const clusterPositionIds = new Set(
        cluster.positions.map((position) => String(position?.id || "")),
      );
      setManagementInvestments((current) =>
        current.map((entry) =>
          clusterPositionIds.has(String(entry?.id || ""))
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
        [clusterSavingKey]:
          normalizedPrice > 0 ? convertFromUsd(normalizedPrice).toFixed(2) : "",
      }));
      await refreshPortfolio();
      setCompositionRefreshToken((current) => current + 1);
    } catch (saveError) {
      console.error("Failed to save cluster buy price", saveError);
    } finally {
      setSavingPriceItemId(null);
    }
  };
  const handleAcceptSuggestedClusterPrice = async (cluster, suggestedPriceUsd) => {
    const normalizedSuggestion = Number(suggestedPriceUsd);
    if (!Number.isFinite(normalizedSuggestion) || normalizedSuggestion <= 0) {
      return;
    }
    setPriceDrafts((current) => ({
      ...current,
      [`cluster:${cluster.key}`]: convertFromUsd(normalizedSuggestion).toFixed(2),
    }));
    await handleSaveClusterPrice(cluster, normalizedSuggestion);
  };
  const priceMissingCount = rawSteamInventoryItems.filter((item) => {
    const price = Number(item.buyPriceUsd ?? item.buyPrice ?? 0);
    return !Number.isFinite(price) || price <= 0;
  }).length;

  // After a Steam sync, re-derive the actionable notifications from the fresh
  // portfolio counts. Runs once per sync (flag-gated) so it behaves like an
  // event, not a live mirror: a dismissed item does not instantly reappear.
  // Notifications self-clear when their count reaches 0.
  useEffect(() => {
    if (!isDesktopRuntime) return;
    // Only react to a genuine sync (token bump), not to count changes caused by
    // the user pricing/confirming items — otherwise a just-dismissed item would
    // instantly reappear.
    if (actionNotificationRefreshToken === lastProcessedActionTokenRef.current) return;
    if (portfolioLoading) return; // wait for counts to reflect the sync
    lastProcessedActionTokenRef.current = actionNotificationRefreshToken;

    void (async () => {
      const localStore = window.electronAPI?.localStore;
      if (!localStore?.createNotification) return;
      try {
        const user = await getCurrentUser();
        const userId = resolveDesktopRuntimeUserId(user, 1);

        // Clear the previous action items, then recreate for whatever work
        // remains. Deleting first keeps counts accurate and avoids stacking.
        if (localStore.deleteAllNotifications) {
          await localStore.deleteAllNotifications(userId, "action_match");
          await localStore.deleteAllNotifications(userId, "action_price");
        }

        if (matchingSuggestedCount > 0) {
          await localStore.createNotification({
            userId,
            category: "action_match",
            title: t("actions.matchingTitle"),
            message: t("actions.matchingMessage", { count: matchingSuggestedCount }),
            payload: { count: matchingSuggestedCount },
          });
        }
        if (priceMissingCount > 0) {
          await localStore.createNotification({
            userId,
            category: "action_price",
            title: t("actions.priceTitle"),
            message: t("actions.priceMessage", { count: priceMissingCount }),
            payload: { count: priceMissingCount },
          });
        }

        if (localStore.listNotifications) {
          const rows = await localStore.listNotifications(userId, { limit: 20 });
          const list = Array.isArray(rows) ? rows : [];
          setSyncNotifications(list);
          setSyncNotification((current) => ({
            ...current,
            newItemsCount: list.filter(
              (row) => ACTION_NOTIFICATION_CATEGORIES.includes(row.category) && row.unread,
            ).length,
          }));
        }
      } catch (error) {
        console.warn("Failed to refresh action notifications", error);
      }
    })();
  }, [
    isDesktopRuntime,
    portfolioLoading,
    actionNotificationRefreshToken,
    matchingSuggestedCount,
    priceMissingCount,
    t,
  ]);

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
  // Manual Steam<->CSFloat link. The store upserts on
  // UNIQUE(user, steam_asset, csfloat_investment), so re-linking an existing
  // suggestion promotes it instead of creating a second row.
  const handleManualMatchCreate = async ({ steamItem, csfloatItem }) => {
    if (!window.electronAPI?.localStore?.createManualSteamCsfloatMatch) {
      return;
    }
    if (!steamItem || !csfloatItem) {
      return;
    }
    const user = await getCurrentUser();
    await window.electronAPI.localStore.createManualSteamCsfloatMatch({
      userId: resolveDesktopRuntimeUserId(user, 1),
      steamAssetId: String(steamItem.steamAssetId || steamItem.id || ""),
      steamItemName: String(steamItem.marketHashName || steamItem.name || ""),
      csfloatInvestmentId: String(csfloatItem.id || ""),
      csfloatTradeId: csfloatItem.externalTradeId || null,
    });
    await refreshPortfolio();
    setCompositionRefreshToken((current) => current + 1);
  };

  const handlePriceDraftChange = (itemId, value) => {
    setPriceDrafts((current) => ({
      ...current,
      [itemId]: value,
    }));
  };

  const handleSaveSteamItemPrice = async (item, explicitPriceUsd = null) => {
    // explicitPriceUsd (e.g. the accepted live suggestion) is already USD and must
    // NOT be converted. A value typed into the draft field is in the user's active
    // display currency and is converted to USD here, at the input boundary.
    let usdPrice;
    if (explicitPriceUsd !== null && explicitPriceUsd !== undefined) {
      usdPrice = Number(explicitPriceUsd);
    } else {
      const typed = Number(priceDrafts[item.id]);
      if (!Number.isFinite(typed) || typed < 0) {
        return;
      }
      usdPrice = convertToUsd(typed);
    }
    if (!Number.isFinite(usdPrice) || usdPrice < 0) {
      return;
    }
    const normalizedPrice = Number(usdPrice.toFixed(2));

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
        // Draft field holds the display-currency value, not USD.
        [item.id]: normalizedPrice > 0 ? convertFromUsd(normalizedPrice).toFixed(2) : "",
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
      // The suggestion is USD; show it in the display currency in the draft field.
      [item.id]: convertFromUsd(normalizedSuggestion).toFixed(2),
    }));

    // Pass the USD suggestion straight through — it must not be re-converted.
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
    const catalogType = String(candidate.itemType || "").trim().toLowerCase();
    setManualItemDraft((current) => ({
      ...current,
      name: String(candidate.marketHashName || candidate.displayName || current.name || "").trim(),
      // The catalog's vocabulary only partly overlaps the manual "Typ" select.
      // An unknown value would make the select fall back to its first option,
      // silently filing every catalog pick as "Anderes".
      type: MANUAL_ITEM_TYPES.includes(catalogType) ? catalogType : current.type,
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
    // buyPriceInput is in the user's active display currency; convert to USD (the
    // stored source of truth) at this boundary.
    const buyPriceInput = Number(manualItemDraft.buyPriceInput);
    const bucket = manualItemDraft.bucket === "inventory" ? "inventory" : "investment";
    const platform = String(manualItemDraft.platform || "manual").trim().toLowerCase() || "manual";
    const fundingMode =
      String(manualItemDraft.fundingMode || "wallet_funded").trim().toLowerCase() === "balance_funded"
        ? "balance_funded"
        : "wallet_funded";
    // Store what the user actually sees in the "Typ" select. The catalog's own
    // itemType uses a different vocabulary, so preferring it here saved a value
    // the form never displayed.
    const type = String(manualItemDraft.type || "other").trim().toLowerCase() || "other";
    const suggestionImageUrl = String(chosenSuggestion?.iconUrl || "").trim() || null;

    if (!name) {
      setManagementError(t("errors.itemNameRequired"));
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setManagementError(t("errors.quantityInvalid"));
      return;
    }
    if (!Number.isFinite(buyPriceInput) || buyPriceInput < 0) {
      setManagementError(t("errors.buyPriceInvalid"));
      return;
    }
    const buyPriceUsd = Number(convertToUsd(buyPriceInput).toFixed(2));

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
        // Acquisition date the user entered; falls back to now when left blank.
        purchasedAt: manualItemDraft.purchaseDate
          ? new Date(`${manualItemDraft.purchaseDate}T12:00:00Z`).toISOString()
          : new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
      try {
        await runDesktopSyncNowIfDue({ force: true });
      } catch (syncError) {
        console.warn("[desktop-sync] manual investment sync failed", syncError);
      }
      await refreshPortfolio();
      setCompositionRefreshToken((current) => current + 1);
      setManualItemDraft(createManualItemDraft());
      setManualSelectedSuggestion(null);
      setManualNameSuggestions([]);
      setManualNameSuggestionsError("");
      setManagementSection("exclude");
    } catch (createError) {
      setManagementError(createError?.message || t("errors.itemCreateFailed"));
    } finally {
      setManualItemSaving(false);
    }
  };
  const appUpdateState = String(appUpdateNotification?.state || "idle");
  const appUpdateVersionLabel = appUpdateNotification?.version
    ? `v${appUpdateNotification.version}`
    : t("appUpdate.fallbackVersion");
  const appUpdateStatusLabel = (() => {
    if (appUpdateState === "checking") {
      return t("appUpdate.checking");
    }
    if (appUpdateState === "available") {
      return t("appUpdate.available", { version: appUpdateVersionLabel });
    }
    if (appUpdateState === "manual") {
      return t("appUpdate.manual", { version: appUpdateVersionLabel });
    }
    if (appUpdateState === "downloading") {
      const percent = Number(appUpdateNotification?.percent || 0);
      return t("appUpdate.downloading", { percent: Math.max(0, Math.min(100, Math.round(percent))) });
    }
    if (appUpdateState === "downloaded") {
      return t("appUpdate.downloaded", { version: appUpdateVersionLabel });
    }
    if (appUpdateState === "installing") {
      return t("appUpdate.installing", { version: appUpdateVersionLabel });
    }
    if (appUpdateState === "handoff") {
      return t("appUpdate.handoff", { version: appUpdateVersionLabel });
    }
    if (appUpdateState === "not-available") {
      return t("appUpdate.upToDate");
    }
    if (appUpdateState === "error") {
      return appUpdateNotification?.message || t("appUpdate.checkFailed");
    }
    return t("appUpdate.noStatus");
  })();
  const appUpdateNotificationClass = (() => {
    if (appUpdateState === "downloaded") {
      return "w-full rounded-xl border border-success/30 bg-success/10 px-2 py-2 text-left hover:bg-success/15";
    }
    if (appUpdateState === "downloading" || appUpdateState === "installing") {
      return "w-full rounded-xl border border-info/30 bg-info/10 px-2 py-2 text-left hover:bg-info/10";
    }
    if (appUpdateState === "handoff") {
      return "w-full rounded-xl border border-warn/30 bg-warn/10 px-2 py-2 text-left hover:bg-warn/10";
    }
    if (appUpdateState === "available" || appUpdateState === "manual") {
      return "w-full rounded-xl border border-warn/30 bg-warn/10 px-2 py-2 text-left hover:bg-warn/10";
    }
    if (appUpdateState === "error") {
      return "w-full rounded-xl border border-destructive/60 bg-destructive/12 px-2 py-2 text-left hover:bg-destructive/20";
    }
    return "w-full rounded-xl border border-border/70 bg-card/70 px-2 py-2 text-left hover:bg-accent/70";
  })();
  const appUpdateHintLabel = (() => {
    if (appUpdateState === "downloaded") {
      return t("appUpdate.hintDownloaded");
    }
    if (appUpdateState === "downloading") {
      return t("appUpdate.hintDownloading");
    }
    if (appUpdateState === "installing") {
      return t("appUpdate.hintInstalling");
    }
    if (appUpdateState === "handoff") {
      return t("appUpdate.hintHandoff");
    }
    if (appUpdateState === "available") {
      return t("appUpdate.hintAvailable");
    }
    if (appUpdateState === "manual") {
      return t("appUpdate.hintManual");
    }
    if (appUpdateState === "error") {
      return t("appUpdate.hintError");
    }
    return t("appUpdate.hintDefault");
  })();
  const APP_UPDATE_VISIBLE_STATES = [
    "available",
    "manual",
    "downloading",
    "downloaded",
    "installing",
    "handoff",
    "error",
  ];
  const hasVisibleAppUpdateNotification = APP_UPDATE_VISIBLE_STATES.includes(appUpdateState);
  const hasUnreadAppUpdate = appUpdateUnread && APP_UPDATE_VISIBLE_STATES.includes(appUpdateState);
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
    handleUiWarningsChange("watchlist-live", t("source.watchlist"), nextWarnings);
  }, [handleUiWarningsChange, t]);
  const portfolioWarningNotifications = useMemo(
    () => mapWarningsToNotifications(warnings, { sourceKey: "portfolio", sourceLabel: t("source.portfolio") }),
    [warnings, t],
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
      return t("notifications.newCountOverflow");
    }
    return t("notifications.newCount", { count: Math.max(0, value) });
  };
  const unreadActionNotifications = useMemo(
    () =>
      syncNotifications.filter(
        (entry) => ACTION_NOTIFICATION_CATEGORIES.includes(entry.category) && entry.unread,
      ),
    [syncNotifications],
  );
  // Acting on an action notification consumes it (read = delete). It reappears
  // on the next sync only if the underlying work still exists.
  const handleNotificationClick = async (entry) => {
    if (window.electronAPI?.localStore?.deleteNotification) {
      await window.electronAPI.localStore.deleteNotification(entry.id);
    }
    setSyncNotifications((current) => current.filter((item) => item.id !== entry.id));
    setSyncNotification((current) => ({
      ...current,
      newItemsCount: Math.max(0, Number(current.newItemsCount || 0) - 1),
    }));
    const section = entry.category === "action_price" ? "prices" : "matching";
    setActiveTab("management");
    setManagementSection(section);
    navigate(`/?tab=management&section=${section}`, { replace: true });
    setCompositionRefreshToken((current) => current + 1);
  };
  const handleClearActionNotifications = async () => {
    const user = await getCurrentUser();
    const userId = resolveDesktopRuntimeUserId(user, 1);
    if (window.electronAPI?.localStore?.deleteAllNotifications) {
      await window.electronAPI.localStore.deleteAllNotifications(userId, "action_match");
      await window.electronAPI.localStore.deleteAllNotifications(userId, "action_price");
    }
    setSyncNotifications((current) =>
      current.filter((entry) => !ACTION_NOTIFICATION_CATEGORIES.includes(entry.category)),
    );
    setSyncNotification((current) => ({
      ...current,
      newItemsCount: 0,
    }));
    setCompositionRefreshToken((current) => current + 1);
  };
  const handleAppUpdateNotificationClick = async () => {
    await runAppUpdateAction({
      state: appUpdateState,
      version: appUpdateNotification?.version,
      url: appUpdateNotification?.url,
      message: appUpdateStatusLabel,
    });
    setAppUpdateUnread(false);
  };
  const renderNotificationsDropdownContent = () => (
    <>
      <DropdownMenuLabel>{t("notifications.title")}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <div className="space-y-2 px-2 py-1">
        {hasVisibleAppUpdateNotification ? (
          <button
            type="button"
            onClick={() => void handleAppUpdateNotificationClick()}
            className={appUpdateNotificationClass}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{t("notifications.appUpdate")}</p>
              {hasUnreadAppUpdate ? (
                <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  neu
                </span>
              ) : null}
            </div>
            {installedAppVersion ? (
              <p className="text-[11px] text-muted-foreground">{t("appUpdate.installed", { version: installedAppVersion })}</p>
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
            className="w-full rounded-xl border border-info/30 bg-info/10 px-2 py-2 text-left hover:bg-info/10"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{t("notifications.csUpdateFeed")}</p>
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
          <Callout tone="warn" title={t("notifications.systemHints")}>
            <div className="mt-1.5 space-y-1.5">
              {warningNotifications.slice(0, 4).map((entry) => (
                <div key={entry.id} className="rounded-lg border border-warn/30 bg-warn/10 px-2 py-1.5">
                  <p className="text-sm">{entry.message}</p>
                  {entry.meta ? (
                    <p className="text-[11px] text-muted-foreground">{entry.meta}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </Callout>
        ) : null}

        <div className="rounded-md border p-2">
          <p className="text-xs font-semibold">{t("notifications.openActions")}</p>
          {unreadActionNotifications.length > 0 ? (
            <div className="mt-1 space-y-1">
              {unreadActionNotifications.slice(0, 5).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => void handleNotificationClick(entry)}
                    className="w-full rounded-md border px-2 py-1 text-left hover:bg-accent"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{entry.title}</p>
                      {Number(entry?.payload?.count) > 0 ? (
                        <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          {formatCompactNewCount(entry.payload.count)}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{entry.message}</p>
                  </button>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">{t("notifications.allDone")}</p>
          )}
          {manualSteamSyncInfo ? (
            <p className="mt-1 text-[11px] text-muted-foreground">{manualSteamSyncInfo}</p>
          ) : null}
          {unreadActionNotifications.length > 0 ? (
            <div className="mt-2">
              <Button size="sm" variant="ghost" onClick={() => void handleClearActionNotifications()}>
                Alle löschen
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
      label: t("journey.serverDone"),
      done: Boolean(serverSetup.configured),
    },
    {
      id: "import_defaults",
      label: t("journey.importTargetDone"),
      done: Boolean(journeyState?.importBucketConfirmedAt),
    },
    {
      id: "csfloat_key",
      label: hasCsFloatKey
        ? t("journey.csfloatKeyStored")
        : csFloatKeySkipped
          ? t("journey.csfloatSkipped")
          : t("journey.csfloatKeyDecided"),
      done: hasCsFloatKey || csFloatKeySkipped,
    },
    {
      id: "csfloat_import",
      label: t("journey.csfloatImportDecided"),
      done: Boolean(journeyState?.csfloatImportCompletedAt || journeyState?.csfloatImportSkippedAt || csFloatKeySkipped),
    },
    {
      id: "push_notifications",
      label: t("journey.pushDecided"),
      done: Boolean(journeyState?.pushPreferenceSetAt),
    },
    {
      id: "matching",
      label: t("journey.matchingChecked"),
      done: Boolean(journeyState?.matchingReviewedAt) || matchingSuggestedCount === 0,
    },
    {
      id: "management",
      label: t("journey.managementHintsSeen"),
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
    setJourneyApiKeySuccess(t("journey.csfloatSkippedHint"));
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
      setJourneyApiKeyError(t("journey.keyInvalid"));
      setJourneyApiKeySuccess("");
      setJourneyApiKeyHelper("");
      return;
    }

    if (normalizedKey.length < 20) {
      setJourneyApiKeyError(t("journey.keyIncomplete"));
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
      setJourneyApiKeySuccess(t("journey.keySaved"));
      setJourneyApiKeyHelper(t("journey.keySavedShort"));
      const keyConnected = await handleRefreshCsFloatStatus();
      if (keyConnected) {
        await updateJourneyState({
          csfloatKeySavedAt: new Date().toISOString(),
          csfloatKeySkippedAt: null,
          currentStepId: resolveNextJourneyStepId("csfloat_key"),
        });
      }
    } catch (error) {
      setJourneyApiKeyError(error?.message || t("journey.keySaveFailed"));
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
      } font-sans text-foreground pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-0 touch-pan-y ${
        // Same fullscreen overlay treatment as the startup welcome: the journey
        // shell rendered inside the app grid's main column left dark frames (rail
        // column, grid gap, app background) around the gradient.
        showSetupJourney
          ? "steam-startup-shell steam-startup-shell-overlay overflow-y-auto"
          : "bg-background"
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
            {/* No mobile header: title, theme toggle, notification bell and
                profile all live in the app shell now (MobileTopbar + drawer). */}

            {/* Header - nur auf Desktop sichtbar */}
            <header className={`hidden sm:flex flex-col items-start justify-between gap-4 md:flex-row md:items-center ${
              useDesktopSidebarShell ? "lg:hidden" : ""
            }`}>
              <div className="flex-1">
                <h1 className="text-2xl font-extrabold tracking-tight text-foreground md:text-3xl">{t("header.title")}</h1>
                <p className="text-sm text-muted-foreground md:text-base">{t("header.subtitle")}</p>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconCircleButton count={unreadNotificationCount}>
                      <Bell className="h-5 w-5" />
                    </IconCircleButton>
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
              <CardTitle className="text-base">{t("journey.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                {t("journey.legacyBannerLead")}
                <span className="font-medium"> {t("journey.csfloatKeyPath")}</span>.
              </p>
              <div className="space-y-1 rounded-md border bg-background/70 p-2">
                <p className="text-xs font-semibold">
                  {t("journey.progressSteps", { done: completedJourneySteps, total: journeySteps.length })}
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
          <Card className="steam-journey-card relative overflow-hidden border-border bg-card/80 text-foreground shadow-2xl backdrop-blur-xl">
            <CardHeader className="space-y-2 pb-3">
              <CardTitle className="text-2xl tracking-tight text-foreground">
                Setup Journey{journeyUserName ? ` fuer ${journeyUserName}` : ""}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Wir teilen alles in klare Schritte auf. Du kannst spaeter in den Einstellungen jeden Punkt wieder aendern.
              </p>
            </CardHeader>
            <CardContent className="space-y-6 text-sm">
              {showStartupAutoSyncEmptyHint ? (
                <Callout tone="info">{t("journey.noNewAutoSyncItems")}</Callout>
              ) : null}
              <div className="space-y-3 rounded-xl border border-border bg-surface-1 p-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t("journey.progress")}</span>
                  <span>{journeyProgressPercent}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full bg-info transition-[width] duration-500 ${journeyProgressPercent < 100 ? "steam-progress-pulse" : ""}`}
                    style={{ width: `${journeyProgressPercent}%` }}
                  />
                </div>
                <div className="grid gap-2 pt-1 sm:grid-cols-2">
                  {journeySteps.map((step) => (
                    <label
                      key={step.id}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                        step.done
                          ? "border-success/30 bg-success/10 text-foreground"
                          : "border-border bg-surface-1 text-muted-foreground"
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
                <div className="space-y-4 rounded-xl border border-border bg-surface-1 p-4">
                  <p className="text-foreground">
                    {t("journey.order")}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => void handleStartJourney()}>{t("journey.start")}</Button>
                    <Button
                      variant="ghost"
                      onClick={() => void handleSkipJourney()}
                    >
                      {t("journey.skip")}
                    </Button>
                  </div>
                </div>
              ) : null}

              {journeyStarted ? (
                <div key={activeJourneyStepId} className="journey-step-panel space-y-4">
                  {activeJourneyStepId === "server" ? (
                    <div className="space-y-4 rounded-xl border border-warn/30 bg-warn/10 p-4">
                      <div>
                        <p className="font-semibold text-foreground">{t("journey.step1Title")}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("journey.step1Body")}
                        </p>
                      </div>
                      {serverSetupError ? <p className="text-xs text-foreground">{serverSetupError}</p> : null}
                      {serverSetupMessage ? <p className="text-xs text-foreground">{serverSetupMessage}</p> : null}
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
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
                        />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={serverSetupTesting || !serverSetup.serverUrl.trim()}
                          onClick={async () => {
                            try {
                              const normalizedHost = normalizeServerHostInput(serverSetup.serverUrl);
                              if (!normalizedHost) {
                                setServerSetupError(t("journey.hostnameInvalid"));
                                return;
                              }
                              setServerSetupTesting(true);
                              setServerSetupError("");
                              setServerSetupMessage("");
                              const result = await window.electronAPI.serverConfig.test(normalizedHost);
                              if (result?.ok) {
                                setServerSetup((current) => ({ ...current, serverUrl: normalizedHost }));
                                setServerSetupMessage(result?.message || t("journey.connectionOk"));
                              } else {
                                setServerSetupError(result?.message || t("journey.connectionFailed"));
                              }
                            } catch (error) {
                              setServerSetupError(error?.message || t("journey.connectionTestFailed"));
                            } finally {
                              setServerSetupTesting(false);
                            }
                          }}
                        >
                          {serverSetupTesting ? t("journey.testing") : t("journey.testConnection")}
                        </Button>
                        <Button
                          size="sm"
                          disabled={serverSetupSaving || !serverSetup.serverUrl.trim()}
                          onClick={async () => {
                            try {
                              const normalizedHost = normalizeServerHostInput(serverSetup.serverUrl);
                              if (!normalizedHost) {
                                setServerSetupError(t("journey.hostnameInvalid"));
                                return;
                              }
                              setServerSetupSaving(true);
                              setServerSetupError("");
                              setServerSetupMessage("");
                              await window.electronAPI.serverConfig.set({
                                serverUrl: normalizedHost,
                              });
                              setServerSetup((current) => ({ ...current, configured: true, serverUrl: normalizedHost }));
                              setServerSetupMessage(t("journey.serverUrlSaved"));
                              await handleGoNextJourneyStep();
                            } catch (error) {
                              setServerSetupError(error?.message || t("journey.serverUrlSaveFailed"));
                            } finally {
                              setServerSetupSaving(false);
                            }
                          }}
                        >
                          {serverSetupSaving ? t("journey.saving") : t("journey.save")}
                        </Button>
                        {serverSetup.configured ? (
                          <Button size="sm" onClick={() => void handleGoNextJourneyStep()}>
                            {t("journey.next")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {activeJourneyStepId === "import_defaults" ? (
                    <div className="space-y-4 rounded-xl border border-border bg-surface-1 p-4">
                      <div>
                        <p className="font-semibold text-foreground">{t("journey.step2Title")}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("journey.step2Body")}
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t("journey.steamImport")}</label>
                          <select
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                            value={portfolioPreferences.steamImportBucket}
                            onChange={async (event) => {
                              const updated = await updatePortfolioPreferences({
                                steamImportBucket: event.target.value,
                              });
                              setPortfolioPreferences(updated);
                            }}
                          >
                            <option value="inventory">{t("journey.sortInventory")}</option>
                            <option value="investment">{t("journey.sortInvestments")}</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t("journey.csfloatImport")}</label>
                          <select
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                            value={portfolioPreferences.csfloatImportBucket}
                            onChange={async (event) => {
                              const updated = await updatePortfolioPreferences({
                                csfloatImportBucket: event.target.value,
                              });
                              setPortfolioPreferences(updated);
                            }}
                          >
                            <option value="investment">{t("journey.sortInvestments")}</option>
                            <option value="inventory">{t("journey.sortInventory")}</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t("journey.skinbaronImport")}</label>
                          <select
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                            value={portfolioPreferences.skinBaronImportBucket}
                            onChange={async (event) => {
                              const updated = await updatePortfolioPreferences({
                                skinBaronImportBucket: event.target.value,
                              });
                              setPortfolioPreferences(updated);
                            }}
                          >
                            <option value="investment">{t("journey.sortInvestments")}</option>
                            <option value="inventory">{t("journey.sortInventory")}</option>
                          </select>
                        </div>
                      </div>
                      <label className="flex items-start gap-3 rounded-md border border-border bg-surface-1 p-3 text-xs text-foreground">
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
                        <span>{t("journey.importTargetConfirmed")}</span>
                      </label>
                    </div>
                  ) : null}
                  {activeJourneyStepId === "csfloat_key" ? (
                    <div className="space-y-4 rounded-xl border border-info/30 bg-info/10 p-4">
                      <div>
                        <p className="font-semibold text-foreground">{t("journey.step3Title")}</p>
                        <p className="mt-1 text-xs text-foreground">
                          {t("journey.step3Body")}
                        </p>
                      </div>
                      <ol className="list-decimal space-y-1 pl-4 text-xs text-foreground">
                        <li>
                          <a
                            href="https://csfloat.com/"
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-info/50 underline-offset-2 hover:text-info"
                          >
                            csfloat.com
                          </a>{" "}
                          {t("journey.step3Open")}
                        </li>
                        <li>
                          {t("journey.step3ProfileLead")}{" "}
                          <a
                            href="https://csfloat.com/profile"
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-info/50 underline-offset-2 hover:text-info"
                          >
                            csfloat.com/profile
                          </a>
                        </li>
                        <li>{t("journey.gotoDeveloperTab")}</li>
                        <li>{t("journey.createAndCopyKey")}</li>
                      </ol>
                      <Callout tone="warn">
                        {t("journey.step3Warning")}
                      </Callout>
                      {journeyApiKeyError ? (
                        <Callout tone="danger">{journeyApiKeyError}</Callout>
                      ) : null}
                      {journeyApiKeySuccess ? (
                        <Callout tone="success">{journeyApiKeySuccess}</Callout>
                      ) : null}
                      {journeyApiKeyHelper ? (
                        <Callout tone="info">{journeyApiKeyHelper}</Callout>
                      ) : null}
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-foreground">{t("journey.csfloatApiKey")}</label>
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
                          placeholder={t("journey.csfloatApiKeyPlaceholder")}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            disabled={journeyApiKeySaving || !normalizeCsFloatApiKeyInput(journeyApiKey)}
                            onClick={() => void handleSaveJourneyCsFloatKey()}
                          >
                            {journeyApiKeySaving ? t("journey.saving") : t("journey.saveKey")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleRefreshCsFloatStatus()}
                          >
                            {t("journey.refreshStatus")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleMarkCsFloatKeySkipped()}
                          >
                            {t("journey.continueWithoutCsfloat")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {activeJourneyStepId === "csfloat_import" ? (
                    <div className="space-y-4 rounded-xl border border-border bg-surface-1 p-4">
                      <div>
                        <p className="font-semibold text-foreground">{t("journey.step4Title")}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("journey.step4Body")}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          onClick={() => {
                            setIsCsFloatSyncOpen(true);
                          }}
                        >
                          {t("journey.startCsfloatImport")}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => void handleMarkCsFloatImportSkipped()}
                        >
                          {t("journey.laterSkip")}
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {t("journey.step4Hint")}
                      </p>
                    </div>
                  ) : null}
                  {activeJourneyStepId === "push_notifications" ? (
                    <div className="space-y-4 rounded-xl border border-border bg-surface-1 p-4">
                      <div>
                        <p className="font-semibold text-foreground">{t("journey.step5Title")}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("journey.step5Body")}
                        </p>
                      </div>
                      <Callout tone="info">
                        {t("journey.step5Recommendation")}
                      </Callout>
                      {mobileCompanionSetupUrl ? (
                        <div className="rounded-md border border-border bg-surface-1 p-3 text-xs text-foreground">
                          Server-Link fuer Mobile Setup:{" "}
                          <span className="font-mono text-[11px] text-info">{mobileCompanionSetupUrl}</span>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={() => void handleSetJourneyPushPreference(false)}>
                          {t("journey.continueWithoutPush")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await handleOpenMobileCompanionPushSetup();
                            await handleSetJourneyPushPreference(true);
                          }}
                        >
                          {t("journey.setUpMobilePush")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {activeJourneyStepId === "matching" ? (
                    <div className="space-y-4 rounded-xl border border-border bg-surface-1 p-4">
                      <div>
                        <p className="font-semibold text-foreground">{t("journey.step6Title")}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Offene Matching-Vorschlaege: <span className="font-semibold">{matchingSuggestedCount}</span>
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setActiveTab("management");
                            setManagementSection("matching");
                          }}
                        >
                          {t("journey.openMatchingInManagement")}
                        </Button>
                        <Button size="sm" onClick={() => void handleMarkMatchingReviewed()}>
                          Matching geprueft
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {activeJourneyStepId === "management" ? (
                    <div className="space-y-4 rounded-xl border border-border bg-surface-1 p-4">
                      <div>
                        <p className="font-semibold text-foreground">{t("journey.step7Title")}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("journey.step7Body")}
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-lg border border-border bg-surface-1 p-3">
                          <p className="text-xs font-semibold uppercase text-foreground">{t("journey.matching")}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{t("journey.matchingHint")}</p>
                        </div>
                        <div className="rounded-lg border border-border bg-surface-1 p-3">
                          <p className="text-xs font-semibold uppercase text-foreground">{t("journey.prices")}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{t("journey.pricesHint")}</p>
                        </div>
                        <div className="rounded-lg border border-border bg-surface-1 p-3">
                          <p className="text-xs font-semibold uppercase text-foreground">{t("journey.exclude")}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{t("journey.excludeHint")}</p>
                        </div>
                      </div>
                      <label className="flex items-start gap-3 rounded-md border border-border bg-surface-1 p-3 text-xs text-foreground">
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
                        <span>{t("journey.hintsUnderstood")}</span>
                      </label>
                      <Button
                        onClick={() => void handleCompleteJourney()}
                        disabled={!journeyState?.managementHintsSeenAt}
                      >
                        {t("journey.completeSetup")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {journeyStarted ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleGoBackJourneyStep()}
                      disabled={activeJourneyStepId === JOURNEY_STEP_ORDER[0]}
                    >
                      {t("journey.back")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate("/settings", { replace: true })}
                    >
                      {t("journey.settings")}
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleSkipJourney()}
                    >
                      {t("journey.finishJourney")}
                    </Button>
                    {activeJourneyStepId !== "management" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleGoNextJourneyStep()}
                      >
                        {t("journey.skipStep")}
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
            <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-[calc(100dvh-2.5rem)] lg:justify-center lg:pt-2">
              <div className="tr-desktop-rail h-full w-[92px] overflow-hidden rounded-2xl">
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
                            title={t(tab.labelKey)}
                            aria-label={t(tab.labelKey)}
                          >
                            <span className="relative inline-flex">
                              <Icon className="h-5 w-5" />
                              {tab.key === "updates" && hasUnreadCsUpdate ? (
                                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-danger" />
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
                        <IconCircleButton count={unreadNotificationCount}>
                          <Bell className="h-5 w-5" />
                        </IconCircleButton>
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
              <div
                className={`hidden lg:flex lg:sticky lg:top-0 lg:z-20 lg:mb-4 lg:items-center lg:gap-6 lg:border-b lg:border-border/60 lg:bg-background/92 lg:px-2 lg:py-4 lg:backdrop-blur-xl lg:transition-transform lg:duration-300 lg:will-change-transform ${
                  searchBarHidden ? "lg:-translate-y-[calc(100%+1px)]" : "lg:translate-y-0"
                }`}
              >
                <div className="flex w-full min-w-0 items-center justify-center">
                  <form
                    className={`relative ${activeTab === "search" ? "w-[min(920px,72vw)]" : "w-[min(560px,60vw)]"}`}
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
                      placeholder={t("globalSearch.placeholder")}
                      className="flex h-11 w-full items-center rounded-md border border-border bg-transparent pl-10 pr-3 text-sm text-foreground placeholder:text-foreground/60 shadow-none outline-none transition-colors focus:border-border dark:rounded-xl dark:border-border/70 dark:bg-card/75 dark:shadow-[0_12px_28px_rgba(0,0,0,0.2)]"
                    />
                  </form>
                </div>
              </div>
            ) : null}
            <div
              className={`hidden md:block ${useDesktopSidebarShell ? "mb-3 lg:hidden" : "mb-3"} sticky top-0 z-20 -mx-1 bg-background/92 px-1 py-2 backdrop-blur-xl transition-transform duration-300 will-change-transform ${
                searchBarHidden ? "-translate-y-[calc(100%+1px)]" : "translate-y-0"
              }`}
            >
              <form
                className="relative"
                onSubmit={(event) => {
                  void handleGlobalSearchSubmit(event);
                }}
              >
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={mobileSearchInputRef}
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
                  placeholder={t("globalSearch.placeholderShort")}
                  className="h-11 w-full rounded-md border border-border bg-transparent pl-10 pr-3 text-sm text-foreground shadow-none outline-none focus:border-border dark:rounded-xl dark:border-border/70 dark:bg-card/75"
                />
              </form>
            </div>
            {error && (
              <Callout tone="danger" className="mb-4">
                {error}
              </Callout>
            )}
            {/* Tab Navigation - auf Desktop Runtime durch Sidebar ersetzt */}
            <div className={useDesktopSidebarShell ? "hidden sm:block lg:hidden" : "hidden sm:block"}>
              <TabsList className={`grid w-full gap-1 sm:max-w-200 ${isDesktopRuntime ? "grid-cols-5" : "grid-cols-4"}`}>
                <TabsTrigger value="overview" className="text-xs sm:text-sm">{t("tabs.overview")}</TabsTrigger>
                <TabsTrigger value="inventory" className="text-xs sm:text-sm">{t("tabs.inventory")}</TabsTrigger>
                <TabsTrigger value="watchlist" className="text-xs sm:text-sm">{t("tabs.watchlist")}</TabsTrigger>
                <TabsTrigger value="search" className="text-xs sm:text-sm">{t("tabs.search")}</TabsTrigger>
                {isDesktopRuntime ? <TabsTrigger value="management" className="text-xs sm:text-sm">{t("tabs.management")}</TabsTrigger> : null}
              </TabsList>
            </div>

          <TabsContent value="overview" forceMount={visitedTabs.has("overview") || undefined}>
          <PortfolioOverviewSection
            stats={stats}
            statsPending={statsPending}
            portfolioLoading={portfolioLoading}
            metricsScope={metricsScope}
            portfolioPreferences={portfolioPreferences}
            headerPortfolioPercent={headerPortfolioPercent}
            headerPortfolioPositive={headerPortfolioPositive}
            headerPortfolioValueLabel={headerPortfolioValueLabel}
            headerProfitEuro={headerProfitEuro}
            headerProfitIsUsd={headerProfitIsUsd}
            headerProfitSubLabel={headerProfitSubLabel}
            headerProfitPositive={headerProfitPositive}
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
            showYearWrappedBanner={showYearWrappedBanner}
            yearWrappedYear={wrappedSeason.year}
            handleOpenYearWrapped={handleOpenYearWrapped}
            handleDismissYearWrapped={handleDismissYearWrapped}
            recentActivity={recentActivity}
            recentActivityLoading={recentActivityLoading}
            scopedPortfolioHistory={scopedPortfolioHistory}
            onChartHoverChange={setHoveredChartData}
            onChartTrendChange={setChartTrendData}
            handleMetricsScopeChange={handleMetricsScopeChange}
            watchlistAlerts={watchlistAlerts}
            handleTabSelect={handleTabSelect}
            allocationByType={allocationByType}
            portfolioMovers={portfolioMovers}
            chartTrendData={chartTrendData}
          />
          </TabsContent>

          <TabsContent value="inventory" forceMount={visitedTabs.has("inventory") || undefined}>
          <PortfolioInventorySection
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
              const selection = buildGroupDetailSelection(group);
              setSelectedItem(selection);
              if (window.innerWidth < BREAKPOINTS.MOBILE) {
                openModal("itemDetail", { item: selection });
              }
            }}
            onSelectCluster={(group, cluster) => {
              const selection = buildGroupClusterDetailSelection(group, cluster);
              setSelectedItem(selection);
              if (window.innerWidth < BREAKPOINTS.MOBILE) {
                openModal("itemDetail", { item: selection });
              }
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
            canToggleBucket={
              // Whole groups can be moved between buckets (batch over member ids);
              // group-clusters remain read-only aggregations.
              isDesktopRuntime &&
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
            watchlistFocusTarget={watchlistFocusTarget}
            onWarningsChange={handleWatchlistWarningsChange}
          />
          </TabsContent>
          <TabsContent value="search" forceMount={visitedTabs.has("search") || undefined}>
          <PortfolioSearchSection
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
            handleManualMatchCreate={handleManualMatchCreate}
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
            handleSaveClusterPrice={handleSaveClusterPrice}
            handleAcceptSuggestedClusterPrice={handleAcceptSuggestedClusterPrice}
            manualItemDraft={manualItemDraft}
            setManualItemDraft={setManualItemDraft}
            manualSelectedSuggestion={manualSelectedSuggestion}
            setManualSelectedSuggestion={setManualSelectedSuggestion}
            manualItemSaving={manualItemSaving}
            setManualItemSaving={setManualItemSaving}
            handleManualItemDraftChange={handleManualItemDraftChange}
            manualNameSuggestions={manualNameSuggestions}
            manualNameSuggestionsLoading={manualNameSuggestionsLoading}
            manualNameSuggestionsError={manualNameSuggestionsError}
            handleManualSuggestionPick={handleManualSuggestionPick}
            handleCreateManualInvestment={handleCreateManualInvestment}
            portfolioGroups={portfolioGroups}
            portfolioGroupSummaryById={portfolioGroupSummaryById}
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
            filteredMatchingRows={filteredMatchingRows}
            matchingSuggestedCount={matchingSuggestedCount}
            matchedSteamInventoryItemsCount={matchedSteamInventoryItemsCount}
            filteredPriceItems={filteredPriceItems}
            filteredPriceClusters={filteredPriceClusters}
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
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
            onClick={() => setGlobalSearchOpen(false)}
          >
            <div
              className="mx-auto mt-4 flex h-[calc(100vh-2rem)] w-[min(1080px,96vw)] flex-col overflow-hidden rounded-xl border border-border/70 bg-background shadow-none dark:rounded-2xl dark:bg-card/96 dark:shadow-[0_22px_60px_rgba(0,0,0,0.55)]"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={t("globalSearch.title")}
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
                      placeholder={t("globalSearch.placeholderShort")}
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
                        <h3 className="text-sm font-semibold text-foreground">{t("globalSearch.recent")}</h3>
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
                      <h3 className="text-sm font-semibold text-foreground">{t("globalSearch.alreadyOwned")}</h3>
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
                      <h3 className="text-sm font-semibold text-foreground">{t("groups.title")}</h3>
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
                                  <span className="text-[11px] text-muted-foreground">{t("groups.badge")}</span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold">{group.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {summary
                                    ? t("groups.summary", {
                                        clusters: summary.clusterCount,
                                        members: summary.memberCount,
                                        // `summary.totalValue` sums the rows'
                                        // `currentValue` (EUR) — a row aggregate,
                                        // not a chart figure.
                                        value: formatPrice(summary.totalValue),
                                      })
                                    : t("groups.emptyHint")}
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
                        <Callout tone="danger">{globalSearchCatalogError}</Callout>
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
