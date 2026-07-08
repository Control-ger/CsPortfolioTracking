import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Eye, LayoutGrid, Package, FolderCog, Cog } from "lucide-react";
import { useCurrency } from "@shared/contexts/CurrencyContext";
import { useTheme } from "@shared/contexts";

import { ThemeToggle } from "@shared/components/ThemeToggle";
import { UserMenu } from "@shared/components/UserMenu";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@shared/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/components";
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
import { PriceSourceSettingsSection } from "@shared/components/PriceSourceSettingsSection";
import { WebPushSettingsSection } from "@shared/components/WebPushSettingsSection";
import { CsFloatApiKeySection } from "@shared/components/CsFloatApiKeySection";
import { SkinBaronApiKeySection } from "@shared/components/SkinBaronApiKeySection";
import { ServerConfigSection } from "@shared/components/ServerConfigSection";

const DESKTOP_SIDEBAR_ITEMS = [
  { key: "overview", label: "Uebersicht", icon: LayoutGrid, to: "/?tab=overview" },
  { key: "inventory", label: "Inventar", icon: Package, to: "/?tab=inventory" },
  { key: "watchlist", label: "Watchlist", icon: Eye, to: "/?tab=watchlist" },
  { key: "management", label: "Verwaltung", icon: FolderCog, to: "/?tab=management", desktopOnly: true },
  { key: "settings", label: "Einstellungen", icon: Cog, to: "/settings" },
];

