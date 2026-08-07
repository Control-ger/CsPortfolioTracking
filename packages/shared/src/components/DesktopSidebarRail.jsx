import { useEffect, useState } from "react";
import { AlertTriangle, Bell, Cog, Download, Eye, FolderCog, LayoutGrid, Newspaper, Package, Search, Trash2, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { ThemeToggle } from "@shared/components/ThemeToggle";
import { UserMenu } from "@shared/components/UserMenu";
import { getCurrentUser, resolveDesktopLocalUserId, runAppUpdateAction } from "@shared/lib";
import { IconCircleButton } from "@shared/components/ui/icon-circle-button";

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

function formatMegabytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

// "12,3 MB von 78,0 MB · 2,1 MB/s" — omits whatever electron-updater did not
// report rather than rendering "0.0 MB von 0.0 MB".
function describeDownloadProgress(progress) {
  const transferred = formatMegabytes(progress?.transferred);
  const total = formatMegabytes(progress?.total);
  const speed = formatMegabytes(progress?.bytesPerSecond);

  const parts = [];
  if (transferred && total) {
    parts.push(`${transferred} von ${total}`);
  } else if (transferred) {
    parts.push(transferred);
  }
  if (speed) {
    parts.push(`${speed}/s`);
  }
  return parts.join(" · ");
}

// The bell renders persisted rows, but download progress arrives many times a
// second — persisting it would hammer SQLite and leave an orphan row if the app
// dies mid-download. It lives as an ephemeral entry instead, rebuilt from the
// live updater status (and replayed via getLastStatus on mount).
function buildDownloadProgressEntry(progress) {
  if (!progress) {
    return null;
  }
  const rawPercent = Number(progress.percent || 0);
  const percent = Number.isFinite(rawPercent) ? Math.min(100, Math.max(0, rawPercent)) : 0;
  const versionLabel = progress.version ? `v${normalizeVersion(progress.version)}` : "Update";

  return {
    id: "__app-update-download__",
    ephemeral: true,
    percent,
    category: "app_update",
    title: `${versionLabel} wird heruntergeladen`,
    message: describeDownloadProgress(progress),
    payload: { state: "downloading", version: progress.version || null },
  };
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
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [notificationsRefreshToken, setNotificationsRefreshToken] = useState(0);
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
        if (staleAppUpdates.length > 0 && window.electronAPI?.localStore?.deleteNotification) {
          await Promise.allSettled(
            staleAppUpdates
              .filter((entry) => entry?.id)
              .map((entry) => window.electronAPI.localStore.deleteNotification(entry.id)),
          );
        }

        // The bell is an action inbox: only outstanding (unread) items are
        // shown. Reading/acting deletes them, so anything still here is live.
        const visibleRows = rows.filter(
          (entry) => entry?.unread && !isStaleAppUpdateEntry(entry, installedVersion),
        );
        setSyncNotifications(visibleRows);
        setUnreadNotificationCount(visibleRows.length);
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
  }, [desktopRuntime, notificationsRefreshToken]);

  // Live download progress for the ephemeral bell entry. The 30s poll above is
  // far too coarse for a progress bar, so it is driven by the updater push.
  useEffect(() => {
    if (!desktopRuntime || !window.electronAPI?.updater?.onStatus) {
      return undefined;
    }

    let cancelled = false;
    let receivedLiveStatus = false;

    const applyStatus = (payload) => {
      if (cancelled || !payload || typeof payload !== "object") {
        return;
      }
      if (String(payload.state || "") === "downloading") {
        setDownloadProgress(payload);
        return;
      }
      // Download ended (downloaded / error / anything else): drop the transient
      // entry and pull the persisted row it hands over to right away, instead
      // of leaving the bell stale for up to 30s.
      setDownloadProgress((current) => {
        if (current) {
          setNotificationsRefreshToken((token) => token + 1);
        }
        return null;
      });
    };

    const unsubscribe = window.electronAPI.updater.onStatus((payload) => {
      receivedLiveStatus = true;
      applyStatus(payload);
    });

    // A download already running when the rail mounts must still show up.
    if (window.electronAPI.updater.getLastStatus) {
      void window.electronAPI.updater
        .getLastStatus()
        .then((payload) => {
          if (cancelled || receivedLiveStatus || !payload) {
            return;
          }
          applyStatus(payload);
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [desktopRuntime]);

  const downloadProgressEntry = buildDownloadProgressEntry(downloadProgress);
  const visibleNotifications = downloadProgressEntry
    ? [downloadProgressEntry, ...syncNotifications]
    : syncNotifications;

  const removeEntryLocally = (entryId) => {
    setSyncNotifications((current) => current.filter((item) => item.id !== entryId));
    setUnreadNotificationCount((current) => Math.max(0, current - 1));
  };

  // Dismiss a single notification WITHOUT triggering its action/navigation,
  // so the user can clear it without being taken elsewhere. Read = delete.
  const handleDismissNotification = async (event, entry) => {
    event.stopPropagation();
    if (window.electronAPI?.localStore?.deleteNotification && entry?.id) {
      await window.electronAPI.localStore.deleteNotification(entry.id);
    }
    removeEntryLocally(entry.id);
  };

  const handleDeleteAllNotifications = async () => {
    try {
      const user = await getCurrentUser();
      const userId = resolveDesktopLocalUserId(user, 1);
      if (window.electronAPI?.localStore?.deleteAllNotifications) {
        await window.electronAPI.localStore.deleteAllNotifications(userId);
      }
    } catch (error) {
      console.warn("Failed to delete all notifications", error);
    }
    setSyncNotifications([]);
    setUnreadNotificationCount(0);
  };

  const handleNotificationClick = async (entry) => {
    // Acting on a notification consumes it: delete rather than mark read.
    if (window.electronAPI?.localStore?.deleteNotification && entry?.id) {
      await window.electronAPI.localStore.deleteNotification(entry.id);
    }
    removeEntryLocally(entry.id);

    const category = String(entry?.category || "").trim().toLowerCase();
    if (category === "app_update") {
      const payload = entry?.payload && typeof entry.payload === "object" ? entry.payload : {};
      await runAppUpdateAction({ message: entry?.message, ...payload });
      return;
    }

    if (category === "action_match") {
      navigate("/?tab=management&section=matching", { replace: true });
      return;
    }

    if (category === "action_price") {
      navigate("/?tab=management&section=prices", { replace: true });
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconCircleButton count={desktopRuntime && unreadNotificationCount > 0 ? unreadNotificationCount : 0}>
                <Bell className="h-5 w-5" />
              </IconCircleButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-80">
              <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                <DropdownMenuLabel className="p-0">System-Benachrichtigungen</DropdownMenuLabel>
                {desktopRuntime && unreadNotificationCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => void handleDeleteAllNotifications()}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Alle löschen
                  </button>
                ) : null}
              </div>
              <DropdownMenuSeparator />
              {desktopRuntime ? (
                <>
                  <div className="max-h-72 space-y-1 overflow-y-auto">
                    {visibleNotifications.length > 0 ? (
                      visibleNotifications.slice(0, 8).map((entry) => {
                        const isError = isErrorNotification(entry);
                        if (entry.ephemeral) {
                          return (
                            <div
                              key={entry.id}
                              className="flex w-full items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-left text-xs"
                            >
                              <Download className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-pulse text-primary" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-2">
                                  <p className="truncate font-semibold text-foreground">{entry.title}</p>
                                  <span className="shrink-0 font-semibold tabular-nums text-primary">
                                    {Math.round(entry.percent)}%
                                  </span>
                                </div>
                                <div
                                  role="progressbar"
                                  aria-valuenow={Math.round(entry.percent)}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-label={entry.title}
                                  className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-primary/15"
                                >
                                  <div
                                    className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                                    style={{ width: `${entry.percent}%` }}
                                  />
                                </div>
                                {entry.message ? (
                                  <p className="mt-1 text-[11px] text-muted-foreground">{entry.message}</p>
                                ) : null}
                              </div>
                            </div>
                          );
                        }
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
                                : "border-primary/30 bg-primary/5"
                            }`}
                          >
                            <span className="mt-0.5 shrink-0">
                              {isError ? (
                                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                              ) : (
                                <span className="inline-block h-2 w-2 rounded-full bg-primary" />
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
                            <button
                              type="button"
                              onClick={(event) => void handleDismissNotification(event, entry)}
                              title="Entfernen"
                              aria-label="Entfernen"
                              className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
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
