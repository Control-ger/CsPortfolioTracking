import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { CurrencyProvider } from "@shared/contexts";
import { BottomNavigation, Titlebar } from "@shared/components";
import { CsUpdatesPage, PortfolioPage, SettingsPage } from "@shared/pages";
import { handleWebAuthCallback } from "@shared/lib/auth.js";
import { startDesktopAutoSync } from "@shared/lib/desktopSync.js";

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

  return (
    <CurrencyProvider>
      <div className={`flex flex-col ${isElectron ? 'h-screen overflow-hidden' : 'min-h-screen'} bg-background text-foreground`}>

        {/* Nur in Electron anzeigen! */}
        {isElectron && <Titlebar />}

        <main className={`flex-1 ${isElectron ? 'overflow-y-auto min-h-0' : ''} w-full`}>
          <Routes>
            <Route path="/" element={<PortfolioPage initialTab="overview" />} />
            <Route path="/inventory" element={<PortfolioPage initialTab="inventory" />} />
            <Route path="/watchlist" element={<PortfolioPage initialTab="watchlist" />} />
            <Route path="/cs-updates" element={<CsUpdatesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        <BottomNavigation />
      </div>
    </CurrencyProvider>
  );
}
