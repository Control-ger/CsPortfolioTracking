import { useEffect, useState } from "react";
import { Bell, Cog, Eye, FolderCog, LayoutGrid, Newspaper, Package } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { Button } from "@shared/components/ui/button";
import { ThemeToggle } from "@shared/components/ThemeToggle";
import { UserMenu } from "@shared/components/UserMenu";
import { getCurrentUser, resolveDesktopLocalUserId } from "@shared/lib";

const DESKTOP_SIDEBAR_ITEMS = [
  { key: "overview", label: "Uebersicht", icon: LayoutGrid, to: "/?tab=overview" },
  { key: "inventory", label: "Inventar", icon: Package, to: "/?tab=inventory" },
  { key: "watchlist", label: "Watchlist", icon: Eye, to: "/?tab=watchlist" },
  { key: "management", label: "Verwaltung", icon: FolderCog, to: "/?tab=management", desktopOnly: true },
  { key: "settings", label: "Einstellungen", icon: Cog, to: "/settings" },
  { key: "updates", label: "Updates", icon: Newspaper, to: "/cs-updates" },
];

export function DesktopSidebarRail({ desktopRuntime = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [syncNotifications, setSyncNotifications] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
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

  useEffect(() => {
    if (!desktopRuntime || !window.electronAPI?.localStore?.listNotifications) {
      return;
    }

    let cancelled = false;

    const loadNotifications = async () => {
      try {
        const user = await getCurrentUser();
        const userId = resolveDesktopLocalUserId(user, 1);
        const notifications = await window.electronAPI.localStore.listNotifications(userId, { limit: 20 });
        if (cancelled) {
          return;
        }
        const rows = Array.isArray(notifications) ? notifications : [];
        setSyncNotifications(rows);
        setUnreadNotificationCount(rows.filter((entry) => entry?.unread).length);
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to load rail notifications", error);
        }
      }
    };

    void loadNotifications();
    const intervalId = window.setInterval(() => void loadNotifications(), 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [desktopRuntime]);

  const handleNotificationClick = async (entry) => {
    if (window.electronAPI?.localStore?.markNotificationRead && entry?.id) {
      await window.electronAPI.localStore.markNotificationRead(entry.id);
    }

    setSyncNotifications((current) =>
      current.map((item) => (item.id === entry.id ? { ...item, unread: false } : item)),
    );
    setUnreadNotificationCount((current) => Math.max(0, current - 1));
    navigate("/?tab=management", { replace: true });
  };

  return (
    <div className="tr-desktop-rail h-[98vh] w-[92px] overflow-hidden rounded-2xl">
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="relative h-11 w-11 rounded-full border-border/80 bg-card/75 p-0">
                <Bell className="h-5 w-5" />
                {desktopRuntime && unreadNotificationCount > 0 ? (
                  <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                    {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                  </span>
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-80">
              <DropdownMenuLabel>System-Benachrichtigungen</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {desktopRuntime ? (
                <>
                  <div className="max-h-72 space-y-1 overflow-y-auto">
                    {syncNotifications.length > 0 ? (
                      syncNotifications.slice(0, 8).map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => void handleNotificationClick(entry)}
                          className="w-full rounded-md p-2 text-left text-xs transition-colors hover:bg-accent"
                        >
                          <p className="font-semibold text-foreground">{entry.title || "Hinweis"}</p>
                          <p className="mt-1 line-clamp-2 text-muted-foreground">{entry.message || ""}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {entry.createdAt ? new Date(entry.createdAt).toLocaleString("de-DE") : ""}
                          </p>
                        </button>
                      ))
                    ) : (
                      <p className="p-2 text-xs text-muted-foreground">Keine Benachrichtigungen.</p>
                    )}
                  </div>
                  <DropdownMenuSeparator />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => navigate("/?tab=management", { replace: true })}
                  >
                    Zur Verwaltung
                  </Button>
                </>
              ) : (
                <>
                  <p className="p-2 text-xs text-muted-foreground">
                    Im Web werden System-Benachrichtigungen per Browser Push zugestellt.
                  </p>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <UserMenu menuSide="right" menuAlign="end" menuSideOffset={8} />
        </div>
      </div>
    </div>
  );
}
