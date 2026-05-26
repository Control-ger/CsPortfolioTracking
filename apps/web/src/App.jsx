import { Suspense, lazy, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { CurrencyProvider } from "@shared/contexts";
import { BottomNavigation, DesktopSidebarRail, Titlebar } from "@shared/components";
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

  return (
    <CurrencyProvider>
      <div className={`flex flex-col ${isElectron ? "h-full overflow-hidden" : "h-[100dvh] overflow-hidden"} bg-background text-foreground`}>

        {/* Nur in Electron anzeigen! */}
        {isElectron && <Titlebar />}

        <div className={`flex-1 min-h-0 lg:grid lg:grid-cols-[92px_minmax(0,1fr)] lg:gap-6 ${isElectron ? "" : "w-full"}`}>
          <aside className="hidden lg:flex lg:justify-center lg:pt-2">
            <DesktopSidebarRail desktopRuntime={desktopRuntime} />
          </aside>
          <main className="w-full min-h-0 overflow-y-auto lg:px-6 xl:px-8">
            {routeViews}
          </main>
        </div>

        <BottomNavigation />
      </div>
    </CurrencyProvider>
  );
}
