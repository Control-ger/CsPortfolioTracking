import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

import { BaseModal } from "@shared/components/BaseModal";
import { Badge } from "@shared/components/ui/badge";
import { BREAKPOINTS } from "@shared/lib/constants";
import { useCurrency } from "@shared/contexts/CurrencyContext";

const formatSignedPercent = (value) =>
  typeof value === "number" && !Number.isNaN(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
    : "-";

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

function ChangeMetric({ label, percent, euro, formatSignedPrice }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/70 bg-card/65 px-2 py-1.5">
      <span className="text-[10px] uppercase text-muted-foreground">{label}</span>
      <span className={`text-xs font-semibold ${deltaClassName(percent)}`}>
        {formatSignedPercent(percent)}
      </span>
      <span className={`text-[10px] ${deltaClassName(euro)}`}>{formatSignedPrice(euro)}</span>
    </div>
  );
}

export function ItemDetailModal({ isOpen, onClose, item, history = [] }) {
  const { formatPrice } = useCurrency();
  const [isSmallScreen, setIsSmallScreen] = useState(window.innerWidth < BREAKPOINTS.MOBILE);
  const formatSignedPrice = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return "-";
    }
    const sign = value >= 0 ? "+" : "-";
    return `${sign}${formatPrice(Math.abs(value))}`;
  };

  useEffect(() => {
    const handleResize = () => {
      setIsSmallScreen(window.innerWidth < BREAKPOINTS.MOBILE);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!item) {
    return null;
  }

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title={item.name} size="3xl" className="w-full sm:max-w-2xl md:max-w-4xl">
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <div className="h-24 w-24 sm:h-32 sm:w-32 shrink-0 overflow-hidden rounded-xl border border-border/75 bg-muted/25 p-1">
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt={item.name}
                className="h-full w-full object-contain"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                N/A
              </div>
            )}
          </div>
          <div className="space-y-2 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {item.type}
            </p>
            <p className="text-sm">
              <strong>Condition:</strong> {item.wearName || "N/A"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={freshnessBadgeClass(item.freshnessStatus)}>
                {item.freshnessLabel || "unbekannt"}
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:gap-6 lg:grid-cols-3">
          <div className="space-y-2 sm:space-y-3 lg:col-span-1">
            <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Einkauf</p>
              <p className="text-sm font-bold">{formatPrice(item.buyPrice)}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {item.quantity}x {formatPrice(item.buyPrice)}
              </p>
            </div>

            <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Break-even</p>
              <p className="text-sm font-bold">
                {formatPrice(item.breakEvenPrice ?? item.buyPrice)}
              </p>
              <p className={`mt-1 text-[10px] ${deltaClassName(item.breakEvenDeltaEuro)}`}>
                {formatSignedPrice(item.breakEvenDeltaEuro)}
              </p>
            </div>

            <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Live</p>
              <p
                className={`text-sm font-bold ${item.isLive ? "text-primary" : "text-muted-foreground"}`}
              >
                {item.livePrice !== null ? formatPrice(item.livePrice) : "Kein Preis verfuegbar"}
              </p>
            </div>

            <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Position</p>
              <p className="text-sm font-bold">{item.isLive ? formatPrice(item.currentValue) : "N/A"}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {item.isLive ? `${item.quantity}x ${formatPrice(item.displayPrice)}` : "Kein csfloat-Preis vorhanden"}
              </p>
            </div>

            <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Gewinn/Verlust</p>
              <p
                className={`text-sm font-bold ${
                  item.isProfitPositive === null
                    ? "text-muted-foreground"
                    : item.isProfitPositive
                      ? "text-emerald-400"
                      : "text-red-400"
                }`}
              >
                {item.isLive
                  ? `${item.isProfitPositive ? "+" : ""}${formatPrice(item.profitEuro)}`
                  : "N/A"}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">{formatSignedPercent(item.roi)}</p>
            </div>

            <div className="rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3">
              <p className="mb-2 text-[10px] uppercase text-muted-foreground">Price Change</p>
              <div className="space-y-1">
                <ChangeMetric
                  label="24h"
                  percent={item.change24hPercent}
                  euro={item.change24hEuro}
                  formatSignedPrice={formatSignedPrice}
                />
                <ChangeMetric
                  label="7d"
                  percent={item.change7dPercent}
                  euro={item.change7dEuro}
                  formatSignedPrice={formatSignedPrice}
                />
                <ChangeMetric
                  label="30d"
                  percent={item.change30dPercent}
                  euro={item.change30dEuro}
                  formatSignedPrice={formatSignedPrice}
                />
              </div>
            </div>
          </div>

          {history && history.length > 0 ? (
            <div className="p-0 lg:col-span-2">
              <h3 className="mb-3 sm:mb-4 text-sm font-semibold">Preishistorie</h3>
              <ResponsiveContainer width="100%" height={isSmallScreen ? 200 : 280}>
                <AreaChart data={history}>
                  <XAxis dataKey="date" fontSize={10} />
                  <Tooltip formatter={(value) => formatPrice(Number(value))} />
                  <Area
                    type="linear"
                    dataKey="wert"
                    stroke="#3b82f6"
                    strokeLinecap="square"
                    strokeLinejoin="miter"
                    fill="#3b82f6"
                    fillOpacity={0.1}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center p-3 sm:p-4 text-sm text-muted-foreground lg:col-span-2">
              Keine Positionshistorie verfuegbar.
            </div>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
