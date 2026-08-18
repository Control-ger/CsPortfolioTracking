import { useState } from "react";
import { useTranslation } from "react-i18next";
import { translate } from "../lib/i18n/index.js";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

import { Button } from "./ui/button";
import { StatusPill } from "./ui/status-pill";
import { ItemThumb } from "./ui/item-thumb";
import {
  Inspector,
  InspectorBlock,
  InspectorEmpty,
  InspectorFooter,
  InspectorHeader,
  InspectorPrice,
  InspectorStat,
} from "./ui/inspector";
import { ExcludeInvestmentDialog } from "./ExcludeInvestmentDialog";
import { toggleExcludeInvestment } from "../lib/apiClient";
import { PortfolioChart } from "./PortfolioChart";
import { GroupWeightingList } from "./GroupWeightingList";
import { resolveItemCategorySingular } from "../lib/portfolioCalculations.js";
import { useCurrency } from "@shared/contexts/CurrencyContext";

/**
 * Stacked preview for a group selection, sized to the inspector's 64px header
 * slot so a group and a single item produce the same header height.
 */
function LayeredPreview({ visuals = [], fallbackLabel = "Group" }) {
  const items = Array.isArray(visuals) ? visuals.slice(0, 2) : [];

  return (
    <div className="relative h-16 w-[86px] shrink-0">
      {items.length === 0 ? (
        <div className="flex size-16 items-center justify-center rounded-[10px] border border-border bg-surface-1 text-xs font-bold text-muted-foreground">
          {String(fallbackLabel || "Group").slice(0, 2).toUpperCase()}
        </div>
      ) : null}
      {items.map((entry, index) => (
        <div
          key={entry?.id || `${entry?.name || fallbackLabel}-${index}`}
          className={`absolute top-0 flex size-16 items-center justify-center overflow-hidden rounded-[10px] border p-1 ${
            index === 0
              ? "left-0 z-20 -rotate-3 border-border bg-card"
              : "left-[22px] z-10 rotate-[4deg] border-border-soft bg-surface-1"
          }`}
        >
          {entry?.imageUrl ? (
            <img
              src={entry.imageUrl}
              alt={entry?.name || "Group visual"}
              className="size-full object-contain"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="text-xs font-bold text-muted-foreground">
              {String(entry?.name || fallbackLabel || "Group").slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function deriveBuyInReferenceValue(item) {
  // PortfolioChart works internally in USD, so the buy-in reference line must be USD too.
  // Groups plot total value → reference is the group's total invested (USD).
  if (item?.__detailKind === "group") {
    const totalInvestedUsd = Number(item?.totalInvested ?? item?.costBasisTotal);
    return Number.isFinite(totalInvestedUsd) && totalInvestedUsd > 0 ? totalInvestedUsd : null;
  }

  // Single items / clusters plot unit price → reference is the unit buy price (USD).
  const buyPriceUsd = Number(item?.buyPriceUsd);
  return Number.isFinite(buyPriceUsd) && buyPriceUsd > 0 ? buyPriceUsd : null;
}

function deriveBuyInReferenceTimestamp(item) {
  const candidates = [item?.purchasedAt, item?.purchaseDate, item?.createdAt, item?.updatedAt];

  for (const candidate of candidates) {
    const timestamp = Date.parse(String(candidate || ""));
    if (Number.isFinite(timestamp) && timestamp > 0) {
      return timestamp;
    }
  }

  return null;
}

function resolvePurchaseUnitDisplay(item, formatPrice) {
  const costBasisUnit = Number(item?.costBasisUnit);
  if (Number.isFinite(costBasisUnit) && costBasisUnit > 0) {
    return formatPrice(costBasisUnit);
  }

  const buyPriceEur = Number(item?.buyPrice);
  if (Number.isFinite(buyPriceEur) && buyPriceEur > 0) {
    return formatPrice(buyPriceEur);
  }

  const buyPriceUsd = Number(item?.buyPriceUsd);
  if (Number.isFinite(buyPriceUsd) && buyPriceUsd > 0) {
    return formatPrice(buyPriceUsd, { useUsd: true, buyPriceUsd });
  }

  return formatPrice(0);
}

/**
 * "Field-Tested · Rifle · Wallet" — the design's uppercase context line.
 *
 * Aggregates get their own wording: `type` on a group selection is the literal
 * string "group" and `fundingMode` is undefined, so the item form would render
 * "GROUP · INVESTMENT · WALLET" — three words, none of them true.
 */
function buildMetaLine(item) {
  // Module-level, so this reads through `translate` rather than the hook — the
  // same escape hatch the other pure formatters use.
  const bucketLabel =
    String(item?.bucket || "investment").toLowerCase() === "inventory"
      ? translate("inventory:detail.inventory")
      : translate("inventory:detail.investment");

  if (item?.__detailKind === "group") {
    const clusterCount = Array.isArray(item?.clusters) ? item.clusters.length : 0;
    const memberCount = Array.isArray(item?.sourceInvestmentIds)
      ? item.sourceInvestmentIds.length
      : 0;
    return [
      translate("inventory:detail.group"),
      clusterCount > 0 ? translate("inventory:detail.clustersCount", { count: clusterCount }) : null,
      memberCount > 0 ? translate("inventory:detail.positionsCount", { count: memberCount }) : null,
      bucketLabel,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (item?.__detailKind === "group-cluster") {
    return [
      translate("inventory:detail.cluster"),
      translate("inventory:detail.piecesShort", { count: Number(item?.quantity || 0) }),
      bucketLabel,
    ].join(" · ");
  }

  const fundingLabel =
    item?.fundingMode === "cash_in"
      ? translate("inventory:detail.cashIn")
      : translate("inventory:detail.wallet");
  // Catalogue category, not `item.type`: that field is importer-supplied and
  // defaults to "skin", so the inspector labelled every case, sticker and
  // capsule "SKIN" while the table row beside it said "CASE". Same resolver the
  // table uses, so the two cannot disagree.
  return [resolveItemCategorySingular(item), bucketLabel, fundingLabel]
    .filter(Boolean)
    .join(" · ");
}

export const ItemDetailPanel = ({
  item,
  history,
  historyLoading,
  onExcludeChange,
  onBucketChange,
  canToggleExclude = true,
  // Groups support the bucket toggle (moves all members) but not exclusion,
  // so the two capabilities are gated separately.
  canToggleBucket = canToggleExclude,
}) => {
  const { t } = useTranslation("inventory");
  const { currency, formatPrice } = useCurrency();
  const [excludeDialogOpen, setExcludeDialogOpen] = useState(false);
  const [isExcludeLoading, setIsExcludeLoading] = useState(false);
  const [showAbsolute, setShowAbsolute] = useState(false);
  const excludeEnabled = canToggleExclude && typeof onExcludeChange === "function";
  const bucketToggleEnabled = canToggleBucket && typeof onBucketChange === "function";
  const isGroupSelection = item?.__detailKind === "group";
  // Group and cluster selections carry `livePrice` as a *weighted unit* price
  // (see buildGroupDetailSelection); their headline number is the aggregate
  // value, which is also what the table row shows for them.
  const isAggregateSelection = isGroupSelection || item?.__detailKind === "group-cluster";

  if (!item) {
    return (
      <InspectorEmpty>
        {t("detail.pickPosition")}
        <br />
        um Details zu sehen.
      </InspectorEmpty>
    );
  }

  const handleExcludeConfirm = async (newExcludeState) => {
    setIsExcludeLoading(true);
    try {
      await toggleExcludeInvestment(item.id, newExcludeState, item.sourceInvestmentIds || []);
      setExcludeDialogOpen(false);
      if (onExcludeChange) {
        onExcludeChange(item.id, newExcludeState);
      }
    } catch (error) {
      console.error("Failed to toggle exclude:", error);
    } finally {
      setIsExcludeLoading(false);
    }
  };

  const handleBucketToggle = async () => {
    if (!bucketToggleEnabled) {
      return;
    }
    const currentBucket =
      String(item?.bucket || "investment").toLowerCase() === "inventory"
        ? "inventory"
        : "investment";
    const nextBucket = currentBucket === "investment" ? "inventory" : "investment";
    await onBucketChange(item, nextBucket);
  };

  const stats6m = item.details?.stats6m;
  const roiValue = Number.isFinite(Number(item.roi)) ? Number(item.roi) : null;
  const buyInReferenceValue = deriveBuyInReferenceValue(item);
  const buyInReferenceTimestamp = deriveBuyInReferenceTimestamp(item);
  const purchaseUnitDisplay = resolvePurchaseUnitDisplay(item, formatPrice);
  const hasBuyOrder = item?.hasBuyOrder && Number(item?.buyOrderBestPriceUsd || 0) > 0;
  const buyOrderDisplay = hasBuyOrder
    ? formatPrice(Number(item.buyOrderBestPriceUsd), {
        useUsd: true,
        buyPriceUsd: Number(item.buyOrderBestPriceUsd),
      })
    : null;

  // Headline delta: absolute P/L and ROI on one line, as in the design.
  const profitTone =
    item.isProfitPositive === null || !item.isLive
      ? "muted"
      : item.isProfitPositive
        ? "success"
        : "danger";
  const headlineDelta = item.isLive
    ? [
        `${item.isProfitPositive ? "+" : ""}${formatPrice(item.profitEuro)}`,
        roiValue === null ? null : `${roiValue >= 0 ? "+" : ""}${roiValue.toFixed(1)} %`,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  // Guard for the weighting block: a group whose clusters are all unpriced has
  // no shares to rank, and would render as a stack of empty tracks.
  const hasWeightableClusters =
    isGroupSelection &&
    Array.isArray(item?.clusters) &&
    item.clusters.some((cluster) => Number(cluster?.totalValue) > 0);

  return (
    <>
      <Inspector>
        <InspectorHeader
          thumb={
            isGroupSelection ? (
              <LayeredPreview visuals={item?.topVisuals} fallbackLabel={item?.name || "Group"} />
            ) : (
              <ItemThumb
                src={item.imageUrl}
                alt={item.name}
                className="size-16 rounded-[10px] p-1"
              />
            )
          }
          title={item.name}
          meta={buildMetaLine(item)}
          badge={
            item.excluded ? (
              <StatusPill tone="warn" className="shrink-0">
                {t("detail.excluded")}
              </StatusPill>
            ) : null
          }
        />

        {/* Plain formatPrice, no `useUsd`: `livePrice`/`displayPrice`/`currentValue`
            on an enriched row all descend from `PricingService`'s `priceEur`
            (`priceUsd * usdToEurRate`), and the group/cluster aliases sum those same
            EUR fields. `buyPriceUsd` is the one genuinely-USD field here. */}
        <InspectorPrice
          value={
            !item.isLive
              ? t("detail.noPriceShort")
              : isAggregateSelection
                ? formatPrice(item.currentValue)
                : item.livePrice !== null
                  ? formatPrice(item.livePrice)
                  : t("detail.noPriceShort")
          }
          delta={headlineDelta}
          tone={profitTone}
        />

        {Array.isArray(history) && history.length > 0 ? (
          <InspectorBlock
            label={t("detail.priceTrend")}
            aside={
              <button
                type="button"
                onClick={() => setShowAbsolute((current) => !current)}
                className="font-extrabold uppercase tracking-[0.12em] transition-colors hover:text-foreground"
                title={t("detail.toggleAbsoluteGrowth")}
              >
                {showAbsolute ? currency : "%"}
              </button>
            }
          >
            <PortfolioChart
              history={history}
              title=""
              valueLabel={t("detail.price")}
              emptyLabel={t("detail.noPriceHistory")}
              isLoading={historyLoading}
              showAbsolute={showAbsolute}
              referenceLineValue={buyInReferenceValue}
              referenceLineLabel={t("detail.buyIn")}
              referenceLineTimestamp={buyInReferenceTimestamp}
              flat
            />
          </InspectorBlock>
        ) : null}

        {hasWeightableClusters ? (
          <InspectorBlock
            label={t("detail.weightingInGroup")}
            // Muted, not the `aside` slot's default info blue — the design
            // reserves that accent for the buy-order figure on the chart band.
            aside={
              <span className="font-semibold text-muted-foreground">
                {t("detail.clusters", { count: item.clusters.length })}
              </span>
            }
          >
            {/* The design's "Gewichtung in der Gruppe" is a ranked bar list at
                every width, and it is also the only readable option here: the
                inspector column is 356px, so a donut of a 21-cluster group is a
                ring of hairline slivers. Bars additionally carry the share, the
                euro value and the per-cluster ROI at once, which the donut
                cannot. */}
            <GroupWeightingList clusters={item.clusters} className="mt-2" />
          </InspectorBlock>
        ) : null}

        <InspectorStat
          label={t("detail.purchase")}
          value={`${item.quantity}x ${purchaseUnitDisplay}`}
        />
        <InspectorStat
          label={t("detail.breakEven")}
          value={formatPrice(item.breakEvenPriceNet ?? item.breakEvenPrice ?? item.buyPrice)}
        />
        {/* For aggregates the headline already *is* the position value, so this
            slot carries the weighted unit price instead of repeating it. Both
            fields are EUR like the Break-even and Cost-Basis tiles around them —
            see the headline note above. */}
        <InspectorStat
          label={isAggregateSelection ? t("detail.avgLivePrice") : t("detail.positionValue")}
          value={
            !item.isLive
              ? "N/A"
              : formatPrice(isAggregateSelection ? item.livePrice : item.currentValue)
          }
        />
        <InspectorStat
          label={t("detail.costBasis")}
          value={
            typeof item.costBasisTotal === "number" ? formatPrice(item.costBasisTotal) : "N/A"
          }
        />
        <InspectorStat
          label={t("detail.profitLoss")}
          tone={profitTone}
          value={
            item.isLive
              ? `${item.isProfitPositive ? "+" : ""}${formatPrice(item.profitEuro)}`
              : "N/A"
          }
        />
        <InspectorStat
          label={t("detail.freshness")}
          value={item.lastPriceUpdateAt || item.freshnessLabel || t("detail.unknown")}
        />

        {hasBuyOrder ? (
          <InspectorBlock label={t("detail.myBuyorder")} aside={buyOrderDisplay}>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {Number(item.buyOrderCount || 0)} Order
              {Number(item.buyOrderCount || 0) === 1 ? "" : "s"}
              {Number(item.buyOrderQuantity || 0) > 0
                ? ` · ${Number(item.buyOrderQuantity)} Menge`
                : ""}
            </p>
          </InspectorBlock>
        ) : null}

        {stats6m?.length > 0 ? (
          <InspectorBlock label={t("detail.trends6m")}>
            <div className="mt-2 h-32 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats6m}>
                  <XAxis dataKey="month" hide />
                  <Tooltip />
                  <Area
                    type="linear"
                    dataKey={item.type === "case" ? "opened" : "applied"}
                    stroke="hsl(var(--chart-1))"
                    strokeLinecap="square"
                    strokeLinejoin="miter"
                    fill="hsl(var(--chart-1))"
                    fillOpacity={0.2}
                  />
                  {item.type === "case" && (
                    <Area
                      type="linear"
                      dataKey="dropped"
                      stroke="hsl(var(--chart-2))"
                      strokeLinecap="square"
                      strokeLinejoin="miter"
                      fill="hsl(var(--chart-2))"
                      fillOpacity={0.2}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </InspectorBlock>
        ) : null}

        {excludeEnabled || bucketToggleEnabled ? (
          <InspectorFooter>
            {excludeEnabled ? (
              <Button
                variant={item.excluded ? "outline" : "softWarn"}
                size="sm"
                onClick={() => setExcludeDialogOpen(true)}
                className="h-8 flex-1"
              >
                {item.excluded ? t("detail.include") : t("detail.exclude")}
              </Button>
            ) : null}
            {bucketToggleEnabled ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleBucketToggle()}
                className="h-8 flex-1"
              >
                {String(item?.bucket || "investment").toLowerCase() === "inventory"
                  ? t("detail.toInvestments")
                  : t("detail.toInventory")}
              </Button>
            ) : null}
          </InspectorFooter>
        ) : null}
      </Inspector>

      {excludeEnabled ? (
        <ExcludeInvestmentDialog
          isOpen={excludeDialogOpen}
          onOpenChange={setExcludeDialogOpen}
          investment={item}
          onConfirm={handleExcludeConfirm}
          isLoading={isExcludeLoading}
        />
      ) : null}
    </>
  );
};
