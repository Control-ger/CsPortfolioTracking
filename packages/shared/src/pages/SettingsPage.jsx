import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Key, Eye, EyeOff, Lock, AlertCircle, Percent, ArrowLeft, DollarSign, LineChart, LayoutGrid, Package, FolderCog, Cog, Bell } from "lucide-react";
import { useCurrency } from "@shared/contexts/CurrencyContext";
import { useTheme } from "@shared/contexts";

import { ThemeToggle } from "@shared/components/ThemeToggle";
import { UserMenu } from "@shared/components/UserMenu";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@shared/components/ui/card";
import { Input } from "@shared/components/ui/input";
import { Skeleton } from "@shared/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/components";
import {
  fetchFeeSettings,
  updateFeeSettings,
  fetchCsFloatApiKeyStatus,
  updateCsFloatApiKey,
  fetchSkinBaronApiKeyStatus,
  updateSkinBaronApiKey,
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
import { normalizeServerHostInput } from "@shared/lib/serverConfig";

const DEFAULT_FORM = {
  fxFeePercent: "0",
  sellerFeePercent: "2",
  withdrawalFeePercent: "2.5",
  depositFeePercent: "2.8",
  depositFeeFixedEur: "0.26",
};

function toInputValue(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return String(value);
}

function formatExchangeRate(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue.toFixed(4) : "-";
}

function isDesktopRuntime() {
  return typeof window !== "undefined" && Boolean(window.electronAPI?.secrets);
}

function normalizePriceSourceMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "csfloat") {
    return "csfloat";
  }
  if (normalized === "steam") {
    return "steam";
  }
  return "auto";
}

function normalizeSkinBaronStatusPayload(statusPayload) {
  const nextStatus = statusPayload && typeof statusPayload === "object" ? statusPayload : {};
  return {
    configured: Boolean(nextStatus?.configured || nextStatus?.hasKey),
    lastFour: nextStatus?.lastFour || null,
    capabilities:
      nextStatus?.capabilities && typeof nextStatus.capabilities === "object"
        ? nextStatus.capabilities
        : {},
    checkedAt: nextStatus?.checkedAt || null,
    sessionCookieConfigured: Boolean(nextStatus?.sessionCookieConfigured),
    sessionCookieHasAuthId: Boolean(nextStatus?.sessionCookieHasAuthId),
    sessionCookieLastFour: nextStatus?.sessionCookieLastFour || null,
    sessionCookieCheckedAt: nextStatus?.sessionCookieCheckedAt || null,
    sessionCookieAccess:
      nextStatus?.sessionCookieAccess && typeof nextStatus.sessionCookieAccess === "object"
        ? nextStatus.sessionCookieAccess
        : { allowed: false, statusCode: null, message: null },
    importReady: Boolean(nextStatus?.importReady),
  };
}

