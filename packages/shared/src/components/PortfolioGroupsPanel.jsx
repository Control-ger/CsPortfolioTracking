// DEAD CODE — pending deletion (siehe plan): not in components barrel, zero importers.
import { useState } from "react";
import { ChevronDown, ChevronUp, FolderCog } from "lucide-react";

import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/components/ui/card";

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function formatSharePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `${numeric.toFixed(1)}% Anteil`;
}

function resolveDeltaClassName(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "text-muted-foreground";
  }
  return numeric >= 0 ? "text-emerald-400" : "text-red-400";
}

function LayeredGroupIcon({ visuals = [], fallbackLabel }) {
  const items = Array.isArray(visuals) ? visuals.slice(0, 2) : [];

  return (
    <div className="relative h-16 w-16 shrink-0">
      {items.length === 0 ? (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/70 bg-card/70 text-[11px] font-semibold text-muted-foreground">
          {String(fallbackLabel || "Group").slice(0, 2).toUpperCase()}
        </div>
      ) : null}
      {items.map((item, index) => {
        const offsetClass = index === 0 ? "left-0 top-0 z-20" : "left-7 top-2 z-10";
        return (
          <div
            key={item.id || `${item.name}-${index}`}
            className={`absolute ${offsetClass} h-14 w-14 overflow-hidden rounded-2xl border border-border/70 bg-card/85 p-1 shadow-[0_12px_28px_rgba(0,0,0,0.18)]`}
          >
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt={item.name || "Group visual"}
                className="h-full w-full object-contain"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-muted-foreground">
                {String(item.name || fallbackLabel || "Group").slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function PortfolioGroupsPanel({
  groups = [],
  isLoading = false,
  formatUsdPrice,
  onManageGroups,
  title = "Investment Gruppen",
  description = "Aggregierte Ansicht ueber mehrere Cluster mit Drilldown auf die enthaltenen Teilpositionen.",
  focusGroupId = "",
}) {
  const [expandedGroupIds, setExpandedGroupIds] = useState({});

  const toggleExpanded = (groupId) => {
    setExpandedGroupIds((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  };

  if (isLoading) {
    return (
      <Card className="border-border/70 bg-card/55">
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-16 rounded-2xl border border-border/70 bg-background/35" />
          <div className="h-16 rounded-2xl border border-border/70 bg-background/35" />
        </CardContent>
      </Card>
    );
  }

  if (!Array.isArray(groups) || groups.length === 0) {
    return (
      <Card className="border-dashed border-border/70 bg-card/55">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
            <Button size="sm" variant="outline" onClick={onManageGroups}>
              <FolderCog className="mr-2 h-4 w-4" />
              Gruppen verwalten
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Noch keine Gruppen vorhanden. Lege in der Verwaltung deine erste Investment-Gruppe an und weise Cluster oder einzelne Positionen zu.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onManageGroups}>
          <FolderCog className="mr-2 h-4 w-4" />
          Gruppen verwalten
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {groups.map((group) => {
          const isFocused = String(focusGroupId || "").trim() === String(group.id || "").trim();
          const isExpanded = Boolean(expandedGroupIds[group.id]) || isFocused;
          const profitClassName = resolveDeltaClassName(group.totalProfit);
          const roiClassName = resolveDeltaClassName(group.roiPercent);

          return (
            <Card
              key={group.id}
              className={`overflow-hidden border-border/70 bg-card/70 ${
                isFocused ? "ring-2 ring-primary/45 ring-offset-2 ring-offset-background" : ""
              }`}
            >
              <CardContent className="space-y-4 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 gap-4">
                    <LayeredGroupIcon visuals={group.topVisuals} fallbackLabel={group.name} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate text-base font-semibold text-foreground">{group.name}</h4>
                        <Badge variant="outline">{group.clusterCount} Cluster</Badge>
                        <Badge variant="secondary">{group.memberCount} Positionen</Badge>
                      </div>
                      {group.thesis ? (
                        <p className="mt-1 text-sm text-muted-foreground">{group.thesis}</p>
                      ) : (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Virtuelle Sammelposition ueber bestehende Cluster.
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{group.totalQuantity} Stk.</span>
                        <span>|</span>
                        <span>{group.liveClusterCount} live bewertet</span>
                      </div>
                    </div>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleExpanded(group.id)}
                    className="shrink-0"
                  >
                    {isExpanded ? (
                      <>
                        Details <ChevronUp className="ml-1 h-4 w-4" />
                      </>
                    ) : (
                      <>
                        Details <ChevronDown className="ml-1 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <div className="rounded-xl border border-border/70 bg-background/40 p-3">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Wert</p>
                    <p className="mt-1 text-lg font-semibold">{formatUsdPrice(group.totalValue)}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/40 p-3">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">PnL</p>
                    <p className={`mt-1 text-lg font-semibold ${profitClassName}`}>
                      {group.totalProfit >= 0 ? "+" : ""}
                      {formatUsdPrice(group.totalProfit)}
                    </p>
                    <p className={`text-xs ${roiClassName}`}>{formatPercent(group.roiPercent)}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/40 p-3">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Gew. Buy-in</p>
                    <p className="mt-1 text-lg font-semibold">{formatUsdPrice(group.weightedBuyUnitPrice)}</p>
                    <p className="text-xs text-muted-foreground">pro Item</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/40 p-3">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Gew. Live</p>
                    <p className="mt-1 text-lg font-semibold">{formatUsdPrice(group.weightedCurrentUnitPrice)}</p>
                    <p className="text-xs text-muted-foreground">pro Item</p>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="space-y-2 rounded-2xl border border-border/70 bg-background/35 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">Enthaltene Cluster</p>
                      <p className="text-xs text-muted-foreground">
                        Gewichtung nach aktuellem Wertanteil der Gruppe
                      </p>
                    </div>
                    <div className="space-y-2">
                      {group.clusters.map((cluster) => {
                        const clusterProfit = cluster.totalValue - cluster.totalInvested;
                        const clusterDeltaClassName = resolveDeltaClassName(clusterProfit);
                        return (
                          <div
                            key={cluster.id}
                            className="flex flex-col gap-3 rounded-xl border border-border/65 bg-card/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-border/70 bg-muted/25 p-1">
                                {cluster.imageUrl ? (
                                  <img
                                    src={cluster.imageUrl}
                                    alt={cluster.name}
                                    className="h-full w-full object-contain"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">
                                    N/A
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{cluster.name}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                  <span>{cluster.quantity} Stk.</span>
                                  <span>|</span>
                                  <span>{formatSharePercent(cluster.sharePercent)}</span>
                                  {cluster.freshnessLabel ? (
                                    <>
                                      <span>|</span>
                                      <span>{cluster.freshnessLabel}</span>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3 sm:min-w-[280px]">
                              <div className="text-right">
                                <p className="text-[11px] text-muted-foreground">Invested</p>
                                <p className="text-sm font-semibold">{formatUsdPrice(cluster.totalInvested)}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-[11px] text-muted-foreground">Wert</p>
                                <p className="text-sm font-semibold">{formatUsdPrice(cluster.totalValue)}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-[11px] text-muted-foreground">PnL</p>
                                <p className={`text-sm font-semibold ${clusterDeltaClassName}`}>
                                  {formatPercent(cluster.roiPercent)}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
