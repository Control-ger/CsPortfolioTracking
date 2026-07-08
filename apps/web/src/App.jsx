import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Lock, UserRound } from "lucide-react";

import { CurrencyProvider } from "@shared/contexts";
import { BottomNavigation, DesktopSidebarRail, Titlebar } from "@shared/components";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { deriveSteamPaletteFromUser } from "@shared/components/SteamLoginPrompt.jsx";
import { PortfolioPage } from "@shared/pages";
import { useGlobalKeyboardNavigation } from "@shared/hooks";
import { handleWebAuthCallback } from "@shared/lib/auth.js";
import { startDesktopAutoSync } from "@shared/lib/desktopSync.js";

const SettingsPage = lazy(() =>
  import("@shared/pages/SettingsPage.jsx").then((module) => ({ default: module.SettingsPage })),
);
const CsUpdatesPage = lazy(() => import("@shared/pages/CsUpdatesPage.jsx"));

const DEFAULT_STEAM_SHELL_PALETTE = Object.freeze({
  colorA: "hsla(212, 62%, 52%, 0.24)",
  colorB: "hsla(188, 55%, 52%, 0.18)",
  colorC: "hsla(39, 48%, 52%, 0.14)",
  colorD: "hsla(32, 42%, 46%, 0.14)",
});

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

