import { Cog, Eye, FolderCog, LayoutGrid, Newspaper, Package, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { NotificationBell } from "@shared/components/NotificationBell";
import { ThemeToggle } from "@shared/components/ThemeToggle";
import { UserMenu } from "@shared/components/UserMenu";

/** Shares the `common:nav.*` keys with `MobileTopbar` — see its NAV_ITEMS note. */
const DESKTOP_SIDEBAR_ITEMS = [
  { key: "overview", labelKey: "nav.overview", icon: LayoutGrid, to: "/" },
  { key: "inventory", labelKey: "nav.inventory", icon: Package, to: "/inventory" },
  { key: "watchlist", labelKey: "nav.watchlist", icon: Eye, to: "/watchlist" },
  { key: "search", labelKey: "nav.search", icon: Search, to: "/search" },
  { key: "updates", labelKey: "nav.updates", icon: Newspaper, to: "/cs-updates" },
  { key: "management", labelKey: "nav.management", icon: FolderCog, to: "/?tab=management", desktopOnly: true },
  { key: "settings", labelKey: "nav.settings", icon: Cog, to: "/settings" },
];

export function DesktopSidebarRail({ desktopRuntime = false }) {
  const { t } = useTranslation("common");
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
              const label = t(item.labelKey);
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
                  title={label}
                  aria-label={label}
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
