import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ItemListRow } from "@shared/components/ItemListRow";
import { LayeredGroupIcon } from "@shared/components/LayeredGroupIcon";
import { ItemThumb } from "@shared/components/ui/item-thumb";
import { RoiMeter } from "@shared/components/ui/data-display";
import {
  GridTable,
  GridTableEmpty,
  GridTableFoot,
  GridTableHead,
  GridTableRow,
} from "@shared/components/ui/grid-table";

import { useCurrency } from "@shared/contexts/CurrencyContext";

/**
 * Column template of the Inventar design's table. Head, rows and nested cluster
 * rows all share it — see `GridTable`.
 */
const COLUMNS = "minmax(0,1fr) 54px 92px 100px 76px 116px";

const SORT_OPTIONS = [
  { key: "roi", label: "ROI" },
  { key: "value", label: "Positionswert" },
  { key: "quantity", label: "Menge" },
  { key: "item", label: "Name" },
];

function formatSignedCurrency(value, formatPrice) {
  if (!Number.isFinite(Number(value))) {
    return "-";
  }

  const numeric = Number(value);
  return `${numeric >= 0 ? "+" : "-"}${formatPrice(Math.abs(numeric))}`;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatSignedPercentOneDecimal(value) {
  if (!isFiniteNumber(value)) {
    return "-";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatSharePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `${numeric.toFixed(1)}% Anteil`;
}

function deltaClassName(value) {
  if (!isFiniteNumber(value)) {
    return "text-muted-foreground";
  }

  return value >= 0 ? "text-success" : "text-danger";
}

/** Unit purchase price of a row, in whichever field the source populated. */
function resolveUnitBuyPrice(item) {
  const candidates = [item?.costBasisUnit, item?.buyPrice];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return null;
}

/**
 * Every id a row can be addressed by. Group members reference desktop-local
 * client ids or server ids depending on where the group was created, so the
 * selection highlight has to match on any of them.
 */
function rowIdentities(entity) {
  return [entity?.id, entity?.clientId, entity?.serverId]
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

/** Sort header: same typography as the design's static labels, plus a toggle. */
function SortHeaderButton({ label, align = "left", isActive, sortDirection, onClick }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${
        align === "right" ? "ml-auto" : ""
      } ${isActive ? "text-foreground" : ""}`}
      onClick={onClick}
      title={`Nach ${label} sortieren`}
    >
      <span>{label}</span>
      {isActive ? (
        <span aria-hidden="true">{sortDirection === "asc" ? "↑" : "↓"}</span>
      ) : null}
    </button>
  );
}

export function InventoryTable({
  investments,
  onSelectItem,
  onSelectGroup,
  onSelectCluster,
  groups = [],
  selectedId = null,
  sortKey = "roi",
  sortDirection = "desc",
  onSortChange,
  unfilteredCount = null,
}) {
  const { formatPrice } = useCurrency();
  const [expandedGroupIds, setExpandedGroupIds] = useState({});

  const toggleExpanded = (groupId) => {
    setExpandedGroupIds((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  };

  const groupedMemberIds = useMemo(() => {
    const ids = new Set();
    (Array.isArray(groups) ? groups : []).forEach((group) => {
      const memberIds = Array.isArray(group?.memberInvestmentIds) ? group.memberInvestmentIds : [];
      memberIds.forEach((memberId) => {
        const normalizedId = String(memberId || "").trim();
        if (normalizedId) {
          ids.add(normalizedId);
        }
      });
    });
    return ids;
  }, [groups]);

  // Groups and single positions are sorted together in one list, so a group
  // lands wherever its aggregate value belongs instead of sticking to the top.
  const sortedRows = useMemo(() => {
    const getLiveSortValue = (item) => {
      if (typeof item.livePrice === "number" && Number.isFinite(item.livePrice)) {
        return item.livePrice;
      }

      if (typeof item.displayPrice === "number" && Number.isFinite(item.displayPrice)) {
        return item.displayPrice;
      }

      return 0;
    };

    const getItemSortValue = (item) => {
      switch (sortKey) {
        case "item":
          return String(item.name || "").toLowerCase();
        case "quantity":
          return Number(item.quantity || 0);
        case "value":
          return Number(item.currentValue || 0);
        case "livePrice":
          return getLiveSortValue(item);
        case "roi":
        default:
          return Number(item.roi || 0);
      }
    };

    const getGroupSortValue = (group) => {
      switch (sortKey) {
        case "item":
          return String(group.name || "").toLowerCase();
        case "quantity":
          return Number(group.totalQuantity || 0);
        case "value":
        case "livePrice":
          return Number(group.totalValue || 0);
        case "roi":
        default:
          return Number(group.roiPercent || 0);
      }
    };

    const visibleInvestments = (Array.isArray(investments) ? investments : []).filter((item) => {
      const sourceIds = Array.isArray(item?.sourceInvestmentIds)
        ? item.sourceInvestmentIds
            .map((entry) => String(entry || "").trim())
            .filter(Boolean)
        : [];
      const sourceClientIds = Array.isArray(item?.sourceClientIds)
        ? item.sourceClientIds.map((entry) => String(entry || "").trim())
        : [];

      if (sourceIds.length > 0) {
        // A source row counts as grouped when either its server id or its
        // index-aligned desktop-local clientId is a group member — groups
        // created on desktop reference local ids, web-created ones server ids.
        const allMemberIdsGrouped = sourceIds.every((sourceId, index) => {
          if (groupedMemberIds.has(sourceId)) {
            return true;
          }
          const clientId = sourceClientIds[index] || "";
          return clientId !== "" && groupedMemberIds.has(clientId);
        });
        return !allMemberIdsGrouped;
      }

      const aliasIds = rowIdentities(item);
      if (aliasIds.length === 0) {
        return true;
      }
      return !aliasIds.some((aliasId) => groupedMemberIds.has(aliasId));
    });

    const rows = [
      ...(Array.isArray(groups) ? groups : []).map((group) => ({
        kind: "group",
        sortValue: getGroupSortValue(group),
        group,
      })),
      ...visibleInvestments.map((item) => ({
        kind: "item",
        sortValue: getItemSortValue(item),
        item,
      })),
    ];

    rows.sort((a, b) => {
      let comparison = 0;
      if (typeof a.sortValue === "string" && typeof b.sortValue === "string") {
        comparison = a.sortValue.localeCompare(b.sortValue, "de");
      } else {
        comparison = Number(a.sortValue) - Number(b.sortValue);
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return rows;
  }, [groupedMemberIds, groups, investments, sortDirection, sortKey]);

  // Footer total: sum of what the table actually shows, so a category filter is
  // reflected instead of silently reporting the whole portfolio.
  const visibleTotalValue = useMemo(
    () =>
      sortedRows.reduce((sum, row) => {
        const value =
          row.kind === "group" ? Number(row.group?.totalValue) : Number(row.item?.currentValue);
        return Number.isFinite(value) ? sum + value : sum;
      }, 0),
    [sortedRows],
  );

  const toggleSort = (nextKey) => {
    if (typeof onSortChange !== "function") {
      return;
    }

    if (sortKey === nextKey) {
      onSortChange(nextKey, sortDirection === "asc" ? "desc" : "asc");
      return;
    }

    onSortChange(nextKey, nextKey === "item" ? "asc" : "desc");
  };

  const selectionKey = String(selectedId ?? "").trim();
  const isSelected = (entity) =>
    selectionKey !== "" && rowIdentities(entity).includes(selectionKey);

  return (
    <>
      {/* Desktop: Position | Menge | Einkauf | Live | 7T | ROI */}
      <div className="hidden md:block">
        <GridTable>
          <GridTableHead columns={COLUMNS}>
            <SortHeaderButton
              label="Position"
              isActive={sortKey === "item"}
              sortDirection={sortDirection}
              onClick={() => toggleSort("item")}
            />
            <span className="text-right">
              <SortHeaderButton
                label="Menge"
                align="right"
                isActive={sortKey === "quantity"}
                sortDirection={sortDirection}
                onClick={() => toggleSort("quantity")}
              />
            </span>
            <span className="text-right">Einkauf</span>
            <span className="text-right">
              <SortHeaderButton
                label="Live"
                align="right"
                isActive={sortKey === "livePrice"}
                sortDirection={sortDirection}
                onClick={() => toggleSort("livePrice")}
              />
            </span>
            <span className="text-right" title="Preisänderung der letzten 7 Tage">
              7T
            </span>
            <span className="text-right">
              <SortHeaderButton
                label="ROI"
                align="right"
                isActive={sortKey === "roi"}
                sortDirection={sortDirection}
                onClick={() => toggleSort("roi")}
              />
            </span>
          </GridTableHead>

          {sortedRows.length === 0 ? (
            <GridTableEmpty>Keine Positionen für diese Filter.</GridTableEmpty>
          ) : null}

          {sortedRows.map((row) => {
            if (row.kind !== "group") {
              const item = row.item;
              const unitBuyPrice = resolveUnitBuyPrice(item);
              const change7d = Number(item?.change7dPercent);
              const roiValue = isFiniteNumber(item.roi) ? item.roi : null;

              return (
                <GridTableRow
                  key={item.id}
                  columns={COLUMNS}
                  selected={isSelected(item)}
                  onClick={() => onSelectItem(item)}
                >
                  <div className="flex min-w-0 items-center gap-[11px]">
                    <ItemThumb
                      src={item.imageUrl}
                      alt={item.name}
                      className="size-[34px] rounded-lg"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold">{item.name}</span>
                      <span className="mt-[3px] flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                        <span className="truncate">
                          {item.type} · {item.fundingMode === "cash_in" ? "cash_in" : "wallet"}
                        </span>
                        {item.hasBuyOrder && Number(item.buyOrderBestPriceUsd) > 0 ? (
                          <span
                            title="Offene CSFloat-Buyorder"
                            className="shrink-0 rounded-[5px] bg-info/16 px-1.5 py-px text-[9px] font-extrabold tracking-[0.04em] text-info"
                          >
                            BO{" "}
                            {formatPrice(Number(item.buyOrderBestPriceUsd), {
                              useUsd: true,
                              buyPriceUsd: Number(item.buyOrderBestPriceUsd),
                            })}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </div>

                  <span className="text-right text-xs tabular-nums text-muted-foreground">
                    {item.quantity}x
                  </span>

                  <span className="text-right text-[12.5px] tabular-nums text-muted-foreground">
                    {unitBuyPrice === null ? "-" : formatPrice(unitBuyPrice)}
                  </span>

                  <span className="text-right text-[13.5px] font-bold tabular-nums">
                    {item.isLive ? (
                      formatPrice(item.livePrice)
                    ) : (
                      <span className="text-[11px] font-medium text-muted-foreground">
                        kein Preis
                      </span>
                    )}
                  </span>

                  <span
                    className={`text-right text-[11.5px] font-semibold tabular-nums ${deltaClassName(
                      Number.isFinite(change7d) ? change7d : null,
                    )}`}
                    title={
                      Number.isFinite(change7d)
                        ? "Preisänderung der letzten 7 Tage"
                        : "Keine 7-Tage-Historie vorhanden"
                    }
                  >
                    {Number.isFinite(change7d) ? formatSignedPercentOneDecimal(change7d) : "–"}
                  </span>

                  <span className="flex items-center justify-end gap-2">
                    {item.isLive && roiValue !== null ? (
                      <>
                        <RoiMeter value={roiValue} />
                        <span
                          className={`min-w-[58px] text-right text-[12.5px] font-extrabold tabular-nums ${deltaClassName(roiValue)}`}
                        >
                          {formatSignedPercentOneDecimal(roiValue)}
                        </span>
                      </>
                    ) : (
                      <span className="min-w-[58px] text-right text-muted-foreground opacity-50">
                        -
                      </span>
                    )}
                  </span>
                </GridTableRow>
              );
            }

            const group = row.group;
            const isExpanded = Boolean(expandedGroupIds[group.id]);
            const weightedBuyUnitPrice = Number(group.weightedBuyUnitPrice);

            return (
              <React.Fragment key={`group-${group.id}`}>
                <GridTableRow
                  columns={COLUMNS}
                  selected={isSelected(group)}
                  onClick={() => {
                    toggleExpanded(group.id);
                    if (typeof onSelectGroup === "function") {
                      onSelectGroup(group);
                    }
                  }}
                >
                  <div className="flex min-w-0 items-center gap-[11px]">
                    {/* "sm" keeps the stacked icon inside the dense row's 34px band. */}
                    <LayeredGroupIcon
                      visuals={group.topVisuals}
                      fallbackLabel={group.name}
                      size="sm"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold">{group.name}</span>
                      <span className="mt-[3px] flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                        <span className="rounded-[5px] border border-border px-1.5 py-px text-[9px]">
                          Gruppe
                        </span>
                        <span className="truncate">
                          {group.clusterCount} Cluster · {group.memberCount} Positionen
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="size-3 shrink-0" />
                        ) : (
                          <ChevronDown className="size-3 shrink-0" />
                        )}
                      </span>
                    </span>
                  </div>

                  <span className="text-right text-xs tabular-nums text-muted-foreground">
                    {group.totalQuantity}x
                  </span>

                  <span className="text-right text-[12.5px] tabular-nums text-muted-foreground">
                    {Number.isFinite(weightedBuyUnitPrice) && weightedBuyUnitPrice > 0
                      ? formatPrice(weightedBuyUnitPrice)
                      : "-"}
                  </span>

                  <span className="text-right text-[13.5px] font-bold tabular-nums">
                    {formatPrice(group.totalValue)}
                  </span>

                  {/* Groups aggregate across items and carry no 7-day series of
                      their own. Printing their absolute P/L here instead would
                      put euros and percent in one column. */}
                  <span
                    className="text-right text-[11.5px] text-muted-foreground"
                    title="Gruppen haben keine 7-Tage-Historie"
                  >
                    –
                  </span>

                  <span className="flex items-center justify-end gap-2">
                    <RoiMeter value={group.roiPercent} />
                    <span
                      className={`min-w-[58px] text-right text-[12.5px] font-extrabold tabular-nums ${deltaClassName(group.roiPercent)}`}
                    >
                      {formatSignedPercentOneDecimal(group.roiPercent)}
                    </span>
                  </span>
                </GridTableRow>

                {isExpanded && group.clusters
                  ? group.clusters.map((cluster) => (
                      <GridTableRow
                        key={`cluster-${cluster.id}`}
                        columns={COLUMNS}
                        indent
                        onClick={() => {
                          if (typeof onSelectCluster === "function") {
                            onSelectCluster(group, cluster);
                          }
                        }}
                      >
                        <div className="flex min-w-0 items-center gap-[11px]">
                          <ItemThumb
                            src={cluster.imageUrl}
                            alt={cluster.name}
                            className="size-[30px] rounded-lg"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-[12.5px] font-semibold">
                              {cluster.name}
                            </span>
                            <span className="mt-[3px] block truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                              {cluster.quantity} Stk. · {formatSharePercent(cluster.sharePercent)}
                            </span>
                          </span>
                        </div>

                        <span className="text-right text-xs tabular-nums text-muted-foreground">
                          {cluster.quantity}x
                        </span>

                        <span className="text-right text-[12.5px] tabular-nums text-muted-foreground">
                          {Number.isFinite(Number(cluster.buyUnitPrice)) &&
                          Number(cluster.buyUnitPrice) > 0
                            ? formatPrice(Number(cluster.buyUnitPrice))
                            : "-"}
                        </span>

                        <span className="text-right text-[13px] font-semibold tabular-nums text-muted-foreground">
                          {formatPrice(cluster.totalValue)}
                        </span>

                        <span className="text-right text-[11.5px] text-muted-foreground">–</span>

                        <span className="flex items-center justify-end gap-2">
                          <RoiMeter value={cluster.roiPercent} />
                          <span
                            className={`min-w-[58px] text-right text-[12.5px] font-bold tabular-nums ${deltaClassName(cluster.roiPercent)}`}
                          >
                            {formatSignedPercentOneDecimal(cluster.roiPercent)}
                          </span>
                        </span>
                      </GridTableRow>
                    ))
                  : null}
              </React.Fragment>
            );
          })}

          <GridTableFoot>
            <span>
              {unfilteredCount != null && unfilteredCount !== sortedRows.length
                ? `${sortedRows.length} von ${unfilteredCount} Positionen`
                : `${sortedRows.length} Positionen`}
            </span>
            <span>Gesamtwert {formatPrice(visibleTotalValue)}</span>
          </GridTableFoot>
        </GridTable>
      </div>

      {/* Mobile: the sidebar is desktop-only, so the sort strip stays inline here. */}
      <div className="space-y-3 px-2 md:hidden">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-2.5">
          <span className="shrink-0 pl-1 text-[10px] uppercase text-muted-foreground">
            Sortierung
          </span>
          <div className="no-scrollbar flex flex-1 gap-1 overflow-x-auto">
            {SORT_OPTIONS.map(({ key, label }) => {
              const isActive = sortKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleSort(key)}
                  className={`shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-2 text-muted-foreground hover:text-foreground"
                  }`}
                  title={`${label} ${sortDirection === "asc" ? "↑" : "↓"}`}
                >
                  {label}
                  {isActive ? (
                    <span className="ml-0.5 text-[10px]">
                      {sortDirection === "asc" ? "↑" : "↓"}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {sortedRows.map((row) => {
          if (row.kind !== "group") {
            const item = row.item;
            const roiValue = isFiniteNumber(item.roi) ? item.roi : null;

            return (
              <ItemListRow
                key={item.id}
                item={{
                  ...item,
                  currentPrice: item.isLive ? item.livePrice : null,
                  currentPriceUsd: null,
                  roi: roiValue,
                  trend: item.isLive && roiValue !== null ? (roiValue >= 0 ? "up" : "down") : null,
                  changeLabel: item.isLive ? formatSignedPercentOneDecimal(roiValue) : "-",
                }}
                onClick={() => onSelectItem(item)}
              />
            );
          }

          const group = row.group;
          const isExpanded = Boolean(expandedGroupIds[group.id]);
          const profitClassName = deltaClassName(group.totalProfit);
          const roiClassName = deltaClassName(group.roiPercent);

          return (
            <div
              key={`group-${group.id}`}
              className="overflow-hidden rounded-2xl border border-border bg-card"
            >
              <button
                type="button"
                onClick={() => {
                  toggleExpanded(group.id);
                  if (typeof onSelectGroup === "function") {
                    onSelectGroup(group);
                  }
                }}
                className="flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-surface-1 active:scale-[0.995]"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <LayeredGroupIcon visuals={group.topVisuals} fallbackLabel={group.name} />
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-sm font-semibold">{group.name}</h4>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-tighter text-muted-foreground">
                      <span className="rounded-[5px] border border-border px-1.5 py-px text-[9px]">
                        Gruppe
                      </span>
                      <span>{group.clusterCount} Cluster</span>
                      <span>|</span>
                      <span>{group.memberCount} Positionen</span>
                      <span>|</span>
                      <span>{group.totalQuantity}x</span>
                    </span>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="text-sm font-bold">{formatPrice(group.totalValue)}</span>
                    <span className={`text-[10px] font-semibold ${roiClassName}`}>
                      {formatSignedPercentOneDecimal(group.roiPercent)}
                    </span>
                    <span className={`text-[10px] ${profitClassName}`}>
                      {formatSignedCurrency(group.totalProfit, formatPrice)}
                    </span>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground/85" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground/85" />
                  )}
                </div>
              </button>

              {isExpanded && Array.isArray(group.clusters) ? (
                <div className="space-y-2 border-t border-border-soft bg-surface-1 p-2">
                  {group.clusters.map((cluster) => (
                    <button
                      key={`cluster-${cluster.id}`}
                      type="button"
                      onClick={() => {
                        if (typeof onSelectCluster === "function") {
                          onSelectCluster(group, cluster);
                        }
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card p-2.5 text-left transition-colors hover:bg-surface-2 active:scale-[0.995]"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <ItemThumb
                          src={cluster.imageUrl}
                          alt={cluster.name}
                          className="size-11 rounded-xl"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{cluster.name}</p>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-tighter text-muted-foreground">
                            <span>{cluster.quantity} Stk.</span>
                            <span>|</span>
                            <span>{formatSharePercent(cluster.sharePercent)}</span>
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
                        <span className="text-sm font-bold text-muted-foreground">
                          {formatPrice(cluster.totalValue)}
                        </span>
                        <span
                          className={`text-[10px] font-semibold ${deltaClassName(cluster.roiPercent)}`}
                        >
                          {formatSignedPercentOneDecimal(cluster.roiPercent)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
