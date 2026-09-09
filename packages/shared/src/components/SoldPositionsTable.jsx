import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ItemThumb } from "@shared/components/ui/item-thumb";
import {
  GridTable,
  GridTableEmpty,
  GridTableFoot,
  GridTableHead,
  GridTableRow,
} from "@shared/components/ui/grid-table";
import { useCurrency } from "@shared/contexts/CurrencyContext";
import { getActiveIntlLocale } from "@shared/lib/i18n/index.js";
import { calculateRealisedPnl, summariseRealisedPnl } from "@shared/lib/saleCalculations.js";

/**
 * Closed positions.
 *
 * Deliberately not the inventory table with a filter: a sold position has no
 * live price and no unrealised ROI, and showing those columns empty would imply
 * the numbers exist. What it has instead is a sale price, a realised result, and
 * the date it closed.
 */
const COLUMNS = "minmax(0,1fr) 62px 96px 96px 104px 92px";

function formatDate(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) {
    return "–";
  }
  return new Date(timestamp).toLocaleDateString(getActiveIntlLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function SoldPositionsTable({ sales = [], allocationsBySaleId = {}, feeSettings = {} }) {
  const { t } = useTranslation("inventory");
  const { formatPrice } = useCurrency();

  const rows = useMemo(() => {
    const list = Array.isArray(sales) ? sales : [];
    return list
      .map((sale) => ({
        sale,
        pnl: calculateRealisedPnl(sale, allocationsBySaleId[sale.id] || [], feeSettings),
      }))
      .sort((left, right) =>
        String(right.sale.soldAt || "").localeCompare(String(left.sale.soldAt || "")),
      );
  }, [sales, allocationsBySaleId, feeSettings]);

  const totals = useMemo(() => summariseRealisedPnl(rows.map((row) => row.pnl)), [rows]);

  // Prices are stored per unit in USD; `useUsd` keeps the conversion honest
  // instead of treating a USD figure as if it were the display currency.
  const money = (usd) => formatPrice(Number(usd || 0), { useUsd: true, buyPriceUsd: Number(usd || 0) });

  return (
    <GridTable>
      <GridTableHead columns={COLUMNS}>
        <span>{t("columns.position")}</span>
        <span className="text-right">{t("sold.quantity")}</span>
        <span className="text-right">{t("sold.costBasis")}</span>
        <span className="text-right">{t("sold.proceeds")}</span>
        <span className="text-right">{t("sold.realised")}</span>
        <span className="text-right">{t("sold.soldAt")}</span>
      </GridTableHead>

      {rows.length === 0 ? (
        <GridTableEmpty>{t("sold.empty")}</GridTableEmpty>
      ) : (
        rows.map(({ sale, pnl }) => {
          const positive = pnl.netProfitUsd >= 0;
          return (
            <GridTableRow key={sale.id} columns={COLUMNS}>
              <div className="flex min-w-0 items-center gap-[11px]">
                <ItemThumb src={sale.imageUrl} alt={sale.name} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-bold">{sale.name}</span>
                  <span className="mt-[3px] block truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    {sale.platform}
                    {pnl.unallocatedQuantity > 0
                      ? ` · ${t("sold.unmatched", { count: pnl.unallocatedQuantity })}`
                      : ""}
                  </span>
                </span>
              </div>
              <span className="text-right text-[13px] tabular-nums">{pnl.quantity}</span>
              <span className="text-right text-[13px] tabular-nums text-muted-foreground">
                {pnl.costUsd > 0 ? money(pnl.costUsd) : "–"}
              </span>
              <span className="text-right text-[13px] tabular-nums">{money(pnl.netUsd)}</span>
              <span
                className={`text-right text-[13px] font-bold tabular-nums ${
                  pnl.costUsd > 0 ? (positive ? "text-success" : "text-danger") : "text-muted-foreground"
                }`}
              >
                {pnl.costUsd > 0 ? `${positive ? "+" : ""}${money(pnl.netProfitUsd)}` : "–"}
              </span>
              <span className="text-right text-[12px] tabular-nums text-muted-foreground">
                {formatDate(sale.soldAt)}
              </span>
            </GridTableRow>
          );
        })
      )}

      {rows.length > 0 ? (
        <GridTableFoot columns={COLUMNS}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {t("sold.totalLabel", { count: totals.sales })}
          </span>
          <span className="text-right text-[12px] tabular-nums">{totals.quantity}</span>
          <span className="text-right text-[12px] tabular-nums text-muted-foreground">
            {money(totals.costUsd)}
          </span>
          <span className="text-right text-[12px] tabular-nums">{money(totals.netUsd)}</span>
          <span
            className={`text-right text-[12px] font-bold tabular-nums ${
              totals.netProfitUsd >= 0 ? "text-success" : "text-danger"
            }`}
          >
            {totals.netProfitUsd >= 0 ? "+" : ""}
            {money(totals.netProfitUsd)}
            {totals.roiPercent !== null ? (
              <span className="ml-1.5 font-semibold text-muted-foreground">
                {totals.roiPercent >= 0 ? "+" : ""}
                {totals.roiPercent.toFixed(1)}%
              </span>
            ) : null}
          </span>
          <span />
        </GridTableFoot>
      ) : null}
    </GridTable>
  );
}
