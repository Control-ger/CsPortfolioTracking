import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Clock3, ExternalLink, Radio, RefreshCw, Sparkles } from "lucide-react";

import { useCsUpdatesFeed } from "@/hooks/useCsUpdatesFeed";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const TWENTY_FOUR_HOURS_IN_MS = 24 * 60 * 60 * 1000;

function toTimestamp(value) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatRelativeTime(value) {
  const timestamp = toTimestamp(value);
  if (timestamp === null) {
    return "unbekannt";
  }

  const diffMs = Date.now() - timestamp;
  const absMinutes = Math.max(1, Math.round(Math.abs(diffMs) / 60000));

  if (absMinutes < 60) {
    return `vor ${absMinutes}m`;
  }

  const absHours = Math.max(1, Math.round(absMinutes / 60));
  if (absHours < 24) {
    return `vor ${absHours}h`;
  }

  const absDays = Math.max(1, Math.round(absHours / 24));
  return `vor ${absDays}d`;
}

function formatDateTime(value) {
  const timestamp = toTimestamp(value);
  if (timestamp === null) {
    return "unbekannt";
  }

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function getSeverityClass(severity) {
  switch (severity) {
    case "critical":
      return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300";
    case "warning":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "notice":
      return "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300";
    default:
      return "border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300";
  }
}

function getFeedCardClass(isFresh, isOpen, severity) {
  return cn(
    "rounded-xl border transition-all duration-200",
    isFresh ? "border-emerald-500/40 bg-emerald-500/5 shadow-sm" : "border-border bg-background",
    isOpen ? "ring-1 ring-primary/20" : "",
    severity === "critical" ? "shadow-[0_0_0_1px_rgba(239,68,68,0.06)]" : "",
  );
}

function LoadingState() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((index) => (
        <div key={index} className="animate-pulse rounded-xl border bg-muted/20 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <div className="h-3 w-28 rounded bg-muted" />
              <div className="h-5 w-full max-w-104 rounded bg-muted" />
              <div className="h-4 w-5/6 rounded bg-muted" />
            </div>
            <div className="h-8 w-8 rounded bg-muted" />
          </div>
          <div className="mt-4 h-14 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
      <div className="mb-2 text-base font-semibold text-foreground">Noch keine CS-Updates verfuegbar</div>
      Sobald neue Meldungen importiert sind, erscheinen sie hier als Live-Feed.
    </div>
  );
}

function ErrorState({ message, onRetry, hasItems }) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        hasItems ? "border-amber-500/30 bg-amber-500/10" : "border-destructive/30 bg-destructive/10",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-foreground">CS Updates konnten nicht geladen werden</p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Erneut laden
        </Button>
      </div>
    </div>
  );
}

