import { Navigate, Route, Routes } from "react-router-dom";

import { DebugDashboardPage } from "@/pages/DebugDashboardPage";
import CsUpdatesPage from "@/pages/CsUpdatesPage";
import { PortfolioPage } from "@/pages/PortfolioPage";
import { SettingsPage } from "@/pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PortfolioPage />} />
      <Route path="/cs-updates" element={<CsUpdatesPage />} />
      <Route path="/debug" element={<DebugDashboardPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
