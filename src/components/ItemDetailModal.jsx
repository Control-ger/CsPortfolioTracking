import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

import { BaseModal } from "@/components/BaseModal";
import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import { Badge } from "@/components/ui/badge";

const formatPrice = (value) =>
  typeof value === "number" && !Number.isNaN(value) ? `${value.toFixed(2)} EUR` : "-";

const formatSignedPrice = (value) =>
  typeof value === "number" && !Number.isNaN(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(2)} EUR`
    : "-";

const formatSignedPercent = (value) =>
  typeof value === "number" && !Number.isNaN(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
    : "-";

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

function ChangeMetric({ label, percent, euro }) {
  return (
    <div className="flex items-center justify-between rounded border bg-background/80 px-2 py-1.5">
      <span className="text-[10px] uppercase text-muted-foreground">{label}</span>
      <span className={`text-xs font-semibold ${deltaClassName(percent)}`}>
        {formatSignedPercent(percent)}
      </span>
      <span className={`text-[10px] ${deltaClassName(euro)}`}>{formatSignedPrice(euro)}</span>
    </div>
  );
}

export function ItemDetailModal({ isOpen, onClose, item, history = [] }) {
  if (!item) {
    return null;
  }

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title={item.name} size="3xl">
      <div className="space-y-6">
        <div className="flex gap-4">
          <div className="h-32 w-32 shrink-0 overflow-hidden rounded-lg border bg-muted">
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt={item.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                N/A
              </div>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {item.type}
            </p>
            <p className="text-sm">
              <strong>Condition:</strong> {item.wearName || "N/A"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <PriceSourceBadge priceSource={item.priceSource} />
              <Badge variant="outline" className={freshnessBadgeClass(item.freshnessStatus)}>
                {item.freshnessLabel || "unbekannt"}
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-1">
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Einkauf</p>
              <p className="text-sm font-bold">{formatPrice(item.buyPrice)}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {item.quantity}x {formatPrice(item.buyPrice)}
              </p>
            </div>

            <div className="rounded-md border bg-muted/40 p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Break-even</p>
              <p className="text-sm font-bold">
                {formatPrice(item.breakEvenPrice ?? item.buyPrice)}
              </p>
              <p className={`mt-1 text-[10px] ${deltaClassName(item.breakEvenDeltaEuro)}`}>
                {formatSignedPrice(item.breakEvenDeltaEuro)}
              </p>
            </div>

            <div className="rounded-md border bg-muted/40 p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Live</p>
              <p
                className={`text-sm font-bold ${item.isLive ? "text-primary" : "text-muted-foreground"}`}
              >
                {item.livePrice !== null ? formatPrice(item.livePrice) : "Nicht verfuegbar"}
              </p>
            </div>

            <div className="rounded-md border bg-muted/40 p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Position</p>
              <p className="text-sm font-bold">{formatPrice(item.currentValue)}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {item.quantity}x {formatPrice(item.displayPrice)}
              </p>
            </div>

            <div className="rounded-md border bg-muted/40 p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Gewinn/Verlust</p>
              <p
                className={`text-sm font-bold ${item.isProfitPositive ? "text-green-600" : "text-red-600"}`}
              >
                {item.isProfitPositive ? "+" : ""}
                {formatPrice(item.profitEuro)}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {item.isProfitPositive ? "+" : ""}
                {item.roi.toFixed(2)}%
              </p>
            </div>

            <div className="rounded-md border bg-muted/40 p-3">
              <p className="mb-2 text-[10px] uppercase text-muted-foreground">Price Change</p>
              <div className="space-y-1.5">
                <ChangeMetric
                  label="24h"
                  percent={item.change24hPercent}
                  euro={item.change24hEuro}
                />
                <ChangeMetric
                  label="7d"
                  percent={item.change7dPercent}
                  euro={item.change7dEuro}
                />
                <ChangeMetric
                  label="30d"
                  percent={item.change30dPercent}
                  euro={item.change30dEuro}
                />
              </div>
            </div>
          </div>

          {history && history.length > 0 ? (
            <div className="rounded-lg border bg-muted/20 p-4 lg:col-span-2">
              <h3 className="mb-4 text-sm font-semibold">Preishistorie</h3>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={history}>
                  <XAxis dataKey="date" />
                  <Tooltip formatter={(value) => `${Number(value).toFixed(2)} EUR`} />
                  <Area
                    type="monotone"
                    dataKey="wert"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.1}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground lg:col-span-2">
              Keine Positionshistorie verfuegbar.
            </div>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
