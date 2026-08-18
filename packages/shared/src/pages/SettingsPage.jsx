import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Eye, LayoutGrid, Package, FolderCog, Cog, Search, CreditCard } from "lucide-react";
import { useCurrency } from "@shared/contexts/CurrencyContext";
import { useTheme } from "@shared/contexts";

import { ThemeToggle } from "@shared/components/ThemeToggle";
import { UserMenu } from "@shared/components/UserMenu";
import { StatusPill } from "@shared/components/ui/status-pill";
import { SegmentedControl } from "@shared/components/ui/segmented-control";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
  SettingsRow,
  SettingsTile,
  SettingsNote,
  SettingsBanner,
} from "@shared/components/ui/settings-card";
import { Switch } from "@shared/components/ui/switch";
import {
  fetchFeeSettings,
  updateFeeSettings,
  fetchCsFloatApiKeyStatus,
  updateCsFloatApiKey,
  fetchSkinBaronApiKeyStatus,
  updateSkinBaronSessionCookie,
  connectSkinBaronSessionCookieViaBrowser,
  fetchPriceSourcePreference,
  updatePriceSourcePreference,
  fetchWebPushPublicKey,
  subscribeWebPush,
  unsubscribeWebPush,
} from "@shared/lib/apiClient";
import { isEncryptionConfigured } from "@shared/lib/encryption";
import { getCurrentUser } from "@shared/lib/auth";
import {
  getPortfolioPreferences,
  updatePortfolioPreferences,
  getWebPushNotificationPreferences,
  updateWebPushNotificationPreferences,
  IMPACT_LEVELS,
} from "@shared/lib/portfolioPreferences";
import { importCsFloatWatchlistData, importCsFloatBuyOrdersAsWatchlistData } from "@shared/lib/dataSource";
import { normalizeServerHostInput } from "@shared/lib/serverConfig";
import { openAppReleasesPage } from "@shared/lib/appUpdateActions";
import {
  DEFAULT_FORM,
  toInputValue,
  isDesktopRuntime,
  normalizePriceSourceMode,
  normalizeSkinBaronStatusPayload,
  base64UrlToUint8Array,
} from "@shared/lib/settingsHelpers";
import { FeeSettingsSection } from "@shared/components/FeeSettingsSection";
import { CurrencySettingsSection } from "@shared/components/CurrencySettingsSection";
import { SoundSettingsSection } from "@shared/components/SoundSettingsSection.jsx";
import { WindowControlsSettingsSection } from "@shared/components/WindowControlsSettingsSection.jsx";
import { PriceSourceSettingsSection } from "@shared/components/PriceSourceSettingsSection";
import { WebPushSettingsSection } from "@shared/components/WebPushSettingsSection";
import { CsFloatApiKeySection } from "@shared/components/CsFloatApiKeySection";
import { SkinBaronApiKeySection } from "@shared/components/SkinBaronApiKeySection";
import { ServerConfigSection } from "@shared/components/ServerConfigSection";

// Page-local rail copy; labels share the `common:nav.*` keys with the shell.
const DESKTOP_SIDEBAR_ITEMS = [
  { key: "overview", labelKey: "nav.overview", icon: LayoutGrid, to: "/?tab=overview" },
  { key: "inventory", labelKey: "nav.inventory", icon: Package, to: "/?tab=inventory" },
  { key: "watchlist", labelKey: "nav.watchlist", icon: Eye, to: "/?tab=watchlist" },
  { key: "management", labelKey: "nav.management", icon: FolderCog, to: "/?tab=management", desktopOnly: true },
  { key: "settings", labelKey: "nav.settings", icon: Cog, to: "/settings" },
];

// Left-hand category column. `keywords` only feeds the search box — they are the
// words a user is likely to type for a setting that lives inside the category
// but is not in its title ("Lautstärke" for Darstellung, "Vault" for Verbindungen).
const SETTINGS_CATEGORIES = [
  { id: "look", labelKey: "categories.lookLabel", hintKey: "categories.lookHint", keywordsKey: "categories.lookKeywords" },
  { id: "money", labelKey: "categories.moneyLabel", hintKey: "categories.moneyHint", keywordsKey: "categories.moneyKeywords" },
  { id: "prices", labelKey: "categories.pricesLabel", hintKey: "categories.pricesHint", keywordsKey: "categories.pricesKeywords" },
  { id: "notify", labelKey: "categories.notifyLabel", hintKey: "categories.notifyHint", keywordsKey: "categories.notifyKeywords" },
  { id: "conn", labelKey: "categories.connLabel", hintKey: "categories.connHint", keywordsKey: "categories.connKeywords", desktopOnly: true },
  { id: "about", labelKey: "categories.aboutLabel", hintKey: "categories.aboutHint", keywordsKey: "categories.aboutKeywords", desktopOnly: true },
];

const LIGHT_SWATCH = "linear-gradient(oklch(93% .004 260) 0 11px, oklch(98% .003 260) 11px 100%)";
const DARK_SWATCH = "linear-gradient(oklch(25% .011 260) 0 11px, oklch(16.5% .01 260) 11px 100%)";
const SYSTEM_SWATCH = `linear-gradient(103deg, transparent 0 49.5%, oklch(100% 0 0 / .16) 49.5% 50.5%, oklch(16.5% .01 260) 50.5% 100%), ${LIGHT_SWATCH}`;

const IMPACT_LEVEL_KEYS = {
  none: "impact.none",
  low: "impact.low",
  medium: "impact.medium",
  high: "impact.high",
};

/** Level pill strip of a notification row. */
function ImpactLevelPicker({ value, disabled, onSelect }) {
  const { t } = useTranslation("settings");
  return (
    <span className="flex flex-wrap gap-1.5">
      {IMPACT_LEVELS.map((level) => {
        const active = value === level;
        return (
          <button
            key={level}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(level)}
            className={`h-[26px] rounded-full border px-2.5 text-[11px] font-bold transition-colors disabled:opacity-50 ${
              active
                ? "border-info/45 bg-info/12 text-info"
                : "border-border bg-transparent text-muted-foreground hover:border-border-strong"
            }`}
          >
            {t(IMPACT_LEVEL_KEYS[level])}
          </button>
        );
      })}
    </span>
  );
}

