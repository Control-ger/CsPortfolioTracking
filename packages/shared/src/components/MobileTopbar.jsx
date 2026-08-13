import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Cog, Eye, FolderCog, LayoutGrid, Menu, Newspaper, Package, Search } from "lucide-react";

import { NotificationBell } from "@shared/components/NotificationBell";
import { ThemeToggle } from "@shared/components/ThemeToggle";
import { UserMenu } from "@shared/components/UserMenu";

/**
 * Mobile shell chrome: a 52px topbar with a hamburger, the screen title and the
 * global search slot, plus the left drawer it opens.
 *
 * Replaces the bottom dock below `md`. The mobile design navigates through a
 * drawer, not a tab bar — six destinations do not fit a dock, and the dock's
 * profile button had to double as the settings entry.
 *
 * Rendered once by the app shell, above the routed view: the title and the
 * active nav item both derive from the route, so no screen has to own it.
 */
const NAV_ITEMS = [
  { key: "overview", label: "Dashboard", icon: LayoutGrid, to: "/" },
  { key: "inventory", label: "Inventar", icon: Package, to: "/inventory" },
  { key: "watchlist", label: "Watchlist", icon: Eye, to: "/watchlist" },
  { key: "search", label: "Suche", icon: Search, to: "/search" },
  { key: "management", label: "Verwaltung", icon: FolderCog, to: "/?tab=management", desktopOnly: true },
  { key: "settings", label: "Einstellungen", icon: Cog, to: "/settings" },
  { key: "updates", label: "Updates", icon: Newspaper, to: "/cs-updates" },
];

/** Route → screen title. The management view is a tab on `/`, not its own route. */
function resolveActiveKey(pathname, tabParam) {
  if (pathname === "/settings") return "settings";
  if (pathname === "/cs-updates") return "updates";
  if (pathname === "/inventory") return "inventory";
  if (pathname === "/watchlist") return "watchlist";
  if (pathname === "/search") return "search";
  if (pathname === "/") return tabParam === "management" ? "management" : "overview";
  return null;
}

export function MobileTopbar({ desktopRuntime = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState("");

  const activeKey = resolveActiveKey(location.pathname, searchParams.get("tab"));
  const title = NAV_ITEMS.find((item) => item.key === activeKey)?.label ?? "CS Portfolio";

  // Escape closes, and the page behind must not scroll under the overlay.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    const term = query.trim();
    setDrawerOpen(false);
    navigate(term ? `/search?q=${encodeURIComponent(term)}` : "/search");
  };

  return (
    <>
      <header className="sticky top-0 z-30 flex h-[52px] flex-none items-center gap-1.5 border-b border-border-soft bg-sidebar px-2.5 pt-[env(safe-area-inset-top)] md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Navigation öffnen"
          aria-expanded={drawerOpen}
          className="grid size-11 flex-none place-items-center text-foreground"
        >
          <Menu className="size-[19px]" strokeWidth={2} />
        </button>
        <span className="truncate text-[15.5px] font-extrabold">{title}</span>
        <form onSubmit={handleSearchSubmit} className="relative ml-auto min-w-24 max-w-[168px] flex-1">
          <Search className="pointer-events-none absolute left-[9px] top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Global suchen"
            aria-label="Global suchen"
            className="h-8 w-full rounded-[9px] border border-border bg-background pl-7 pr-2.5 text-[11.5px] text-foreground outline-none"
          />
        </form>
      </header>

      {/* absolute, not fixed: a viewport-anchored overlay slides up under the
          Electron titlebar and clips the drawer header. The shell wraps topbar
          and routed view in a `relative` box so `inset-0` means "below it". */}
      {drawerOpen ? (
        <div
          role="presentation"
          onClick={() => setDrawerOpen(false)}
          className="absolute inset-0 z-50 bg-black/50 md:hidden"
        >
          <nav
            aria-label="Hauptnavigation"
            onClick={(event) => event.stopPropagation()}
            className="flex h-full w-[250px] flex-col gap-[3px] border-r border-border bg-sidebar px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[calc(1.375rem+env(safe-area-inset-top))]"
          >
            <div className="px-2.5 pb-4 text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
              CS Portfolio Tracking
            </div>
            {NAV_ITEMS.filter((item) => !item.desktopOnly || desktopRuntime).map((item) => {
              const Icon = item.icon;
              const isActive = item.key === activeKey;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    // Closed here rather than on a route effect: navigating to
                    // the screen you are already on fires no route change, and
                    // the drawer would stay open over it.
                    setDrawerOpen(false);
                    navigate(item.to, { replace: true });
                  }}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-[13.5px] ${
                    isActive
                      ? "bg-primary font-extrabold text-primary-foreground"
                      : "font-semibold text-foreground"
                  }`}
                >
                  <Icon className="size-[18px] flex-none" strokeWidth={1.8} />
                  {item.label}
                </button>
              );
            })}
            {/* The dock carried theme, notifications and profile; the drawer
                inherits all three. The design's topbar has no room for the
                bell, and it is the app's only channel for update availability
                and sync actions — dropping it on mobile would hide them. */}
            <div className="mt-auto flex items-center gap-2 px-1 pt-4">
              <ThemeToggle />
              <NotificationBell desktopRuntime={desktopRuntime} menuSide="top" menuAlign="start" />
              <UserMenu menuSide="top" menuAlign="start" menuSideOffset={8} />
            </div>
          </nav>
        </div>
      ) : null}
    </>
  );
}
