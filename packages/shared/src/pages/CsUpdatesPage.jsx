import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, Cog, Eye, FolderCog, LayoutGrid, Package } from "lucide-react";

import { CsUpdatesFeed } from "@shared/components/CsUpdatesFeed";
import { ThemeToggle } from "@shared/components/ThemeToggle";
import { UserMenu } from "@shared/components/UserMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@shared/components";
import { Button } from "@shared/components/ui/button";
import { getCurrentUser, resolveDesktopLocalUserId } from "@shared/lib";

const DESKTOP_SIDEBAR_ITEMS = [
  { key: "overview", label: "Uebersicht", icon: LayoutGrid, to: "/?tab=overview" },
  { key: "inventory", label: "Inventar", icon: Package, to: "/?tab=inventory" },
  { key: "watchlist", label: "Watchlist", icon: Eye, to: "/?tab=watchlist" },
  { key: "management", label: "Verwaltung", icon: FolderCog, to: "/?tab=management", desktopOnly: true },
  { key: "settings", label: "Einstellungen", icon: Cog, to: "/settings" },
  { key: "updates", label: "Updates", icon: Bell, to: "/cs-updates" },
];
const CS_UPDATES_SEEN_KEY = "cs-updates:last-seen-id:v1";

export default function CsUpdatesPage({ useExternalDesktopSidebarShell = false }) {
  const isElectronRuntime = typeof window !== "undefined" && Boolean(window.electronAPI);
  const desktopRuntime = isElectronRuntime && Boolean(window.electronAPI?.localStore);
  const useDesktopSidebarShell = true;
  const renderLocalDesktopSidebar = useDesktopSidebarShell && !useExternalDesktopSidebarShell;
  const location = useLocation();
  const navigate = useNavigate();
  const [syncNotifications, setSyncNotifications] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const preferredOpenItemId = useMemo(
    () => String(new URLSearchParams(location.search).get("item") || "").trim(),
    [location.search],
  );
  const handleLatestVisible = useCallback((item) => {
    const latestId = String(item?.id || "").trim();
    if (!latestId || typeof window === "undefined") {
      return;
    }
    try {
      localStorage.setItem(CS_UPDATES_SEEN_KEY, latestId);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.localStore?.listNotifications) {
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
          console.warn("Failed to load sidebar notifications", error);
          setSyncNotifications([]);
          setUnreadNotificationCount(0);
        }
      }
    };

    void loadNotifications();
    const intervalId = window.setInterval(() => void loadNotifications(), 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

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

  const updatesContent = (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-4 lg:py-6">
        <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Portfolio Tracking
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              CS Updates
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Live Patchnotes und KI-Einschaetzung.
            </p>
          </div>
          <div className={`flex items-center gap-2 ${useDesktopSidebarShell ? "lg:hidden" : ""}`}>
            <ThemeToggle />
            <UserMenu />
            <Button asChild variant="outline" size="icon" className="sm:hidden">
              <Link to="/" aria-label="Zurueck zum Portfolio">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="hidden sm:inline-flex">
              <Link to="/">Zurueck zum Portfolio</Link>
            </Button>
          </div>
        </header>

        <CsUpdatesFeed preferredOpenItemId={preferredOpenItemId} onLatestVisible={handleLatestVisible} />
      </div>
    </div>
  );

  return (
    <div
      className={`${desktopRuntime ? "min-h-full" : "min-h-screen"} ${
        renderLocalDesktopSidebar ? "lg:h-full lg:min-h-0 lg:overflow-hidden" : ""
      } bg-background px-3.5 pb-[calc(8.5rem+env(safe-area-inset-bottom))] pt-[max(0.35rem,env(safe-area-inset-top))] font-sans text-foreground sm:p-6 md:p-8 md:pb-0 lg:p-0`}
    >
      {renderLocalDesktopSidebar ? (
        <div className="w-full lg:grid lg:min-h-0 lg:h-full lg:grid-cols-[92px_minmax(0,1fr)]">
          <aside className="hidden lg:flex lg:justify-center lg:pt-2">
            <div className="tr-desktop-rail h-[98vh] w-[92px] overflow-hidden rounded-2xl">
              <div className="flex h-full flex-col items-center py-4">
                <nav className="flex w-full flex-col items-center gap-2 px-2">
                  {DESKTOP_SIDEBAR_ITEMS
                    .filter((item) => !item.desktopOnly || desktopRuntime)
                    .map((item) => {
                      const Icon = item.icon;
                      const isActive =
                        item.key === "updates"
                          ? location.pathname === "/cs-updates"
                          : item.key === "settings"
                            ? location.pathname === "/settings"
                            : location.pathname === "/" &&
                              new URLSearchParams(location.search).get("tab") === item.key;
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
                        {unreadNotificationCount > 0 ? (
                          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                            {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                          </span>
                        ) : null}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="end" className="w-80">
                      <DropdownMenuLabel>Benachrichtigungen</DropdownMenuLabel>
                      <DropdownMenuSeparator />
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
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <UserMenu menuSide="right" menuAlign="end" menuSideOffset={8} />
                </div>
              </div>
            </div>
          </aside>

          <div className="w-full min-w-0 lg:min-h-0 lg:overflow-y-auto lg:px-6 xl:px-8">
            {updatesContent}
          </div>
        </div>
      ) : (
        updatesContent
      )}
    </div>
  );
}

