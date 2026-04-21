import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { PriceSourceBadge } from "@/components/PriceSourceBadge";

const ItemThumbnail = ({ imageUrl, name }) => (
  <div className="h-12 w-12 overflow-hidden rounded-md border bg-muted">
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
      return "border-muted bg-muted/30 text-muted-foreground";
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
                  label="ROI"
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
                className="group cursor-pointer transition-colors hover:bg-muted/50"
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
      <div className="space-y-3 md:hidden px-2">
        <div className="rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between gap-2">
            <span>Sortierung</span>
            <span className="font-medium text-foreground">
              {sortKey === "item"
                ? "Item"
                : sortKey === "quantity"
                  ? "Menge"
                  : sortKey === "livePrice"
                    ? "Live Preis"
                    : "ROI"}{" "}
              ({sortDirection === "asc" ? "Aufsteigend" : "Absteigend"})
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="rounded border bg-muted/30 px-2 py-1 text-left hover:bg-muted/60"
              onClick={() => toggleSort("item")}
            >
              Item
            </button>
            <button
              type="button"
              className="rounded border bg-muted/30 px-2 py-1 text-left hover:bg-muted/60"
              onClick={() => toggleSort("quantity")}
            >
              Menge
            </button>
            <button
              type="button"
              className="rounded border bg-muted/30 px-2 py-1 text-left hover:bg-muted/60"
              onClick={() => toggleSort("livePrice")}
            >
              Live Preis
            </button>
            <button
              type="button"
              className="rounded border bg-muted/30 px-2 py-1 text-left hover:bg-muted/60"
              onClick={() => toggleSort("roi")}
            >
              ROI
            </button>
          </div>
        </div>

        {sortedInvestments.map((item) => (
          <div
            key={item.id}
            onClick={() => onSelectItem(item)}
            className="cursor-pointer rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
          >
            {/* Item Header */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 flex-1">
                <ItemThumbnail imageUrl={item.imageUrl} name={item.name} />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate transition-colors hover:text-primary">
                    {item.name}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] uppercase tracking-tighter text-muted-foreground">
                    <span>{item.type}</span>
                    <Badge variant="outline" className="text-[9px]">
                      {item.fundingMode === "cash_in" ? "cash_in" : "wallet"}
                    </Badge>
                  </span>
                </div>
              </div>
              <div className="text-right">
                {item.isLive ? (
                  <div className={`text-sm font-bold whitespace-nowrap ${item.roi >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {`${item.roi >= 0 ? "+" : ""}${item.roi.toFixed(1)}%`}
                  </div>
                ) : (
                  <div className="text-sm font-bold whitespace-nowrap text-muted-foreground opacity-50">
                    0.0%
                  </div>
                )}
              </div>
            </div>

            {/* Item Details Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
              <div>
                <span className="text-muted-foreground">Menge:</span>
                <span className="ml-1 font-mono">{item.quantity}x</span>
              </div>
              <div className="text-right">
                <span className="text-muted-foreground">Einkauf:</span>
                <span className="ml-1">{formatCurrency(item.buyPrice)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Live:</span>
                <span className={`ml-1 font-bold ${item.isLive ? "text-primary" : "text-muted-foreground"}`}>
                  {item.isLive ? formatCurrency(item.livePrice) : formatCurrency(item.buyPrice)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-muted-foreground">Break-even:</span>
                <span className="ml-1">{formatCurrency(item.breakEvenPriceNet ?? item.breakEvenPrice ?? item.buyPrice)}</span>
              </div>
            </div>

            {/* Changes Row */}
            <div className="flex gap-2 text-xs mb-2">
              <div className="flex-1">
                <span className="text-muted-foreground block">24h</span>
                <ChangeCell euro={item.change24hEuro} percent={item.change24hPercent} />
              </div>
              <div className="flex-1">
                <span className="text-muted-foreground block">7d</span>
                <ChangeCell euro={item.change7dEuro} percent={item.change7dPercent} />
              </div>
              <div className="flex-1">
                <span className="text-muted-foreground block">30d</span>
                <ChangeCell euro={item.change30dEuro} percent={item.change30dPercent} />
              </div>
            </div>

            {/* Freshness */}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground text-xs">Freshness:</span>
              <FreshnessCell item={item} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