function FeedItem({ item, isOpen, isFresh, onToggle, compact }) {
  const severityClass = getSeverityClass(item.severity);

  return (
    <article className={getFeedCardClass(isFresh, isOpen, item.severity)}>
      <button
        type="button"
        className={cn("w-full text-left", compact ? "p-3" : "p-4")}
        onClick={() => onToggle(item.id)}
        aria-expanded={isOpen}
      >
        <div className={cn("flex items-start", compact ? "gap-2" : "gap-3")}>
          <div
            className={cn(
              "mt-1 flex shrink-0 items-center justify-center rounded-full border",
              compact ? "h-7 w-7" : "h-9 w-9",
              isFresh
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {isFresh ? (
              <Sparkles className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
            ) : (
              <Clock3 className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-sm sm:text-base")}>
                    {item.title}
                  </h3>
                  {isFresh ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    >
                      Neu
                    </Badge>
                  ) : null}
                  {item.isBreaking ? (
                    <Badge
                      variant="outline"
                      className="border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
                    >
                      Breaking
                    </Badge>
                  ) : null}
                </div>
                <p className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm")}>
                  {item.summary}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline" className={severityClass}>
                  {item.severity || "info"}
                </Badge>
                <Badge variant="outline" className="text-muted-foreground">
                  {formatRelativeTime(item.publishedAt)}
                </Badge>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    isOpen ? "rotate-180" : "",
                  )}
                />
              </div>
            </div>

            <div className={cn("flex flex-wrap items-center gap-2 text-xs text-muted-foreground", compact ? "text-[10px]" : "")}>
              <span>{formatDateTime(item.publishedAt)}</span>
              <span>·</span>
              <span>{item.sourceLabel}</span>
              {!compact && Array.isArray(item.tags) && item.tags.length > 0 ? (
                <>
                  <span>·</span>
                  <span>{item.tags.join(" · ")}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </button>

      {isOpen ? (
        <div className={cn("border-t border-border/70", compact ? "px-3 pb-3 pt-2" : "px-4 pb-4 pt-3")}>
          <div className="space-y-3">
            <p className={cn("leading-6 text-muted-foreground", compact ? "text-xs" : "text-sm")}>
              {item.details}
            </p>

            {Array.isArray(item.highlights) && item.highlights.length > 0 ? (
              <ul className="space-y-2">
                {item.highlights.map((highlight) => (
                  <li key={highlight} className="flex gap-2 text-sm text-foreground">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {Array.isArray(item.tags)
                ? item.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px] uppercase tracking-wide">
                      {tag}
                    </Badge>
                  ))
                : null}

              {item.url ? (
                <Button asChild variant="outline" size="sm" className="ml-auto">
                  <a href={item.url} target="_blank" rel="noreferrer">
                    Mehr Infos
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function CsUpdatesFeed({ compact = false, maxVisibleItems = compact ? 3 : Number.POSITIVE_INFINITY } = {}) {
  const { items, meta, latestItem, newestFreshItem, isLoading, isRefreshing, error, refresh } = useCsUpdatesFeed();
  const [openItemId, setOpenItemId] = useState(null);
  const visibleItems = useMemo(
    () => items.slice(0, Math.max(1, maxVisibleItems || items.length)),
    [items, maxVisibleItems],
  );

  const latestFreshItemId = newestFreshItem?.id || null;
  const feedHasFreshLatest = latestFreshItemId !== null;

  const lastUpdateLabel = useMemo(() => {
    if (!latestItem?.publishedAt) {
      return "unbekannt";
    }

    return `${formatRelativeTime(latestItem.publishedAt)} · ${formatDateTime(latestItem.publishedAt)}`;
  }, [latestItem]);

  useEffect(() => {
    const defaultOpenId = compact ? null : latestFreshItemId || latestItem?.id || null;

    setOpenItemId((currentOpenId) => {
      if (compact) {
        return currentOpenId && visibleItems.some((item) => item.id === currentOpenId) ? currentOpenId : defaultOpenId;
      }

      if (currentOpenId && visibleItems.some((item) => item.id === currentOpenId)) {
        return currentOpenId;
      }

      return defaultOpenId;
    });
  }, [compact, latestFreshItemId, latestItem, visibleItems]);

  const hasItems = items.length > 0;

  return (
    <Card className={cn("border-border/70 shadow-sm", compact ? "shadow-none" : "")}>
      <CardHeader className={cn("space-y-3", compact ? "pb-3" : "")}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn("gap-1.5", compact ? "px-2 py-0.5 text-[10px]" : "")}>
                <Radio className={cn("text-emerald-500", compact ? "h-2.5 w-2.5" : "h-3 w-3")} />
                Live Feed
              </Badge>
              {meta.sourceMode && !compact ? (
                <Badge variant="outline" className="capitalize">
                  {meta.sourceMode}
                </Badge>
              ) : null}
              {meta.isStale ? (
                <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                  Veraltet
                </Badge>
              ) : (
                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  Aktuell
                </Badge>
              )}
            </div>
            <CardTitle className={compact ? "text-lg sm:text-xl" : "text-xl sm:text-2xl"}>CS Updates Feed</CardTitle>
            {!compact ? (
              <CardDescription>
                Die letzten Counter-Strike-Updates im Fullscreen-View mit Details zum Aufklappen.
              </CardDescription>
            ) : null}
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading || isRefreshing}>
              <RefreshCw className={cn("mr-2 h-4 w-4", isRefreshing ? "animate-spin" : "")} />
              {isRefreshing ? "Aktualisiere..." : "Aktualisieren"}
            </Button>
            <div className={cn("flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:justify-end", compact ? "text-[10px]" : "")}>
              <span className="inline-flex items-center gap-1">
                <Clock3 className="h-3.5 w-3.5" />
                Letztes Update: {lastUpdateLabel}
              </span>
              {!compact && meta.lastRefreshAt ? <span>· Feed geladen</span> : null}
            </div>
          </div>
        </div>

        {!compact && feedHasFreshLatest && newestFreshItem ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-500" />
              <span className="font-semibold text-foreground">Neueste Meldung</span>
              <Badge variant="outline" className="border-emerald-500/30 bg-background/70 text-emerald-700 dark:text-emerald-300">
                {formatRelativeTime(newestFreshItem.publishedAt)}
              </Badge>
              <span className="text-muted-foreground">{newestFreshItem.title}</span>
            </div>
          </div>
        ) : null}
      </CardHeader>

      <CardContent>
        {isLoading ? <LoadingState /> : null}

        {!isLoading && error ? <ErrorState message={error} onRetry={refresh} hasItems={hasItems} /> : null}

        {!isLoading && !hasItems && !error ? <EmptyState /> : null}

        {!isLoading && hasItems ? (
          compact ? (
            <ScrollArea className="h-72 pr-3 sm:h-80">
              <div className="space-y-2">
                {visibleItems.map((item) => {
                  const itemTimestamp = toTimestamp(item.publishedAt);
                  const isFresh = itemTimestamp !== null && Date.now() - itemTimestamp <= TWENTY_FOUR_HOURS_IN_MS;
                  const isOpen = openItemId === item.id;

                  return (
                    <FeedItem
                      key={item.id}
                      item={item}
                      isOpen={isOpen}
                      isFresh={isFresh}
                      onToggle={(itemId) => setOpenItemId((currentOpenId) => (currentOpenId === itemId ? null : itemId))}
                      compact
                    />
                  );
                })}
              </div>
            </ScrollArea>
          ) : (
            <div className="space-y-3">
              {visibleItems.map((item) => {
                const itemTimestamp = toTimestamp(item.publishedAt);
                const isFresh = itemTimestamp !== null && Date.now() - itemTimestamp <= TWENTY_FOUR_HOURS_IN_MS;
                const isOpen = openItemId === item.id;

                return (
                  <FeedItem
                    key={item.id}
                    item={item}
                    isOpen={isOpen}
                    isFresh={isFresh}
                    onToggle={(itemId) => setOpenItemId((currentOpenId) => (currentOpenId === itemId ? null : itemId))}
                    compact={false}
                  />
                );
              })}
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

