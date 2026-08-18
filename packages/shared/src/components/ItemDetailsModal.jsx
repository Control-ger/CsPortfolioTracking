import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FieldLabel, StatTile } from "@shared/components/ui/data-display";
import { BaseModal } from "@shared/components/BaseModal";
import { PortfolioChart } from "@shared/components/PortfolioChart";
import { ItemDetailPanel } from "@shared/components/ItemDetailPanel";
import { Badge } from "@shared/components/ui/badge";
import { ExcludeInvestmentDialog } from "@shared/components/ExcludeInvestmentDialog";
import { useCurrency } from "@shared/contexts/CurrencyContext";
import { translate } from "../lib/i18n/index.js";

const formatSignedPrice = (value, formatPrice) =>
  typeof value === "number" && !Number.isNaN(value)
    ? `${value >= 0 ? "+" : "-"}${formatPrice(Math.abs(value))}`
    : "-";

const formatSignedPercent = (value) =>
  typeof value === "number" && !Number.isNaN(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
    : "-";

function deltaClassName(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "text-muted-foreground";
  }

  return value >= 0 ? "text-success" : "text-danger";
}

function freshnessBadgeClass(status) {
  switch (status) {
    case "fresh":
      return "border-success/30 bg-success/10 text-success";
    case "aging":
      return "border-warn/30 bg-warn/10 text-warn";
    case "stale":
      return "border-danger/30 bg-danger/10 text-danger";
    default:
      return "border-muted text-muted-foreground";
  }
}

function ChangeMetric({ label, percent, euro, formatPrice }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/70 bg-card/65 px-2 py-1.5">
      <FieldLabel>{label}</FieldLabel>
      <span className={`text-xs font-semibold ${deltaClassName(percent)}`}>
        {formatSignedPercent(percent)}
      </span>
      <span className={`text-[10px] ${deltaClassName(euro)}`}>{formatSignedPrice(euro, formatPrice)}</span>
    </div>
  );
}

function deriveBuyInReferenceValue(item) {
  // PortfolioChart works internally in USD, so the buy-in reference line must be USD.
  // Groups plot total value → reference is the group's total invested, not the
  // weighted unit buy price (mirrors ItemDetailPanel.deriveBuyInReferenceValue).
  if (item?.__detailKind === "group") {
    const totalInvestedUsd = Number(item?.totalInvested ?? item?.costBasisTotal);
    return Number.isFinite(totalInvestedUsd) && totalInvestedUsd > 0 ? totalInvestedUsd : null;
  }

  const buyPriceUsd = Number(item?.buyPriceUsd);
  return Number.isFinite(buyPriceUsd) && buyPriceUsd > 0 ? buyPriceUsd : null;
}

function deriveBuyInReferenceTimestamp(item) {
  const candidates = [
    item?.purchasedAt,
    item?.purchaseDate,
    item?.createdAt,
    item?.updatedAt,
  ];

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
    return formatPrice(buyPriceUsd, {
      useUsd: true,
      buyPriceUsd,
    });
  }

  return formatPrice(0);
}