function base64UrlToUint8Array(base64Url) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = `${base64Url}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

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

  // SkinBaron API Key State
  const [skinBaronApiKey, setSkinBaronApiKey] = useState("");
  const [skinBaronApiKeyLoading, setSkinBaronApiKeyLoading] = useState(true);
  const [skinBaronApiKeySaving, setSkinBaronApiKeySaving] = useState(false);
  const [skinBaronApiKeyStatus, setSkinBaronApiKeyStatus] = useState(() => normalizeSkinBaronStatusPayload());
  const [showSkinBaronApiKey, setShowSkinBaronApiKey] = useState(false);
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
        setSkinBaronApiKeyLoading(true);

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
        setSkinBaronApiKeyLoading(false);
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

  const handleSkinBaronApiKeyChange = (event) => {
    setSkinBaronApiKey(event.target.value);
    setSkinBaronApiKeyError("");
    setSkinBaronApiKeySuccess("");
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

  const handleUpdateSkinBaronApiKey = async () => {
    try {
      setSkinBaronApiKeySaving(true);
      setSkinBaronApiKeyError("");
      setSkinBaronApiKeySuccess("");

      if (!desktopRuntime) {
        setSkinBaronApiKeyError("SkinBaron API Key kann nur in der Desktop-App gesetzt werden.");
        return;
      }

      const trimmedApiKey = skinBaronApiKey.trim();
      await updateSkinBaronApiKey(trimmedApiKey);

      setSkinBaronApiKeySuccess("API Key wurde erfolgreich aktualisiert und Rechte wurden geprueft.");
      setSkinBaronApiKey("");

      const statusResponse = await fetchSkinBaronApiKeyStatus();
      const nextStatus = statusResponse?.data || statusResponse || {};
      setSkinBaronApiKeyStatus(normalizeSkinBaronStatusPayload(nextStatus));
    } catch (err) {
      setSkinBaronApiKeyError(err.message || "Fehler beim Aktualisieren des API Keys.");
    } finally {
      setSkinBaronApiKeySaving(false);
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

  
  const renderGeneralTab = () => {
    const {
      currency,
      currencies,
      setCurrency,
      exchangeRates,
      ratesLoading,
      popularCurrencyCodes = [],
    } = currencyContext;
    const themeModeLabel = themeMode === "system"
      ? `System (${isDark ? "dunkel" : "hell"})`
      : themeMode === "dark"
        ? "Dunkel"
        : "Hell";
    const priceSourceLabel = priceSourceMode === "csfloat"
      ? "Nur CSFloat"
      : priceSourceMode === "steam"
        ? "Nur Steam"
        : "Auto (CSFloat bevorzugt)";
    const currencyEntries = Object.entries(currencies);
    const popularRankByCode = new Map(
      popularCurrencyCodes.map((code, index) => [String(code || "").toUpperCase(), index]),
    );
    const sortedCurrencyEntries = [...currencyEntries].sort(([leftCode], [rightCode]) => {
      const leftRank = popularRankByCode.has(leftCode) ? Number(popularRankByCode.get(leftCode)) : Number.POSITIVE_INFINITY;
      const rightRank = popularRankByCode.has(rightCode) ? Number(popularRankByCode.get(rightCode)) : Number.POSITIVE_INFINITY;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      if (leftCode === currency) {
        return -1;
      }
      if (rightCode === currency) {
        return 1;
      }
      return leftCode.localeCompare(rightCode);
    });
    const normalizedCurrencySearchTerm = String(currencySearchTerm || "").trim().toLowerCase();
    const filteredCurrencyEntries = (() => {
      if (!normalizedCurrencySearchTerm) {
        return sortedCurrencyEntries;
      }

      return sortedCurrencyEntries.filter(([code, info]) => {
        const haystack = [
          code,
          info?.name,
          info?.regionName,
          info?.symbol,
        ]
          .map((entry) => String(entry || "").toLowerCase())
          .join(" ");
        return haystack.includes(normalizedCurrencySearchTerm);
      });
    })();
    const popularCurrencyEntries = popularCurrencyCodes
      .map((code) => {
        const normalizedCode = String(code || "").toUpperCase();
        return [normalizedCode, currencies[normalizedCode]];
      })
      .filter((entry) => Boolean(entry[1]))
      .slice(0, 8);
    const currentCurrencyInfo = currencies[currency] || null;
    const currentCurrencyRate = Number(exchangeRates[currency]);
    const hasCurrentCurrencyRate = Number.isFinite(currentCurrencyRate) && currentCurrencyRate > 0;

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

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              <CardTitle>Waehrung</CardTitle>
            </div>
            <CardDescription>
              Waehle deine bevorzugte Waehrung fuer Preisanzeigen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground">
                Anzeige-Waehrung
              </label>
              {popularCurrencyEntries.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Beliebt bei Nutzern (anonym)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {popularCurrencyEntries.map(([code, info]) => (
                      <button
                        key={`popular-${code}`}
                        type="button"
                        onClick={() => setCurrency(code)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                          currency === code
                            ? "border-primary/40 bg-primary/12 text-foreground"
                            : "border-border/70 text-muted-foreground hover:bg-accent/55 hover:text-foreground"
                        }`}
                      >
                        <span>{info.flag}</span>
                        <span>{code}</span>
                        {info.hasDistinctSymbol ? <span className="text-muted-foreground">({info.symbol})</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="space-y-2">
                <Input
                  value={currencySearchTerm}
                  onChange={(event) => setCurrencySearchTerm(event.target.value)}
                  placeholder="Waehrung suchen (Code, Name oder Land)"
                  className="h-10"
                />
                <p className="text-[11px] text-muted-foreground">
                  {filteredCurrencyEntries.length} von {currencyEntries.length} Waehrungen sichtbar
                </p>
              </div>
              <div className="max-h-80 overflow-y-auto rounded-lg border border-border/70 p-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {filteredCurrencyEntries.map(([code, info]) => (
                    <button
                      key={code}
                      onClick={() => setCurrency(code)}
                      className={`flex min-h-[108px] flex-col items-center justify-center gap-1 rounded-xl border p-3 transition-colors ${
                        currency === code
                          ? "border-primary/40 bg-primary/12 shadow-none dark:shadow-[0_10px_22px_rgba(255,255,255,0.12)]"
                          : "border-border bg-transparent hover:bg-accent/55 dark:border-border/75 dark:bg-card/65"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-base leading-none">{info.flag}</span>
                        {info.hasDistinctSymbol ? (
                          <span className="text-lg font-bold leading-none">{info.symbol}</span>
                        ) : null}
                      </div>
                      <span className="text-xs font-semibold">{info.code}</span>
                      <span className="line-clamp-2 text-center text-[10px] text-muted-foreground">{info.name}</span>
                      <span className="line-clamp-1 text-center text-[10px] text-muted-foreground/80">
                        {info.regionName || info.regionCode || "Global"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {ratesLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-transparent p-3 text-sm dark:border-border/70 dark:bg-card/65">
                <p className="font-medium text-foreground">Aktueller Wechselkurs</p>
                <div className="mt-2 rounded-md border border-border/70 bg-background/35 p-2 text-xs text-muted-foreground">
                  <div className="font-semibold text-foreground">
                    {currentCurrencyInfo?.flag || "🌍"} {currency}
                    {currentCurrencyInfo?.hasDistinctSymbol ? ` (${currentCurrencyInfo.symbol})` : ""}
                  </div>
                  <div className="mt-1">
                    {hasCurrentCurrencyRate ? `1 EUR = ${formatExchangeRate(currentCurrencyRate)} ${currency}` : "Kein Wechselkurs verfuegbar"}
                  </div>
                  {hasCurrentCurrencyRate ? (
                    <div className="mt-1">1 {currency} = {formatExchangeRate(1 / currentCurrencyRate)} EUR</div>
                  ) : null}
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Kurse werden taeglich aktualisiert.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <LineChart className="h-5 w-5" />
              <CardTitle>Live-Preisquelle</CardTitle>
              <Badge variant="outline" className="ml-auto">
                {priceSourceLabel}
              </Badge>
            </div>
            <CardDescription>
              Lege fest, welche Quelle fuer Live-Preise bevorzugt wird.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {priceSourceError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {priceSourceError}
              </div>
            ) : null}
            {priceSourceSuccess ? (
              <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/12 p-3 text-sm text-emerald-300">
                {priceSourceSuccess}
              </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { value: "auto", label: "Auto", hint: "CSFloat zuerst, Steam als Fallback" },
                { value: "csfloat", label: "CSFloat", hint: "Nur CSFloat bevorzugen" },
                { value: "steam", label: "Steam", hint: "Nur Steam bevorzugen" },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setPriceSourceMode(option.value);
                    setPriceSourceError("");
                    setPriceSourceSuccess("");
                  }}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    priceSourceMode === option.value
                      ? "border-primary/40 bg-primary/12 shadow-none dark:shadow-[0_10px_22px_rgba(255,255,255,0.12)]"
                      : "border-border bg-transparent hover:bg-accent/55 dark:border-border/75 dark:bg-card/65"
                  }`}
                >
                  <p className="text-sm font-semibold text-foreground">{option.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{option.hint}</p>
                </button>
              ))}
            </div>

            <div className="flex justify-end">
              <Button
                disabled={priceSourceSaving}
                onClick={async () => {
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
                }}
              >
                {priceSourceSaving ? "Speichert..." : "Praeferenz speichern"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              <CardTitle>Browser Push (CS Updates)</CardTitle>
              <Badge variant="outline" className="ml-auto">
                {webPushSubscribed ? "Aktiv" : "Inaktiv"}
              </Badge>
            </div>
            <CardDescription>
              Erhalte Benachrichtigungen bei neuen CS-Updates auf Mobile und Desktop (PWA/Web).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!webPushSupported ? (
              <div className="rounded-lg border border-border bg-transparent p-3 text-sm text-muted-foreground dark:border-border/70 dark:bg-card/65">
                Browser Push ist hier nicht verfuegbar (z.B. Electron Runtime oder fehlende Push-Unterstuetzung).
              </div>
            ) : null}

            {webPushLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-4 w-44" />
              </div>
            ) : null}

            {webPushError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {webPushError}
              </div>
            ) : null}

            {webPushSuccess ? (
              <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/12 p-3 text-sm text-emerald-300">
                {webPushSuccess}
              </div>
            ) : null}

            <div className="rounded-lg border border-border bg-transparent p-3 text-xs text-muted-foreground dark:border-border/70 dark:bg-card/65">
              <p>
                Berechtigung: <span className="font-semibold text-foreground">{webPushPermission}</span>
              </p>
              <p>
                Server konfiguriert: <span className="font-semibold text-foreground">{webPushConfigured ? "ja" : "nein"}</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void handleEnableWebPush()}
                disabled={!webPushSupported || webPushSaving}
              >
                {webPushSaving ? "Aktiviere..." : "Push aktivieren"}
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleDisableWebPush()}
                disabled={!webPushSupported || webPushSaving || !webPushSubscribed}
              >
                {webPushSaving ? "Deaktiviere..." : "Push deaktivieren"}
              </Button>
            </div>
          </CardContent>
        </Card>

      </div>
    );
  };

  const renderFeesTab = () => {
    if (loading) {
      return (
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {[1, 2, 3, 4, 5].map((entry) => (
                <div key={entry} className={`space-y-2 ${entry === 5 ? "sm:col-span-2" : ""}`}>
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
            <Skeleton className="h-10 w-28" />
          </CardContent>
        </Card>
      );
    }

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Percent className="h-5 w-5" />
            <CardTitle>Gebuehren</CardTitle>
            <Badge variant="outline" className="ml-auto">{source === "db" ? "Aus DB" : "Standard"}</Badge>
          </div>
          <CardDescription>
            Konfiguriere die Gebuehren fuer Netto-ROI und Break-even Berechnungen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/12 p-3 text-sm text-emerald-300">
              {success}
            </div>
          )}

          {/* Trading Fees Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Trading Gebuehren</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="fxFeePercent">
                  FX Fee (%)
                </label>
                <Input
                  id="fxFeePercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.fxFeePercent}
                  onChange={handleChange("fxFeePercent")}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="sellerFeePercent">
                  Seller Fee (%)
                </label>
                <Input
                  id="sellerFeePercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.sellerFeePercent}
                  onChange={handleChange("sellerFeePercent")}
                  disabled={saving}
                />
              </div>
            </div>
          </div>

          {/* Deposit/Withdrawal Fees Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Ein-/Auszahlungsgebuehren</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="withdrawalFeePercent">
                  Withdrawal Fee (%)
                </label>
                <Input
                  id="withdrawalFeePercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.withdrawalFeePercent}
                  onChange={handleChange("withdrawalFeePercent")}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="depositFeePercent">
                  Deposit Fee (%)
                </label>
                <Input
                  id="depositFeePercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.depositFeePercent}
                  onChange={handleChange("depositFeePercent")}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="depositFeeFixedEur">
                  Deposit Fee (Fix EUR)
                </label>
                <Input
                  id="depositFeeFixedEur"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.depositFeeFixedEur}
                  onChange={handleChange("depositFeeFixedEur")}
                  disabled={saving}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 pt-2 border-t">
            <p className="text-xs text-muted-foreground max-w-md">
              Funding Mode wird pro Investment gesetzt und in der Netto-Berechnung beruecksichtigt.
            </p>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Speichert..." : "Speichern"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderApiKeyTab = () => {
    if (apiKeyLoading) {
      return (
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-32" />
          </CardContent>
        </Card>
      );
    }

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            <CardTitle>CSFloat API Key</CardTitle>
            {apiKeyStatus.configured && (
              <Badge variant="outline" className="ml-auto border-emerald-400/35 text-emerald-300">
                Konfiguriert
              </Badge>
            )}
          </div>
          <CardDescription>
            API Key fuer CSFloat Integration. Wird lokal verschluesselt gespeichert.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!encryptionReady && (
            <div className="rounded-xl border border-amber-400/35 bg-amber-500/12 p-3 text-sm text-amber-300">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                <span>
                  {desktopRuntime
                    ? "OS-Verschluesselung ist auf diesem System nicht verfuegbar."
                    : "Verschluesselung nicht konfiguriert. Bitte VITE_ENCRYPTION_KEY in .env setzen."}
                </span>
              </div>
            </div>
          )}

          {apiKeyError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {apiKeyError}
            </div>
          )}
          {apiKeySuccess && (
            <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/12 p-3 text-sm text-emerald-300">
              {apiKeySuccess}
            </div>
          )}

          {/* Current Status */}
          {apiKeyStatus.configured && (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/18">
                <Lock className="h-5 w-5 text-emerald-300" />
              </div>
              <div>
                <p className="text-sm font-medium">API Key aktiv</p>
                <p className="text-xs text-muted-foreground">Endet auf ...{apiKeyStatus.lastFour}</p>
              </div>
            </div>
          )}

          {/* Input Section */}
          <div className="space-y-3">
            <label className="text-sm font-medium">
              {apiKeyStatus.configured ? "Neuen Key eingeben" : "API Key eingeben"}
            </label>
            <div className="relative">
              <Input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={handleApiKeyChange}
                placeholder={apiKeyStatus.configured ? "Zum Aendern neuen Key eingeben..." : "CSFloat API Key..."}
                disabled={apiKeySaving || !encryptionReady}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                disabled={apiKeySaving}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {desktopRuntime
                ? "Desktop speichert den Key ueber die OS-Verschluesselung im Electron Main Process."
                : "Web-Modus: CSFloat Key-Update ist deaktiviert."}
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleUpdateCsFloatApiKey}
              disabled={apiKeySaving || !encryptionReady || !apiKey.trim()}
            >
              {apiKeySaving ? "Speichert..." : apiKeyStatus.configured ? "Key Aktualisieren" : "Key Speichern"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderSkinBaronApiKeyTab = () => {
    if (skinBaronApiKeyLoading) {
      return (
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-80" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-28 w-full" />
          </CardContent>
        </Card>
      );
    }

    const capabilityRows = [
      {
        id: "getBalance",
        label: "GetBalance",
        requirement: "Zeigt Guthaben/Key-Validitaet.",
      },
      {
        id: "getSales",
        label: "GetSales",
        requirement: "Pflicht fuer SkinBaron-Import in die lokale Portfolio-Datenbank.",
      },
      {
        id: "search",
        label: "Search",
        requirement: "Optional fuer spaetere Suche/Erweiterungen.",
      },
      {
        id: "getActiveTradeOffers",
        label: "GetActiveTradeOffers",
        requirement: "Optional fuer aktive Tradeoffer-Ansichten.",
      },
      {
        id: "getPriceList",
        label: "GetPriceList",
        requirement: "Optional fuer Preislisten-Sync.",
      },
    ];

    const capabilities = skinBaronApiKeyStatus?.capabilities || {};
    const sessionCookieAccess = skinBaronApiKeyStatus?.sessionCookieAccess || {};
    const readOnlyImportReady = skinBaronApiKeyStatus?.importReady === true
      || sessionCookieAccess?.allowed === true;

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            <CardTitle>SkinBaron Zugriff</CardTitle>
            {skinBaronApiKeyStatus.configured && (
              <Badge variant="outline" className="ml-auto border-emerald-400/35 text-emerald-300">
                Konfiguriert
              </Badge>
            )}
          </div>
          <CardDescription>
            SkinBaron-Zugangsdaten werden lokal verschluesselt gespeichert. Fuer den Import nutzen wir Purchases ueber Session-Cookie.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div
            className={
              readOnlyImportReady
                ? "rounded-xl border border-emerald-400/35 bg-emerald-500/12 p-3 text-sm text-emerald-300"
                : "rounded-xl border border-amber-400/35 bg-amber-500/12 p-3 text-sm text-amber-200"
            }
          >
            <p className="font-medium">
              {readOnlyImportReady ? "Read-only Preset: Import bereit" : "Read-only Preset: Import noch nicht bereit"}
            </p>
            <p className="mt-1 text-xs text-current/90">
              Voraussetzung ist ein gueltiger <span className="font-semibold">SkinBaron Session-Cookie (AUTHID)</span>.{" "}
              {readOnlyImportReady
                ? "Der SkinBaron-Import kann jetzt genutzt werden."
                : "Bitte Session-Cookie pruefen oder neu setzen."}
            </p>
          </div>

          <div className="space-y-3 rounded-xl border border-border/70 bg-card/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Session-Cookie fuer Purchases</p>
              <Badge
                variant="outline"
                className={readOnlyImportReady ? "border-emerald-400/35 text-emerald-300" : "border-amber-400/35 text-amber-300"}
              >
                {readOnlyImportReady ? "Import Ready" : "Nicht bereit"}
              </Badge>
            </div>

            {skinBaronApiKeyStatus?.sessionCookieConfigured ? (
              <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-2 text-xs text-muted-foreground">
                AUTHID ...{skinBaronApiKeyStatus.sessionCookieLastFour || "----"}
                {skinBaronApiKeyStatus?.sessionCookieCheckedAt
                  ? ` | letzter Purchases-Check: ${new Date(skinBaronApiKeyStatus.sessionCookieCheckedAt).toLocaleString("de-DE")}`
                  : ""}
                {sessionCookieAccess?.message ? ` | ${sessionCookieAccess.message}` : ""}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Noch kein Session-Cookie gespeichert. Bitte `AUTHID=...` aus einer aktiven SkinBaron-Websession hinterlegen.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 p-2">
              <p className="text-[11px] text-muted-foreground">
                Automatisch: Login-Fenster oeffnen, bei erfolgreichem Login wird `AUTHID` direkt uebernommen.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={handleConnectSkinBaronSessionViaBrowser}
                disabled={skinBaronSessionSaving || skinBaronSessionBrowserConnecting || !encryptionReady}
              >
                {skinBaronSessionBrowserConnecting ? "Warte auf Login..." : "Mit SkinBaron verbinden"}
              </Button>
            </div>

            <div className="relative">
              <Input
                type={showSkinBaronSessionCookie ? "text" : "password"}
                value={skinBaronSessionCookie}
                onChange={handleSkinBaronSessionCookieChange}
                placeholder="AUTHID=..."
                disabled={skinBaronSessionSaving || skinBaronSessionBrowserConnecting || !encryptionReady}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowSkinBaronSessionCookie(!showSkinBaronSessionCookie)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                disabled={skinBaronSessionSaving || skinBaronSessionBrowserConnecting}
              >
                {showSkinBaronSessionCookie ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleUpdateSkinBaronSessionCookie}
                disabled={
                  skinBaronSessionSaving
                  || skinBaronSessionBrowserConnecting
                  || !encryptionReady
                  || !skinBaronSessionCookie.trim()
                }
              >
                {skinBaronSessionSaving ? "Prueft + speichert..." : "Session-Cookie Speichern"}
              </Button>
            </div>
          </div>

          {skinBaronApiKeyError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {skinBaronApiKeyError}
            </div>
          )}
          {skinBaronApiKeySuccess && (
            <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/12 p-3 text-sm text-emerald-300">
              {skinBaronApiKeySuccess}
            </div>
          )}

          {skinBaronApiKeyStatus.configured && (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/18">
                <Lock className="h-5 w-5 text-emerald-300" />
              </div>
              <div>
                <p className="text-sm font-medium">API Key aktiv</p>
                <p className="text-xs text-muted-foreground">
                  Endet auf ...{skinBaronApiKeyStatus.lastFour || "----"}
                  {skinBaronApiKeyStatus.checkedAt
                    ? ` | letzte Rechtepruefung: ${new Date(skinBaronApiKeyStatus.checkedAt).toLocaleString("de-DE")}`
                    : ""}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <label className="text-sm font-medium">
              {skinBaronApiKeyStatus.configured ? "Neuen API-Key eingeben (optional)" : "API-Key eingeben (optional)"}
            </label>
            <div className="relative">
              <Input
                type={showSkinBaronApiKey ? "text" : "password"}
                value={skinBaronApiKey}
                onChange={handleSkinBaronApiKeyChange}
                placeholder={
                  skinBaronApiKeyStatus.configured
                    ? "Zum Aendern neuen SkinBaron Key eingeben..."
                    : "SkinBaron API Key..."
                }
                disabled={skinBaronApiKeySaving || !encryptionReady}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowSkinBaronApiKey(!showSkinBaronApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                disabled={skinBaronApiKeySaving}
              >
                {showSkinBaronApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Hinweis: Der API-Key ist optional (z. B. fuer Balance/Legacy-Checks). Der eigentliche Import nutzt den Session-Cookie.
            </p>
          </div>

          <div className="space-y-2 rounded-xl border border-border/70 bg-card/60 p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Rechte-Check</p>
            <p className="text-[11px] text-muted-foreground">
              Hinweis: API-Checks sind weiterhin verfuegbar, beeinflussen aber nicht mehr die Purchases-Import-Quelle.
            </p>
            {capabilityRows.map((row) => {
              const capability = capabilities?.[row.id] || null;
              const allowed = capability?.allowed === true;
              return (
                <div key={row.id} className="flex items-start justify-between gap-3 rounded-md border border-border/60 p-2">
                  <div>
                    <p className="text-sm font-medium">{row.label}</p>
                    <p className="text-xs text-muted-foreground">{row.requirement}</p>
                    {capability?.message ? (
                      <p className="text-[11px] text-muted-foreground">
                        Status: {capability.message}
                      </p>
                    ) : null}
                  </div>
                  <Badge
                    variant="outline"
                    className={allowed ? "border-emerald-400/35 text-emerald-300" : "border-amber-400/35 text-amber-300"}
                  >
                    {allowed ? "Erlaubt" : "Nicht erlaubt"}
                  </Badge>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleUpdateSkinBaronApiKey}
              disabled={skinBaronApiKeySaving || !encryptionReady || !skinBaronApiKey.trim()}
            >
              {skinBaronApiKeySaving
                ? "Speichert + prueft..."
                : skinBaronApiKeyStatus.configured
                  ? "Key Aktualisieren"
                  : "Key Speichern"}
            </Button>
          </div>
        </CardContent>
      </Card>
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
          <Card>
            <CardHeader>
              <CardTitle>Server Verbindung</CardTitle>
              <CardDescription>
                URL fuer Sync und Server-Features. Lokal gespeichert im Desktop-Profil.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {serverConfigError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  {serverConfigError}
                </div>
              ) : null}
              {serverConfigMessage ? (
                <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/12 p-3 text-sm text-emerald-300">
                  {serverConfigMessage}
                </div>
              ) : null}
              <Input
                value={serverUrl}
                onChange={(event) => {
                  setServerUrl(event.target.value);
                  setServerConfigError("");
                  setServerConfigMessage("");
                }}
                onBlur={() => {
                  const normalized = normalizeServerHostInput(serverUrl);
                  if (normalized && normalized !== serverUrl) {
                    setServerUrl(normalized);
                  }
                }}
                placeholder="cs2.clustercontrol.cc"
                disabled={serverConfigLoading || serverConfigSaving || serverConfigTesting}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  disabled={serverConfigLoading || serverConfigTesting || !serverUrl.trim()}
                  onClick={async () => {
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
                >
                  {serverConfigTesting ? "Teste..." : "Verbindung testen"}
                </Button>
                <Button
                  disabled={serverConfigLoading || serverConfigSaving || !serverUrl.trim()}
                  onClick={async () => {
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
                >
                  {serverConfigSaving ? "Speichert..." : "Speichern"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
        {renderSkinBaronApiKeyTab()}
        {renderApiKeyTab()}
      </div>
    );
  };

  const settingsContent = (
    <div className="mx-auto max-w-3xl space-y-6">
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