/** One "Ereignis | Mindest-Impact | Aktiv" row of the notification table. */
function NotificationRow({ title, description, enabled, onToggle, level, onLevelSelect, saving, divider = true }) {
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3.5 lg:grid-cols-[minmax(0,1fr)_300px_62px] ${
        divider ? "border-b border-border-soft" : ""
      }`}
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-foreground">{title}</span>
        <span className="mt-[3px] block text-[11px] leading-[1.5] text-muted-foreground">
          {description}
        </span>
      </span>
      {/* The level strip only exists while the event is on — a threshold for a
          channel that sends nothing is noise. */}
      <span className="order-3 col-span-2 lg:order-none lg:col-span-1">
        {onLevelSelect && enabled ? (
          <ImpactLevelPicker value={level} disabled={saving} onSelect={onLevelSelect} />
        ) : null}
      </span>
      <span className="flex justify-end">
        <Switch checked={enabled} onCheckedChange={onToggle} disabled={saving} aria-label={title} />
      </span>
    </div>
  );
}

export function SettingsPage({ useExternalDesktopSidebarShell = false }) {
  const { t } = useTranslation(["settings", "common"]);
  const [form, setForm] = useState(DEFAULT_FORM);
  // Baselines for the header's dirty state: what the server last confirmed.
  const [savedForm, setSavedForm] = useState(DEFAULT_FORM);
  const [source, setSource] = useState("defaults");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const currencyContext = useCurrency();
  const { themeMode, setThemeMode, isDark, systemPrefersDark } = useTheme();

  // CSFloat API Key State
  const [apiKey, setApiKey] = useState("");
  const [apiKeyLoading, setApiKeyLoading] = useState(true);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState({ configured: false, lastFour: null });
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyError, setApiKeyError] = useState("");
  const [apiKeySuccess, setApiKeySuccess] = useState("");

  // SkinBaron AUTHID Session State
  const [skinBaronStatusLoading, setSkinBaronStatusLoading] = useState(true);
  const [skinBaronApiKeyStatus, setSkinBaronApiKeyStatus] = useState(() => normalizeSkinBaronStatusPayload());
  const [skinBaronApiKeyError, setSkinBaronApiKeyError] = useState("");
  const [skinBaronApiKeySuccess, setSkinBaronApiKeySuccess] = useState("");
  const [skinBaronSessionCookie, setSkinBaronSessionCookie] = useState("");
  const [showSkinBaronSessionCookie, setShowSkinBaronSessionCookie] = useState(false);
  const [skinBaronSessionSaving, setSkinBaronSessionSaving] = useState(false);
  const [skinBaronSessionBrowserConnecting, setSkinBaronSessionBrowserConnecting] = useState(false);
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [vaultStatus, setVaultStatus] = useState(null);
  const [vaultActionSaving, setVaultActionSaving] = useState(false);
  const [priceSourceMode, setPriceSourceMode] = useState("auto");
  const [savedPriceSourceMode, setSavedPriceSourceMode] = useState("auto");
  const [priceSourceSaving, setPriceSourceSaving] = useState(false);
  const [priceSourceError, setPriceSourceError] = useState("");
  const [priceSourceSuccess, setPriceSourceSuccess] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [serverConfigLoading, setServerConfigLoading] = useState(true);
  const [serverConfigSaving, setServerConfigSaving] = useState(false);
  const [serverConfigTesting, setServerConfigTesting] = useState(false);
  const [serverConfigMessage, setServerConfigMessage] = useState("");
  const [serverConfigError, setServerConfigError] = useState("");
  const [webPushLoading, setWebPushLoading] = useState(false);
  const [webPushSaving, setWebPushSaving] = useState(false);
  const [webPushConfigured, setWebPushConfigured] = useState(false);
  const [webPushSubscribed, setWebPushSubscribed] = useState(false);
  const [webPushPermission, setWebPushPermission] = useState("default");
  const [_webPushPublicKey, setWebPushPublicKey] = useState("");
  const [webPushError, setWebPushError] = useState("");
  const [webPushSuccess, setWebPushSuccess] = useState("");
  const [currencySearchTerm, setCurrencySearchTerm] = useState("");
  const [categorySearchTerm, setCategorySearchTerm] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const [csfloatWatchlistAutoImport, setCsfloatWatchlistAutoImport] = useState(false);
  const [csfloatWatchlistSaving, setCsfloatWatchlistSaving] = useState(false);
  const [notifyBanWaveDesktop, setNotifyBanWaveDesktop] = useState(true);
  const [notifyBanWaveDesktopMinLevel, setNotifyBanWaveDesktopMinLevel] = useState("low");
  const [notifyCsUpdatesDesktop, setNotifyCsUpdatesDesktop] = useState(true);
  const [notifyCsUpdatesDesktopMinLevel, setNotifyCsUpdatesDesktopMinLevel] = useState("medium");
  const [notifySteamSyncDesktop, setNotifySteamSyncDesktop] = useState(true);
  const [notifyCsUpdatesWebPush, setNotifyCsUpdatesWebPush] = useState(false);
  const [notifyCsUpdatesWebPushMinLevel, setNotifyCsUpdatesWebPushMinLevel] = useState("high");
  const [notifySaving, setNotifySaving] = useState(false);
  const [notifyError, setNotifyError] = useState("");
  const [csfloatWatchlistImporting, setCsfloatWatchlistImporting] = useState(false);
  const [csfloatWatchlistMessage, setCsfloatWatchlistMessage] = useState("");
  const [csfloatWatchlistError, setCsfloatWatchlistError] = useState("");
  const [csfloatBuyOrderAutoImport, setCsfloatBuyOrderAutoImport] = useState(false);
  const [csfloatBuyOrderSaving, setCsfloatBuyOrderSaving] = useState(false);
  const [csfloatBuyOrderImporting, setCsfloatBuyOrderImporting] = useState(false);
  const [csfloatBuyOrderMessage, setCsfloatBuyOrderMessage] = useState("");
  const [csfloatBuyOrderError, setCsfloatBuyOrderError] = useState("");
  const desktopRuntime = isDesktopRuntime();
  const isElectronRuntime = typeof window !== "undefined" && Boolean(window.electronAPI);
  const webPushSupported =
    !isElectronRuntime &&
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window;
  const useDesktopSidebarShell = true;
  const renderLocalDesktopSidebar = useDesktopSidebarShell && !useExternalDesktopSidebarShell;
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activePortfolioTab = new URLSearchParams(location.search).get("tab") || "overview";
  const requestedSettingsTab = String(searchParams.get("settingsTab") || "").trim().toLowerCase();
  const requestedCategory = String(searchParams.get("cat") || "").trim().toLowerCase();
  const requestedSettingsSection = String(searchParams.get("section") || "").trim().toLowerCase();

  const availableCategories = SETTINGS_CATEGORIES.filter(
    (category) => !category.desktopOnly || desktopRuntime,
  );

  // Category resolution keeps the old deep links alive: `settingsTab=api-remote`
  // was the API/Remote tab (now "Verbindungen") and `section=push-notifications`
  // pointed at the notification block.
  const activeCategory = (() => {
    const known = availableCategories.some((category) => category.id === requestedCategory);
    if (known) {
      return requestedCategory;
    }
    if (requestedSettingsSection === "push-notifications" || requestedSettingsSection === "push" || requestedSettingsSection === "browser-push") {
      return "notify";
    }
    if (requestedSettingsTab === "api-remote" && desktopRuntime) {
      return "conn";
    }
    return "look";
  })();

  // Below `lg` the page is two-staged (list -> detail), as the design has it:
  // stacking the full category list above the active panel meant scrolling past
  // six entries to reach the one just tapped. The stage is derived from the URL
  // rather than component state, so the back control, a deep link and the
  // browser's own Back button all agree on where you are.
  const mobileDetailOpen = searchParams.has("cat");

  const closeMobileDetail = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("cat");
    setSearchParams(nextParams, { replace: true });
  };

  const selectCategory = (categoryId) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("cat", categoryId);
    nextParams.delete("settingsTab");
    nextParams.delete("section");
    // Opening a category is a navigation on mobile (list -> detail) but only a
    // selection on desktop, where both panes stay on screen. Pushing on mobile
    // is what makes the platform Back gesture return to the list instead of
    // leaving Settings entirely; replacing on desktop keeps clicking through
    // six categories from stacking six history entries.
    const desktopLayout =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(min-width: 1024px)").matches;
    setSearchParams(nextParams, { replace: desktopLayout });
  };

  const notificationChannels = [
    ...(desktopRuntime ? [{ value: "desktop", label: t("channel.desktop") }] : []),
    ...(!isElectronRuntime ? [{ value: "push", label: t("channel.push") }] : []),
  ];
  const [notificationChannel, setNotificationChannel] = useState(() =>
    isDesktopRuntime() ? "desktop" : "push",
  );
  const activeNotificationChannel = notificationChannels.some((c) => c.value === notificationChannel)
    ? notificationChannel
    : notificationChannels[0]?.value;

  const isSidebarItemActive = (item) => {
    if (item.key === "settings") {
      return location.pathname === "/settings";
    }

    if (location.pathname !== "/") {
      return false;
    }

    return activePortfolioTab === item.key;
  };
  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoading(true);
        setApiKeyLoading(true);
        setSkinBaronStatusLoading(true);

        const [feeResponse, keyStatusResponse, skinBaronStatusResponse, priceSourceResponse] = await Promise.all([
          fetchFeeSettings(),
          fetchCsFloatApiKeyStatus(),
          fetchSkinBaronApiKeyStatus(),
          fetchPriceSourcePreference(),
        ]);

        const feeData = feeResponse?.data || {};
        const loadedForm = {
          fxFeePercent: toInputValue(feeData.fxFeePercent, DEFAULT_FORM.fxFeePercent),
          sellerFeePercent: toInputValue(feeData.sellerFeePercent, DEFAULT_FORM.sellerFeePercent),
          withdrawalFeePercent: toInputValue(
            feeData.withdrawalFeePercent,
            DEFAULT_FORM.withdrawalFeePercent,
          ),
          depositFeePercent: toInputValue(feeData.depositFeePercent, DEFAULT_FORM.depositFeePercent),
          depositFeeFixedEur: toInputValue(
            feeData.depositFeeFixedEur,
            DEFAULT_FORM.depositFeeFixedEur,
          ),
        };
        setForm(loadedForm);
        setSavedForm(loadedForm);
        setSource(feeData.source === "db" ? "db" : "defaults");

        const keyStatus = keyStatusResponse?.data || { configured: false, lastFour: null };
        setApiKeyStatus(keyStatus);
        const skinBaronStatus = skinBaronStatusResponse?.data || {};
        setSkinBaronApiKeyStatus(normalizeSkinBaronStatusPayload(skinBaronStatus));
        const priceSourceData = priceSourceResponse?.data || {};
        const loadedPriceSource = normalizePriceSourceMode(priceSourceData.mode);
        setPriceSourceMode(loadedPriceSource);
        setSavedPriceSourceMode(loadedPriceSource);

        setEncryptionReady(
          desktopRuntime
            ? keyStatus.encryptionAvailable !== false
            : isEncryptionConfigured(),
        );
        if (desktopRuntime && window.electronAPI?.secrets?.getVaultStatus) {
          const status = await window.electronAPI.secrets.getVaultStatus();
          setVaultStatus(status || null);
        } else {
          setVaultStatus(null);
        }
        setError("");
      } catch (loadError) {
        setError(loadError.message || t("errors.settingsLoad"));
      } finally {
        setLoading(false);
        setApiKeyLoading(false);
        setSkinBaronStatusLoading(false);
      }
    };

    void loadSettings();
  }, [desktopRuntime, t]);

  useEffect(() => {
    const loadServerConfig = async () => {
      if (!window.electronAPI?.serverConfig?.get) {
        setServerConfigLoading(false);
        return;
      }
      try {
        const config = await window.electronAPI.serverConfig.get();
        const normalizedHost = normalizeServerHostInput(config?.serverUrl || "");
        setServerUrl(normalizedHost || String(config?.serverUrl || ""));
      } catch (error) {
        setServerConfigError(error?.message || t("errors.serverConfigLoad"));
      } finally {
        setServerConfigLoading(false);
      }
    };

    void loadServerConfig();
  }, [t]);

  useEffect(() => {
    const loadAppVersion = async () => {
      if (!window.electronAPI?.updater?.getVersion) {
        return;
      }
      try {
        const value = await window.electronAPI.updater.getVersion();
        setAppVersion(String(value || ""));
      } catch {
        setAppVersion("");
      }
    };

    void loadAppVersion();
  }, []);

  // Reflect updater status pushed from the main process (covers both manual checks
  // and the periodic auto-check), so the "Über die App" card shows availability,
  // download progress, and errors live.
  useEffect(() => {
    if (!window.electronAPI?.updater?.onStatus) {
      return undefined;
    }
    const applyStatus = (payload) => {
      setUpdateStatus(payload || null);
      const state = payload?.state;
      if (state === "downloading") {
        setUpdateDownloading(true);
      } else if (
        state === "downloaded"
        || state === "handoff"
        || state === "error"
        || state === "not-available"
      ) {
        setUpdateDownloading(false);
      }
    };

    let cancelled = false;
    let receivedLiveStatus = false;

    const unsubscribe = window.electronAPI.updater.onStatus((payload) => {
      receivedLiveStatus = true;
      applyStatus(payload);
    });

    // Show the result of the automatic startup check even when this page is
    // opened long after it ran. A null snapshot means "nothing checked yet"
    // and must not clear the card; a live push that raced this call wins.
    if (window.electronAPI.updater.getLastStatus) {
      void window.electronAPI.updater
        .getLastStatus()
        .then((payload) => {
          if (cancelled || receivedLiveStatus || !payload) {
            return;
          }
          applyStatus(payload);
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      try {
        unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const handleCheckForUpdates = async () => {
    if (!window.electronAPI?.updater?.check) {
      return;
    }
    setUpdateChecking(true);
    try {
      const result = await window.electronAPI.updater.check();
      if (!result?.ok) {
        setUpdateStatus(
          result?.reason === "not-packaged"
            ? { state: "dev" }
            : {
                state: "error",
                message: result?.error || t("errors.updateCheckFailed"),
                url: result?.url,
              },
        );
      }
      // On success the main process emits app-updater-status (available / not-available),
      // which the subscription above turns into the displayed state.
    } catch (checkError) {
      setUpdateStatus({ state: "error", message: checkError?.message || t("errors.updateCheckFailed") });
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (!window.electronAPI?.updater?.download) {
      return;
    }
    setUpdateDownloading(true);
    try {
      await window.electronAPI.updater.download();
    } catch {
      setUpdateDownloading(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!window.electronAPI?.updater?.install) {
      return;
    }
    const result = await window.electronAPI.updater.install();
    // deb/rpm installs are handed to the system installer instead of restarting
    // in place — the status line explains that, but the failure needs a route out.
    if (result && result.ok === false) {
      await openAppReleasesPage(result.url);
    }
  };

  useEffect(() => {
    if (!desktopRuntime) {
      return;
    }
    const loadCsfloatWatchlistPref = async () => {
      try {
        const prefs = await getPortfolioPreferences();
        setCsfloatWatchlistAutoImport(Boolean(prefs?.csfloatWatchlistAutoImport));
        setCsfloatBuyOrderAutoImport(Boolean(prefs?.csfloatBuyOrderAutoImport));
        setNotifyBanWaveDesktop(prefs?.notifyBanWaveDesktop ?? true);
        setNotifyBanWaveDesktopMinLevel(prefs?.notifyBanWaveDesktopMinLevel ?? "low");
        setNotifyCsUpdatesDesktop(prefs?.notifyCsUpdatesDesktop ?? true);
        setNotifyCsUpdatesDesktopMinLevel(prefs?.notifyCsUpdatesDesktopMinLevel ?? "medium");
        setNotifySteamSyncDesktop(prefs?.notifySteamSyncDesktop ?? true);
      } catch {
        setCsfloatWatchlistAutoImport(false);
        setCsfloatBuyOrderAutoImport(false);
      }
    };

    void loadCsfloatWatchlistPref();
  }, [desktopRuntime]);

  // Web-push notification prefs are server-owned on the web/PWA (see
  // portfolioPreferences.js). They must load on web too — not just desktop —
  // otherwise the enable toggle and min-level stay at their initial defaults
  // (off / "high") and every saved change appears lost after a reload.
  useEffect(() => {
    if (isElectronRuntime) {
      return;
    }
    const loadWebPushNotifyPrefs = async () => {
      try {
        const webPushPrefs = await getWebPushNotificationPreferences();
        setNotifyCsUpdatesWebPush(Boolean(webPushPrefs?.notifyCsUpdatesWebPush));
        setNotifyCsUpdatesWebPushMinLevel(webPushPrefs?.notifyCsUpdatesWebPushMinLevel ?? "high");
      } catch {
        setNotifyCsUpdatesWebPush(false);
      }
    };

    void loadWebPushNotifyPrefs();
  }, [isElectronRuntime]);

  const handleToggleCsfloatWatchlistAutoImport = async () => {
    const next = !csfloatWatchlistAutoImport;
    setCsfloatWatchlistAutoImport(next);
    setCsfloatWatchlistSaving(true);
    setCsfloatWatchlistError("");
    setCsfloatWatchlistMessage("");
    try {
      const saved = await updatePortfolioPreferences({ csfloatWatchlistAutoImport: next });
      setCsfloatWatchlistAutoImport(Boolean(saved?.csfloatWatchlistAutoImport));
    } catch (error) {
      setCsfloatWatchlistAutoImport(!next);
      setCsfloatWatchlistError(error?.message || t("errors.settingSaveFailed"));
    } finally {
      setCsfloatWatchlistSaving(false);
    }
  };

  const WEB_PUSH_NOTIFY_KEYS = ["notifyCsUpdatesWebPush", "notifyCsUpdatesWebPushMinLevel"];

  const handleToggleNotifyPref = async (key, currentValue, setter, explicitValue) => {
    const next = explicitValue !== undefined ? explicitValue : !currentValue;
    if (next === currentValue) return;
    setter(next);
    setNotifySaving(true);
    setNotifyError("");
    try {
      if (WEB_PUSH_NOTIFY_KEYS.includes(key)) {
        // Server-owned (web) preferences — persisted via the settings API so the
        // push send-path can honour them; desktop mirrors the localStore blob.
        await updateWebPushNotificationPreferences({ [key]: next });
      } else {
        await updatePortfolioPreferences({ [key]: next });
      }
    } catch (error) {
      setter(currentValue);
      setNotifyError(error?.message || t("errors.settingSaveFailed"));
    } finally {
      setNotifySaving(false);
    }
  };

  const handleImportCsfloatWatchlistNow = async () => {
    setCsfloatWatchlistImporting(true);
    setCsfloatWatchlistError("");
    setCsfloatWatchlistMessage("");
    try {
      const result = await importCsFloatWatchlistData({ force: true });
      if (result?.skipped) {
        if (result.reason === "auth-required") {
          setCsfloatWatchlistError(t("errors.signInFirst"));
        } else if (result.reason === "upstream-error") {
          const code = String(result?.error?.code || "CSFLOAT_ERROR");
          const status = Number(result?.error?.statusCode || 0);
          setCsfloatWatchlistError(
            `CSFloat-Watchlist konnte nicht geladen werden (${code}${status ? ` ${status}` : ""}).`,
          );
        } else {
          setCsfloatWatchlistError(t("errors.importSkipped"));
        }
      } else {
        const added = Number(result?.added || 0);
        const fetched = Number(result?.fetched || 0);
        const notInCatalog = Number(result?.notInCatalog || 0);
        const skippedSuffix = notInCatalog > 0
          ? t("csfloatSync.importSkipped", { count: notInCatalog })
          : "";
        setCsfloatWatchlistMessage(
          (added > 0
            ? t("csfloatSync.watchlistAdded", { count: added, fetched })
            : t("csfloatSync.watchlistNone", { fetched })) + skippedSuffix,
        );
      }
    } catch (error) {
      setCsfloatWatchlistError(error?.message || t("errors.watchlistImportFailed"));
    } finally {
      setCsfloatWatchlistImporting(false);
    }
  };

  const handleToggleCsfloatBuyOrderAutoImport = async () => {
    const next = !csfloatBuyOrderAutoImport;
    setCsfloatBuyOrderAutoImport(next);
    setCsfloatBuyOrderSaving(true);
    setCsfloatBuyOrderError("");
    setCsfloatBuyOrderMessage("");
    try {
      const saved = await updatePortfolioPreferences({ csfloatBuyOrderAutoImport: next });
      setCsfloatBuyOrderAutoImport(Boolean(saved?.csfloatBuyOrderAutoImport));
    } catch (error) {
      setCsfloatBuyOrderAutoImport(!next);
      setCsfloatBuyOrderError(error?.message || t("errors.settingSaveFailed"));
    } finally {
      setCsfloatBuyOrderSaving(false);
    }
  };

  const handleImportCsfloatBuyOrdersNow = async () => {
    setCsfloatBuyOrderImporting(true);
    setCsfloatBuyOrderError("");
    setCsfloatBuyOrderMessage("");
    try {
      const result = await importCsFloatBuyOrdersAsWatchlistData({ force: true });
      if (result?.skipped) {
        if (result.reason === "auth-required") {
          setCsfloatBuyOrderError(t("errors.signInFirst"));
        } else if (result.reason === "upstream-error") {
          const code = String(result?.error?.code || "CSFLOAT_ERROR");
          const status = Number(result?.error?.statusCode || 0);
          setCsfloatBuyOrderError(
            `CSFloat Buy Orders konnten nicht geladen werden (${code}${status ? ` ${status}` : ""}).`,
          );
        } else {
          setCsfloatBuyOrderError(t("errors.importSkipped"));
        }
      } else {
        const added = Number(result?.added || 0);
        const fetched = Number(result?.fetched || 0);
        const notInCatalog = Number(result?.notInCatalog || 0);
        const skippedSuffix = notInCatalog > 0
          ? t("csfloatSync.importSkipped", { count: notInCatalog })
          : "";
        setCsfloatBuyOrderMessage(
          (added > 0
            ? t("csfloatSync.buyOrdersAdded", { count: added, fetched })
            : t("csfloatSync.buyOrdersNone", { fetched })) + skippedSuffix,
        );
      }
    } catch (error) {
      setCsfloatBuyOrderError(error?.message || t("errors.buyOrderImportFailed"));
    } finally {
      setCsfloatBuyOrderImporting(false);
    }
  };

  useEffect(() => {
    const loadWebPushState = async () => {
      if (!webPushSupported) {
        return;
      }

      try {
        setWebPushLoading(true);
        setWebPushError("");
        setWebPushPermission(Notification.permission);

        const keyResponse = await fetchWebPushPublicKey();
        const configured = Boolean(keyResponse?.data?.configured);
        const publicKey = String(keyResponse?.data?.publicKey || "");
        setWebPushConfigured(configured);
        setWebPushPublicKey(publicKey);

        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setWebPushSubscribed(Boolean(subscription));
      } catch (error) {
        setWebPushError(error?.message || t("errors.pushStatusLoad"));
      } finally {
        setWebPushLoading(false);
      }
    };

    void loadWebPushState();
  }, [webPushSupported, t]);

  // A deep link into the push settings must also select the channel it means —
  // landing on the Desktop channel would show a table without the row asked for.
  useEffect(() => {
    if (!requestedSettingsSection) {
      return;
    }
    if (["push-notifications", "push", "browser-push"].includes(requestedSettingsSection)) {
      setNotificationChannel(isElectronRuntime ? "desktop" : "push");
    }
  }, [requestedSettingsSection, isElectronRuntime]);

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
    setSuccess("");
  };

  const handleApiKeyChange = (event) => {
    setApiKey(event.target.value);
    setApiKeyError("");
    setApiKeySuccess("");
  };

  const handleSkinBaronSessionCookieChange = (event) => {
    setSkinBaronSessionCookie(event.target.value);
    setSkinBaronApiKeyError("");
    setSkinBaronApiKeySuccess("");
  };

  const handleUpdateCsFloatApiKey = async () => {
    try {
      setApiKeySaving(true);
      setApiKeyError("");
      setApiKeySuccess("");

      if (!desktopRuntime) {
        setApiKeyError(t("errors.apiKeyDesktopOnly"));
        return;
      }

      const trimmedApiKey = apiKey.trim();
      await updateCsFloatApiKey(trimmedApiKey);

      setApiKeySuccess(t("errors.apiKeyUpdated"));
      setApiKey("");

      const statusResponse = await fetchCsFloatApiKeyStatus();
      setApiKeyStatus(statusResponse?.data || statusResponse);
    } catch (err) {
      setApiKeyError(err.message || t("errors.apiKeyUpdateFailed"));
    } finally {
      setApiKeySaving(false);
    }
  };

  const feeDirty = useMemo(
    () => Object.keys(DEFAULT_FORM).some((key) => String(form[key]) !== String(savedForm[key])),
    [form, savedForm],
  );
  const priceSourceDirty = priceSourceMode !== savedPriceSourceMode;
  const dirty = feeDirty || priceSourceDirty;
  const savingAny = saving || priceSourceSaving;

  const handleSaveFees = async () => {
    const payload = {
      fxFeePercent: Number(form.fxFeePercent),
      sellerFeePercent: Number(form.sellerFeePercent),
      withdrawalFeePercent: Number(form.withdrawalFeePercent),
      depositFeePercent: Number(form.depositFeePercent),
      depositFeeFixedEur: Number(form.depositFeeFixedEur),
    };

    const response = await updateFeeSettings(payload);
    const saved = response?.data || payload;

    const nextForm = {
      fxFeePercent: toInputValue(saved.fxFeePercent, DEFAULT_FORM.fxFeePercent),
      sellerFeePercent: toInputValue(saved.sellerFeePercent, DEFAULT_FORM.sellerFeePercent),
      withdrawalFeePercent: toInputValue(
        saved.withdrawalFeePercent,
        DEFAULT_FORM.withdrawalFeePercent,
      ),
      depositFeePercent: toInputValue(saved.depositFeePercent, DEFAULT_FORM.depositFeePercent),
      depositFeeFixedEur: toInputValue(saved.depositFeeFixedEur, DEFAULT_FORM.depositFeeFixedEur),
    };
    setForm(nextForm);
    setSavedForm(nextForm);
    setSource("db");
  };

  const handleSavePriceSource = async () => {
    const response = await updatePriceSourcePreference(priceSourceMode);
    const saved = normalizePriceSourceMode(response?.data?.mode || priceSourceMode);
    setPriceSourceMode(saved);
    setSavedPriceSourceMode(saved);
  };

  /**
   * Header save. Fees and the price-source preference are the only settings that
   * do not persist on change, so they are the page's dirty set — everything else
   * (theme, currency, toggles) writes through immediately.
   */
  const handleSaveAll = async () => {
    setError("");
    setSuccess("");
    setPriceSourceError("");
    setPriceSourceSuccess("");

    if (feeDirty) {
      setSaving(true);
      try {
        await handleSaveFees();
        setSuccess(t("errors.feesSaved"));
      } catch (saveError) {
        setError(saveError.message || t("errors.feesSaveFailed"));
      } finally {
        setSaving(false);
      }
    }

    if (priceSourceDirty) {
      setPriceSourceSaving(true);
      try {
        await handleSavePriceSource();
        setPriceSourceSuccess(t("errors.saved"));
      } catch (saveError) {
        setPriceSourceError(saveError?.message || t("errors.priceSourceSaveFailed"));
      } finally {
        setPriceSourceSaving(false);
      }
    }
  };

  const handleDiscardAll = () => {
    setForm(savedForm);
    setPriceSourceMode(savedPriceSourceMode);
    setError("");
    setSuccess("");
    setPriceSourceError("");
    setPriceSourceSuccess("");
  };

  const handleUpdateSkinBaronSessionCookie = async () => {
    try {
      setSkinBaronSessionSaving(true);
      setSkinBaronApiKeyError("");
      setSkinBaronApiKeySuccess("");

      if (!desktopRuntime) {
        setSkinBaronApiKeyError(t("errors.cookieDesktopOnly"));
        return;
      }

      const trimmedCookie = skinBaronSessionCookie.trim();
      await updateSkinBaronSessionCookie(trimmedCookie);

      setSkinBaronApiKeySuccess(t("errors.cookieSaved"));
      setSkinBaronSessionCookie("");

      const statusResponse = await fetchSkinBaronApiKeyStatus();
      const nextStatus = statusResponse?.data || statusResponse || {};
      setSkinBaronApiKeyStatus(normalizeSkinBaronStatusPayload(nextStatus));
    } catch (err) {
      setSkinBaronApiKeyError(err.message || t("errors.cookieSaveFailed"));
    } finally {
      setSkinBaronSessionSaving(false);
    }
  };

  const handleConnectSkinBaronSessionViaBrowser = async () => {
    try {
      setSkinBaronSessionBrowserConnecting(true);
      setSkinBaronApiKeyError("");
      setSkinBaronApiKeySuccess("");

      if (!desktopRuntime) {
        setSkinBaronApiKeyError(t("errors.browserLoginDesktopOnly"));
        return;
      }

      await connectSkinBaronSessionCookieViaBrowser();
      setSkinBaronApiKeySuccess(t("errors.browserConnected"));
      setSkinBaronSessionCookie("");

      const statusResponse = await fetchSkinBaronApiKeyStatus();
      const nextStatus = statusResponse?.data || statusResponse || {};
      setSkinBaronApiKeyStatus(normalizeSkinBaronStatusPayload(nextStatus));
    } catch (err) {
      setSkinBaronApiKeyError(err.message || t("errors.browserLoginFailed"));
    } finally {
      setSkinBaronSessionBrowserConnecting(false);
    }
  };

  const resolveCurrentUserId = async () => {
    const user = await getCurrentUser();
    const userId = Number(user?.id || 1);
    return Number.isFinite(userId) && userId > 0 ? userId : 1;
  };

  const handleEnableWebPush = async () => {
    if (!webPushSupported) {
      setWebPushError(t("errors.pushUnsupported"));
      return;
    }

    try {
      setWebPushSaving(true);
      setWebPushError("");
      setWebPushSuccess("");

      const keyResponse = await fetchWebPushPublicKey();
      const configured = Boolean(keyResponse?.data?.configured);
      const publicKey = String(keyResponse?.data?.publicKey || "");
      setWebPushConfigured(configured);
      setWebPushPublicKey(publicKey);

      if (!configured || !publicKey) {
        setWebPushError(t("errors.pushNotConfigured"));
        return;
      }

      if (Notification.permission === "denied") {
        setWebPushPermission("denied");
        setWebPushError(t("errors.pushBlocked"));
        return;
      }

      const permission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      setWebPushPermission(permission);
      if (permission !== "granted") {
        setWebPushError(t("errors.pushPermissionDenied"));
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(publicKey),
        });
      }

      const userId = await resolveCurrentUserId();
      const payload =
        typeof subscription.toJSON === "function" ? subscription.toJSON() : subscription;
      await subscribeWebPush(payload, userId);

      setWebPushSubscribed(true);
      setWebPushSuccess(t("errors.pushEnabled"));
    } catch (error) {
      setWebPushError(error?.message || t("errors.pushEnableFailed"));
    } finally {
      setWebPushSaving(false);
    }
  };

  const handleDisableWebPush = async () => {
    if (!webPushSupported) {
      setWebPushError(t("errors.pushUnsupported"));
      return;
    }

    try {
      setWebPushSaving(true);
      setWebPushError("");
      setWebPushSuccess("");

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const endpoint = String(subscription?.endpoint || "");

      if (subscription) {
        await subscription.unsubscribe();
      }

      if (endpoint) {
        const userId = await resolveCurrentUserId();
        await unsubscribeWebPush(endpoint, userId);
      }

      setWebPushSubscribed(false);
      setWebPushSuccess(t("errors.pushDisabled"));
    } catch (error) {
      setWebPushError(error?.message || t("errors.pushDisableFailed"));
    } finally {
      setWebPushSaving(false);
    }
  };

  const handlePriceSourceChange = (value) => {
    setPriceSourceMode(value);
    setPriceSourceError("");
    setPriceSourceSuccess("");
  };

  const themeModeLabel = themeMode === "system"
    ? t("theme.themeSystemWith", { mode: isDark ? t("theme.modeDark") : t("theme.modeLight") })
    : themeMode === "dark"
      ? t("theme.dark")
      : t("theme.light");

  // Credentials that are missing or no longer valid — the only badge in the nav
  // that carries a real signal rather than a count of controls.
  const connectionAttentionCount = desktopRuntime
    ? [
        !apiKeyStatus.configured,
        !(skinBaronApiKeyStatus?.importReady === true
          || skinBaronApiKeyStatus?.sessionCookieAccess?.allowed === true),
        desktopRuntime && !serverUrl.trim(),
      ].filter(Boolean).length
    : 0;

  const normalizedCategorySearch = categorySearchTerm.trim().toLowerCase();
  const visibleCategories = normalizedCategorySearch
    ? availableCategories.filter((category) =>
        // The keyword list is translated too: a German user searches "währung",
        // an English one "currency", and neither should have to know the other.
        `${t(category.labelKey)} ${t(category.hintKey)} ${t(category.keywordsKey)}`
          .toLowerCase()
          .includes(normalizedCategorySearch),
      )
    : availableCategories;

  const renderLookCategory = () => (
    <>
      <SettingsCard id="settings-section-appearance">
        <SettingsCardHeader
          title={t("theme.title")}
          description={t("theme.hint")}
        />
        <SettingsCardBody className="flex flex-col gap-3.5">
          <div className="grid gap-2.5 sm:grid-cols-3">
            {[
              {
                value: "system",
                label: t("theme.system"),
                hint: t("theme.systemHint", {
                  mode: systemPrefersDark ? t("theme.modeDark") : t("theme.modeLight"),
                }),
                swatch: SYSTEM_SWATCH,
              },
              { value: "light", label: t("theme.light"), hint: t("theme.lightHint"), swatch: LIGHT_SWATCH },
              { value: "dark", label: t("theme.dark"), hint: t("theme.darkHint"), swatch: DARK_SWATCH },
            ].map((option) => (
              <SettingsTile
                key={option.value}
                active={themeMode === option.value}
                label={option.label}
                hint={option.hint}
                swatch={option.swatch}
                onClick={() => setThemeMode(option.value)}
              />
            ))}
          </div>
          <SettingsNote>
            <span>
              {t("theme.activeMode")}{" "}
              <span className="font-bold text-foreground">{themeModeLabel}</span>
            </span>
            <span>{t("theme.appliesEverywhere")}</span>
          </SettingsNote>
        </SettingsCardBody>
      </SettingsCard>

      <SoundSettingsSection />

      {desktopRuntime ? <WindowControlsSettingsSection /> : null}
    </>
  );

  const renderMoneyCategory = () => (
    <>
      <CurrencySettingsSection
        currency={currencyContext.currency}
        currencies={currencyContext.currencies}
        setCurrency={currencyContext.setCurrency}
        exchangeRates={currencyContext.exchangeRates}
        ratesLoading={currencyContext.ratesLoading}
        popularCurrencyCodes={currencyContext.popularCurrencyCodes || []}
        currencySearchTerm={currencySearchTerm}
        setCurrencySearchTerm={setCurrencySearchTerm}
      />
      <FeeSettingsSection
        form={form}
        source={source}
        loading={loading}
        saving={saving}
        error={error}
        success={success}
        handleChange={handleChange}
      />
    </>
  );

  const renderPricesCategory = () => (
    <>
      <PriceSourceSettingsSection
        priceSourceMode={priceSourceMode}
        priceSourceError={priceSourceError}
        priceSourceSuccess={priceSourceSuccess}
        onPriceSourceChange={handlePriceSourceChange}
      />

      {desktopRuntime ? (
        <SettingsCard id="settings-section-csfloat-sync">
          <SettingsCardHeader
            title={t("csfloatSync.title")}
            description={t("csfloatSync.hint")}
          />
          <SettingsRow
            title={t("csfloatSync.autoWatchlist")}
            description={
              csfloatWatchlistAutoImport
                ? t("csfloatSync.autoWatchlistOn")
                : t("csfloatSync.autoWatchlistOff")
            }
          >
            <button
              type="button"
              onClick={handleImportCsfloatWatchlistNow}
              disabled={csfloatWatchlistImporting}
              className="h-8 whitespace-nowrap rounded-[9px] border border-border-strong px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-40"
            >
              {csfloatWatchlistImporting ? t("csfloatSync.importing") : t("csfloatSync.importNow")}
            </button>
            <Switch
              checked={csfloatWatchlistAutoImport}
              onCheckedChange={handleToggleCsfloatWatchlistAutoImport}
              disabled={csfloatWatchlistSaving}
              aria-label={t("csfloatSync.autoWatchlist")}
            />
          </SettingsRow>
          <SettingsRow
            title={t("csfloatSync.autoBuyOrders")}
            description={
              csfloatBuyOrderAutoImport
                ? t("csfloatSync.autoBuyOrdersOn")
                : t("csfloatSync.autoWatchlistOff")
            }
            divider={Boolean(
              csfloatWatchlistMessage || csfloatWatchlistError || csfloatBuyOrderMessage || csfloatBuyOrderError,
            )}
          >
            <button
              type="button"
              onClick={handleImportCsfloatBuyOrdersNow}
              disabled={csfloatBuyOrderImporting}
              className="h-8 whitespace-nowrap rounded-[9px] border border-border-strong px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-40"
            >
              {csfloatBuyOrderImporting ? t("csfloatSync.importing") : t("csfloatSync.importNow")}
            </button>
            <Switch
              checked={csfloatBuyOrderAutoImport}
              onCheckedChange={handleToggleCsfloatBuyOrderAutoImport}
              disabled={csfloatBuyOrderSaving}
              aria-label={t("csfloatSync.autoBuyOrders")}
            />
          </SettingsRow>
          {csfloatWatchlistMessage || csfloatWatchlistError || csfloatBuyOrderMessage || csfloatBuyOrderError ? (
            <div className="flex flex-col gap-1 px-5 py-3 text-[11px]">
              {csfloatWatchlistMessage ? <p className="text-success">{csfloatWatchlistMessage}</p> : null}
              {csfloatWatchlistError ? <p className="text-warn">{csfloatWatchlistError}</p> : null}
              {csfloatBuyOrderMessage ? <p className="text-success">{csfloatBuyOrderMessage}</p> : null}
              {csfloatBuyOrderError ? <p className="text-warn">{csfloatBuyOrderError}</p> : null}
            </div>
          ) : null}
        </SettingsCard>
      ) : null}
    </>
  );

  const renderNotifyCategory = () => {
    const isPushChannel = activeNotificationChannel === "push";
    const rows = isPushChannel
      ? [
          {
            id: "cs-updates-push",
            title: t("notifications.cs2Updates"),
            description: t("notifications.cs2UpdatesPushHint"),
            enabled: notifyCsUpdatesWebPush,
            onToggle: () =>
              void handleToggleNotifyPref(
                "notifyCsUpdatesWebPush",
                notifyCsUpdatesWebPush,
                setNotifyCsUpdatesWebPush,
              ),
            level: notifyCsUpdatesWebPushMinLevel,
            onLevelSelect: (level) =>
              void handleToggleNotifyPref(
                "notifyCsUpdatesWebPushMinLevel",
                notifyCsUpdatesWebPushMinLevel,
                setNotifyCsUpdatesWebPushMinLevel,
                level,
              ),
          },
        ]
      : [
          {
            id: "ban-wave",
            title: t("notifications.banWave"),
            description: t("notifications.banWaveHint"),
            enabled: notifyBanWaveDesktop,
            onToggle: () =>
              void handleToggleNotifyPref(
                "notifyBanWaveDesktop",
                notifyBanWaveDesktop,
                setNotifyBanWaveDesktop,
              ),
            level: notifyBanWaveDesktopMinLevel,
            onLevelSelect: (level) =>
              void handleToggleNotifyPref(
                "notifyBanWaveDesktopMinLevel",
                notifyBanWaveDesktopMinLevel,
                setNotifyBanWaveDesktopMinLevel,
                level,
              ),
          },
          {
            id: "cs-updates",
            title: t("notifications.cs2Updates"),
            description: t("notifications.cs2UpdatesFeedHint"),
            enabled: notifyCsUpdatesDesktop,
            onToggle: () =>
              void handleToggleNotifyPref(
                "notifyCsUpdatesDesktop",
                notifyCsUpdatesDesktop,
                setNotifyCsUpdatesDesktop,
              ),
            level: notifyCsUpdatesDesktopMinLevel,
            onLevelSelect: (level) =>
              void handleToggleNotifyPref(
                "notifyCsUpdatesDesktopMinLevel",
                notifyCsUpdatesDesktopMinLevel,
                setNotifyCsUpdatesDesktopMinLevel,
                level,
              ),
          },
          {
            id: "steam-sync",
            title: t("notifications.steamSync"),
            description: t("notifications.steamSyncHint"),
            enabled: notifySteamSyncDesktop,
            onToggle: () =>
              void handleToggleNotifyPref(
                "notifySteamSyncDesktop",
                notifySteamSyncDesktop,
                setNotifySteamSyncDesktop,
              ),
            level: null,
            onLevelSelect: null,
          },
        ];

    return (
      <SettingsCard id="settings-section-push-notifications">
        <SettingsCardHeader
          title={t("notifications.title")}
          description={t("notifications.hint")}
          action={
            notificationChannels.length > 1 ? (
              <SegmentedControl
                items={notificationChannels}
                value={activeNotificationChannel}
                onChange={setNotificationChannel}
                size="sm"
              />
            ) : null
          }
        />
        <div className="hidden grid-cols-[minmax(0,1fr)_300px_62px] items-center gap-3 border-b border-border px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground lg:grid">
          <span>{t("notifications.columnEvent")}</span>
          <span>{t("notifications.columnMinImpact")}</span>
          <span className="text-right">{t("notifications.columnActive")}</span>
        </div>
        {rows.map((row, index) => (
          <NotificationRow
            key={row.id}
            title={row.title}
            description={row.description}
            enabled={row.enabled}
            onToggle={row.onToggle}
            level={row.level}
            onLevelSelect={row.onLevelSelect}
            saving={notifySaving}
            divider={index < rows.length - 1 || isPushChannel || Boolean(notifyError)}
          />
        ))}
        {isPushChannel ? (
          <WebPushSettingsSection
            webPushSupported={webPushSupported}
            webPushLoading={webPushLoading}
            webPushError={webPushError}
            webPushSuccess={webPushSuccess}
            webPushPermission={webPushPermission}
            webPushConfigured={webPushConfigured}
            webPushSubscribed={webPushSubscribed}
            webPushSaving={webPushSaving}
            onEnable={handleEnableWebPush}
            onDisable={handleDisableWebPush}
          />
        ) : null}
        {notifyError ? <p className="px-5 py-3 text-[11px] text-warn">{notifyError}</p> : null}
      </SettingsCard>
    );
  };

  const renderVaultCard = () => {
    if (!desktopRuntime || !window.electronAPI?.secrets?.getVaultStatus) {
      return null;
    }

    const isConfigured = vaultStatus?.configured === true;
    const isUnlocked = vaultStatus?.unlocked === true;
    const idleMinutes = Number(vaultStatus?.idleTimeoutMinutes || 15);
    const autoLockEnabled = vaultStatus?.policy?.autoLockOnIdle === true;

    return (
      <SettingsCard id="settings-section-vault">
        <SettingsCardHeader
          title={t("vault.title")}
          description="Verschlüsselter Speicher für Schlüssel und Sessions. Unlock ist nach jedem App-Start erforderlich."
          action={
            <>
              <StatusPill tone={isUnlocked ? "success" : "warn"} dot>
                {isUnlocked ? t("vault.unlocked") : t("vault.locked")}
              </StatusPill>
              <StatusPill tone={isConfigured ? "muted" : "danger"}>
                {isConfigured ? t("vault.passwordSet") : t("vault.passwordMissing")}
              </StatusPill>
            </>
          }
        />
        <SettingsRow
          title={t("vault.autoLock")}
          description={
            autoLockEnabled
              ? `Aktiv: sperrt nach ${idleMinutes} Minuten Inaktivität`
              : t("vault.autoLockOff")
          }
          divider={false}
        >
          <Switch
            checked={autoLockEnabled}
            disabled={vaultActionSaving || !window.electronAPI?.secrets?.setVaultPreferences}
            aria-label={t("vault.autoLock")}
            onCheckedChange={async () => {
              try {
                setVaultActionSaving(true);
                const result = await window.electronAPI.secrets.setVaultPreferences({
                  autoLockEnabled: !autoLockEnabled,
                });
                setVaultStatus(result?.status || vaultStatus);
              } catch (error) {
                setError(error?.message || t("errors.vaultSaveFailed"));
              } finally {
                setVaultActionSaving(false);
              }
            }}
          />
        </SettingsRow>
      </SettingsCard>
    );
  };

  const renderConnCategory = () => (
    <>
      <SettingsCard id="settings-section-api-keys">
        <SettingsCardHeader
          title={t("vault.apiKeys")}
          description={t("vault.apiKeysHint")}
        />
        <SettingsBanner tone="info" icon={<CreditCard className="size-4 text-info" />}>
          <span className="font-bold text-foreground">
            Testen und Speichern können ein Browserfenster öffnen.
          </span>{" "}
          Verlangt SkinBaron einen Login oder Cloudflare beim Server eine Bestätigung, startet die
          App ein eingebettetes Chromium-Fenster. Schließe es erst, wenn die Anmeldung durch ist —
          die Session wird danach im Vault abgelegt.
        </SettingsBanner>
        <CsFloatApiKeySection
          apiKey={apiKey}
          apiKeyLoading={apiKeyLoading}
          apiKeySaving={apiKeySaving}
          apiKeyStatus={apiKeyStatus}
          showApiKey={showApiKey}
          apiKeyError={apiKeyError}
          apiKeySuccess={apiKeySuccess}
          encryptionReady={encryptionReady}
          desktopRuntime={desktopRuntime}
          onApiKeyChange={handleApiKeyChange}
          onToggleShowApiKey={() => setShowApiKey(!showApiKey)}
          onUpdate={handleUpdateCsFloatApiKey}
        />
        <SkinBaronApiKeySection
          skinBaronStatusLoading={skinBaronStatusLoading}
          skinBaronApiKeyStatus={skinBaronApiKeyStatus}
          skinBaronApiKeyError={skinBaronApiKeyError}
          skinBaronApiKeySuccess={skinBaronApiKeySuccess}
          skinBaronSessionCookie={skinBaronSessionCookie}
          showSkinBaronSessionCookie={showSkinBaronSessionCookie}
          skinBaronSessionSaving={skinBaronSessionSaving}
          skinBaronSessionBrowserConnecting={skinBaronSessionBrowserConnecting}
          encryptionReady={encryptionReady}
          onSessionCookieChange={handleSkinBaronSessionCookieChange}
          onToggleShowSessionCookie={() => setShowSkinBaronSessionCookie(!showSkinBaronSessionCookie)}
          onSaveSessionCookie={handleUpdateSkinBaronSessionCookie}
          onConnectViaBrowser={handleConnectSkinBaronSessionViaBrowser}
        />
        {window.electronAPI?.serverConfig ? (
          <ServerConfigSection
            serverUrl={serverUrl}
            serverConfigLoading={serverConfigLoading}
            serverConfigSaving={serverConfigSaving}
            serverConfigTesting={serverConfigTesting}
            serverConfigError={serverConfigError}
            serverConfigMessage={serverConfigMessage}
            onUrlChange={(event) => {
              setServerUrl(event.target.value);
              setServerConfigError("");
              setServerConfigMessage("");
            }}
            onTestConnection={async () => {
              try {
                const normalizedHost = normalizeServerHostInput(serverUrl);
                if (!normalizedHost) {
                  setServerConfigError(t("errors.hostnameInvalid"));
                  return;
                }
                setServerConfigTesting(true);
                setServerConfigError("");
                setServerConfigMessage("");
                const result = await window.electronAPI.serverConfig.test(normalizedHost);
                if (result?.ok) {
                  setServerConfigMessage(result?.message || t("errors.connectionOk"));
                  setServerUrl(normalizedHost);
                } else {
                  setServerConfigError(result?.message || t("errors.connectionFailed"));
                }
              } catch (error) {
                setServerConfigError(error?.message || t("errors.connectionTestFailed"));
              } finally {
                setServerConfigTesting(false);
              }
            }}
            onSave={async () => {
              try {
                const normalizedHost = normalizeServerHostInput(serverUrl);
                if (!normalizedHost) {
                  setServerConfigError(t("errors.hostnameInvalid"));
                  return;
                }
                setServerConfigSaving(true);
                setServerConfigError("");
                setServerConfigMessage("");
                await window.electronAPI.serverConfig.set({ serverUrl: normalizedHost });
                setServerUrl(normalizedHost);
                setServerConfigMessage(t("errors.serverUrlSaved"));
              } catch (error) {
                setServerConfigError(error?.message || t("errors.serverUrlSaveFailed"));
              } finally {
                setServerConfigSaving(false);
              }
            }}
          />
        ) : null}
      </SettingsCard>

      {renderVaultCard()}
    </>
  );

  const renderAboutCategory = () => {
    const updateMessage = !updateStatus
      ? ""
      : updateStatus.state === "available"
        ? `Update verfügbar${updateStatus.version ? ` (v${updateStatus.version})` : ""}.`
        : updateStatus.state === "manual"
          ? `Update verfügbar${updateStatus.version ? ` (v${updateStatus.version})` : ""}. Diese Installation kann sich nicht selbst aktualisieren — bitte manuell von GitHub laden.`
          : updateStatus.state === "downloading"
            ? `Wird heruntergeladen… ${Math.round(Number(updateStatus.percent || 0))}%`
            : updateStatus.state === "downloaded"
              ? `Update${updateStatus.version ? ` v${updateStatus.version}` : ""} bereit zur Installation.`
              : updateStatus.state === "installing"
                ? t("about.installing")
                : updateStatus.state === "handoff"
                  ? `Update${updateStatus.version ? ` v${updateStatus.version}` : ""} wurde im System-Installer geöffnet — App schließen und dort bestätigen.`
                  : updateStatus.state === "not-available"
                    ? t("about.upToDate")
                    : updateStatus.state === "dev"
                      ? t("about.installedAppOnly")
                      : updateStatus.state === "error"
                        ? `${updateStatus.message || t("errors.updateCheckFailed")} Alternativ manuell von GitHub laden.`
                        : "";
    const updateTone =
      updateStatus?.state === "error" || updateStatus?.state === "manual"
        ? "text-warn"
        : updateStatus?.state === "available" || updateStatus?.state === "downloaded"
          ? "text-success"
          : "text-muted-foreground";

    const facts = [
      { label: t("about.appVersion"), value: appVersion ? `v${appVersion}` : t("about.unknown") },
      { label: t("about.serverHost"), value: serverUrl || t("about.notSet") },
      { label: t("about.displayCurrency"), value: currencyContext.currency },
      {
        label: t("about.livePriceSource"),
        value:
          savedPriceSourceMode === "csfloat"
            ? t("about.csfloatOnly")
            : savedPriceSourceMode === "steam"
              ? t("about.steamOnly")
              : t("about.auto"),
      },
    ];

    return (
      <SettingsCard id="settings-section-about">
        <SettingsCardHeader title={t("about.title")} description={t("about.hint")} />
        <SettingsCardBody className="grid gap-2.5 sm:grid-cols-2">
          {facts.map((fact) => (
            <div
              key={fact.label}
              className="flex items-center justify-between gap-3 rounded-[12px] border border-border-soft bg-surface-1 px-3.5 py-3"
            >
              <span className="text-[12px] text-muted-foreground">{fact.label}</span>
              <span className="truncate text-[13px] font-bold tabular-nums text-foreground">
                {fact.value}
              </span>
            </div>
          ))}
        </SettingsCardBody>
        <div className="flex flex-wrap items-center gap-2 px-5 pb-[18px]">
          <button
            type="button"
            onClick={() => void handleCheckForUpdates()}
            disabled={updateChecking || updateStatus?.state === "checking"}
            className="h-[34px] rounded-[9px] border border-border-strong px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-40"
          >
            {updateChecking || updateStatus?.state === "checking"
              ? t("about.checking")
              : t("about.checkForUpdates")}
          </button>

          {updateStatus?.state === "available" ? (
            <button
              type="button"
              onClick={() => void handleDownloadUpdate()}
              disabled={updateDownloading}
              className="h-[34px] rounded-[9px] bg-primary px-3 text-[12px] font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {updateDownloading ? t("about.downloading") : t("about.downloadNow")}
            </button>
          ) : null}

          {/* This install cannot update itself, or the updater failed —
              the release page is the only remaining route. */}
          {updateStatus?.state === "manual" || updateStatus?.state === "error" ? (
            <button
              type="button"
              onClick={() => void openAppReleasesPage(updateStatus?.url)}
              className="h-[34px] rounded-[9px] border border-border-strong px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-surface-2"
            >
              Auf GitHub herunterladen
            </button>
          ) : null}

          {updateStatus?.state === "downloaded" ? (
            <button
              type="button"
              onClick={() => void handleInstallUpdate()}
              className="h-[34px] rounded-[9px] bg-primary px-3 text-[12px] font-bold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Neustarten &amp; installieren
            </button>
          ) : null}

          {updateMessage ? (
            <p className={`w-full text-[11px] ${updateTone}`}>{updateMessage}</p>
          ) : null}
        </div>
      </SettingsCard>
    );
  };

  const categoryPanels = {
    look: renderLookCategory,
    money: renderMoneyCategory,
    prices: renderPricesCategory,
    notify: renderNotifyCategory,
    conn: renderConnCategory,
    about: renderAboutCategory,
  };

  const settingsContent = (
    <div className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/"
            aria-label={t("back")}
            className={`inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground ${
              useDesktopSidebarShell ? "lg:hidden" : ""
            }`}
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-[-0.01em] text-foreground">
              Einstellungen
            </h1>
            <p className="mt-1 truncate text-[12px] text-muted-foreground">
              {desktopRuntime ? t("desktopApp") : t("webApp")}
              {appVersion ? t("about.versionSuffix", { version: appVersion }) : ""}
              {serverUrl ? t("about.serverSuffix", { server: serverUrl }) : ""}
            </p>
          </div>
        </div>
        {/* Wraps rather than overflowing: at 380px the pill plus both buttons
            ran off the right edge and cut "Verwerfen" in half. */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          <StatusPill tone={dirty ? "warn" : "success"} size="default" dot>
            {dirty ? t("unsavedChanges") : t("allSaved")}
          </StatusPill>
          <button
            type="button"
            onClick={() => void handleSaveAll()}
            disabled={!dirty || savingAny}
            className="h-9 whitespace-nowrap rounded-[10px] bg-primary px-4 text-[13px] font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {savingAny ? t("saving") : t("saveChanges")}
          </button>
          <button
            type="button"
            onClick={handleDiscardAll}
            disabled={!dirty || savingAny}
            className="h-9 whitespace-nowrap rounded-[10px] border border-border-strong px-3.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-40"
          >
            {t("discard")}
          </button>
          <div className={`ml-1 items-center gap-2 ${useDesktopSidebarShell ? "hidden" : "flex"}`}>
            <UserMenu />
          </div>
        </div>
      </div>

      <div className="mt-[18px] grid items-start gap-[18px] lg:grid-cols-[268px_minmax(0,1fr)]">
        <aside
          className={`flex-col gap-3 lg:sticky lg:top-[18px] lg:flex ${
            mobileDetailOpen ? "hidden" : "flex"
          }`}
        >
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={categorySearchTerm}
              onChange={(event) => setCategorySearchTerm(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-[38px] w-full rounded-[10px] border border-border bg-card pl-[34px] pr-3 text-[13px] outline-none transition-colors focus:border-border-strong"
            />
          </label>

          <div className="flex flex-col gap-0.5 rounded-[16px] border border-border bg-card p-1.5">
            {visibleCategories.map((category) => {
              const active = category.id === activeCategory;
              const badge = category.id === "conn" ? connectionAttentionCount : 0;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => selectCategory(category.id)}
                  className={`flex w-full items-center justify-between gap-2.5 rounded-[12px] border border-transparent px-3 py-2.5 text-left transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-surface-2"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold">{t(category.labelKey)}</span>
                    <span className="mt-0.5 block text-[11px] font-medium opacity-70">
                      {t(category.hintKey)}
                    </span>
                  </span>
                  {badge > 0 ? (
                    <span
                      className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[10px] font-extrabold ${
                        active ? "bg-primary-foreground/15" : "bg-warn/15 text-warn"
                      }`}
                    >
                      {badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {visibleCategories.length === 0 ? (
              <p className="px-3 py-2.5 text-[12px] text-muted-foreground">
                Keine Kategorie passt zu „{categorySearchTerm}“.
              </p>
            ) : null}
          </div>

          {desktopRuntime ? (
            <p className="px-1 text-[11px] leading-[1.5] text-muted-foreground">
              API-, Server- und Vault-Einstellungen liegen gebündelt unter Verbindungen.
            </p>
          ) : null}
        </aside>

        <div
          className={`min-w-0 flex-col gap-3.5 lg:flex ${mobileDetailOpen ? "flex" : "hidden"}`}
        >
          <button
            type="button"
            onClick={closeMobileDetail}
            className="inline-flex items-center gap-1.5 self-start text-[13px] font-semibold text-muted-foreground lg:hidden"
          >
            <ArrowLeft className="size-4" />
            Alle Einstellungen
          </button>
          {(categoryPanels[activeCategory] || renderLookCategory)()}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={`${desktopRuntime ? "min-h-full" : "min-h-screen"} ${
        renderLocalDesktopSidebar ? "lg:h-full lg:min-h-0 lg:overflow-hidden" : ""
      } bg-background px-3.5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[max(0.35rem,env(safe-area-inset-top))] font-sans text-foreground sm:p-8 md:pb-0 lg:p-0`}
    >
      {renderLocalDesktopSidebar ? (
        <div className="w-full lg:grid lg:min-h-0 lg:h-full lg:grid-cols-[92px_minmax(0,1fr)]">
          <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-[calc(100dvh-2.5rem)] lg:justify-center lg:pt-2">
            <div className="tr-desktop-rail h-full w-[92px] overflow-hidden rounded-2xl">
              <div className="flex h-full flex-col items-center py-4">
                <nav className="flex w-full flex-col items-center gap-2 px-2">
                  {DESKTOP_SIDEBAR_ITEMS
                    .filter((item) => !item.desktopOnly || desktopRuntime)
                    .map((item) => {
                      const Icon = item.icon;
                      const isActive = isSidebarItemActive(item);
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => navigate(item.to, { replace: true })}
                          className={`group flex h-12 w-12 items-center justify-center rounded-xl border transition-colors ${
                            isActive
                              ? "border-primary/35 bg-primary text-primary-foreground shadow-none dark:shadow-[0_10px_24px_rgba(255,255,255,0.14)]"
                              : "border-transparent bg-transparent text-muted-foreground hover:border-border/80 hover:bg-accent/70 hover:text-foreground"
                          }`}
                          title={t(item.labelKey, { ns: "common" })}
                          aria-label={t(item.labelKey, { ns: "common" })}
                        >
                          <Icon className="h-5 w-5" />
                        </button>
                      );
                    })}
                </nav>
                <div className="mt-auto flex w-full flex-col items-center gap-2 px-2 pb-2">
                  <ThemeToggle />
                  <UserMenu menuSide="right" menuAlign="end" menuSideOffset={8} />
                </div>
              </div>
            </div>
          </aside>

          <div className="w-full min-w-0 lg:min-h-0 lg:overflow-y-auto lg:px-6 xl:px-8">
            <div className="p-0 sm:p-0 md:p-0 lg:py-6">{settingsContent}</div>
          </div>
        </div>
      ) : (
        settingsContent
      )}
    </div>
  );
}
