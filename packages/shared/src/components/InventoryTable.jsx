import { useMemo, useState } from "react";
import { Badge } from "@shared/components/ui/badge";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { ItemListRow } from "@shared/components/ItemListRow";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@shared/components/ui/table";

import { Abbr } from "@shared/components/AbbreviationTooltip";
import { useCurrency } from "@shared/contexts/CurrencyContext";

const ItemThumbnail = ({ imageUrl, name }) => (
  <div className="h-14 w-14 overflow-hidden rounded-xl border border-border/75 bg-muted/25 p-1">
    {imageUrl ? (
      <img
        src={imageUrl}
        alt={name}
        className="h-full w-full object-contain"
        loading="lazy"
        decoding="async"
      />
    ) : (
      <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
        N/A
      </div>
    )}
  </div>
);

function formatSignedCurrency(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} EUR`;
}

function formatSignedPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
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

function deltaClassName(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "text-muted-foreground";
  }

  return value >= 0 ? "text-emerald-400" : "text-red-400";
}

function freshnessBadgeClass(status) {
  switch (status) {
    case "fresh":
      return "border-emerald-400/35 bg-emerald-500/12 text-emerald-300";
    case "aging":
      return "border-amber-400/35 bg-amber-500/12 text-amber-300";
    case "stale":
      return "border-red-400/35 bg-red-500/12 text-red-300";
    default:
      return "border-muted text-muted-foreground";
  }
}

function ChangeCell({ euro, percent }) {
  if (typeof percent !== "number" || Number.isNaN(percent)) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={`text-xs font-semibold ${deltaClassName(percent)}`}>
        {formatSignedPercent(percent)}
      </span>
      <span className={`text-[10px] ${deltaClassName(euro)}`}>
        {formatSignedCurrency(euro)}
      </span>
    </div>
  );
}

function FreshnessCell({ item }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant="outline" className={freshnessBadgeClass(item.freshnessStatus)}>
        {item.freshnessLabel || "unbekannt"}
      </Badge>
      {item.lastPriceUpdateAt ? (
        <span className="font-mono text-[10px] text-muted-foreground">
          {item.lastPriceUpdateAt}
        </span>
      ) : null}
    </div>
  );
}

function SortHeaderButton({ label, align = "left", isActive, sortDirection, onClick }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors hover:bg-muted/70 ${
        align === "right" ? "ml-auto" : ""
      } ${isActive ? "text-foreground" : "text-muted-foreground"}`}
      onClick={onClick}
      title={`${label} sortieren`}
    >
      <span>{label}</span>
      {isActive ? (
        sortDirection === "asc" ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />
      )}
    </button>
  );
}

