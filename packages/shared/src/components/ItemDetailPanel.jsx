import { useState } from "react";
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
import { PortfolioCompositionChart } from "./PortfolioCompositionChart";
import { GroupWeightingList } from "./GroupWeightingList";
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
  const bucketLabel =
    String(item?.bucket || "investment").toLowerCase() === "inventory" ? "Inventar" : "Investment";

  if (item?.__detailKind === "group") {
    const clusterCount = Array.isArray(item?.clusters) ? item.clusters.length : 0;
    const memberCount = Array.isArray(item?.sourceInvestmentIds)
      ? item.sourceInvestmentIds.length
      : 0;
    return [
      "Gruppe",
      clusterCount > 0 ? `${clusterCount} Cluster` : null,
      memberCount > 0 ? `${memberCount} Positionen` : null,
      bucketLabel,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (item?.__detailKind === "group-cluster") {
    return ["Cluster", `${Number(item?.quantity || 0)} Stk.`, bucketLabel].join(" · ");
  }

  const fundingLabel = item?.fundingMode === "cash_in" ? "Cash-In" : "Wallet";
  return [item?.type, bucketLabel, fundingLabel].filter(Boolean).join(" · ");
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
        Wähle eine Position aus der Liste,
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

  // Cluster weighting for the group composition donut. Values follow the group's
  // display-currency convention (see buildGroupDetailSelection), so the donut is
  // fed with valuesAreUsd={false} to match the group's stat rows/table row.
  const clusterCompositionData =
    isGroupSelection && Array.isArray(item?.clusters)
      ? item.clusters
          .map((cluster) => ({
            name: cluster?.name || "Cluster",
            value: Number(cluster?.totalValue || 0),
            count: Number(cluster?.quantity || 0),
            type: cluster?.type || "cluster",
          }))
          .filter((row) => Number.isFinite(row.value) && row.value > 0)
      : [];

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
                Ausgeschlossen
              </StatusPill>
            ) : null
          }
        />

        <InspectorPrice
          value={
            !item.isLive
              ? "Kein Preis"
              : isAggregateSelection
                ? formatPrice(item.currentValue)
                : item.livePrice !== null
                  ? formatPrice(item.livePrice)
                  : "Kein Preis"
          }
          delta={headlineDelta}
          tone={profitTone}
        />

        {Array.isArray(history) && history.length > 0 ? (
          <InspectorBlock
            label="Preisentwicklung"
            aside={
              <button
                type="button"
                onClick={() => setShowAbsolute((current) => !current)}
                className="font-extrabold uppercase tracking-[0.12em] transition-colors hover:text-foreground"
                title="Zwischen Absolutwert und Wachstum umschalten"
              >
                {showAbsolute ? currency : "%"}
              </button>
            }
          >
            <PortfolioChart
              history={history}
              title=""
              valueLabel="Preis"
              emptyLabel="Noch keine Preishistorie verfügbar"
              isLoading={historyLoading}
              showAbsolute={showAbsolute}
              referenceLineValue={buyInReferenceValue}
              referenceLineLabel="Buy-In"
              referenceLineTimestamp={buyInReferenceTimestamp}
              flat
            />
          </InspectorBlock>
        ) : null}

        {isGroupSelection && clusterCompositionData.length > 0 ? (
          <InspectorBlock label="Cluster-Gewichtung">
            {/* Two renderings of the same clusters, one per breakpoint. The donut
                is unreadable at phone width (a group of 20 becomes hairline
                slivers), and the bar list wastes the horizontal room the desktop
                panel has. */}
            <GroupWeightingList clusters={item.clusters} className="mt-2 sm:hidden" />
            <div className="mt-2 hidden sm:block">
              <PortfolioCompositionChart
                data={clusterCompositionData}
                valuesAreUsd={false}
                totalValueOverride={Number(item?.totalValue ?? item?.currentValue ?? 0)}
                centerLabel="Gruppenwert"
                shareSuffix="der Gruppe"
                assetCountLabel="Cluster"
              />
            </div>
          </InspectorBlock>
        ) : null}

        <InspectorStat
          label="Einkauf"
          value={`${item.quantity}x ${purchaseUnitDisplay}`}
        />
        <InspectorStat
          label="Break-even"
          value={formatPrice(item.breakEvenPriceNet ?? item.breakEvenPrice ?? item.buyPrice)}
        />
        {/* For aggregates the headline already *is* the position value, so this
            slot carries the weighted unit price instead of repeating it. */}
        <InspectorStat
          label={isAggregateSelection ? "Ø Live-Preis" : "Positionswert"}
          value={
            !item.isLive
              ? "N/A"
              : formatPrice(isAggregateSelection ? item.livePrice : item.currentValue)
          }
        />
        <InspectorStat
          label="Cost Basis"
          value={
            typeof item.costBasisTotal === "number" ? formatPrice(item.costBasisTotal) : "N/A"
          }
        />
        <InspectorStat
          label="Gewinn / Verlust"
          tone={profitTone}
          value={
            item.isLive
              ? `${item.isProfitPositive ? "+" : ""}${formatPrice(item.profitEuro)}`
              : "N/A"
          }
        />
        <InspectorStat
          label="Freshness"
          value={item.lastPriceUpdateAt || item.freshnessLabel || "Unbekannt"}
        />

        {hasBuyOrder ? (
          <InspectorBlock label="Meine Buyorder · CSFloat" aside={buyOrderDisplay}>
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
          <InspectorBlock label="Trends · 6 Monate">
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
                {item.excluded ? "Einschließen" : "Ausschließen"}
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
                  ? "Zu Investments"
                  : "Zum Inventar"}
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
