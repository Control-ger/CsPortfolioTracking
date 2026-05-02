import { Navigate, Route, Routes } from "react-router-dom";

import { CurrencyProvider } from "@shared/contexts";
import { BottomNavigation, Titlebar } from "@shared/components";
import { DebugDashboardPage, CsUpdatesPage, PortfolioPage, SettingsPage } from "@shared/pages";

export default function App() {
    const isElectron = window.electronAPI !== undefined;
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
                      <Route path="/debug" element={<DebugDashboardPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
              </main>

              <BottomNavigation />
          </div>
      </CurrencyProvider>
  );
}