export function InventoryTable({ investments, onSelectItem }) {
  const { formatPrice } = useCurrency();
  const [sortKey, setSortKey] = useState("roi");
  const [sortDirection, setSortDirection] = useState("desc");

  const sortedInvestments = useMemo(() => {
    const getLiveSortValue = (item) => {
      if (typeof item.livePrice === "number" && Number.isFinite(item.livePrice)) {
        return item.livePrice;
      }

      if (typeof item.displayPrice === "number" && Number.isFinite(item.displayPrice)) {
        return item.displayPrice;
      }

      return 0;
    };

    const getSortValue = (item) => {
      switch (sortKey) {
        case "item":
          return String(item.name || "").toLowerCase();
        case "quantity":
          return Number(item.quantity || 0);
        case "livePrice":
          return getLiveSortValue(item);
        case "roi":
        default:
          return Number(item.roi || 0);
      }
    };

    const sorted = [...investments];

    sorted.sort((a, b) => {
      const aValue = getSortValue(a);
      const bValue = getSortValue(b);

      let comparison = 0;
      if (typeof aValue === "string" && typeof bValue === "string") {
        comparison = aValue.localeCompare(bValue, "de");
      } else {
        comparison = aValue - bValue;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [investments, sortDirection, sortKey]);

  const toggleSort = (nextKey) => {
    if (sortKey === nextKey) {
      setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === "item" ? "asc" : "desc");
  };

  return (
    <>
      {/* Desktop-View (md und höher) - Smart Columns: Item | Menge | Live | ROI% */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortHeaderButton
                  label="Item"
                  isActive={sortKey === "item"}
                  sortDirection={sortDirection}
                  onClick={() => toggleSort("item")}
                />
              </TableHead>
              <TableHead className="text-right">
                <SortHeaderButton
                  label="Menge"
                  align="right"
                  isActive={sortKey === "quantity"}
                  sortDirection={sortDirection}
                  onClick={() => toggleSort("quantity")}
                />
              </TableHead>
              <TableHead className="text-right">
                <SortHeaderButton
                  label="Live Preis"
                  align="right"
                  isActive={sortKey === "livePrice"}
                  sortDirection={sortDirection}
                  onClick={() => toggleSort("livePrice")}
                />
              </TableHead>
              <TableHead className="text-right">
                <SortHeaderButton
                  label={<Abbr term="ROI" />}
                  align="right"
                  isActive={sortKey === "roi"}
                  sortDirection={sortDirection}
                  onClick={() => toggleSort("roi")}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedInvestments.map((item) => (
              <TableRow
                key={item.id}
                className="group cursor-pointer border-border/70 transition-colors hover:bg-accent/40"
                onClick={() => onSelectItem(item)}
              >
                <TableCell className="font-medium text-sm">
                  <div className="flex items-center gap-3">
                    <ItemThumbnail imageUrl={item.imageUrl} name={item.name} />
                    <span className="flex flex-col">
                      <span className="font-semibold transition-colors group-hover:text-primary">
                        {item.name}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] uppercase tracking-tighter text-muted-foreground">
                        <span>{item.type}</span>
                        <Badge variant="outline" className="text-[9px]">
                          {item.fundingMode === "cash_in" ? "cash_in" : "wallet"}
                        </Badge>
                      </span>
                    </span>
                  </div>
                </TableCell>

                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                  {item.quantity}x
                </TableCell>

                <TableCell
                  className={`text-right text-sm font-bold ${item.isLive ? "text-primary" : "text-muted-foreground"}`}
                >
                  {item.isLive ? (
                    <div className="flex flex-col items-end gap-1">
                      <span>{formatPrice(item.livePrice)}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {item.lastPriceUpdateAt || item.freshnessLabel || "unbekannt"}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-end">
                      <span className="text-xs text-muted-foreground">Kein Preis verfuegbar</span>
                    </div>
                  )}
                </TableCell>

                <TableCell className="text-right">
                  {item.isLive && isFiniteNumber(item.roi) ? (
                    <span
                      className={`text-sm font-bold ${item.roi >= 0 ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {formatSignedPercentOneDecimal(item.roi)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground opacity-50">-</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

        {/* Mobile-View (unter md) */}
        <div className="space-y-3 px-2 md:hidden">
          {/* Sort Controls - Compact Horizontal */}
          <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/75 p-2.5 shadow-[0_14px_28px_rgba(0,0,0,0.2)]">
            <span className="text-[10px] uppercase text-muted-foreground shrink-0 pl-1">Sortierung</span>
            <div className="flex flex-1 gap-1 overflow-x-auto no-scrollbar">
              {[
                { key: "item", label: "Item", short: "Name" },
                { key: "quantity", label: "Menge", short: "Anz." },
                { key: "livePrice", label: "Live Preis", short: "Preis" },
                { key: "roi", label: "ROI", short: "ROI" },
              ].map(({ key, label, short }) => {
                const isActive = sortKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleSort(key)}
                    className={`shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(255,255,255,0.14)]"
                        : "bg-muted/35 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    }`}
                    title={`${label} ${sortDirection === "asc" ? "↑" : "↓"}`}
                  >
                    <span className="sm:hidden">{short}</span>
                    <span className="hidden sm:inline">{label}</span>
                    {isActive && (
                      <span className="ml-0.5 text-[10px]">
                        {sortDirection === "asc" ? "↑" : "↓"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {sortedInvestments.map((item) => {
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
          })}
        </div>
    </>
  );
}
