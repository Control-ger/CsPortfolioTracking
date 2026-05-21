import { Suspense, lazy, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { CurrencyProvider } from "@shared/contexts";
import { BottomNavigation, Titlebar } from "@shared/components";
import { PortfolioPage } from "@shared/pages";
import { handleWebAuthCallback } from "@shared/lib/auth.js";
import { startDesktopAutoSync } from "@shared/lib/desktopSync.js";

const SettingsPage = lazy(() =>
  import("@shared/pages/SettingsPage.jsx").then((module) => ({ default: module.SettingsPage })),
);
const CsUpdatesPage = lazy(() => import("@shared/pages/CsUpdatesPage.jsx"));

export default function App() {
  const isElectron = window.electronAPI !== undefined;
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

  return (
    <CurrencyProvider>
      <div className={`flex flex-col ${isElectron ? "h-full overflow-hidden" : "min-h-screen"} bg-background text-foreground`}>

        {/* Nur in Electron anzeigen! */}
        {isElectron && <Titlebar />}

        <main className={`flex-1 ${isElectron ? 'overflow-y-auto min-h-0' : ''} w-full`}>
          <Routes>
            <Route path="/" element={<PortfolioPage initialTab="overview" />} />
            <Route path="/inventory" element={<PortfolioPage initialTab="inventory" />} />
            <Route path="/watchlist" element={<PortfolioPage initialTab="watchlist" />} />
            <Route
              path="/cs-updates"
              element={(
                <Suspense fallback={routeFallback}>
                  <CsUpdatesPage />
                </Suspense>
              )}
            />
            <Route
              path="/settings"
              element={(
                <Suspense fallback={routeFallback}>
                  <SettingsPage />
                </Suspense>
              )}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        <BottomNavigation />
      </div>
    </CurrencyProvider>
  );
}
