import { useMemo, useState } from "react";
import {
  AlertCircle,
  Bot,
  Clock3,
  ExternalLink,
  Gauge,
  Radio,
  RefreshCw,
  Sparkles,
  Zap,
} from "lucide-react";

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
  const aiConfidence = String(item?.aiConfidence || "").toLowerCase();

  if (aiStatus === "pending") {
    return {
      level: "pending",
      label: "KI Rating laeuft",
      action: "Eilmeldung jetzt lesen; KI-Rating folgt gleich.",
      badgeClass: "border-cyan-500/35 bg-cyan-500/14 text-cyan-200",
      itemClass: "border-cyan-500/35 bg-gradient-to-r from-cyan-950/45 via-card to-card",
      panelClass: "border-cyan-500/35 bg-cyan-950/35",
      lineClass: "bg-cyan-400/80",
      confidence: null,
    };
  }

  if (aiStatus === "rated" && ["none", "low", "medium", "high"].includes(aiImpactLevel)) {
    const map = {
      none: {
        label: "Impact none",
        badgeClass: "border-slate-500/35 bg-slate-500/14 text-slate-200",
        itemClass: "border-border bg-card",
        panelClass: "border-slate-500/30 bg-slate-900/45",
        lineClass: "bg-slate-500/80",
        action: "Kein akuter Markt-Impact.",
      },
      low: {
        label: "Impact niedrig",
        badgeClass: "border-emerald-500/35 bg-emerald-500/14 text-emerald-200",
        itemClass: "border-emerald-500/30 bg-gradient-to-r from-emerald-950/35 via-card to-card",
        panelClass: "border-emerald-500/30 bg-emerald-950/30",
        lineClass: "bg-emerald-400/80",
        action: "Nur beobachten.",
      },
      medium: {
        label: "Impact mittel",
        badgeClass: "border-amber-500/35 bg-amber-500/14 text-amber-200",
        itemClass: "border-amber-500/35 bg-gradient-to-r from-amber-950/40 via-card to-card",
        panelClass: "border-amber-500/35 bg-amber-950/30",
        lineClass: "bg-amber-400/80",
        action: "Heute aktiv monitoren.",
      },
      high: {
        label: "Impact hoch",
        badgeClass: "border-red-500/45 bg-red-500/18 text-red-100",
        itemClass:
          "border-red-500/45 bg-gradient-to-r from-red-950/75 via-card to-amber-950/65 shadow-[0_16px_38px_rgba(127,29,29,0.36)]",
        panelClass: "border-red-500/45 bg-red-950/45",
        lineClass: "bg-red-400/85",
        action: "Sofort markt-kritische Positionen pruefen.",
      },
    };

    const mapped = map[aiImpactLevel];
    return {
      level: aiImpactLevel,
      label: mapped.label,
      action: aiAction || mapped.action,
      badgeClass: mapped.badgeClass,
      itemClass: mapped.itemClass,
      panelClass: mapped.panelClass,
      lineClass: mapped.lineClass,
      confidence: ["low", "medium", "high"].includes(aiConfidence) ? aiConfidence : null,
    };
  }

  if (aiStatus === "failed") {
    return {
      level: "failed",
      label: "KI Rating fehlgeschlagen",
      action: "Patchnotes manuell bewerten.",
      badgeClass: "border-rose-500/35 bg-rose-500/14 text-rose-200",
      itemClass: "border-rose-500/35 bg-gradient-to-r from-rose-950/35 via-card to-card",
      panelClass: "border-rose-500/35 bg-rose-950/30",
      lineClass: "bg-rose-400/80",
      confidence: null,
    };
  }

  return {
    level: "unrated",
    label: "KI Rating ausstehend",
    action: "Noch keine Bewertung verfuegbar.",
    badgeClass: "border-slate-500/35 bg-slate-500/14 text-slate-200",
    itemClass: "border-border bg-card",
    panelClass: "border-slate-500/30 bg-slate-900/45",
    lineClass: "bg-slate-500/80",
    confidence: null,
  };
}

function getSeverityBadgeClass(severity) {
  switch (severity) {
    case "critical":
      return "border-red-500/40 bg-red-500/10 text-red-300";
    case "warning":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "notice":
      return "border-sky-500/40 bg-sky-500/10 text-sky-300";
    default:
      return "border-slate-500/35 bg-slate-500/10 text-slate-300";
  }
}

