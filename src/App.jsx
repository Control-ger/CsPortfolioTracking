import { Navigate, Route, Routes } from "react-router-dom";

import { BottomNavigation } from "@/components/BottomNavigation";
import { DebugDashboardPage } from "@/pages/DebugDashboardPage";
import CsUpdatesPage from "@/pages/CsUpdatesPage";
import { PortfolioPage } from "@/pages/PortfolioPage";
import { SettingsPage } from "@/pages/SettingsPage";

export default function App() {
  return (
    <div className="flex flex-col min-h-screen">
      <Routes>
        <Route path="/" element={<PortfolioPage initialTab="overview" />} />
        <Route path="/inventory" element={<PortfolioPage initialTab="inventory" />} />
        <Route path="/watchlist" element={<PortfolioPage initialTab="watchlist" />} />
        <Route path="/cs-updates" element={<CsUpdatesPage />} />
        <Route path="/debug" element={<DebugDashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BottomNavigation />
    </div>
  );
}
