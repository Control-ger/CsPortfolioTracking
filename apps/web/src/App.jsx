import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Lock } from "lucide-react";

import { CurrencyProvider } from "@shared/contexts";
import { BottomNavigation, DesktopSidebarRail, Titlebar } from "@shared/components";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { PortfolioPage } from "@shared/pages";
import { handleWebAuthCallback } from "@shared/lib/auth.js";
import { startDesktopAutoSync } from "@shared/lib/desktopSync.js";

const SettingsPage = lazy(() =>
  import("@shared/pages/SettingsPage.jsx").then((module) => ({ default: module.SettingsPage })),
);
const CsUpdatesPage = lazy(() => import("@shared/pages/CsUpdatesPage.jsx"));

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed !== "") {
        return trimmed;
      }
    }
  }
  return null;
}

function normalizeAvatarUrl(url) {
  if (typeof url !== "string") {
    return null;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (trimmed.startsWith("/")) {
    return `https://steamcommunity.com${trimmed}`;
  }
  if (trimmed.startsWith("http://")) {
    return `https://${trimmed.slice("http://".length)}`;
  }
  return trimmed;
}

export default function App() {
  const isElectron = window.electronAPI !== undefined;
  const desktopRuntime = Boolean(window.electronAPI?.localStore);
  const [vaultStatus, setVaultStatus] = useState(null);
  const [vaultLoading, setVaultLoading] = useState(() => Boolean(isElectron && desktopRuntime));
  const [vaultError, setVaultError] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState("");
  const [vaultActionRunning, setVaultActionRunning] = useState(false);
  const [vaultLoginUser, setVaultLoginUser] = useState(null);
  const [updaterStatus, setUpdaterStatus] = useState({
    state: "idle",
    version: null,
    percent: 0,
    message: "",
  });
  const [isUpdaterActionRunning, setIsUpdaterActionRunning] = useState(false);
  const [isProcessingAuthCallback, setIsProcessingAuthCallback] = useState(() => {
    if (isElectron || typeof window === "undefined") {
      return false;
    }
    const hash = window.location.hash || "";
    return hash.includes("token=") || window.location.pathname === "/auth/callback";
  });
  const shouldUseVaultGate = isElectron && desktopRuntime;

  const refreshVaultStatus = useMemo(() => {
    return async ({ quiet = false } = {}) => {
      if (!shouldUseVaultGate || !window.electronAPI?.secrets?.getVaultStatus) {
        setVaultStatus(null);
        setVaultLoading(false);
        return null;
      }

      if (!quiet) {
        setVaultLoading(true);
      }

      try {
        const nextStatus = await window.electronAPI.secrets.getVaultStatus();
        setVaultStatus(nextStatus || null);
        setVaultError("");
        return nextStatus || null;
      } catch (error) {
        setVaultError(error?.message || "Secret-Vault Status konnte nicht geladen werden.");
        return null;
      } finally {
        if (!quiet) {
          setVaultLoading(false);
        }
      }
    };
  }, [shouldUseVaultGate]);

  const isVaultUnlocked = !shouldUseVaultGate || (vaultStatus?.configured === true && vaultStatus?.unlocked === true);

  useEffect(() => {
    void refreshVaultStatus();
  }, [refreshVaultStatus]);

  useEffect(() => {
    if (!shouldUseVaultGate || !isVaultUnlocked || !window.electronAPI?.secrets?.touchVaultActivity) {
      return;
    }

    let lastTouch = 0;
    const touch = () => {
      const now = Date.now();
      if (now - lastTouch < 5000) {
        return;
      }
      lastTouch = now;
      void window.electronAPI.secrets.touchVaultActivity().catch(() => {});
    };

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"];
    events.forEach((eventName) => window.addEventListener(eventName, touch, { passive: true }));

    const intervalId = window.setInterval(() => {
      void refreshVaultStatus({ quiet: true });
    }, 20000);

    touch();
    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, touch));
      window.clearInterval(intervalId);
    };
  }, [isVaultUnlocked, refreshVaultStatus, shouldUseVaultGate]);

  useEffect(() => {
    if (!isProcessingAuthCallback || isElectron || typeof window === "undefined") {
      return;
    }

    let cancelled = false;
    handleWebAuthCallback()
      .catch((error) => {
        console.error("[auth] Web callback handling failed:", error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsProcessingAuthCallback(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isElectron, isProcessingAuthCallback]);

  useEffect(() => {
    if (!isElectron || !isVaultUnlocked) {
      return;
    }

    return startDesktopAutoSync();
  }, [isElectron, isVaultUnlocked]);

  useEffect(() => {
    if (!isElectron || !window.electronAPI?.updater?.onStatus) {
      return;
    }

    const unsubscribe = window.electronAPI.updater.onStatus((payload) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      setUpdaterStatus((current) => ({
        ...current,
        ...payload,
      }));
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [isElectron]);

  useEffect(() => {
    if (!shouldUseVaultGate || !window.electronAPI?.getSession) {
      setVaultLoginUser(null);
      return;
    }

    let cancelled = false;
    const loadVaultLoginUser = async () => {
      try {
        const session = await window.electronAPI.getSession();
        const user = session?.user && typeof session.user === "object" ? session.user : null;
        if (!cancelled) {
          setVaultLoginUser(user);
        }
      } catch {
        if (!cancelled) {
          setVaultLoginUser(null);
        }
      }
    };

    void loadVaultLoginUser();
    return () => {
      cancelled = true;
    };
  }, [shouldUseVaultGate]);

  if (isProcessingAuthCallback) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">Anmeldung wird abgeschlossen...</p>
      </div>
    );
  }

  const handleSetVaultPassword = async () => {
    const minLength = Number(vaultStatus?.minPasswordLength || 16);
    if (setupPassword.length < minLength) {
      setVaultError(`App-Passwort muss mindestens ${minLength} Zeichen haben.`);
      return;
    }
    if (setupPassword !== setupPasswordConfirm) {
      setVaultError("Passwort-Bestaetigung stimmt nicht ueberein.");
      return;
    }

    setVaultActionRunning(true);
    setVaultError("");
    try {
      await window.electronAPI.secrets.setVaultPassword(setupPassword);
      setSetupPassword("");
      setSetupPasswordConfirm("");
      await refreshVaultStatus();
    } catch (error) {
      setVaultError(error?.message || "App-Passwort konnte nicht gesetzt werden.");
    } finally {
      setVaultActionRunning(false);
    }
  };

  const handleUnlockVault = async () => {
    if (!unlockPassword.trim()) {
      setVaultError("Bitte App-Passwort eingeben.");
      return;
    }

    setVaultActionRunning(true);
    setVaultError("");
    try {
      await window.electronAPI.secrets.unlockVault(unlockPassword);
      setUnlockPassword("");
      await refreshVaultStatus();
    } catch (error) {
      setVaultError(error?.message || "Secret Vault konnte nicht entsperrt werden.");
    } finally {
      setVaultActionRunning(false);
    }
  };

  if (shouldUseVaultGate && (vaultLoading || !vaultStatus || !isVaultUnlocked)) {
    const requiresSetup = vaultStatus?.configured !== true;
    const minPasswordLength = Number(vaultStatus?.minPasswordLength || 16);
    const vaultLoginStep = requiresSetup ? 1 : vaultActionRunning ? 3 : 2;
    const vaultLoginProgressPercent = Math.round((vaultLoginStep / 3) * 100);
    const vaultLoginProgressLabel = requiresSetup
      ? "Lokalen Zugang einrichten"
      : vaultActionRunning
        ? "Entsperren..."
        : "Bereit zum Entsperren";
    const vaultDisplayName =
      firstNonEmptyString(
        vaultLoginUser?.name,
        vaultLoginUser?.steamName,
        vaultLoginUser?.steam_name,
      ) || "Steam Account";
    const vaultAvatarUrl = normalizeAvatarUrl(
      firstNonEmptyString(
        vaultLoginUser?.animatedAvatar,
        vaultLoginUser?.animated_avatar,
        vaultLoginUser?.avatar,
        vaultLoginUser?.steam_avatar,
        vaultLoginUser?.steamAvatar,
      ),
    );

    return (
      <CurrencyProvider>
        <div className={`flex flex-col ${isElectron ? "h-full overflow-hidden" : "min-h-screen"} bg-background text-foreground`}>
          {isElectron && <Titlebar />}
          <main className="flex flex-1 items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl border border-border/80 bg-card/95 p-5 shadow-xl backdrop-blur">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Lock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-base font-semibold">Welcome to CS Investor Hub</p>
                  <p className="text-xs text-muted-foreground">Mit App-Passwort anmelden und direkt ins Dashboard.</p>
                </div>
              </div>

              <div className="mb-4 flex items-center gap-3 rounded-lg border border-white/15 bg-white/5 p-3">
                {vaultAvatarUrl ? (
                  <img
                    src={vaultAvatarUrl}
                    alt={vaultDisplayName}
                    className="h-12 w-12 rounded-full object-cover ring-2 ring-primary/30"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary ring-2 ring-primary/30">
                    {vaultDisplayName.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-foreground">{vaultDisplayName}</p>
                  <p className="text-xs text-muted-foreground">Steam verbunden</p>
                </div>
              </div>

              {requiresSetup ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium">App-Passwort erstellen</p>
                  <Input
                    type="password"
                    value={setupPassword}
                    onChange={(event) => setSetupPassword(event.target.value)}
                    placeholder={`Mindestens ${minPasswordLength} Zeichen`}
                    disabled={vaultActionRunning}
                  />
                  <Input
                    type="password"
                    value={setupPasswordConfirm}
                    onChange={(event) => setSetupPasswordConfirm(event.target.value)}
                    placeholder="Passwort bestaetigen"
                    disabled={vaultActionRunning}
                  />
                  <p className="text-xs text-muted-foreground">
                    Empfehlung: Lange Passphrase mit Gross-/Kleinbuchstaben, Zahlen und Sonderzeichen.
                  </p>
                  <Button className="w-full" onClick={() => void handleSetVaultPassword()} disabled={vaultActionRunning}>
                    {vaultActionRunning ? "Speichert..." : "App-Passwort setzen"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-medium">App entsperren</p>
                  <Input
                    type="password"
                    value={unlockPassword}
                    onChange={(event) => setUnlockPassword(event.target.value)}
                    placeholder="App-Passwort"
                    disabled={vaultActionRunning}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleUnlockVault();
                      }
                    }}
                  />
                  <Button className="w-full" onClick={() => void handleUnlockVault()} disabled={vaultActionRunning}>
                    {vaultActionRunning ? "Entsperrt..." : "Entsperren"}
                  </Button>
                </div>
              )}

              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{vaultLoginProgressLabel}</span>
                  <span>{vaultLoginProgressPercent}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
                  <div
                    className="h-full rounded-full bg-cyan-300 transition-[width] duration-300"
                    style={{ width: `${vaultLoginProgressPercent}%` }}
                  />
                </div>
              </div>

              {vaultError ? (
                <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  {vaultError}
                </div>
              ) : null}
            </div>
          </main>
        </div>
      </CurrencyProvider>
    );
  }

  const routeFallback = (
    <div className="flex min-h-[30vh] items-center justify-center">
      <p className="text-sm text-muted-foreground">Ansicht wird geladen...</p>
    </div>
  );

  const routeViews = (
    <Routes>
      <Route path="/" element={<PortfolioPage initialTab="overview" useExternalDesktopSidebarShell />} />
      <Route path="/inventory" element={<PortfolioPage initialTab="inventory" useExternalDesktopSidebarShell />} />
      <Route path="/watchlist" element={<PortfolioPage initialTab="watchlist" useExternalDesktopSidebarShell />} />
      <Route path="/search" element={<PortfolioPage initialTab="search" useExternalDesktopSidebarShell />} />
      <Route
        path="/cs-updates"
        element={(
          <Suspense fallback={routeFallback}>
            <CsUpdatesPage useExternalDesktopSidebarShell />
          </Suspense>
        )}
      />
      <Route
        path="/settings"
        element={(
          <Suspense fallback={routeFallback}>
            <SettingsPage useExternalDesktopSidebarShell />
          </Suspense>
        )}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );

  const updaterState = String(updaterStatus?.state || "idle");
  const updaterVersionLabel = updaterStatus?.version ? `v${updaterStatus.version}` : "Neue Version";
  const updaterPercent = Math.max(0, Math.min(100, Math.round(Number(updaterStatus?.percent || 0))));
  const showUpdaterStatus = isElectron && ["available", "downloading", "downloaded", "error"].includes(updaterState);
  const updaterStatusText = (() => {
    if (updaterState === "available") {
      return `${updaterVersionLabel} ist verfuegbar`;
    }
    if (updaterState === "downloading") {
      return `Download laeuft: ${updaterPercent}%`;
    }
    if (updaterState === "downloaded") {
      return `${updaterVersionLabel} ist bereit zur Installation`;
    }
    if (updaterState === "error") {
      return String(updaterStatus?.message || "Update-Download fehlgeschlagen");
    }
    return "";
  })();

  const handleUpdaterDownload = async () => {
    if (!window.electronAPI?.updater?.download || isUpdaterActionRunning) {
      return;
    }
    setIsUpdaterActionRunning(true);
    try {
      const result = await window.electronAPI.updater.download();
      if (!result || result.ok !== false) {
        return;
      }
      if (result.reason === "no-update-info") {
        window.alert(`${updaterVersionLabel}: Update-Metadaten noch nicht verfuegbar. Bitte gleich erneut versuchen.`);
        return;
      }
      if (result.reason === "not-packaged") {
        window.alert("Updates sind nur in der installierten Desktop-App verfuegbar.");
        return;
      }
      window.alert(String(result.error || "Update-Download konnte nicht gestartet werden."));
    } finally {
      setIsUpdaterActionRunning(false);
    }
  };

  const handleUpdaterInstall = async () => {
    if (!window.electronAPI?.updater?.install || isUpdaterActionRunning) {
      return;
    }
    setIsUpdaterActionRunning(true);
    try {
      await window.electronAPI.updater.install();
    } finally {
      setIsUpdaterActionRunning(false);
    }
  };

  return (
    <CurrencyProvider>
      <div className={`flex flex-col ${isElectron ? "h-full overflow-hidden" : "h-[100dvh] overflow-hidden"} bg-background text-foreground`}>

        {/* Nur in Electron anzeigen! */}
        {isElectron && <Titlebar />}

        <div
          className={`flex flex-1 min-h-0 flex-col lg:grid lg:grid-cols-[92px_minmax(0,1fr)] lg:gap-6 ${
            isElectron ? "" : "w-full"
          }`}
        >
          <aside className="hidden lg:flex lg:justify-center lg:pt-2">
            <DesktopSidebarRail desktopRuntime={desktopRuntime} />
          </aside>
          <main className="w-full flex-1 min-h-0 overflow-y-auto">
            {routeViews}
          </main>
        </div>

        {showUpdaterStatus ? (
          <div className="pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-3 z-[70] w-[min(26rem,calc(100vw-1.5rem))]">
            <div className="pointer-events-auto rounded-xl border border-border/80 bg-card/95 p-3 shadow-xl backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">App Update</p>
              <p className="mt-1 text-sm font-medium text-foreground">{updaterStatusText}</p>
              {updaterState === "downloading" ? (
                <div className="mt-2">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-[width] duration-300 ease-out"
                      style={{ width: `${updaterPercent}%` }}
                    />
                  </div>
                </div>
              ) : null}
              <div className="mt-3 flex items-center justify-end gap-2">
                {updaterState === "available" ? (
                  <Button size="sm" onClick={() => void handleUpdaterDownload()} disabled={isUpdaterActionRunning}>
                    Jetzt updaten
                  </Button>
                ) : null}
                {updaterState === "downloaded" ? (
                  <Button size="sm" onClick={() => void handleUpdaterInstall()} disabled={isUpdaterActionRunning}>
                    Installieren
                  </Button>
                ) : null}
                {updaterState === "error" ? (
                  <Button size="sm" variant="outline" onClick={() => void handleUpdaterDownload()} disabled={isUpdaterActionRunning}>
                    Erneut versuchen
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <BottomNavigation />
      </div>
    </CurrencyProvider>
  );
}
