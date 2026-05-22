import { useMemo, useState } from "react";
import { AlertCircle, Bot, Clock3, ExternalLink, RefreshCw } from "lucide-react";

import { useCsUpdatesFeed } from "@shared/hooks/useCsUpdatesFeed";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@shared/components/ui/accordion";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { ScrollArea } from "@shared/components/ui/scroll-area";
import { Skeleton } from "@shared/components/ui/skeleton";
import { cn } from "@shared/lib/utils";

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

function deriveMarketImpact(item) {
  const aiStatus = String(item?.aiRatingStatus || "").toLowerCase();
  const aiImpactLevel = String(item?.aiImpactLevel || "").toLowerCase();
  const aiAction = String(item?.aiRecommendedAction || "").trim();

  if (aiStatus === "pending") {
    return {
      level: "pending",
      label: "KI laeuft",
      action: "Eilmeldung lesen, Bewertung folgt.",
      badgeClass: "border-sky-500/25 bg-sky-500/8 text-sky-300",
      itemClass: "border-border bg-card",
      panelClass: "border-sky-500/20 bg-sky-500/5",
    };
  }

  if (aiStatus === "rated" && ["none", "low", "medium", "high"].includes(aiImpactLevel)) {
    const map = {
      none: {
        label: "Impact none",
        badgeClass: "border-border bg-muted/30 text-muted-foreground",
        panelClass: "border-border bg-muted/20",
        action: "Kein akuter Markt-Impact.",
      },
      low: {
        label: "Impact niedrig",
        badgeClass: "border-emerald-500/20 bg-emerald-500/8 text-emerald-300",
        panelClass: "border-emerald-500/20 bg-emerald-500/5",
        action: "Beobachten.",
      },
      medium: {
        label: "Impact mittel",
        badgeClass: "border-amber-500/20 bg-amber-500/8 text-amber-300",
        panelClass: "border-amber-500/20 bg-amber-500/5",
        action: "Heute monitoren.",
      },
      high: {
        label: "Impact hoch",
        badgeClass: "border-red-500/25 bg-red-500/8 text-red-300",
        panelClass: "border-red-500/25 bg-red-500/5",
        action: "Schnell relevante Positionen pruefen.",
      },
    };

    const mapped = map[aiImpactLevel];
    return {
      level: aiImpactLevel,
      label: mapped.label,
      action: aiAction || mapped.action,
      badgeClass: mapped.badgeClass,
      itemClass: aiImpactLevel === "high" ? "border-red-500/25 bg-card" : "border-border bg-card",
      panelClass: mapped.panelClass,
    };
  }

  if (aiStatus === "failed") {
    return {
      level: "failed",
      label: "KI fehlgeschlagen",
      action: "Patchnotes manuell bewerten.",
      badgeClass: "border-rose-500/25 bg-rose-500/8 text-rose-300",
      itemClass: "border-border bg-card",
      panelClass: "border-rose-500/25 bg-rose-500/5",
    };
  }

  return {
    level: "unrated",
    label: "KI ausstehend",
    action: "Noch keine Bewertung verfuegbar.",
    badgeClass: "border-border bg-muted/30 text-muted-foreground",
    itemClass: "border-border bg-card",
    panelClass: "border-border bg-muted/20",
  };
}

