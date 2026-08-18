import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@shared/contexts/CurrencyContext";
import { cn } from "../lib/utils.js";
import { formatPercent as formatPercentLocale } from "../lib/portfolioHelpers.js";
import { ItemName } from "./ui/item-name.jsx";

const TOP_COUNT = 5;

/**
 * Ranked share-of-group list for a portfolio group's clusters.
 *
 * The mobile counterpart of the `Cluster-Gewichtung` donut: a donut splits a
 * 380px-wide group into hairline slivers and reads as empty, which is the same
 * problem the dashboard allocation bar already solved. Bars also carry the two
 * figures the donut cannot show at once — the euro value and the per-cluster
 * ROI — which is what makes the block worth tapping into on a phone.
 *
 * Long tail is collapsed into one "Rest" row rather than scrolled: a group with
 * 40 members otherwise buries the toggle below a full screen of 6px bars.
 */
export function GroupWeightingList({ clusters, className }) {
  const { t } = useTranslation("inventory");
  const { formatPrice } = useCurrency();
  const [showAll, setShowAll] = useState(false);

  const rows = Array.isArray(clusters) ? clusters : [];
  if (rows.length === 0) {
    return null;
  }

  // `sharePercent` is computed against the group total in portfolioGroups.js, so
  // the tail share is derived from the same base rather than re-summing values
  // that may carry unpriced (0) clusters.
  const ranked = [...rows].sort((left, right) => (right.totalValue ?? 0) - (left.totalValue ?? 0));
  const hasRest = ranked.length > TOP_COUNT && !showAll;
  const shown = showAll ? ranked : ranked.slice(0, TOP_COUNT);
  const rest = hasRest ? ranked.slice(TOP_COUNT) : [];

  const sumShare = (list) => list.reduce((total, row) => total + (Number(row.sharePercent) || 0), 0);
  const sumValue = (list) => list.reduce((total, row) => total + (Number(row.totalValue) || 0), 0);
  const sumQuantity = (list) => list.reduce((total, row) => total + (Number(row.quantity) || 0), 0);

  const topShare = sumShare(ranked.slice(0, TOP_COUNT));

  const formatPercent = (value) => formatPercentLocale(value, 1);

  return (
    <div className={cn("rounded-2xl border border-border-soft bg-surface-1 p-3.5", className)}>
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="text-xs font-extrabold">{t("detail.weightingInGroup")}</span>
        <span className="shrink-0 text-[10.5px] text-muted-foreground">
          {t("detail.clusters", { count: ranked.length })}
        </span>
      </div>

      <div
        className={cn(
          "mt-3.5 flex flex-col gap-3",
          showAll && ranked.length > TOP_COUNT ? "max-h-[236px] overflow-y-auto pr-1" : null,
        )}
      >
        {shown.map((row) => {
          const roi = Number(row.roiPercent) || 0;
          return (
            <div key={row.id ?? row.name} className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2">
                <ItemName name={row.name} className="flex-1" nameClassName="text-xs font-bold" />
                <span className="shrink-0 text-[10.5px] text-muted-foreground">
                  {Number(row.quantity) || 0}x
                </span>
                <span
                  className={cn(
                    "inline-flex h-[19px] shrink-0 items-center rounded-full px-[7px] text-[10px] font-bold tabular-nums",
                    roi >= 0 ? "bg-success/15 text-success" : "bg-danger/15 text-danger",
                  )}
                >
                  {roi >= 0 ? "+" : "−"}
                  {formatPercentLocale(Math.abs(roi), 1)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="block h-full rounded-full bg-foreground"
                    style={{ width: `${Math.min(100, Math.max(0, Number(row.sharePercent) || 0))}%` }}
                  />
                </span>
                <span className="w-11 shrink-0 text-right text-[11px] font-bold tabular-nums">
                  {formatPercent(row.sharePercent)}
                </span>
                <span className="w-[62px] shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-muted-foreground">
                  {formatPrice(row.totalValue)}
                </span>
              </div>
            </div>
          );
        })}

        {hasRest ? (
          <div className="flex flex-col gap-1.5 border-t border-dashed border-border pt-2.5">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-bold text-muted-foreground">
                {rest.length} weitere Cluster
              </span>
              <span className="shrink-0 text-[10.5px] text-muted-foreground">
                {sumQuantity(rest)}x
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full bg-foreground opacity-25"
                  style={{ width: `${Math.min(100, Math.max(0, sumShare(rest)))}%` }}
                />
              </span>
              <span className="w-11 shrink-0 text-right text-[11px] font-bold tabular-nums text-muted-foreground">
                {formatPercent(sumShare(rest))}
              </span>
              <span className="w-[62px] shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-muted-foreground">
                {formatPrice(sumValue(rest))}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {ranked.length > TOP_COUNT ? (
        <button
          type="button"
          onClick={() => setShowAll((current) => !current)}
          className="mt-3.5 h-8 w-full rounded-[9px] border border-border bg-transparent text-[11.5px] font-bold transition-colors hover:bg-surface-2"
        >
          {showAll ? `Nur Top ${TOP_COUNT} zeigen` : `Alle ${ranked.length} Cluster zeigen`}
        </button>
      ) : null}

      <p className="mt-3 text-[10.5px] text-muted-foreground">
        {ranked.length > TOP_COUNT
          ? `Top ${TOP_COUNT} = ${topShare.toFixed(0)} % des Gruppenwerts · `
          : ""}
        Anteil am Live-Wert, ROI je Cluster
      </p>
    </div>
  );
}
