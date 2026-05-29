import { Suspense, lazy, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { CurrencyProvider } from "@shared/contexts";
import { BottomNavigation, DesktopSidebarRail, Titlebar } from "@shared/components";
import { Button } from "@shared/components/ui/button";
import { PortfolioPage } from "@shared/pages";
import { handleWebAuthCallback } from "@shared/lib/auth.js";
import { startDesktopAutoSync } from "@shared/lib/desktopSync.js";

const SettingsPage = lazy(() =>
  import("@shared/pages/SettingsPage.jsx").then((module) => ({ default: module.SettingsPage })),
);
const CsUpdatesPage = lazy(() => import("@shared/pages/CsUpdatesPage.jsx"));

export default function App() {
  const isElectron = window.electronAPI !== undefined;
  const desktopRuntime = Boolean(window.electronAPI?.localStore);
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
    if (!isElectron) {
      return;
    }

    return startDesktopAutoSync();
  }, [isElectron]);

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

  if (isProcessingAuthCallback) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">Anmeldung wird abgeschlossen...</p>
      </div>
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
          <main className="w-full flex-1 min-h-0 overflow-y-auto lg:px-6 xl:px-8">
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
