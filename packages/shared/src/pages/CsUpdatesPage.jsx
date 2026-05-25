import { useCallback, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, Cog, Eye, FolderCog, LayoutGrid, Package } from "lucide-react";

import { CsUpdatesFeed } from "@shared/components/CsUpdatesFeed";
import { ThemeToggle } from "@shared/components/ThemeToggle";
import { UserMenu } from "@shared/components/UserMenu";
import { Button } from "@shared/components/ui/button";

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