function LoadingState() {
  return (
    <div className="space-y-2.5">
      {[1, 2, 3].map((index) => (
        <div key={index} className="rounded-xl border border-border bg-card p-4">
          <div className="space-y-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
      <p className="text-sm font-semibold text-foreground">Noch keine CS-Updates verfuegbar</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Neue Meldungen erscheinen automatisch, sobald sie erkannt werden.
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry, hasItems }) {
  return (
    <div className={cn("rounded-xl border p-4", hasItems ? "border-amber-500/25 bg-amber-500/8" : "border-red-500/25 bg-red-500/8")}> 
      <div className="flex items-start gap-2">
        <AlertCircle className={cn("mt-0.5 h-4 w-4", hasItems ? "text-amber-300" : "text-red-300")} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">CS Updates konnten nicht geladen werden</p>
          <p className="mt-1 text-xs text-muted-foreground">{message}</p>
          <Button variant="outline" size="sm" onClick={onRetry} className="mt-3">
            <RefreshCw className="mr-2 h-4 w-4" />
            Erneut laden
          </Button>
        </div>
      </div>
    </div>
  );
}

function FeedItem({ item, isOpen, isFresh, compact }) {
  const impact = deriveMarketImpact(item);
  const hasAiText = Boolean(item?.aiRecommendedAction || item?.aiReasoning);
  const aiModelLabel = String(item?.aiModel || "").trim();

  return (
    <AccordionItem
      value={String(item.id)}
      className={cn(
        "rounded-xl border bg-card transition-colors",
        impact.itemClass,
        isOpen ? "ring-1 ring-primary/20" : "hover:bg-accent/20",
      )}
    >
      <AccordionTrigger className={cn("px-4 text-left hover:no-underline", compact ? "py-3" : "py-4")}> 
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-base")}>{item.title}</h3>
                {isFresh ? (
                  <Badge variant="outline" className="border-primary/25 bg-primary/8 text-primary">
                    Neu
                  </Badge>
                ) : null}
              </div>
              <p className={cn("mt-1 line-clamp-2 text-muted-foreground", compact ? "text-xs" : "text-sm")}>{item.summary}</p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Badge variant="outline" className={impact.badgeClass}>
                {impact.label}
              </Badge>
              <Badge variant="outline" className="border-border text-muted-foreground">
                {formatRelativeTime(item.publishedAt)}
              </Badge>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3.5 w-3.5" />
              {formatDateTime(item.publishedAt)}
            </span>
            <span>-</span>
            <span>{item.sourceLabel}</span>
          </div>
        </div>
      </AccordionTrigger>

      <AccordionContent className={cn("px-4", compact ? "pb-3" : "pb-4")}>
        <div className="space-y-3 border-t border-border/70 pt-3">
          {!compact && hasAiText ? (
            <div className={cn("rounded-lg border p-3", impact.panelClass)}>
              <p className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Bot className="h-3.5 w-3.5" />
                KI Signal{aiModelLabel ? ` (${aiModelLabel})` : ""}
              </p>
              {item.aiRecommendedAction ? (
                <p className="text-xs text-foreground">
                  <span className="font-semibold">Aktion:</span> {item.aiRecommendedAction}
                </p>
              ) : null}
              {item.aiReasoning ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Begruendung:</span> {item.aiReasoning}
                </p>
              ) : null}
            </div>
          ) : null}

          <p className={cn("leading-6 text-muted-foreground", compact ? "text-xs" : "text-sm")}>{item.details}</p>

          {Array.isArray(item.highlights) && item.highlights.length > 0 ? (
            <ul className="space-y-1.5">
              {item.highlights.slice(0, 4).map((highlight) => (
                <li key={highlight} className="text-sm text-foreground">
                  - {highlight}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {Array.isArray(item.tags)
              ? item.tags.slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="outline" className="border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                    {tag}
                  </Badge>
                ))
              : null}

            {item.url ? (
              <Button asChild variant="outline" size="sm" className="ml-auto">
                <a href={item.url} target="_blank" rel="noreferrer">
                  Original Update
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

export function CsUpdatesFeed({
  compact = false,
  maxVisibleItems = compact ? 3 : Number.POSITIVE_INFINITY,
  preferredOpenItemId = null,
} = {}) {
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
  const normalizedPreferredOpenItemId = String(preferredOpenItemId || "").trim();
  const defaultOpenId = compact
    ? null
    : normalizedPreferredOpenItemId || latestFreshItemId || (latestItem?.id ? String(latestItem.id) : null);

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
    return `${formatRelativeTime(latestItem.publishedAt)} - ${formatDateTime(latestItem.publishedAt)}`;
  }, [latestItem]);

  const hasItems = items.length > 0;

  const feedItems = (
    <Accordion
      type="single"
      collapsible
      value={openItemId || undefined}
      onValueChange={(value) => setUserOpenItemId(value || CLOSED_ITEM_SENTINEL)}
      className="space-y-2.5"
    >
      {visibleItems.map((item) => {
        const itemId = String(item.id);
        const isFresh = freshItemIdSet.has(itemId);

        return <FeedItem key={itemId} item={item} isOpen={openItemId === itemId} isFresh={isFresh} compact={compact} />;
      })}
    </Accordion>
  );

  return (
    <section className={cn("rounded-2xl border border-border bg-card/70", compact ? "p-3" : "p-4 sm:p-5")}>
      <div className="space-y-4">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className={cn("font-semibold text-foreground", compact ? "text-lg" : "text-xl")}>CS Updates Feed</h2>
            <p className="text-sm text-muted-foreground">Live Patchnotes mit KI-Einschaetzung.</p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="border-border text-muted-foreground">{meta.sourceMode || "backend"}</Badge>
              <Badge
                variant="outline"
                className={meta.isStale ? "border-amber-500/25 bg-amber-500/8 text-amber-300" : "border-emerald-500/25 bg-emerald-500/8 text-emerald-300"}
              >
                {meta.isStale ? "Veraltet" : "Aktuell"}
              </Badge>
              {newestFreshItem ? (
                <Badge variant="outline" className="border-border text-muted-foreground">
                  Neueste Meldung: {formatRelativeTime(newestFreshItem.publishedAt)}
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading || isRefreshing}>
              <RefreshCw className={cn("mr-2 h-4 w-4", isRefreshing ? "animate-spin" : "")} />
              {isRefreshing ? "Aktualisiere..." : "Aktualisieren"}
            </Button>
            <p className="text-xs text-muted-foreground">Letztes Update: {lastUpdateLabel}</p>
          </div>
        </header>

        {isLoading ? <LoadingState /> : null}
        {!isLoading && error ? <ErrorState message={error} onRetry={refresh} hasItems={hasItems} /> : null}
        {!isLoading && !hasItems && !error ? <EmptyState /> : null}

        {!isLoading && hasItems ? (
          compact ? (
            <ScrollArea className="h-72 pr-2 sm:h-80">{feedItems}</ScrollArea>
          ) : (
            feedItems
          )
        ) : null}
      </div>
    </section>
  );
}
