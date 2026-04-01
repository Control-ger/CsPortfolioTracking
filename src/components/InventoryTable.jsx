import { Badge } from "@/components/ui/badge";
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

export function InventoryTable({ investments, onSelectItem }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Menge</TableHead>
          <TableHead className="text-right">Einkauf</TableHead>
          <TableHead className="text-right">Break-even</TableHead>
          <TableHead className="text-right">Live</TableHead>
          <TableHead className="text-right">24h</TableHead>
          <TableHead className="text-right">7d</TableHead>
          <TableHead className="text-right">30d</TableHead>
          <TableHead className="text-right">Freshness</TableHead>
          <TableHead className="text-right">ROI %</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {investments.map((item) => (
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
                  <span className="text-[10px] uppercase tracking-tighter text-muted-foreground">
                    {item.type}
                  </span>
                </span>
              </div>
            </TableCell>

            <TableCell className="text-right font-mono text-xs text-muted-foreground">
              {item.quantity}x
            </TableCell>

            <TableCell className="text-right text-xs">
              {formatCurrency(item.buyPrice)}
            </TableCell>

            <TableCell className="text-right">
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-xs font-semibold">
                  {formatCurrency(item.breakEvenPrice ?? item.buyPrice)}
                </span>
                <span className={`text-[10px] ${deltaClassName(item.breakEvenDeltaEuro)}`}>
                  {formatSignedCurrency(item.breakEvenDeltaEuro)}
                </span>
              </div>
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
              <ChangeCell euro={item.change24hEuro} percent={item.change24hPercent} />
            </TableCell>

            <TableCell className="text-right">
              <ChangeCell euro={item.change7dEuro} percent={item.change7dPercent} />
            </TableCell>

            <TableCell className="text-right">
              <ChangeCell euro={item.change30dEuro} percent={item.change30dPercent} />
            </TableCell>

            <TableCell className="text-right">
              <FreshnessCell item={item} />
            </TableCell>

            <TableCell
              className={`text-right text-sm font-bold ${item.roi >= 0 ? "text-green-500" : "text-red-500"}`}
            >
              {item.isLive ? (
                `${item.roi >= 0 ? "+" : ""}${item.roi.toFixed(1)}%`
              ) : (
                <span className="text-muted-foreground opacity-50">0.0%</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
