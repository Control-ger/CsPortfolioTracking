import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { ItemListRow } from "@/components/ItemListRow";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import { Abbr } from "@/components/AbbreviationTooltip";

const ItemThumbnail = ({ imageUrl, name }) => (
  <div className="h-12 w-12 overflow-hidden rounded-md border ">
    {imageUrl ? (
      <img
        src={imageUrl}
        alt={name}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    ) : (
      <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
        N/A
      </div>
    )}
  </div>
);

function formatCurrency(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return `${value.toFixed(2)} EUR`;
}

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

function deltaClassName(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "text-muted-foreground";
  }

  return value >= 0 ? "text-green-600" : "text-red-600";
}

function freshnessBadgeClass(status) {
  switch (status) {
    case "fresh":
      return "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900/60 dark:text-emerald-300";
    case "aging":
      return "border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-900/60 dark:text-amber-300";
    case "stale":
      return "border-red-200 bg-red-500/10 text-red-700 dark:border-red-900/60 dark:text-red-300";
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
      className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs font-semibold uppercase tracking-wide transition-colors hover:bg-muted/70 ${
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

      if (typeof item.buyPrice === "number" && Number.isFinite(item.buyPrice)) {
        return item.buyPrice;
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
                className="group cursor-pointer transition-colors"
                onClick={() => onSelectItem(item)}
              >
                <TableCell className="font-medium text-sm">
                  <div className="flex items-center gap-3">
                    <ItemThumbnail imageUrl={item.imageUrl} name={item.name} />
                    <span className="flex flex-col">
                      <span className="transition-colors group-hover:text-primary">
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
                      <span>{formatCurrency(item.livePrice)}</span>
                      <PriceSourceBadge priceSource={item.priceSource} compact />
                    </div>
                  ) : (
                    <div className="flex flex-col items-end">
                      <span className="text-xs">{formatCurrency(item.buyPrice)}</span>
                      <span className="animate-pulse text-[9px] uppercase">Warte...</span>
                    </div>
                  )}
                </TableCell>

                <TableCell className="text-right">
                  {item.isLive ? (
                    <span className={`text-sm font-bold ${item.roi >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {`${item.roi >= 0 ? "+" : ""}${item.roi.toFixed(1)}%`}
                    </span>
                  ) : (
                    <span className="text-muted-foreground opacity-50">0.0%</span>
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
          <div className="flex items-center gap-2 rounded-lg border bg-card p-2">
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
                    className={`shrink-0 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted"
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

          {sortedInvestments.map((item) => (
            <ItemListRow
              key={item.id}
              item={{
                ...item,
                currentPrice: item.isLive
                  ? item.livePrice
                  : item.buyPrice,
                roi: item.roi,
                trend: item.isLive ? (item.roi >= 0 ? "up" : "down") : null,
                changeLabel: item.isLive
                  ? `${item.roi >= 0 ? "+" : ""}${item.roi.toFixed(1)}%`
                  : "-",
              }}
              onClick={() => onSelectItem(item)}
            />
          ))}
        </div>
    </>
  );
}