export function SettingsPage({ useExternalDesktopSidebarShell = false }) {
  const [form, setForm] = useState(DEFAULT_FORM);
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
  const activeSettingsTab = requestedSettingsTab === "api-remote" ? "api-remote" : "general";
  const requestedSettingsSection = String(searchParams.get("section") || "").trim().toLowerCase();

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
        setForm({
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
        });
        setSource(feeData.source === "db" ? "db" : "defaults");

        const keyStatus = keyStatusResponse?.data || { configured: false, lastFour: null };
        setApiKeyStatus(keyStatus);
        const skinBaronStatus = skinBaronStatusResponse?.data || {};
        setSkinBaronApiKeyStatus(normalizeSkinBaronStatusPayload(skinBaronStatus));
        const priceSourceData = priceSourceResponse?.data || {};
        setPriceSourceMode(normalizePriceSourceMode(priceSourceData.mode));

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
        setError(loadError.message || "Settings konnten nicht geladen werden.");
      } finally {
        setLoading(false);
        setApiKeyLoading(false);
        setSkinBaronStatusLoading(false);
      }
    };

    void loadSettings();
  }, [desktopRuntime]);

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
        setServerConfigError(error?.message || "Server-Konfiguration konnte nicht geladen werden.");
      } finally {
        setServerConfigLoading(false);
      }
    };

    void loadServerConfig();
  }, []);

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
    const unsubscribe = window.electronAPI.updater.onStatus((payload) => {
      setUpdateStatus(payload || null);
      const state = payload?.state;
      if (state === "downloading") {
        setUpdateDownloading(true);
      } else if (state === "downloaded" || state === "error" || state === "not-available") {
        setUpdateDownloading(false);
      }
    });
    return () => {
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
            : { state: "error", message: result?.error || "Update-Suche fehlgeschlagen." },
        );
      }
      // On success the main process emits app-updater-status (available / not-available),
      // which the subscription above turns into the displayed state.
    } catch (checkError) {
      setUpdateStatus({ state: "error", message: checkError?.message || "Update-Suche fehlgeschlagen." });
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
    await window.electronAPI.updater.install();
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

      // Web-push notification prefs are server-owned on the web/PWA (see
      // portfolioPreferences.js); load them separately so they persist.
      try {
        const webPushPrefs = await getWebPushNotificationPreferences();
        setNotifyCsUpdatesWebPush(Boolean(webPushPrefs?.notifyCsUpdatesWebPush));
        setNotifyCsUpdatesWebPushMinLevel(webPushPrefs?.notifyCsUpdatesWebPushMinLevel ?? "high");
      } catch {
        setNotifyCsUpdatesWebPush(false);
      }
    };

    void loadCsfloatWatchlistPref();
  }, [desktopRuntime]);

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
      setCsfloatWatchlistError(error?.message || "Einstellung konnte nicht gespeichert werden.");
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
      setNotifyError(error?.message || "Einstellung konnte nicht gespeichert werden.");
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
          setCsfloatWatchlistError("Bitte zuerst bei CSFloat/Steam anmelden.");
        } else if (result.reason === "upstream-error") {
          const code = String(result?.error?.code || "CSFLOAT_ERROR");
          const status = Number(result?.error?.statusCode || 0);
          setCsfloatWatchlistError(
            `CSFloat-Watchlist konnte nicht geladen werden (${code}${status ? ` ${status}` : ""}).`,
          );
        } else {
          setCsfloatWatchlistError("Import wurde übersprungen.");
        }
      } else {
        const added = Number(result?.added || 0);
        const fetched = Number(result?.fetched || 0);
        const notInCatalog = Number(result?.notInCatalog || 0);
        const skippedSuffix = notInCatalog > 0
          ? ` ${notInCatalog} nicht im Katalog – übersprungen.`
          : "";
        setCsfloatWatchlistMessage(
          (added > 0
            ? `${added} neue${added === 1 ? "s Item" : " Items"} aus der CSFloat-Watchlist hinzugefügt (${fetched} geprüft).`
            : `Keine neuen Items – Watchlist ist bereits aktuell (${fetched} geprüft).`) + skippedSuffix,
        );
      }
    } catch (error) {
      setCsfloatWatchlistError(error?.message || "CSFloat-Watchlist-Import fehlgeschlagen.");
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
      setCsfloatBuyOrderError(error?.message || "Einstellung konnte nicht gespeichert werden.");
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
          setCsfloatBuyOrderError("Bitte zuerst bei CSFloat/Steam anmelden.");
        } else if (result.reason === "upstream-error") {
          const code = String(result?.error?.code || "CSFLOAT_ERROR");
          const status = Number(result?.error?.statusCode || 0);
          setCsfloatBuyOrderError(
            `CSFloat Buy Orders konnten nicht geladen werden (${code}${status ? ` ${status}` : ""}).`,
          );
        } else {
          setCsfloatBuyOrderError("Import wurde übersprungen.");
        }
      } else {
        const added = Number(result?.added || 0);
        const fetched = Number(result?.fetched || 0);
        const notInCatalog = Number(result?.notInCatalog || 0);
        const skippedSuffix = notInCatalog > 0
          ? ` ${notInCatalog} nicht im Katalog – übersprungen.`
          : "";
        setCsfloatBuyOrderMessage(
          (added > 0
            ? `${added} neue${added === 1 ? "s Item" : " Items"} aus den CSFloat Buy Orders hinzugefügt (${fetched} geprüft).`
            : `Keine neuen Items – alle Buy Orders bereits in der Watchlist (${fetched} geprüft).`) + skippedSuffix,
        );
      }
    } catch (error) {
      setCsfloatBuyOrderError(error?.message || "CSFloat Buy Order-Import fehlgeschlagen.");
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
        setWebPushError(error?.message || "Push-Status konnte nicht geladen werden.");
      } finally {
        setWebPushLoading(false);
      }
    };

    void loadWebPushState();
  }, [webPushSupported]);

  useEffect(() => {
    if (!requestedSettingsSection) {
      return;
    }
    const anchorMap = {
      "push-notifications": "settings-section-push-notifications",
      push: "settings-section-push-notifications",
      "browser-push": "settings-section-push-notifications",
    };
    const anchorId = anchorMap[requestedSettingsSection];
    if (!anchorId) {
      return;
    }

    const timerId = window.setTimeout(() => {
      const anchor = document.getElementById(anchorId);
      if (anchor) {
        anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 120);
    return () => window.clearTimeout(timerId);
  }, [requestedSettingsSection, activeSettingsTab]);

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
        setApiKeyError("CSFloat API Key kann nur in der Desktop-App gesetzt werden.");
        return;
      }

      const trimmedApiKey = apiKey.trim();
      await updateCsFloatApiKey(trimmedApiKey);

      setApiKeySuccess("API Key wurde erfolgreich aktualisiert.");
      setApiKey("");

      const statusResponse = await fetchCsFloatApiKeyStatus();
      setApiKeyStatus(statusResponse?.data || statusResponse);
    } catch (err) {
      setApiKeyError(err.message || "Fehler beim Aktualisieren des API Keys.");
    } finally {
      setApiKeySaving(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");

      const payload = {
        fxFeePercent: Number(form.fxFeePercent),
        sellerFeePercent: Number(form.sellerFeePercent),
        withdrawalFeePercent: Number(form.withdrawalFeePercent),
        depositFeePercent: Number(form.depositFeePercent),
        depositFeeFixedEur: Number(form.depositFeeFixedEur),
      };

      const response = await updateFeeSettings(payload);
      const saved = response?.data || payload;

      setForm({
        fxFeePercent: toInputValue(saved.fxFeePercent, DEFAULT_FORM.fxFeePercent),
        sellerFeePercent: toInputValue(saved.sellerFeePercent, DEFAULT_FORM.sellerFeePercent),
        withdrawalFeePercent: toInputValue(
          saved.withdrawalFeePercent,
          DEFAULT_FORM.withdrawalFeePercent,
        ),
        depositFeePercent: toInputValue(saved.depositFeePercent, DEFAULT_FORM.depositFeePercent),
        depositFeeFixedEur: toInputValue(saved.depositFeeFixedEur, DEFAULT_FORM.depositFeeFixedEur),
      });
      setSource("db");
      setSuccess("Fee-Settings gespeichert.");
    } catch (saveError) {
      setError(saveError.message || "Fee-Settings konnten nicht gespeichert werden.");
      setSuccess("");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateSkinBaronSessionCookie = async () => {
    try {
      setSkinBaronSessionSaving(true);
      setSkinBaronApiKeyError("");
      setSkinBaronApiKeySuccess("");

      if (!desktopRuntime) {
        setSkinBaronApiKeyError("SkinBaron Session-Cookie kann nur in der Desktop-App gesetzt werden.");
        return;
      }

      const trimmedCookie = skinBaronSessionCookie.trim();
      await updateSkinBaronSessionCookie(trimmedCookie);

      setSkinBaronApiKeySuccess("Session-Cookie wurde gespeichert und der Purchases-Zugriff wurde erfolgreich geprueft.");
      setSkinBaronSessionCookie("");

      const statusResponse = await fetchSkinBaronApiKeyStatus();
      const nextStatus = statusResponse?.data || statusResponse || {};
      setSkinBaronApiKeyStatus(normalizeSkinBaronStatusPayload(nextStatus));
    } catch (err) {
      setSkinBaronApiKeyError(err.message || "Fehler beim Speichern des Session-Cookies.");
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
        setSkinBaronApiKeyError("SkinBaron Browser-Login ist nur in der Desktop-App verfuegbar.");
        return;
      }

      await connectSkinBaronSessionCookieViaBrowser();
      setSkinBaronApiKeySuccess("Session-Cookie wurde per Browser verbunden und verifiziert.");
      setSkinBaronSessionCookie("");

      const statusResponse = await fetchSkinBaronApiKeyStatus();
      const nextStatus = statusResponse?.data || statusResponse || {};
      setSkinBaronApiKeyStatus(normalizeSkinBaronStatusPayload(nextStatus));
    } catch (err) {
      setSkinBaronApiKeyError(err.message || "SkinBaron Browser-Login fehlgeschlagen.");
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
      setWebPushError("Browser Push wird in dieser Umgebung nicht unterstuetzt.");
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
        setWebPushError("Push ist serverseitig noch nicht konfiguriert (VAPID Keys fehlen).");
        return;
      }

      if (Notification.permission === "denied") {
        setWebPushPermission("denied");
        setWebPushError("Browser-Benachrichtigungen sind blockiert. Bitte im Browser erlauben.");
        return;
      }

      const permission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      setWebPushPermission(permission);
      if (permission !== "granted") {
        setWebPushError("Benachrichtigungsberechtigung wurde nicht erteilt.");
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
      setWebPushSuccess("Browser Push fuer CS-Updates ist aktiviert.");
    } catch (error) {
      setWebPushError(error?.message || "Browser Push konnte nicht aktiviert werden.");
    } finally {
      setWebPushSaving(false);
    }
  };

  const handleDisableWebPush = async () => {
    if (!webPushSupported) {
      setWebPushError("Browser Push wird in dieser Umgebung nicht unterstuetzt.");
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
      setWebPushSuccess("Browser Push wurde deaktiviert.");
    } catch (error) {
      setWebPushError(error?.message || "Browser Push konnte nicht deaktiviert werden.");
    } finally {
      setWebPushSaving(false);
    }
  };

  
  const handlePriceSourceChange = (value) => {
    setPriceSourceMode(value);
    setPriceSourceError("");
    setPriceSourceSuccess("");
  };

  const handlePriceSourceSave = async () => {
    try {
      setPriceSourceSaving(true);
      setPriceSourceError("");
      setPriceSourceSuccess("");
      const response = await updatePriceSourcePreference(priceSourceMode);
      const saved = normalizePriceSourceMode(response?.data?.mode || priceSourceMode);
      setPriceSourceMode(saved);
      setPriceSourceSuccess("Preisquellen-Praeferenz gespeichert.");
    } catch (saveError) {
      setPriceSourceError(saveError?.message || "Preisquellen-Praeferenz konnte nicht gespeichert werden.");
    } finally {
      setPriceSourceSaving(false);
    }
  };

  const themeModeLabel = themeMode === "system"
    ? `System (${isDark ? "dunkel" : "hell"})`
    : themeMode === "dark"
      ? "Dunkel"
      : "Hell";

  const renderGeneralTab = () => {
    return (
      <div className="space-y-4">
        <Card id="settings-section-push-notifications">
          <CardHeader>
            <CardTitle>Darstellung</CardTitle>
            <CardDescription>
              Waehle, ob die App hell, dunkel oder automatisch per Systempraeferenz laufen soll.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                {
                  value: "system",
                  label: "System",
                  hint: `Automatisch (${systemPrefersDark ? "dunkel" : "hell"})`,
                },
                { value: "light", label: "Hell", hint: "Immer helles Design" },
                { value: "dark", label: "Dunkel", hint: "Immer dunkles Design" },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => setThemeMode(option.value)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    themeMode === option.value
                      ? "border-primary/40 bg-primary/12 shadow-none dark:shadow-[0_10px_22px_rgba(255,255,255,0.12)]"
                      : "border-border bg-transparent hover:bg-accent/55 dark:border-border/75 dark:bg-card/65"
                  }`}
                >
                  <p className="text-sm font-semibold text-foreground">{option.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{option.hint}</p>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-transparent p-3 dark:border-border/70 dark:bg-card/65">
              <p className="text-xs text-muted-foreground">
                Aktiver Modus: <span className="font-semibold text-foreground">{themeModeLabel}</span>
              </p>
              <ThemeToggle />
            </div>
          </CardContent>
        </Card>

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

        <PriceSourceSettingsSection
          priceSourceMode={priceSourceMode}
          priceSourceSaving={priceSourceSaving}
          priceSourceError={priceSourceError}
          priceSourceSuccess={priceSourceSuccess}
          onPriceSourceChange={handlePriceSourceChange}
          onPriceSourceSave={handlePriceSourceSave}
        />

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

        <Card>
          <CardHeader>
            <CardTitle>Benachrichtigungen</CardTitle>
            <CardDescription>
              Steuere, wofür du System-Benachrichtigungen und Web-Push-Nachrichten erhältst.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {desktopRuntime ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">System-Benachrichtigungen</p>

                {/* VAC Ban-Welle — desktop */}
                <div className="space-y-2 rounded-xl border border-border/70 bg-card/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">VAC Ban-Welle erkannt</p>
                      <p className="text-xs text-muted-foreground">Systembenachrichtigung bei erhöhter Ban-Aktivität in CS2.</p>
                    </div>
                    <Button variant="outline" disabled={notifySaving} onClick={() => void handleToggleNotifyPref("notifyBanWaveDesktop", notifyBanWaveDesktop, setNotifyBanWaveDesktop)}>
                      {notifyBanWaveDesktop ? "Deaktivieren" : "Aktivieren"}
                    </Button>
                  </div>
                  {notifyBanWaveDesktop ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs text-muted-foreground">Mindest-Impact:</p>
                      {IMPACT_LEVELS.map((level) => {
                        const labels = { none: "Kein", low: "Niedrig", medium: "Mittel", high: "Hoch" };
                        const active = notifyBanWaveDesktopMinLevel === level;
                        return (
                          <button
                            key={level}
                            disabled={notifySaving}
                            onClick={() => void handleToggleNotifyPref("notifyBanWaveDesktopMinLevel", notifyBanWaveDesktopMinLevel, setNotifyBanWaveDesktopMinLevel, level)}
                            className={`rounded-md border px-2 py-0.5 text-xs transition-colors disabled:opacity-50 ${active ? "border-primary/40 bg-primary/12 text-foreground" : "border-border/60 bg-transparent text-muted-foreground hover:bg-accent/50"}`}
                          >
                            {labels[level]}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                {/* CS2 Updates — desktop */}
                <div className="space-y-2 rounded-xl border border-border/70 bg-card/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">CS2 Updates</p>
                      <p className="text-xs text-muted-foreground">Systembenachrichtigung bei neuen CS2 Game-Updates im Feed.</p>
                    </div>
                    <Button variant="outline" disabled={notifySaving} onClick={() => void handleToggleNotifyPref("notifyCsUpdatesDesktop", notifyCsUpdatesDesktop, setNotifyCsUpdatesDesktop)}>
                      {notifyCsUpdatesDesktop ? "Deaktivieren" : "Aktivieren"}
                    </Button>
                  </div>
                  {notifyCsUpdatesDesktop ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs text-muted-foreground">Mindest-Impact:</p>
                      {IMPACT_LEVELS.map((level) => {
                        const labels = { none: "Kein", low: "Niedrig", medium: "Mittel", high: "Hoch" };
                        const active = notifyCsUpdatesDesktopMinLevel === level;
                        return (
                          <button
                            key={level}
                            disabled={notifySaving}
                            onClick={() => void handleToggleNotifyPref("notifyCsUpdatesDesktopMinLevel", notifyCsUpdatesDesktopMinLevel, setNotifyCsUpdatesDesktopMinLevel, level)}
                            className={`rounded-md border px-2 py-0.5 text-xs transition-colors disabled:opacity-50 ${active ? "border-primary/40 bg-primary/12 text-foreground" : "border-border/60 bg-transparent text-muted-foreground hover:bg-accent/50"}`}
                          >
                            {labels[level]}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                {/* Steam Sync — no level selector */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/60 p-3">
                  <div>
                    <p className="text-sm font-medium">Steam Sync (neue Items)</p>
                    <p className="text-xs text-muted-foreground">Systembenachrichtigung wenn Steam Sync neue Items findet.</p>
                  </div>
                  <Button variant="outline" disabled={notifySaving} onClick={() => void handleToggleNotifyPref("notifySteamSyncDesktop", notifySteamSyncDesktop, setNotifySteamSyncDesktop)}>
                    {notifySteamSyncDesktop ? "Deaktivieren" : "Aktivieren"}
                  </Button>
                </div>
              </div>
            ) : null}

            {!isElectronRuntime ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Web Push</p>

                {/* CS2 Updates — web push */}
                <div className="space-y-2 rounded-xl border border-border/70 bg-card/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">CS2 Updates</p>
                      <p className="text-xs text-muted-foreground">Web-Push-Nachricht bei neuen CS2-Updates.</p>
                    </div>
                    <Button variant="outline" disabled={notifySaving} onClick={() => void handleToggleNotifyPref("notifyCsUpdatesWebPush", notifyCsUpdatesWebPush, setNotifyCsUpdatesWebPush)}>
                      {notifyCsUpdatesWebPush ? "Deaktivieren" : "Aktivieren"}
                    </Button>
                  </div>
                  {notifyCsUpdatesWebPush ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs text-muted-foreground">Mindest-Impact:</p>
                      {IMPACT_LEVELS.map((level) => {
                        const labels = { none: "Kein", low: "Niedrig", medium: "Mittel", high: "Hoch" };
                        const active = notifyCsUpdatesWebPushMinLevel === level;
                        return (
                          <button
                            key={level}
                            disabled={notifySaving}
                            onClick={() => void handleToggleNotifyPref("notifyCsUpdatesWebPushMinLevel", notifyCsUpdatesWebPushMinLevel, setNotifyCsUpdatesWebPushMinLevel, level)}
                            className={`rounded-md border px-2 py-0.5 text-xs transition-colors disabled:opacity-50 ${active ? "border-primary/40 bg-primary/12 text-foreground" : "border-border/60 bg-transparent text-muted-foreground hover:bg-accent/50"}`}
                          >
                            {labels[level]}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {notifyError ? (
              <p className="text-xs text-amber-400">{notifyError}</p>
            ) : null}
          </CardContent>
        </Card>

        {desktopRuntime ? (
          <Card>
            <CardHeader>
              <CardTitle>CSFloat Watchlist-Sync</CardTitle>
              <CardDescription>
                Übernimmt Items aus deiner CSFloat-Watchlist automatisch in die Electron-Watchlist.
                Bestehende Einträge bleiben erhalten; es wird nur hinzugefügt, nie entfernt.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/60 p-3">
                <div>
                  <p className="text-sm font-medium">Automatischer Import</p>
                  <p className="text-xs text-muted-foreground">
                    {csfloatWatchlistAutoImport
                      ? "Aktiv: bei jedem CSFloat-Sync werden neue Watchlist-Items übernommen."
                      : "Inaktiv: nur per manuellem Import unten."}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={csfloatWatchlistSaving}
                  onClick={handleToggleCsfloatWatchlistAutoImport}
                >
                  {csfloatWatchlistSaving
                    ? "Speichert..."
                    : csfloatWatchlistAutoImport
                      ? "Deaktivieren"
                      : "Aktivieren"}
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Einmaligen Import jetzt ausführen.
                </p>
                <Button
                  variant="outline"
                  disabled={csfloatWatchlistImporting}
                  onClick={handleImportCsfloatWatchlistNow}
                >
                  {csfloatWatchlistImporting ? "Importiert..." : "Jetzt importieren"}
                </Button>
              </div>
              {csfloatWatchlistMessage ? (
                <p className="text-xs text-emerald-400">{csfloatWatchlistMessage}</p>
              ) : null}
              {csfloatWatchlistError ? (
                <p className="text-xs text-amber-400">{csfloatWatchlistError}</p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {desktopRuntime ? (
          <Card>
            <CardHeader>
              <CardTitle>CSFloat Buy Order-Sync</CardTitle>
              <CardDescription>
                Übernimmt Items aus deinen CSFloat Buy Orders automatisch in die Watchlist.
                Bestehende Einträge bleiben erhalten; es wird nur hinzugefügt, nie entfernt.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/60 p-3">
                <div>
                  <p className="text-sm font-medium">Automatischer Import</p>
                  <p className="text-xs text-muted-foreground">
                    {csfloatBuyOrderAutoImport
                      ? "Aktiv: bei jedem Watchlist-Load werden neue Buy Order-Items übernommen."
                      : "Inaktiv: nur per manuellem Import unten."}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={csfloatBuyOrderSaving}
                  onClick={handleToggleCsfloatBuyOrderAutoImport}
                >
                  {csfloatBuyOrderSaving
                    ? "Speichert..."
                    : csfloatBuyOrderAutoImport
                      ? "Deaktivieren"
                      : "Aktivieren"}
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Einmaligen Import jetzt ausführen.
                </p>
                <Button
                  variant="outline"
                  disabled={csfloatBuyOrderImporting}
                  onClick={handleImportCsfloatBuyOrdersNow}
                >
                  {csfloatBuyOrderImporting ? "Importiert..." : "Jetzt importieren"}
                </Button>
              </div>
              {csfloatBuyOrderMessage ? (
                <p className="text-xs text-emerald-400">{csfloatBuyOrderMessage}</p>
              ) : null}
              {csfloatBuyOrderError ? (
                <p className="text-xs text-amber-400">{csfloatBuyOrderError}</p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {desktopRuntime ? (
          <Card>
            <CardHeader>
              <CardTitle>Über die App</CardTitle>
              <CardDescription>
                Installierte Version der Desktop-App.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-border bg-transparent p-3 dark:border-border/70 dark:bg-card/65">
                <p className="text-sm text-muted-foreground">Version</p>
                <Badge variant="outline" className="border-border/70 font-mono text-foreground">
                  {appVersion ? `v${appVersion}` : "unbekannt"}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleCheckForUpdates()}
                  disabled={updateChecking || updateStatus?.state === "checking"}
                >
                  {updateChecking || updateStatus?.state === "checking"
                    ? "Suche nach Updates..."
                    : "Nach Updates suchen"}
                </Button>

                {updateStatus?.state === "available" ? (
                  <Button
                    size="sm"
                    onClick={() => void handleDownloadUpdate()}
                    disabled={updateDownloading}
                  >
                    {updateDownloading ? "Wird heruntergeladen..." : "Jetzt herunterladen"}
                  </Button>
                ) : null}

                {updateStatus?.state === "downloaded" ? (
                  <Button size="sm" onClick={() => void handleInstallUpdate()}>
                    Neustarten &amp; installieren
                  </Button>
                ) : null}
              </div>

              {updateStatus ? (
                <p
                  className={`text-xs ${
                    updateStatus.state === "error"
                      ? "text-amber-400"
                      : updateStatus.state === "available" || updateStatus.state === "downloaded"
                        ? "text-emerald-400"
                        : "text-muted-foreground"
                  }`}
                >
                  {updateStatus.state === "available"
                    ? `Update verfügbar${updateStatus.version ? ` (v${updateStatus.version})` : ""}.`
                    : updateStatus.state === "downloading"
                      ? `Wird heruntergeladen... ${Math.round(Number(updateStatus.percent || 0))}%`
                      : updateStatus.state === "downloaded"
                        ? `Update${updateStatus.version ? ` v${updateStatus.version}` : ""} bereit zur Installation.`
                        : updateStatus.state === "not-available"
                          ? "Du hast die neueste Version."
                          : updateStatus.state === "dev"
                            ? "Update-Suche ist nur in der installierten App verfügbar."
                            : updateStatus.state === "error"
                              ? updateStatus.message || "Update-Suche fehlgeschlagen."
                              : ""}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

      </div>
    );
  };

  const renderFeesTab = () => {
    return (
      <FeeSettingsSection
        form={form}
        source={source}
        loading={loading}
        saving={saving}
        error={error}
        success={success}
        handleChange={handleChange}
        handleSave={handleSave}
      />
    );
  };

  const renderApiKeyTab = () => {
    return (
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
    );
  };

  const renderSkinBaronApiKeyTab = () => {
    return (
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
    );
  };

  const renderSecretVaultCard = () => {
    if (!desktopRuntime || !window.electronAPI?.secrets?.getVaultStatus) {
      return null;
    }

    const isConfigured = vaultStatus?.configured === true;
    const isUnlocked = vaultStatus?.unlocked === true;
    const idleMinutes = Number(vaultStatus?.idleTimeoutMinutes || 15);
    const autoLockEnabled = vaultStatus?.policy?.autoLockOnIdle === true;

    return (
      <Card>
        <CardHeader>
          <CardTitle>Secret Vault</CardTitle>
          <CardDescription>
            Lokale API-Secrets bleiben verschluesselt. Unlock ist nach jedem App-Start erforderlich.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={isUnlocked ? "border-emerald-400/35 text-emerald-300" : "border-amber-400/35 text-amber-300"}
            >
              {isUnlocked ? "Entsperrt" : "Gesperrt"}
            </Badge>
            <Badge variant="outline" className="border-border/70 text-muted-foreground">
              {isConfigured ? "App-Passwort gesetzt" : "App-Passwort fehlt"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Optional: Auto-Sperre nach {idleMinutes} Minuten Inaktivitaet.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/60 p-3">
            <div>
              <p className="text-sm font-medium">Auto-Sperre</p>
              <p className="text-xs text-muted-foreground">
                {autoLockEnabled
                  ? `Aktiv: sperrt nach ${idleMinutes} Minuten Inaktivitaet`
                  : "Inaktiv: nur bei Neustart oder explizitem Sperren"}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={vaultActionSaving || !window.electronAPI?.secrets?.setVaultPreferences}
              onClick={async () => {
                try {
                  setVaultActionSaving(true);
                  const result = await window.electronAPI.secrets.setVaultPreferences({
                    autoLockEnabled: !autoLockEnabled,
                  });
                  setVaultStatus(result?.status || vaultStatus);
                } catch (error) {
                  setError(error?.message || "Secret-Vault Einstellungen konnten nicht gespeichert werden.");
                } finally {
                  setVaultActionSaving(false);
                }
              }}
            >
              {vaultActionSaving ? "Speichert..." : autoLockEnabled ? "Auto-Sperre deaktivieren" : "Auto-Sperre aktivieren"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderRemoteConnectionsTab = () => {
    if (!desktopRuntime) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>API & Verbindungen</CardTitle>
            <CardDescription>
              Diese Einstellungen sind nur in der Desktop-App verfuegbar.
            </CardDescription>
          </CardHeader>
        </Card>
      );
    }

    return (
      <div className="space-y-4">
        {renderSecretVaultCard()}
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
                  setServerConfigError("Bitte gueltigen Hostnamen eingeben (z.B. cs2.clustercontrol.cc).");
                  return;
                }
                setServerConfigTesting(true);
                setServerConfigError("");
                setServerConfigMessage("");
                const result = await window.electronAPI.serverConfig.test(normalizedHost);
                if (result?.ok) {
                  setServerConfigMessage(result?.message || "Verbindung erfolgreich.");
                  setServerUrl(normalizedHost);
                } else {
                  setServerConfigError(result?.message || "Verbindung fehlgeschlagen.");
                }
              } catch (error) {
                setServerConfigError(error?.message || "Verbindungstest fehlgeschlagen.");
              } finally {
                setServerConfigTesting(false);
              }
            }}
            onSave={async () => {
              try {
                const normalizedHost = normalizeServerHostInput(serverUrl);
                if (!normalizedHost) {
                  setServerConfigError("Bitte gueltigen Hostnamen eingeben (z.B. cs2.clustercontrol.cc).");
                  return;
                }
                setServerConfigSaving(true);
                setServerConfigError("");
                setServerConfigMessage("");
                await window.electronAPI.serverConfig.set({ serverUrl: normalizedHost });
                setServerUrl(normalizedHost);
                setServerConfigMessage("Server-URL gespeichert.");
              } catch (error) {
                setServerConfigError(error?.message || "Server-URL konnte nicht gespeichert werden.");
              } finally {
                setServerConfigSaving(false);
              }
            }}
          />
        ) : null}
        {renderSkinBaronApiKeyTab()}
        {renderApiKeyTab()}
      </div>
    );
  };

  const settingsContent = (
    <div className="w-full space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className={`shrink-0 ${useDesktopSidebarShell ? "lg:hidden" : ""}`}
          >
            <Link to="/">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Einstellungen</h1>
            <p className="text-sm text-muted-foreground">
              Allgemeine Einstellungen und API/Remote-Konfiguration
            </p>
          </div>
        </div>
        <div className={`flex items-center gap-2 ${useDesktopSidebarShell ? "lg:hidden" : ""}`}>
          <ThemeToggle />
          <div className="hidden sm:block">
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="space-y-4">
        <Tabs
          value={activeSettingsTab}
          onValueChange={(nextValue) => {
            const normalizedTab = nextValue === "api-remote" ? "api-remote" : "general";
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set("settingsTab", normalizedTab);
            setSearchParams(nextParams, { replace: true });
          }}
          className="w-full"
        >
          <TabsList className="grid h-auto w-full grid-cols-2 gap-0 border-b border-border/70 bg-transparent p-0">
            <TabsTrigger
              value="general"
              className="h-11 rounded-none border-b-2 border-b-transparent px-3 text-xs sm:text-sm data-[state=active]:border-b-foreground data-[state=active]:text-foreground"
            >
              Allgemein
            </TabsTrigger>
            <TabsTrigger
              value="api-remote"
              className="h-11 rounded-none border-b-2 border-b-transparent px-3 text-xs sm:text-sm data-[state=active]:border-b-foreground data-[state=active]:text-foreground"
            >
              API & Remote
            </TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="space-y-4 pt-1">
            {renderGeneralTab()}
            {renderFeesTab()}
          </TabsContent>
          <TabsContent value="api-remote" className="space-y-4 pt-1">
            {renderRemoteConnectionsTab()}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );

  return (
    <div
      className={`${desktopRuntime ? "min-h-full" : "min-h-screen"} ${
        renderLocalDesktopSidebar ? "lg:h-full lg:min-h-0 lg:overflow-hidden" : ""
      } bg-background px-3.5 pb-[calc(8.5rem+env(safe-area-inset-bottom))] pt-[max(0.35rem,env(safe-area-inset-top))] font-sans text-foreground sm:p-8 md:pb-0 lg:p-0`}
    >
      {renderLocalDesktopSidebar ? (
        <div className="w-full lg:grid lg:min-h-0 lg:h-full lg:grid-cols-[92px_minmax(0,1fr)]">
          <aside className="hidden lg:flex lg:justify-center lg:pt-2">
            <div className="tr-desktop-rail h-[98vh] w-[92px] overflow-hidden rounded-2xl">
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
                          title={item.label}
                          aria-label={item.label}
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
