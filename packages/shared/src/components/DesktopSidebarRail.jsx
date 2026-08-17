import { Cog, Eye, FolderCog, LayoutGrid, Newspaper, Package, Search } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { NotificationBell } from "@shared/components/NotificationBell";
import { ThemeToggle } from "@shared/components/ThemeToggle";
import { UserMenu } from "@shared/components/UserMenu";

const DESKTOP_SIDEBAR_ITEMS = [
  { key: "overview", label: "Uebersicht", icon: LayoutGrid, to: "/" },
  { key: "inventory", label: "Inventar", icon: Package, to: "/inventory" },
  { key: "watchlist", label: "Watchlist", icon: Eye, to: "/watchlist" },
  { key: "search", label: "Suche", icon: Search, to: "/search" },
  { key: "updates", label: "Updates", icon: Newspaper, to: "/cs-updates" },
  { key: "management", label: "Verwaltung", icon: FolderCog, to: "/?tab=management", desktopOnly: true },
  { key: "settings", label: "Einstellungen", icon: Cog, to: "/settings" },
];

export function DesktopSidebarRail({ desktopRuntime = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const activePortfolioTab = new URLSearchParams(location.search).get("tab") || "overview";
  const routeMappedTab = location.pathname === "/inventory"
    ? "inventory"
    : location.pathname === "/watchlist"
      ? "watchlist"
      : location.pathname === "/search"
        ? "search"
        : null;
  const resolvedPortfolioTab = routeMappedTab || activePortfolioTab;

  const isItemActive = (item) => {
    if (item.key === "updates") {
      return location.pathname === "/cs-updates";
    }
    if (item.key === "settings") {
      return location.pathname === "/settings";
    }
    if (location.pathname === "/" || routeMappedTab) {
      return resolvedPortfolioTab === item.key;
    }
    return false;
  };

  return (
    <div className="tr-desktop-rail h-full w-[92px] overflow-hidden rounded-2xl">
      <div className="flex h-full flex-col items-center py-4">
        <nav className="flex w-full flex-col items-center gap-2 px-2">
          {DESKTOP_SIDEBAR_ITEMS
            .filter((item) => !item.desktopOnly || desktopRuntime)
            .map((item) => {
              const Icon = item.icon;
              const isActive = isItemActive(item);
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
          <NotificationBell desktopRuntime={desktopRuntime} menuSide="right" menuAlign="end" />
          <UserMenu menuSide="right" menuAlign="end" menuSideOffset={8} />
        </div>
      </div>
    </div>
  );
}