function resolveSteamIdFromUser(user) {
  const directSteamId = firstNonEmptyString(user?.steamId, user?.steam_id);
  if (directSteamId) {
    return directSteamId;
  }

  const rawId = firstNonEmptyString(user?.id, user?.userId, user?.user_id);
  if (rawId?.startsWith("steam-")) {
    const candidate = rawId.slice("steam-".length).trim();
    return candidate || null;
  }

  return null;
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
  const [vaultShellPalette, setVaultShellPalette] = useState(DEFAULT_STEAM_SHELL_PALETTE);
  const [isProcessingAuthCallback, setIsProcessingAuthCallback] = useState(() => {
    if (isElectron || typeof window === "undefined") {
      return false;
    }
    const hash = window.location.hash || "";
    return hash.includes("token=") || window.location.pathname === "/auth/callback";
  });
  const shouldUseVaultGate = isElectron && desktopRuntime;
  useGlobalKeyboardNavigation(true);

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
  const showVaultGate = shouldUseVaultGate && (vaultLoading || !vaultStatus || !isVaultUnlocked);

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

  useEffect(() => {
    if (!shouldUseVaultGate) {
      setVaultShellPalette(DEFAULT_STEAM_SHELL_PALETTE);
      return;
    }

    let cancelled = false;
    const derivePalette = async () => {
      try {
        const derived = await deriveSteamPaletteFromUser(vaultLoginUser || null);
        if (cancelled) {
          return;
        }
        setVaultShellPalette({
          colorA: derived?.colorA || DEFAULT_STEAM_SHELL_PALETTE.colorA,
          colorB: derived?.colorB || DEFAULT_STEAM_SHELL_PALETTE.colorB,
          colorC: derived?.colorC || DEFAULT_STEAM_SHELL_PALETTE.colorC,
          colorD: derived?.colorD || derived?.colorB || DEFAULT_STEAM_SHELL_PALETTE.colorD,
        });
      } catch {
        if (!cancelled) {
          setVaultShellPalette(DEFAULT_STEAM_SHELL_PALETTE);
        }
      }
    };

    void derivePalette();
    return () => {
      cancelled = true;
    };
  }, [shouldUseVaultGate, vaultLoginUser]);

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

  if (showVaultGate) {
    const requiresSetup = vaultStatus?.configured !== true;
    const minPasswordLength = Number(vaultStatus?.minPasswordLength || 16);
    const vaultLoginStep = requiresSetup ? 1 : vaultActionRunning ? 3 : 2;
    const vaultLoginProgressPercent = Math.round((vaultLoginStep / 3) * 100);
    const vaultLoginProgressLabel = requiresSetup
      ? "Lokalen Zugang einrichten"
      : vaultActionRunning
        ? "Entsperren..."
        : "Bereit zum Entsperren";
    const hasVaultSteamUser = Boolean(resolveSteamIdFromUser(vaultLoginUser));
    const vaultDisplayName =
      hasVaultSteamUser
        ? firstNonEmptyString(
            vaultLoginUser?.name,
            vaultLoginUser?.steamName,
            vaultLoginUser?.steam_name,
          ) || "Steam Account"
        : "Steam Account";
    const vaultAvatarUrl = hasVaultSteamUser
      ? normalizeAvatarUrl(
          firstNonEmptyString(
            vaultLoginUser?.animatedAvatar,
            vaultLoginUser?.animated_avatar,
            vaultLoginUser?.avatar,
            vaultLoginUser?.steam_avatar,
            vaultLoginUser?.steamAvatar,
          ),
        )
      : null;
    const vaultShellStyle = {
      "--steam-shell-color-a": vaultShellPalette.colorA,
      "--steam-shell-color-b": vaultShellPalette.colorB,
      "--steam-shell-color-c": vaultShellPalette.colorC,
      "--steam-shell-color-d": vaultShellPalette.colorD,
    };

    return (
      <CurrencyProvider>
        <div
          className={`steam-startup-shell flex flex-col ${isElectron ? "h-full overflow-hidden" : "min-h-screen"} text-foreground`}
          style={vaultShellStyle}
        >
          {isElectron && <Titlebar />}
          <main className="flex flex-1 items-center justify-center overflow-auto p-4">
            <div
              className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-white/15 bg-slate-950/58 p-5 text-slate-100 shadow-2xl backdrop-blur-xl"
              data-keyboard-scope="page"
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-slate-100">
                  <Lock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-base font-semibold">Welcome to CS Investor Hub</p>
                  <p className="text-xs text-slate-300">Mit App-Passwort anmelden und direkt ins Dashboard.</p>
                </div>
              </div>

              <div className="mb-4 flex items-center gap-3 rounded-lg border border-white/15 bg-white/5 p-3">
                {vaultAvatarUrl ? (
                  <img
                    src={vaultAvatarUrl}
                    alt={vaultDisplayName}
                    className="h-12 w-12 rounded-full object-cover ring-2 ring-primary/30"
                  />
                ) : hasVaultSteamUser ? (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-slate-100 ring-2 ring-cyan-300/30">
                    {vaultDisplayName.slice(0, 2).toUpperCase()}
                  </div>
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-slate-300 ring-2 ring-white/15">
                    <UserRound className="h-5 w-5" />
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-slate-100">{vaultDisplayName}</p>
                  <p className="text-xs text-slate-300">
                    {hasVaultSteamUser ? "Steam verbunden" : "Noch nicht verbunden"}
                  </p>
                </div>
              </div>

              {requiresSetup ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSetVaultPassword();
                  }}
                >
                  <p className="text-sm font-medium">App-Passwort erstellen</p>
                  <Input
                    type="password"
                    value={setupPassword}
                    onChange={(event) => setSetupPassword(event.target.value)}
                    placeholder={`Mindestens ${minPasswordLength} Zeichen`}
                    disabled={vaultActionRunning}
                    className="border-white/15 bg-white/5 text-slate-100 placeholder:text-slate-400"
                  />
                  <Input
                    type="password"
                    value={setupPasswordConfirm}
                    onChange={(event) => setSetupPasswordConfirm(event.target.value)}
                    placeholder="Passwort bestaetigen"
                    disabled={vaultActionRunning}
                    className="border-white/15 bg-white/5 text-slate-100 placeholder:text-slate-400"
                  />
                  <p className="text-xs text-slate-300">
                    Empfehlung: Lange Passphrase mit Gross-/Kleinbuchstaben, Zahlen und Sonderzeichen.
                  </p>
                  <Button
                    type="submit"
                    className="w-full bg-white/95 text-slate-950 hover:bg-white"
                    disabled={vaultActionRunning}
                    data-keyboard-default
                  >
                    {vaultActionRunning ? "Speichert..." : "App-Passwort setzen"}
                  </Button>
                </form>
              ) : (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleUnlockVault();
                  }}
                >
                  <p className="text-sm font-medium">App entsperren</p>
                  <Input
                    type="password"
                    value={unlockPassword}
                    onChange={(event) => setUnlockPassword(event.target.value)}
                    placeholder="App-Passwort"
                    disabled={vaultActionRunning}
                    className="border-white/15 bg-white/5 text-slate-100 placeholder:text-slate-400"
                  />
                  <Button
                    type="submit"
                    className="w-full bg-white/95 text-slate-950 hover:bg-white"
                    disabled={vaultActionRunning}
                    data-keyboard-default
                  >
                    {vaultActionRunning ? "Entsperrt..." : "Entsperren"}
                  </Button>
                </form>
              )}

              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>{vaultLoginProgressLabel}</span>
                  <span>{vaultLoginProgressPercent}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
                  <div
                    className={`h-full rounded-full bg-cyan-300 transition-[width] duration-300 ${vaultActionRunning ? "steam-progress-pulse" : ""}`}
                    style={{ width: `${vaultLoginProgressPercent}%` }}
                  />
                </div>
              </div>

              {vaultError ? (
                <div className="mt-3 rounded-md border border-red-400/40 bg-red-500/15 p-2 text-xs text-red-100">
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

        <BottomNavigation />
      </div>
    </CurrencyProvider>
  );
}
