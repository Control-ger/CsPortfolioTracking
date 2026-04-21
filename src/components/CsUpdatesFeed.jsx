import { useMemo, useState } from "react";
import { AlertCircle, Clock3, ExternalLink, Radio, RefreshCw, Sparkles } from "lucide-react";

import { useCsUpdatesFeed } from "@/hooks/useCsUpdatesFeed";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const CLOSED_ITEM_SENTINEL = "__closed__";

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

function getFeedItemClass(isFresh, isOpen, severity) {
  return cn(
    "overflow-hidden rounded-xl border bg-card text-card-foreground transition-all duration-200",
    isFresh ? "border-emerald-500/40 bg-emerald-500/5" : "border-border",
    isOpen ? "ring-1 ring-primary/20" : "",
    severity === "critical" ? "shadow-[0_0_0_1px_rgba(239,68,68,0.06)]" : "",
  );
}

function LoadingState() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((index) => (
        <Card key={index} className="rounded-xl border-border/70 shadow-none">
          <CardContent className="space-y-4 p-4">
            <div className="flex items-start gap-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-5 w-full max-w-96" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            </div>
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <Alert className="border-dashed bg-muted/20">
      <AlertTitle>Noch keine CS-Updates verfuegbar</AlertTitle>
      <AlertDescription>Sobald neue Meldungen importiert sind, erscheinen sie hier als Live-Feed.</AlertDescription>
    </Alert>
  );
}

function ErrorState({ message, onRetry, hasItems }) {
  return (
    <Alert
      variant={hasItems ? "default" : "destructive"}
      className={cn(hasItems ? "border-amber-500/30 bg-amber-500/10 text-foreground" : "")}
    >
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>CS Updates konnten nicht geladen werden</AlertTitle>
      <AlertDescription className="space-y-3">
        <p className="text-muted-foreground">{message}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Erneut laden
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function FeedItem({ item, isOpen, isFresh, compact }) {
  const severityClass = getSeverityClass(item.severity);

  return (
    <AccordionItem value={String(item.id)} className={cn("border-0", getFeedItemClass(isFresh, isOpen, item.severity))}>
      <AccordionTrigger className={cn("items-start px-3 text-left sm:px-4", compact ? "py-3" : "py-4")}>
        <div className={cn("flex w-full items-start", compact ? "gap-2" : "gap-3")}>
          <div
            className={cn(
              "mt-1 flex shrink-0 items-center justify-center rounded-full border",
              compact ? "h-7 w-7" : "h-9 w-9",
              isFresh
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {isFresh ? <Sparkles className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} /> : <Clock3 className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />}
          </div>

          <div className="min-w-0 flex-1 space-y-2 pr-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-sm sm:text-base")}>{item.title}</h3>
                  {isFresh ? (
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                      Neu
                    </Badge>
                  ) : null}
                  {item.isBreaking ? (
                    <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300">
                      Breaking
                    </Badge>
                  ) : null}
                </div>
                <p className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm")}>{item.summary}</p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline" className={severityClass}>
                  {item.severity || "info"}
                </Badge>
                <Badge variant="outline" className="text-muted-foreground">
                  {formatRelativeTime(item.publishedAt)}
                </Badge>
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
      </AccordionTrigger>

      <AccordionContent className={cn(compact ? "px-3" : "px-4")}>
        <Separator className="mb-3" />
        <div className="space-y-3">
          <p className={cn("leading-6 text-muted-foreground", compact ? "text-xs" : "text-sm")}>{item.details}</p>

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
      </AccordionContent>
    </AccordionItem>
  );
}

export function CsUpdatesFeed({ compact = false, maxVisibleItems = compact ? 3 : Number.POSITIVE_INFINITY } = {}) {
  const {
    items,
    meta,
    latestItem,
    newestFreshItem,
    freshItemIds,
    isLoading,
    isRefreshing,
    error,
    refresh,
  } = useCsUpdatesFeed();
  const [userOpenItemId, setUserOpenItemId] = useState(null);
  const visibleItems = useMemo(
    () => items.slice(0, Math.max(1, maxVisibleItems || items.length)),
    [items, maxVisibleItems],
  );

  const visibleItemIds = useMemo(() => new Set(visibleItems.map((item) => String(item.id))), [visibleItems]);
  const freshItemIdSet = useMemo(() => new Set((freshItemIds || []).map((id) => String(id))), [freshItemIds]);

  const latestFreshItemId = newestFreshItem?.id ? String(newestFreshItem.id) : null;
  const feedHasFreshLatest = latestFreshItemId !== null;
  const defaultOpenId = compact ? null : latestFreshItemId || (latestItem?.id ? String(latestItem.id) : null);

  const openItemId = useMemo(() => {
    if (userOpenItemId === CLOSED_ITEM_SENTINEL) {
      return null;
    }

    if (userOpenItemId && visibleItemIds.has(userOpenItemId)) {
      return userOpenItemId;
    }

    if (defaultOpenId && visibleItemIds.has(defaultOpenId)) {
      return defaultOpenId;
    }

    return null;
  }, [defaultOpenId, userOpenItemId, visibleItemIds]);

  const lastUpdateLabel = useMemo(() => {
    if (!latestItem?.publishedAt) {
      return "unbekannt";
    }

    return `${formatRelativeTime(latestItem.publishedAt)} · ${formatDateTime(latestItem.publishedAt)}`;
  }, [latestItem]);

  const hasItems = items.length > 0;

  const feedItems = (
    <Accordion
      type="single"
      collapsible
      value={openItemId || undefined}
      onValueChange={(value) => setUserOpenItemId(value || CLOSED_ITEM_SENTINEL)}
      className="space-y-3"
    >
      {visibleItems.map((item) => {
        const itemId = String(item.id);
        const isFresh = freshItemIdSet.has(itemId);

        return <FeedItem key={itemId} item={item} isOpen={openItemId === itemId} isFresh={isFresh} compact={compact} />;
      })}
    </Accordion>
  );

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
          <Alert className="border-emerald-500/30 bg-emerald-500/10">
            <Sparkles className="h-4 w-4 text-emerald-500" />
            <AlertTitle className="flex flex-wrap items-center gap-2">
              Neueste Meldung
              <Badge variant="outline" className="border-emerald-500/30 bg-background/70 text-emerald-700 dark:text-emerald-300">
                {formatRelativeTime(newestFreshItem.publishedAt)}
              </Badge>
            </AlertTitle>
            <AlertDescription className="text-muted-foreground">{newestFreshItem.title}</AlertDescription>
          </Alert>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? <LoadingState /> : null}
        {!isLoading && error ? <ErrorState message={error} onRetry={refresh} hasItems={hasItems} /> : null}
        {!isLoading && !hasItems && !error ? <EmptyState /> : null}

        {!isLoading && hasItems ? (
          compact ? (
            <ScrollArea className="h-72 pr-3 sm:h-80">{feedItems}</ScrollArea>
          ) : (
            feedItems
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