function LoadingState() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((index) => (
        <div key={index} className="rounded-2xl border border-border/80 bg-card/70 p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="mt-1 h-9 w-1 rounded-full" />
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-56" />
                <Skeleton className="h-5 w-20" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-3 w-44" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-6 text-center">
      <p className="text-sm font-semibold text-foreground">Noch keine CS-Updates verfuegbar</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Sobald neue Patchnotes erkannt werden, erscheinen sie hier als Live-Radar.
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry, hasItems }) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        hasItems ? "border-amber-500/35 bg-amber-500/12" : "border-red-500/35 bg-red-500/12",
      )}
    >
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
  const severityClass = getSeverityBadgeClass(item.severity);
  const hasAiText = Boolean(item?.aiRecommendedAction || item?.aiReasoning);
  const aiModelLabel = String(item?.aiModel || "").trim();

  return (
    <AccordionItem
      value={String(item.id)}
      className={cn(
        "overflow-hidden rounded-2xl border transition-all duration-200",
        impact.itemClass,
        isOpen ? "ring-1 ring-primary/35" : "hover:border-border",
      )}
    >
      <AccordionTrigger className={cn("px-4 text-left hover:no-underline", compact ? "py-3" : "py-4")}> 
        <div className="flex w-full items-start gap-3">
          <div className="mt-0.5 flex flex-col items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", impact.lineClass)} />
            <span className={cn("w-1 rounded-full", compact ? "h-12" : "h-16", impact.lineClass, "opacity-70")} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-base")}>{item.title}</h3>
                  {isFresh ? (
                    <Badge variant="outline" className="border-emerald-500/35 bg-emerald-500/14 text-emerald-200">
                      Neu
                    </Badge>
                  ) : null}
                  {impact.level === "high" ? (
                    <Badge variant="outline" className="border-red-500/45 bg-red-500/16 text-red-100">
                      High Alert
                    </Badge>
                  ) : null}
                </div>
                <p className={cn("mt-1 line-clamp-2 text-muted-foreground", compact ? "text-xs" : "text-sm")}>{item.summary}</p>
                {!compact ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    KI Signal: <span className="text-foreground">{impact.action}</span>
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Badge variant="outline" className={impact.badgeClass}>
                  {impact.label}
                </Badge>
                <Badge variant="outline" className={severityClass}>
                  {item.severity || "info"}
                </Badge>
                <Badge variant="outline" className="border-border/70 text-muted-foreground">
                  {formatRelativeTime(item.publishedAt)}
                </Badge>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock3 className="h-3.5 w-3.5" />
                {formatDateTime(item.publishedAt)}
              </span>
              <span>•</span>
              <span>{item.sourceLabel}</span>
              {impact.confidence ? (
                <>
                  <span>•</span>
                  <span>KI Confidence: {impact.confidence}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </AccordionTrigger>

      <AccordionContent className={cn("px-4", compact ? "pb-3" : "pb-4")}>
        <div className="space-y-3 border-t border-border/70 pt-3">
          {!compact && hasAiText ? (
            <div className={cn("rounded-xl border p-3", impact.panelClass)}>
              <p className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/90">
                <Bot className="h-3.5 w-3.5" />
                KI-generierte Markt-Einschaetzung{aiModelLabel ? ` (${aiModelLabel})` : ""}
              </p>
              {item.aiRecommendedAction ? (
                <p className="text-xs text-foreground">
                  <span className="font-semibold">Aktion:</span> {item.aiRecommendedAction}
                </p>
              ) : null}
              {item.aiReasoning ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground/90">Begruendung:</span> {item.aiReasoning}
                </p>
              ) : null}
            </div>
          ) : null}

          <p className={cn("leading-6 text-muted-foreground", compact ? "text-xs" : "text-sm")}>{item.details}</p>

          {Array.isArray(item.highlights) && item.highlights.length > 0 ? (
            <div className="rounded-xl border border-border/70 bg-background/45 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Wichtige Punkte</p>
              <ul className="space-y-2">
                {item.highlights.map((highlight) => (
                  <li key={highlight} className="flex gap-2 text-sm text-foreground">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {Array.isArray(item.tags)
              ? item.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="border-border/70 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {tag}
                  </Badge>
                ))
              : null}

            {item.url ? (
              <Button asChild size="sm" className="ml-auto">
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

function buildSignalStats(items) {
  return items.reduce(
    (acc, item) => {
      const impact = deriveMarketImpact(item);
      if (impact.level === "high") {
        acc.high += 1;
      }
      if (impact.level === "medium") {
        acc.medium += 1;
      }
      if (impact.level === "pending") {
        acc.pending += 1;
      }
      if (impact.level === "failed") {
        acc.failed += 1;
      }
      return acc;
    },
    { high: 0, medium: 0, pending: 0, failed: 0 },
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

  const signalStats = useMemo(() => buildSignalStats(visibleItems), [visibleItems]);
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
    <section className={cn("relative overflow-hidden rounded-3xl border border-border/70 bg-card/70", compact ? "p-3" : "p-4 sm:p-5")}> 
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-0 h-52 w-52 rounded-full bg-cyan-500/8 blur-3xl" />
        <div className="absolute -right-20 bottom-0 h-64 w-64 rounded-full bg-amber-500/8 blur-3xl" />
      </div>

      <div className="relative z-10 space-y-4">
        <header className="rounded-2xl border border-border/75 bg-background/50 p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-cyan-500/35 bg-cyan-500/14 text-cyan-200">
                  <Radio className="mr-1.5 h-3.5 w-3.5" />
                  Live Radar
                </Badge>
                {meta.sourceMode ? (
                  <Badge variant="outline" className="capitalize">
                    {meta.sourceMode}
                  </Badge>
                ) : null}
                <Badge
                  variant="outline"
                  className={meta.isStale ? "border-amber-500/35 bg-amber-500/14 text-amber-200" : "border-emerald-500/35 bg-emerald-500/14 text-emerald-200"}
                >
                  {meta.isStale ? "Veraltet" : "Aktuell"}
                </Badge>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Market Pulse</p>
                <h2 className={cn("mt-1 font-extrabold tracking-tight text-foreground", compact ? "text-xl" : "text-2xl sm:text-3xl")}>
                  CS Update Radar
                </h2>
                {!compact ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Klare Live-Signale fuer Patchnotes, Markt-Impact und KI-Handlungsempfehlungen.
                  </p>
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
          </div>

          {!compact ? (
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
              <div className="rounded-xl border border-border/70 bg-card/80 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Eintraege</p>
                <p className="mt-1 text-xl font-bold text-foreground">{visibleItems.length}</p>
              </div>
              <div className="rounded-xl border border-red-500/35 bg-red-500/10 p-3">
                <p className="text-[11px] uppercase tracking-wide text-red-200">High Impact</p>
                <p className="mt-1 text-xl font-bold text-red-100">{signalStats.high}</p>
              </div>
              <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
                <p className="text-[11px] uppercase tracking-wide text-amber-200">Mittel</p>
                <p className="mt-1 text-xl font-bold text-amber-100">{signalStats.medium}</p>
              </div>
              <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 p-3">
                <p className="text-[11px] uppercase tracking-wide text-cyan-200">Pending</p>
                <p className="mt-1 text-xl font-bold text-cyan-100">{signalStats.pending}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-card/80 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Neueste Meldung</p>
                <p className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                  <Gauge className="h-3.5 w-3.5 text-primary" />
                  {newestFreshItem ? formatRelativeTime(newestFreshItem.publishedAt) : "-"}
                </p>
              </div>
            </div>
          ) : null}

          {!compact && newestFreshItem ? (
            <div className="mt-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3">
              <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-200">
                <Sparkles className="h-3.5 w-3.5" />
                Frisch erkannt
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">{newestFreshItem.title}</p>
            </div>
          ) : null}

          {!compact && signalStats.high > 0 ? (
            <div className="mt-3 rounded-xl border border-red-500/45 bg-gradient-to-r from-red-500/14 to-amber-500/10 p-3">
              <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-red-200">
                <Zap className="h-3.5 w-3.5" />
                High Impact aktiv
              </p>
              <p className="mt-1 text-xs text-red-100/90">
                Mindestens ein Update ist als markt-kritisch markiert. Priorisiere diese Karten im Feed.
              </p>
            </div>
          ) : null}
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
