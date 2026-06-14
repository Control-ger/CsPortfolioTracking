import { useEffect, useState } from "react";
import { AlertTriangle, Bell, Check, CheckCheck, Cog, Eye, FolderCog, LayoutGrid, Newspaper, Package, Search } from "lucide-react";
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
  { key: "overview", label: "Uebersicht", icon: LayoutGrid, to: "/" },
  { key: "inventory", label: "Inventar", icon: Package, to: "/inventory" },
  { key: "watchlist", label: "Watchlist", icon: Eye, to: "/watchlist" },
  { key: "search", label: "Suche", icon: Search, to: "/search" },
  { key: "management", label: "Verwaltung", icon: FolderCog, to: "/?tab=management", desktopOnly: true },
  { key: "settings", label: "Einstellungen", icon: Cog, to: "/settings" },
  { key: "updates", label: "Updates", icon: Newspaper, to: "/cs-updates" },
];

function normalizeVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v/i, "");
}

function compareSemver(left, right) {
  const leftParts = normalizeVersion(left).split(".").map((part) => Number(part || 0));
  const rightParts = normalizeVersion(right).split(".").map((part) => Number(part || 0));
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightPart = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

function isStaleAppUpdateEntry(entry, installedVersion) {
  const category = String(entry?.category || "").trim().toLowerCase();
  if (category !== "app_update") {
    return false;
  }

  const payloadVersion = normalizeVersion(entry?.payload?.version);
  const currentVersion = normalizeVersion(installedVersion);
  if (!payloadVersion || !currentVersion) {
    return false;
  }

  return compareSemver(payloadVersion, currentVersion) <= 0;
}

function isErrorNotification(entry) {
  const category = String(entry?.category || "").trim().toLowerCase();
  if (category.includes("error") || category.includes("fehler")) {
    return true;
  }
  const payload = entry?.payload && typeof entry.payload === "object" ? entry.payload : {};
  return String(payload?.state || "").trim().toLowerCase() === "error";
}

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
        const installedVersion = window.electronAPI?.updater?.getVersion
          ? await window.electronAPI.updater.getVersion()
          : "";
        const notifications = await window.electronAPI.localStore.listNotifications(userId, { limit: 20 });
        if (cancelled) {
          return;
        }
        const rows = Array.isArray(notifications) ? notifications : [];
        const staleAppUpdates = rows.filter((entry) => isStaleAppUpdateEntry(entry, installedVersion));
        if (staleAppUpdates.length > 0 && window.electronAPI?.localStore?.markNotificationRead) {
          await Promise.allSettled(
            staleAppUpdates
              .filter((entry) => entry?.unread && entry?.id)
              .map((entry) => window.electronAPI.localStore.markNotificationRead(entry.id)),
          );
        }

        const visibleRows = rows.filter((entry) => !isStaleAppUpdateEntry(entry, installedVersion));
        setSyncNotifications(visibleRows);
        setUnreadNotificationCount(visibleRows.filter((entry) => entry?.unread).length);
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

  const markEntryReadLocally = (entryId) => {
    setSyncNotifications((current) =>
      current.map((item) => (item.id === entryId ? { ...item, unread: false } : item)),
    );
  };

  // Mark a single notification as read WITHOUT triggering its action/navigation,
  // so the user can clear the unread badge without being taken elsewhere.
  const handleMarkNotificationRead = async (event, entry) => {
    event.stopPropagation();
    if (!entry?.unread) {
      return;
    }
    if (window.electronAPI?.localStore?.markNotificationRead && entry?.id) {
      await window.electronAPI.localStore.markNotificationRead(entry.id);
    }
    markEntryReadLocally(entry.id);
    setUnreadNotificationCount((current) => Math.max(0, current - 1));
  };

  const handleMarkAllNotificationsRead = async () => {
    try {
      const user = await getCurrentUser();
      const userId = resolveDesktopLocalUserId(user, 1);
      if (window.electronAPI?.localStore?.markAllNotificationsRead) {
        await window.electronAPI.localStore.markAllNotificationsRead(userId);
      }
    } catch (error) {
      console.warn("Failed to mark all notifications read", error);
    }
    setSyncNotifications((current) => current.map((item) => ({ ...item, unread: false })));
    setUnreadNotificationCount(0);
  };

  const handleNotificationClick = async (entry) => {
    const wasUnread = Boolean(entry?.unread);
    if (window.electronAPI?.localStore?.markNotificationRead && entry?.id) {
      await window.electronAPI.localStore.markNotificationRead(entry.id);
    }

    markEntryReadLocally(entry.id);
    if (wasUnread) {
      setUnreadNotificationCount((current) => Math.max(0, current - 1));
    }

    const category = String(entry?.category || "").trim().toLowerCase();
    if (category === "app_update") {
      const payload = entry?.payload && typeof entry.payload === "object" ? entry.payload : {};
      const state = String(payload?.state || "").trim().toLowerCase();
      const version = String(payload?.version || "").trim();
      const versionLabel = version ? `v${version}` : "Das Update";
      const runUpdateDownload = async () => {
        if (!window.electronAPI?.updater?.download) {
          window.alert(`${versionLabel} ist verfuegbar.`);
          return;
        }
        const result = await window.electronAPI.updater.download();
        if (!result || result.ok !== false) {
          return;
        }
        if (result.reason === "no-update-info") {
          window.alert(
            `${versionLabel}: Updater-Metadaten sind noch nicht bereit. Bitte in ein paar Sekunden erneut versuchen.`,
          );
          return;
        }
        if (result.reason === "not-packaged") {
          window.alert("Updates sind nur in der installierten Desktop-App verfuegbar.");
          return;
        }
        window.alert(String(result.error || "Update-Download konnte nicht gestartet werden."));
      };

      if (state === "downloaded") {
        const shouldInstallNow = window.confirm(
          `${versionLabel} wurde heruntergeladen. Jetzt neu starten und installieren?`,
        );
        if (shouldInstallNow && window.electronAPI?.updater?.install) {
          await window.electronAPI.updater.install();
        }
        return;
      }

      if (state === "available") {
        await runUpdateDownload();
        return;
      }

      if (state === "downloading") {
        await runUpdateDownload();
        return;
      }

      if (state === "error") {
        window.alert(String(entry?.message || "Update-Status konnte nicht geladen werden."));
      }
      return;
    }

    if (category === "steam_sync") {
      navigate("/?tab=management", { replace: true });
      return;
    }

    if (category === "cs_update" || category === "cs_updates") {
      navigate("/cs-updates", { replace: true });
    }
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
              <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                <DropdownMenuLabel className="p-0">System-Benachrichtigungen</DropdownMenuLabel>
                {desktopRuntime && unreadNotificationCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => void handleMarkAllNotificationsRead()}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Alle gelesen
                  </button>
                ) : null}
              </div>
              <DropdownMenuSeparator />
              {desktopRuntime ? (
                <>
                  <div className="max-h-72 space-y-1 overflow-y-auto">
                    {syncNotifications.length > 0 ? (
                      syncNotifications.slice(0, 8).map((entry) => {
                        const isError = isErrorNotification(entry);
                        const isUnread = Boolean(entry?.unread);
                        return (
                          <div
                            key={entry.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => void handleNotificationClick(entry)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                void handleNotificationClick(entry);
                              }
                            }}
                            className={`group flex w-full cursor-pointer items-start gap-2 rounded-md border p-2 text-left text-xs transition-colors hover:bg-accent ${
                              isError
                                ? "border-destructive/50 bg-destructive/5"
                                : isUnread
                                  ? "border-primary/30 bg-primary/5"
                                  : "border-transparent opacity-70"
                            }`}
                          >
                            <span className="mt-0.5 shrink-0">
                              {isError ? (
                                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                              ) : isUnread ? (
                                <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                              ) : (
                                <span className="inline-block h-2 w-2" />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className={`font-semibold ${isError ? "text-destructive" : "text-foreground"}`}>
                                {entry.title || "Hinweis"}
                              </p>
                              <p className="mt-1 line-clamp-2 text-muted-foreground">{entry.message || ""}</p>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {entry.createdAt ? new Date(entry.createdAt).toLocaleString("de-DE") : ""}
                              </p>
                            </div>
                            {isUnread ? (
                              <button
                                type="button"
                                onClick={(event) => void handleMarkNotificationRead(event, entry)}
                                title="Als gelesen markieren"
                                aria-label="Als gelesen markieren"
                                className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </div>
                        );
                      })
                    ) : (
                      <p className="p-2 text-xs text-muted-foreground">Keine Benachrichtigungen.</p>
                    )}
                  </div>
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