export function ItemDetailsModal({
  isOpen,
  onClose,
  item,
  history = [],
  historyLoading = false,
  onToggleExclude,
  onBucketChange,
  canToggleExclude = true,
}) {
  const { t } = useTranslation("inventory");
  const { currency, formatPrice } = useCurrency();
  const [showAbsolute, setShowAbsolute] = useState(false);
  const [excludeDialogOpen, setExcludeDialogOpen] = useState(false);
  const [isExcludeLoading, setIsExcludeLoading] = useState(false);
  const excludeEnabled = canToggleExclude && typeof onToggleExclude === "function";
  const bucketToggleEnabled = canToggleExclude && typeof onBucketChange === "function";

  if (!item) return null;

  // Group / group-cluster selections reuse the shared ItemDetailPanel (which knows how to
  // render aggregates + composition donut) instead of the single-item layout below, so the
  // mobile modal matches the desktop side panel exactly. Exclusion never applies to groups;
  // whole groups may be moved between buckets, group-clusters stay read-only.
  const isGroupSelection =
    item.__detailKind === "group" || item.__detailKind === "group-cluster";

  if (isGroupSelection) {
    return (
      <BaseModal isOpen={isOpen} onClose={onClose} title={item.name} size="3xl" className="w-full md:hidden">
        <ItemDetailPanel
          item={item}
          history={history}
          historyLoading={historyLoading}
          onBucketChange={onBucketChange}
          canToggleExclude={false}
          canToggleBucket={canToggleExclude && item.__detailKind !== "group-cluster"}
        />
      </BaseModal>
    );
  }

  // Exclusion is confirmed here exactly as it is in the desktop inspector: it
  // silently removes the position from portfolio value, ROI and every
  // evaluation, and on a phone the button sits under a thumb that is already
  // scrolling. Same dialog component, so the wording cannot drift apart.
  const handleExcludeConfirm = async (nextExcluded) => {
    if (!excludeEnabled) {
      return;
    }
    setIsExcludeLoading(true);
    try {
      await onToggleExclude(item.id, nextExcluded, item.sourceInvestmentIds || []);
      setExcludeDialogOpen(false);
    } catch (error) {
      console.error("Failed to toggle exclude:", error);
    } finally {
      setIsExcludeLoading(false);
    }
  };

  const handleToggleBucket = async () => {
    if (!bucketToggleEnabled) {
      return;
    }
    const currentBucket = String(item?.bucket || "investment").toLowerCase() === "inventory"
      ? "inventory"
      : "investment";
    const nextBucket = currentBucket === "investment" ? "inventory" : "investment";
    await onBucketChange(item, nextBucket);
  };

  const togglePriceDisplay = () => {
    setShowAbsolute(!showAbsolute);
  };
  const buyInReferenceValue = deriveBuyInReferenceValue(item);
  const buyInReferenceTimestamp = deriveBuyInReferenceTimestamp(item);
  const purchaseUnitDisplay = resolvePurchaseUnitDisplay(item, formatPrice);

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title={item.name} size="3xl" className="w-full md:hidden">
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
              <strong>{t("detail.condition")}</strong> {item.wearName || "N/A"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                Bucket: {String(item?.bucket || "investment").toLowerCase() === "inventory" ? t("detail.inventory") : t("detail.investment")}
              </Badge>
              <Badge variant="outline">
                Funding: {item.fundingMode === "cash_in" ? t("detail.cashIn") : t("detail.wallet")}
              </Badge>
              <Badge variant="outline" className={freshnessBadgeClass(item.freshnessStatus)}>
                {item.freshnessLabel || translate("common:units.unknownLower")}
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          <StatTile>
            <FieldLabel>Einkauf</FieldLabel>
            <p className="mt-2 text-sm font-bold">{purchaseUnitDisplay}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{item.quantity}x {purchaseUnitDisplay}</p>
          </StatTile>

          <StatTile>
            <FieldLabel>{t("detail.live")}</FieldLabel>
            <p
              className={`mt-2 text-sm font-bold ${item.isLive ? "text-primary" : "text-muted-foreground"}`}
            >
              {item.livePrice !== null ? formatPrice(item.livePrice) : t("detail.noPrice")}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">{item.lastPriceUpdateAt || item.freshnessLabel || t("detail.unknown")}</p>
            {item?.hasBuyOrder && Number(item?.buyOrderBestPriceUsd || 0) > 0 ? (
              <p className="mt-1 inline-flex items-center gap-1 rounded border border-info/30 bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">
                Meine Buyorder: {formatPrice(Number(item.buyOrderBestPriceUsd), {
                  useUsd: true,
                  buyPriceUsd: Number(item.buyOrderBestPriceUsd),
                })}
                {Number(item?.buyOrderCount || 0) > 1
                  ? ` (${Number(item.buyOrderCount)} Orders)`
                  : ""}
              </p>
            ) : null}
          </StatTile>

          <StatTile>
            <FieldLabel>Break-even</FieldLabel>
            <p className="mt-2 text-sm font-bold">
              {formatPrice(item.breakEvenPriceNet ?? item.breakEvenPrice ?? item.buyPrice)}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">{t("detail.breakEvenHint")}</p>
          </StatTile>

          <StatTile>
            <FieldLabel>Positionswert</FieldLabel>
            <p className="mt-2 text-sm font-bold">
              {item.isLive ? formatPrice(item.currentValue) : "N/A"}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {item.isLive ? `${item.quantity}x ${formatPrice(item.displayPrice)}` : t("detail.noCsfloatPrice")}
            </p>
          </StatTile>

          <StatTile>
            <FieldLabel>Gewinn / Verlust</FieldLabel>
            <p
              className={`mt-2 text-sm font-bold ${
                item.isProfitPositive === null
                  ? "text-muted-foreground"
                  : item.isProfitPositive
                    ? "text-success"
                    : "text-danger"
              }`}
            >
              {item.isLive
                ? `${item.isProfitPositive ? "+" : ""}${formatPrice(item.profitEuro)}`
                : "N/A"}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {formatSignedPercent(item.roi)}
            </p>
          </StatTile>

          <StatTile>
            <FieldLabel>{t("detail.priceChange")}</FieldLabel>
            <div className="mt-2 space-y-1">
              <ChangeMetric
                label="24h"
                percent={item.change24hPercent}
                euro={item.change24hEuro}
                formatPrice={formatPrice}
              />
              <ChangeMetric
                label="7d"
                percent={item.change7dPercent}
                euro={item.change7dEuro}
                formatPrice={formatPrice}
              />
              <ChangeMetric
                label="30d"
                percent={item.change30dPercent}
                euro={item.change30dEuro}
                formatPrice={formatPrice}
              />
            </div>
          </StatTile>

          <StatTile>
            <FieldLabel>Cost Basis</FieldLabel>
            <p className="mt-2 text-sm font-bold">
              {typeof item.costBasisTotal === "number" ? formatPrice(item.costBasisTotal) : "N/A"}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              pro Unit: {typeof item.costBasisUnit === "number" ? formatPrice(item.costBasisUnit) : "N/A"}
            </p>
          </StatTile>
        </div>

        {historyLoading || (history && history.length > 0) ? (
          <div className="rounded-2xl border border-border/70 bg-card/65 p-3 sm:p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Preishistorie</h3>
              <button
                onClick={togglePriceDisplay}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAbsolute ? (
                  <>
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">{currency}</span>
                    <span className="text-muted-foreground/50">%</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground/50">{currency}</span>
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">%</span>
                  </>
                )}
              </button>
            </div>
            <PortfolioChart
              history={history}
              isLoading={historyLoading}
              title={t("detail.positionTrend")}
              emptyLabel={t("detail.noPositionHistory")}
              valueLabel={t("detail.positionValue")}
              showAbsolute={showAbsolute}
              referenceLineValue={buyInReferenceValue}
              referenceLineLabel={t("detail.buyIn")}
              referenceLineTimestamp={buyInReferenceTimestamp}
              disableDarkGlass
            />
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/60 p-3 sm:p-4 text-sm text-muted-foreground">
            {t("detail.noPositionHistoryShort")}
          </div>
        )}

        {/* Exclude Toggle Button */}
        {excludeEnabled && (
          <div className="sticky bottom-0 z-10 -mx-3 border-t border-border/70 bg-background/92 px-3 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-4 sm:backdrop-blur-0">
            <button
              onClick={() => setExcludeDialogOpen(true)}
              className={`flex h-10 w-full items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                (item.excluded ?? item.isExcluded)
                  ? "border-success/30 bg-success/10 text-success hover:bg-success/15"
                  : "border-warn/30 bg-warn/10 text-warn hover:bg-warn/10"
              }`}
            >
              {(item.excluded ?? item.isExcluded) ? (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {t("detail.includeInPortfolio")}
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  {t("detail.excludeFromPortfolio")}
                </>
              )}
            </button>
            {bucketToggleEnabled ? (
              <button
                onClick={() => void handleToggleBucket()}
                className="mt-2 flex h-10 w-full items-center justify-center rounded-xl border border-border/75 bg-card/70 px-4 py-2 text-sm font-medium transition-colors hover:bg-accent/70"
              >
                {String(item?.bucket || "investment").toLowerCase() === "inventory"
                  ? t("detail.moveToInvestments")
                  : t("detail.moveToInventory")}
              </button>
            ) : null}
          </div>
        )}
      </div>

      <ExcludeInvestmentDialog
        isOpen={excludeDialogOpen}
        onOpenChange={setExcludeDialogOpen}
        investment={{
          name: item.name,
          excluded: Boolean(item.excluded ?? item.isExcluded),
        }}
        onConfirm={handleExcludeConfirm}
        isLoading={isExcludeLoading}
      />
    </BaseModal>
  );
}

