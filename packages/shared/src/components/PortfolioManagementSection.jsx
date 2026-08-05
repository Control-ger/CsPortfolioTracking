import { Suspense, lazy, useState } from "react";
import { Check, Info, Link2, Search } from "lucide-react";
import { Badge } from "./ui/badge.jsx";
import { Button } from "./ui/button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.jsx";
import { Skeleton } from "./ui/skeleton.jsx";
import { LayeredGroupIcon } from "./LayeredGroupIcon.jsx";
import { StatusPill } from "./ui/status-pill.jsx";
import { SegmentedControl } from "./ui/segmented-control.jsx";
import { ItemThumb } from "./ui/item-thumb.jsx";
import { SectionLabel, MetaRow } from "./ui/data-display.jsx";
import { NativeSelect } from "./ui/native-select.jsx";
import { ManualMatchModal } from "./ManualMatchModal.jsx";
import {
  PORTFOLIO_GROUP_COLORS,
  normalizePortfolioGroupColor,
} from "../lib/portfolioGroups.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip.jsx";
import {
  formatDateSafe,
  buildPositionLots,
  MANUAL_ITEM_TYPES,
} from "../lib/portfolioHelpers.js";
import {
  uniqueInvestmentIds,
  normalizeInvestmentId,
} from "../lib/portfolioGroups.js";
import { useCurrency } from "../contexts/CurrencyContext.jsx";
import { resolveInvestmentDate } from "../lib/yearWrapped.js";

// Human-readable labels for the match `reason` codes produced by
// calculateSteamCsfloatMatch (see apps/desktop/src/localStore/utils.js). These are
// the signals that earned the score, surfaced as chips so a match can be judged at a
// glance instead of trusting a bare number.
const MATCH_REASON_LABELS = {
  same_type: "Typ",
  exact_core_name: "Name exakt",
  token_overlap_high: "Name ~hoch",
  token_overlap_medium: "Name ~mittel",
  token_overlap_low: "Name ~niedrig",
  wear_exact: "Wear",
  float_exact: "Float exakt",
  float_near: "Float nah",
  float_loose: "Float grob",
  seed_exact: "Seed",
  price_near: "Preis nah",
  price_loose: "Preis grob",
  time_near: "Zeit nah",
  time_medium: "Zeit mittel",
  time_loose: "Zeit grob",
};

// `accentText`/`accentBar` drive the score column: the confidence reads as a colour
// before it reads as a word, so a card can be judged without parsing the number.
const MATCH_CONFIDENCE_META = {
  high: {
    label: "Hoch",
    tone: "success",
    className: "border-success/40 text-success",
    accentText: "text-success",
    accentBar: "bg-success",
  },
  medium: {
    label: "Mittel",
    tone: "warn",
    className: "border-warn/40 text-warn",
    accentText: "text-warn",
    accentBar: "bg-warn",
  },
  low: {
    label: "Niedrig",
    tone: "neutral",
    className: "border-muted-foreground/40 text-muted-foreground",
    accentText: "text-muted-foreground",
    accentBar: "bg-muted-foreground",
  },
};

// Highest score the scorer can realistically award (every reason code firing at once).
// The meter is a share of that ceiling, not of 100, so a 102 does not render as
// "over full".
const MATCH_SCORE_METER_MAX = 110;

// Group accent colours, resolved against the design tokens so both themes work.
const GROUP_COLOR_SWATCH = {
  success: "bg-success",
  info: "bg-info",
  warn: "bg-warn",
  danger: "bg-danger",
  muted: "bg-muted-foreground",
};
const GROUP_COLOR_CHIP = {
  success: "border-success/45 bg-success/12",
  info: "border-info/45 bg-info/12",
  warn: "border-warn/45 bg-warn/12",
  danger: "border-danger/45 bg-danger/12",
  muted: "border-border-strong bg-surface-2",
};
const GROUP_COLOR_TEXT = {
  success: "text-success",
  info: "text-info",
  warn: "text-warn",
  danger: "text-danger",
  muted: "text-muted-foreground",
};

// The five Verwaltung tabs, in the order the design presents them.
const MANAGEMENT_TABS = [
  { value: "matching", label: "Matching" },
  { value: "prices", label: "Preise" },
  { value: "exclude", label: "Exclude" },
  { value: "groups", label: "Gruppen" },
  { value: "create", label: "Hinzufügen" },
];

// Point value each reason code contributes — kept in lockstep with the scorer in
// apps/desktop/src/localStore/utils.js (calculateSteamCsfloatMatch). Every fired code
// maps to exactly one value, so the listed contributions add up to the stored score:
// this is what makes the confidence traceable instead of a black-box number.
const MATCH_REASON_POINTS = {
  same_type: 12,
  exact_core_name: 50,
  token_overlap_high: 36,
  token_overlap_medium: 24,
  token_overlap_low: 12,
  wear_exact: 8,
  float_exact: 22,
  float_near: 14,
  float_loose: 6,
  seed_exact: 20,
  price_near: 10,
  price_loose: 5,
  time_near: 12,
  time_medium: 7,
  time_loose: 5,
};

// Mirrors the confidence thresholds in calculateSteamCsfloatMatch.
const MATCH_CONFIDENCE_HIGH_SCORE = 88;
const MATCH_CONFIDENCE_MEDIUM_SCORE = 68;

const POSITION_SOURCE_LABELS = {
  steam_inventory: "Steam Sync",
  csfloat: "CSFloat",
  skinbaron: "SkinBaron",
};

function resolvePositionSourceLabel(platform) {
  return POSITION_SOURCE_LABELS[String(platform || "").toLowerCase()] || "Manuell";
}

// Ids (steam asset ids + csfloat investment ids) that are part of a resolved
// Steam<->CSFloat match — used to render the chain badge on both linked positions.
function buildResolvedMatchIdSet(matchingRows = []) {
  const resolved = new Set();
  (Array.isArray(matchingRows) ? matchingRows : []).forEach((row) => {
    const status = String(row?.status || "").toLowerCase();
    if (status !== "manual_confirmed" && status !== "auto_linked") {
      return;
    }
    const steamAssetId = String(row?.steamAssetId || "").trim();
    const csfloatInvestmentId = String(row?.csfloatInvestmentId || "").trim();
    if (steamAssetId) {
      resolved.add(steamAssetId);
    }
    if (csfloatInvestmentId) {
      resolved.add(csfloatInvestmentId);
    }
  });
  return resolved;
}

function isPositionMatchLinked(position, resolvedMatchIds) {
  if (!resolvedMatchIds || resolvedMatchIds.size === 0) {
    return false;
  }
  const candidates = [position?.steamAssetId, position?.id];
  return candidates.some((value) => {
    const normalized = String(value || "").trim();
    return normalized !== "" && resolvedMatchIds.has(normalized);
  });
}

function parseMatchReasons(reason) {
  return String(reason || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function formatMatchFloat(value) {
  if (!Number.isFinite(value)) {
    return "?";
  }
  // CS floats live in 0..1; show enough precision to be meaningful without noise.
  return value
    .toFixed(6)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

// Turn the persisted per-signal metrics into the concrete deviation the user wants to
// see (actual float delta, price gap %, day gap, name overlap %), per reason code.
function formatMatchMetric(code, metrics) {
  if (!metrics || typeof metrics !== "object") {
    return null;
  }
  switch (code) {
    case "same_type":
      return metrics.type ? String(metrics.type) : null;
    case "exact_core_name":
      return "Name identisch";
    case "token_overlap_high":
    case "token_overlap_medium":
    case "token_overlap_low":
      return Number.isFinite(metrics.overlap)
        ? `${Math.round(metrics.overlap * 100)}% Namensüberlappung`
        : null;
    case "wear_exact":
      return metrics.wear ? String(metrics.wear).toUpperCase() : null;
    case "float_exact":
    case "float_near":
    case "float_loose":
      return Number.isFinite(metrics.floatDiff)
        ? `Δ ${formatMatchFloat(metrics.floatDiff)} (${formatMatchFloat(metrics.steamFloat)} ↔ ${formatMatchFloat(metrics.csfloatFloat)})`
        : null;
    case "seed_exact":
      return metrics.seed !== undefined && metrics.seed !== null
        ? `Seed ${metrics.seed} (identisch)`
        : null;
    case "price_near":
    case "price_loose":
      return Number.isFinite(metrics.priceDiffRatio)
        ? `${(metrics.priceDiffRatio * 100).toFixed(1)}% Preisabweichung`
        : null;
    case "time_near":
    case "time_medium":
    case "time_loose":
      return Number.isFinite(metrics.dayDiff)
        ? `${metrics.dayDiff.toFixed(1)} Tage Abstand`
        : null;
    default:
      return null;
  }
}

// Build the per-signal rows for one match. Prefer the persisted breakdown (carries the
// raw measured deviations); fall back to the bare reason codes for matches synced
// before the breakdown column existed — those still show label + points, just no delta.
function buildMatchBreakdownRows(scoreBreakdown, reasonCodes) {
  if (Array.isArray(scoreBreakdown) && scoreBreakdown.length > 0) {
    return scoreBreakdown.map((entry) => {
      const code = String(entry?.code || "");
      const points = Number.isFinite(entry?.points)
        ? entry.points
        : MATCH_REASON_POINTS[code];
      return {
        code,
        points,
        label: MATCH_REASON_LABELS[code] || code,
        detail: formatMatchMetric(code, entry?.metrics),
      };
    });
  }
  return reasonCodes.map((code) => ({
    code,
    points: MATCH_REASON_POINTS[code],
    label: MATCH_REASON_LABELS[code] || code,
    detail: null,
  }));
}

// Explain, per match, exactly which rule produced the confidence tier — using this
// match's own score so the user can retrace how the value came about.
function describeMatchConfidence(confidence, score, reasonCodes) {
  const tier = String(confidence || "").toLowerCase();
  const scoreLabel = Number.isFinite(score) ? score : "-";
  if (tier === "high") {
    if (reasonCodes.includes("float_exact") && reasonCodes.includes("seed_exact")) {
      return "Float + Seed exakt → Hoch";
    }
    return `Score ${scoreLabel} ≥ ${MATCH_CONFIDENCE_HIGH_SCORE} → Hoch`;
  }
  if (tier === "medium") {
    return `Score ${scoreLabel} ≥ ${MATCH_CONFIDENCE_MEDIUM_SCORE} → Mittel`;
  }
  return `Score ${scoreLabel} < ${MATCH_CONFIDENCE_MEDIUM_SCORE} → Niedrig`;
}

const CsFloatTradeSyncModal = lazy(() =>
  import("./CsFloatTradeSyncModal.jsx").then((module) => ({
    default: module.CsFloatTradeSyncModal,
  })),
);

const SkinBaronSalesSyncModal = lazy(() =>
  import("./SkinBaronSalesSyncModal.jsx").then((module) => ({
    default: module.SkinBaronSalesSyncModal,
  })),
);

/**
 * Management tab content for the Portfolio page — cluster management,
 * matching, pricing, groups, and manual item creation.
 *
 * Accepts all state and callbacks from PortfolioPage.jsx as props.
 */
export function PortfolioManagementSection({
  // Render control
  forceMount,

  // Sync / inbox
  syncNotification,
  autoSyncEnabled,
  isSteamSyncing,
  steamSyncError,
  hasCsFloatKey,
  hasSkinBaronImportReady,
  isCsFloatSyncOpen,
  isSkinBaronSyncOpen,
  setIsCsFloatSyncOpen,
  setIsSkinBaronSyncOpen,
  runSteamSync,
  handleToggleAutoSync,

  // Management state
  managementLoading,
  managementError,
  managementSection,
  setManagementSection,
  managementFilter,
  setManagementFilter,
  managementSearchTerm,
  setManagementSearchTerm,
  managementTypeFilter,
  setManagementTypeFilter,
  managementBucketFilter,
  setManagementBucketFilter,
  managementSortBy,
  setManagementSortBy,
  expandedClusters,
  setExpandedClusters,

  // Exclude callbacks
  handleManagementExcludeToggle,
  handleManagementBucketToggle,
  handleManagementClusterToggle,
  handleManagementClusterBucketToggle,

  // Matching state
  matchingRows,
  matchingLoading,
  matchingSearchTerm,
  setMatchingSearchTerm,
  matchingSortBy,
  setMatchingSortBy,
  matchingConfidenceFilter,
  setMatchingConfidenceFilter,
  showMatchedMatchingRows,
  setShowMatchedMatchingRows,
  handleMatchStatusUpdate,
  handleManualMatchCreate,
  managementInvestmentById,

  // Price state
  rawSteamInventoryItems,
  steamInventoryItemsAll,
  priceSearchTerm,
  setPriceSearchTerm,
  priceSortBy,
  setPriceSortBy,
  priceMissingOnly,
  setPriceMissingOnly,
  priceDrafts,
  savingPriceItemId,
  handlePriceDraftChange,
  handleSaveSteamItemPrice,
  handleAcceptSuggestedPrice,
  handleSaveClusterPrice,
  handleAcceptSuggestedClusterPrice,

  // Manual item
  manualItemDraft,
  setManualItemDraft,
  manualSelectedSuggestion,
  setManualSelectedSuggestion,
  manualNameSuggestions = [],
  manualNameSuggestionsLoading = false,
  manualNameSuggestionsError = "",
  handleManualSuggestionPick,
  manualItemSaving,
  handleManualItemDraftChange,
  handleCreateManualInvestment,

  // Portfolio group state
  portfolioGroups,
  // Aggregated counterparts of `portfolioGroups` keyed by group id. The raw
  // groups carry only name/thesis/memberInvestmentIds — cluster counts, item
  // counts and topVisuals live exclusively on the summaries.
  portfolioGroupSummaryById,
  portfolioGroupsLoading,
  portfolioGroupDraft,
  portfolioGroupEditorId,
  portfolioGroupMessage,
  portfolioGroupError,
  portfolioGroupEditor,
  handleStartCreatePortfolioGroup,
  resetPortfolioGroupEditor,
  handlePortfolioGroupDraftChange,
  handleSavePortfolioGroup,
  handleDeletePortfolioGroup,
  handleOpenPortfolioGroupInInventory,
  handleOpenPortfolioGroupInManagement,
  groupSearchTerm,
  setGroupSearchTerm,
  groupSortBy,
  setGroupSortBy,
  expandedGroupManagementClusters,
  toggleExpandedGroupManagementCluster,
  filteredGroupManagementClusters,
  managementGroupsByClusterKey,
  portfolioGroupMembershipMap,
  portfolioGroupsById,
  handleAssignInvestmentIdsToGroup,
  handleRemoveInvestmentIdsFromGroup,

  // Additional matching state
  matchingDisplayRows,
  handleEditPortfolioGroup,

  // Derived / computed values
  filteredManagementClusters,
  managementTypeOptions,
  filteredMatchingRows,
  matchingSuggestedCount,
  matchedSteamInventoryItemsCount,
  filteredPriceClusters,
  priceMissingCount,
}) {
  const [expandedPriceClusters, setExpandedPriceClusters] = useState({});
  // Catalog dropdown visibility for the manual-investment item picker.
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [manualMatchOpen, setManualMatchOpen] = useState(false);
  // Which bundled positions are split open into their individual rows.
  const [expandedPriceLots, setExpandedPriceLots] = useState({});
  // Group editor modal. Editing an existing group opens it implicitly.
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  // Bulk selection + inspector target for the price grid.
  const [selectedPriceClusters, setSelectedPriceClusters] = useState(() => new Set());
  const [inspectedPriceClusterKey, setInspectedPriceClusterKey] = useState(null);

  const togglePriceClusterSelection = (key) => {
    setSelectedPriceClusters((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };
  const {
    currency,
    currencies,
    convertFromUsd,
    convertToUsd,
    formatPrice,
    ratesLoading,
  } = useCurrency();
  const currencySymbol = currencies?.[currency]?.symbol || currency;
  // USD stored as source of truth → show the user their active currency instead.
  const formatUsdInDisplayCurrency = (usdValue) =>
    formatPrice(Number(usdValue || 0), { useUsd: true, buyPriceUsd: Number(usdValue || 0) });

  // Single-position price row — reused both for standalone items and for the
  // individual positions revealed by expanding a multi-position price cluster.
  if (!forceMount) {
    return null;
  }

  const isGroupFormOpen = groupFormOpen;

  /**
   * Condenses a cluster's per-position buy-ins into the single "Einkauf" cell
   * the design shows: one price when every position agrees, a quantity-weighted
   * average when they differ, and an explicit warning while any is unset.
   * All arithmetic runs on the stored USD values; only the labels are formatted.
   */
  const summarizeClusterBuyIn = (cluster, lots) => {
    const positions = Array.isArray(cluster?.positions) ? cluster.positions : [];
    const qtyOf = (position) => Math.max(1, Number(position?.quantity || 1));
    const priceOf = (position) => Number(position?.buyPriceUsd ?? position?.buyPrice ?? 0);
    const filled = positions.filter((position) => priceOf(position) > 0);
    // Price maths run on the raw rows (exact), but the wording counts bundled
    // positions — "56 Positionen offen" for one Steam sync reads as a backlog
    // when it is really a single unpriced acquisition.
    const unitCount = Array.isArray(lots) ? lots.length : positions.length;
    const openUnits = Array.isArray(lots)
      ? lots.filter((lot) => lot.missingCount > 0).length
      : positions.length - filled.length;
    const missing = openUnits;

    if (filled.length === 0) {
      return {
        missing,
        label: "— fehlt",
        note: `${unitCount} ${unitCount === 1 ? "Position" : "Positionen"} offen`,
        detail: `noch keiner gesetzt`,
      };
    }

    const values = filled.map(priceOf);
    const distinct = new Set(values.map((value) => value.toFixed(2)));
    const openNote = missing > 0 ? ` · ${missing} offen` : "";

    if (distinct.size > 1) {
      const totalQty = filled.reduce((sum, position) => sum + qtyOf(position), 0);
      const weighted =
        filled.reduce((sum, position) => sum + qtyOf(position) * priceOf(position), 0) / totalQty;
      const average = formatUsdInDisplayCurrency(weighted);
      return {
        missing,
        label: `Ø ${average}`,
        note: `gemischt ${formatUsdInDisplayCurrency(Math.min(...values))}–${formatUsdInDisplayCurrency(Math.max(...values))}${openNote}`,
        detail: `Ø ${average}${openNote}`,
      };
    }

    const single = formatUsdInDisplayCurrency(values[0]);
    return {
      missing,
      label: single,
      note: openUnits > 0 ? `${openUnits} von ${unitCount} offen` : "alle Positionen gleich",
      detail: `${single}${openNote}`,
    };
  };

  /**
   * Applies each selected cluster's suggested price to all of its positions.
   * Runs sequentially: handleAcceptSuggestedClusterPrice writes through the
   * local store, and firing them in parallel would interleave those writes.
   */
  const handleAcceptSuggestionsForSelection = async () => {
    const targets = filteredPriceClusters.filter(
      (cluster) =>
        selectedPriceClusters.has(cluster.key) &&
        Number(cluster.suggestion?.value ?? 0) > 0,
    );
    for (const cluster of targets) {
      await handleAcceptSuggestedClusterPrice(cluster, Number(cluster.suggestion.value));
    }
    setSelectedPriceClusters(new Set());
  };

  const inspectedCluster =
    filteredPriceClusters.find((cluster) => cluster.key === inspectedPriceClusterKey) || null;
  const inspectedLots = inspectedCluster
    ? buildPositionLots(inspectedCluster.positions, resolveInvestmentDate)
    : [];
  const inspectedSummary = inspectedCluster
    ? summarizeClusterBuyIn(inspectedCluster, inspectedLots)
    : { missing: 0, label: "—", note: "", detail: "—" };

  const resolvedMatchIds = buildResolvedMatchIdSet(matchingRows);
  // Manual-link pools. A position already part of a resolved match is excluded so
  // the modal cannot produce a second link for something already spoken for.
  const manualMatchPool = Array.from(managementInvestmentById?.values?.() || []);
  const manualSteamCandidates = manualMatchPool.filter((item) => {
    const platform = String(item?.platform || item?.source || "").toLowerCase();
    return (
      platform === "steam_inventory" && !isPositionMatchLinked(item, resolvedMatchIds)
    );
  });
  const manualCsfloatCandidates = manualMatchPool.filter((item) => {
    const platform = String(item?.platform || item?.source || "").toLowerCase();
    return platform === "csfloat" && !isPositionMatchLinked(item, resolvedMatchIds);
  });
  // Confirmed = suggestions that already resolved into a linked position.
  const confirmedMatchCount = resolvedMatchIds.size;
  // Share of all known matches the scorer resolved without manual triage.
  // Null (and hidden) while there is nothing to take a share of.
  const totalKnownMatches = confirmedMatchCount + matchingSuggestedCount;
  const autoMatchShare =
    totalKnownMatches > 0
      ? Math.round((confirmedMatchCount / totalKnownMatches) * 100)
      : null;

  return (
    <div className="space-y-4 sm:space-y-6">
      {typeof window !== "undefined" && !window.electronAPI?.localStore ? (
        <Card>
          <CardHeader>
            <CardTitle>Cluster-Verwaltung nur im Desktop verfuegbar</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Diese Detailverwaltung arbeitet auf lokalen Positionen (inkl.
            excluded Status).
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Header: title + sync state + primary actions */}
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <h3 className="text-2xl font-extrabold tracking-[-0.01em]">Verwaltung</h3>
              <p className="mt-2 text-xs text-muted-foreground">
                Aufgaben aus dem letzten Steam-Sync in einer Übersicht · Auto-Sync
                läuft maximal alle 30 Minuten pro App-Instanz.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                dot
                size="default"
                tone={autoSyncEnabled ? "success" : "neutral"}
                onClick={() => void handleToggleAutoSync()}
                title="Auto-Sync umschalten"
              >
                Auto-Sync {autoSyncEnabled ? "an" : "aus"}
              </StatusPill>
              <Button
                size="sm"
                disabled={isSteamSyncing}
                onClick={() => void runSteamSync({ manual: true })}
              >
                {isSteamSyncing ? "Sync läuft…" : "Steam Sync starten"}
              </Button>
              {hasCsFloatKey ? (
                <Button size="sm" variant="outline" onClick={() => setIsCsFloatSyncOpen(true)}>
                  CSFloat Sync
                </Button>
              ) : null}
              {hasSkinBaronImportReady ? (
                <Button size="sm" variant="outline" onClick={() => setIsSkinBaronSyncOpen(true)}>
                  SkinBaron Sync
                </Button>
              ) : null}
            </div>
          </div>

          {/* Tab nav on the left, actionable counts on the right. The counts are
              buttons: each jumps to the tab that resolves it. */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <SegmentedControl
              value={managementSection}
              onChange={setManagementSection}
              items={MANAGEMENT_TABS.map((tab) => ({
                ...tab,
                // Matching stays reachable only while it has something to triage
                // or something already confirmed to look back at.
                disabled:
                  tab.value === "matching" &&
                  matchingSuggestedCount === 0 &&
                  confirmedMatchCount === 0,
                count:
                  tab.value === "matching"
                    ? matchingSuggestedCount || undefined
                    : tab.value === "prices"
                      ? priceMissingCount || undefined
                      : tab.value === "groups"
                        ? portfolioGroups.length || undefined
                        : undefined,
              }))}
            />
            <div className="flex flex-wrap items-center justify-end gap-[7px]">
              {priceMissingCount > 0 ? (
                <StatusPill dot tone="warn" onClick={() => setManagementSection("prices")}>
                  {priceMissingCount} ohne Einkaufspreis
                </StatusPill>
              ) : null}
              {matchingSuggestedCount > 0 ? (
                <StatusPill dot tone="info" onClick={() => setManagementSection("matching")}>
                  {matchingSuggestedCount} Matchings offen
                </StatusPill>
              ) : null}
              <StatusPill tone="neutral">
                {syncNotification.newItemsCount} neue Steam-Items
              </StatusPill>
            </div>
          </div>

          {!hasCsFloatKey && !hasSkinBaronImportReady ? (
            <p className="text-xs text-muted-foreground">
              Kein CSFloat-Key bzw. kein gültiger SkinBaron Session-Zugriff hinterlegt.
              Import-Buttons erscheinen automatisch nach Setup.
            </p>
          ) : null}


          {steamSyncError ? (
            <p className="text-xs text-danger">{steamSyncError}</p>
          ) : null}

          {/* Management error */}
          {managementError ? (
            <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              {managementError}
            </div>
          ) : null}

          {/* === PRICES SECTION === */}
          {managementSection === "prices" ? (
            <Card className="overflow-hidden">
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <CardTitle className="text-base">Preise setzen</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Nur nicht gematchte Steam-Inventory-Items können hier einen Einkaufspreis
                    erhalten
                    {matchedSteamInventoryItemsCount > 0
                      ? ` · ${matchedSteamInventoryItemsCount} gematchte ausgeblendet`
                      : ""}
                    .
                  </p>
                </div>
                {/* Toolbar: query, the missing-price filter as a warn toggle, sort. */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <label className="relative min-w-0 flex-1 basis-64 sm:max-w-[380px]">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={priceSearchTerm}
                      onChange={(event) => setPriceSearchTerm(event.target.value)}
                      placeholder="Nach Item suchen…"
                      className="h-[38px] w-full rounded-[10px] border border-border bg-background pl-[34px] pr-3 text-[13px] outline-none transition-colors focus:border-border-strong"
                    />
                  </label>
                  <button
                    type="button"
                    aria-pressed={priceMissingOnly}
                    onClick={() => setPriceMissingOnly(!priceMissingOnly)}
                    className={`inline-flex h-[38px] items-center whitespace-nowrap rounded-[10px] border px-3 text-[12px] font-bold leading-none transition-colors ${
                      priceMissingOnly
                        ? "border-warn/30 bg-warn/10 text-warn"
                        : "border-border bg-transparent text-muted-foreground hover:border-border-strong hover:text-foreground"
                    }`}
                  >
                    Nur ohne Preis · {priceMissingCount}
                  </button>
                  <NativeSelect size="default"
                    value={priceSortBy}
                    onChange={(event) => setPriceSortBy(event.target.value)}
                  >
                    <option value="name_asc">Name A–Z</option>
                    <option value="name_desc">Name Z–A</option>
                    <option value="price_desc">Preis ↓</option>
                    <option value="price_asc">Preis ↑</option>
                    <option value="qty_desc">Menge ↓</option>
                  </NativeSelect>

                  {selectedPriceClusters.size > 0 ? (
                    <div className="ml-auto flex items-center gap-2">
                      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {selectedPriceClusters.size} ausgewählt
                      </span>
                      <Button
                        size="sm"
                        variant="softSuccess"
                        disabled={ratesLoading || Boolean(savingPriceItemId)}
                        onClick={() => void handleAcceptSuggestionsForSelection()}
                      >
                        Vorschläge übernehmen
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedPriceClusters(new Set())}
                      >
                        Auswahl aufheben
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {rawSteamInventoryItems.length === 0 ? (
                  <p className="px-6 py-5 text-sm text-muted-foreground">
                    {steamInventoryItemsAll.length > 0
                      ? "Alle Steam-Inventory-Items sind bereits gematcht. Keine manuellen Preise nötig."
                      : "Noch keine Steam-Inventory-Items vorhanden."}
                  </p>
                ) : filteredPriceClusters.length === 0 ? (
                  <p className="px-6 py-5 text-sm text-muted-foreground">
                    Kein Item passt zu Suche/Filter.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_330px] xl:items-start">
                    {/* Dense cluster list. A cluster expands into its positions,
                        so a per-position price can be set without leaving the row. */}
                    <div className="min-w-0">
                      <div className="grid grid-cols-[36px_minmax(0,1fr)_90px_110px_110px_120px] items-center gap-3 border-b border-border px-[18px] py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                        <span />
                        <span>Cluster / Position</span>
                        <span className="text-right">Menge</span>
                        <span className="text-right">Positionen</span>
                        <span className="text-right">Vorschlag</span>
                        <span className="text-right">Einkauf</span>
                      </div>

                      <div className="max-h-[60vh] overflow-y-auto">
                        {filteredPriceClusters.map((cluster) => {
                          const isExpanded = Boolean(expandedPriceClusters[cluster.key]);
                          const isSelected = selectedPriceClusters.has(cluster.key);
                          const isInspected = inspectedPriceClusterKey === cluster.key;
                          const suggestedPrice = Number(cluster.suggestion?.value ?? 0);
                          const hasSuggestion =
                            Number.isFinite(suggestedPrice) && suggestedPrice > 0;
                          const clusterLots = buildPositionLots(
                            cluster.positions,
                            resolveInvestmentDate,
                          );
                          const openLotCount = clusterLots.filter(
                            (lot) => lot.missingCount > 0,
                          ).length;
                          const summary = summarizeClusterBuyIn(cluster, clusterLots);
                          return (
                            <div key={cluster.key}>
                              <div
                                className={`grid grid-cols-[36px_minmax(0,1fr)_90px_110px_110px_120px] items-center gap-3 border-b border-surface-2 px-[18px] py-2.5 transition-colors ${
                                  isInspected
                                    ? "bg-row-sel"
                                    : isSelected || isExpanded
                                      ? "bg-surface-1"
                                      : ""
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  aria-label={`${cluster.name} auswählen`}
                                  checked={isSelected}
                                  onChange={() => togglePriceClusterSelection(cluster.key)}
                                  className="size-4 accent-success"
                                />

                                <div className="flex min-w-0 items-center gap-2">
                                  <button
                                    type="button"
                                    aria-label={isExpanded ? "Positionen einklappen" : "Positionen aufklappen"}
                                    aria-expanded={isExpanded}
                                    onClick={() =>
                                      setExpandedPriceClusters((current) => ({
                                        ...current,
                                        [cluster.key]: !current[cluster.key],
                                      }))
                                    }
                                    className={`size-5 flex-none text-[15px] font-bold leading-none text-muted-foreground transition-transform hover:text-foreground ${
                                      isExpanded ? "rotate-90" : ""
                                    }`}
                                  >
                                    ›
                                  </button>
                                  <ItemThumb src={cluster.imageUrl} alt={cluster.name} size="xs" bordered={false} />
                                  <button
                                    type="button"
                                    onClick={() => setInspectedPriceClusterKey(cluster.key)}
                                    className="min-w-0 flex-1 text-left"
                                  >
                                    <span className="block truncate text-[13px] font-semibold">
                                      {cluster.name}
                                    </span>
                                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                                      {cluster.bucket === "inventory" ? "Inventar" : "Investment"}
                                    </span>
                                  </button>
                                </div>

                                <span className="text-right text-[13px] tabular-nums text-muted-foreground">
                                  {cluster.totalQuantity}×
                                </span>
                                <span className="text-right text-[13px] tabular-nums text-muted-foreground">
                                  {clusterLots.length}
                                  {openLotCount > 0 && openLotCount < clusterLots.length
                                    ? ` · ${openLotCount} offen`
                                    : ""}
                                </span>
                                <span className="text-right text-[13px] tabular-nums">
                                  {hasSuggestion ? formatUsdInDisplayCurrency(suggestedPrice) : "—"}
                                </span>
                                <span className="min-w-0 text-right">
                                  <span
                                    className={`block text-[13px] font-semibold tabular-nums ${
                                      summary.missing > 0 ? "text-warn" : ""
                                    }`}
                                  >
                                    {summary.label}
                                  </span>
                                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                                    {summary.note}
                                  </span>
                                </span>
                              </div>

                              {isExpanded
                                ? clusterLots.map((lot, lotIndex, lotList) => {
                                      const lotDraftKey = `cluster:${lot.key}`;
                                      const lotDraft =
                                        priceDrafts[lotDraftKey] ??
                                        String(
                                          lot.buyPriceUsd > 0
                                            ? convertFromUsd(lot.buyPriceUsd).toFixed(2)
                                            : "",
                                        );
                                      const lotSplit = Boolean(expandedPriceLots[lot.key]);
                                      const splittable = lot.positions.length > 1;
                                      const lotSaving = savingPriceItemId === lotDraftKey;
                                      const lastLot = lotIndex === lotList.length - 1;

                                      return (
                                        <div key={lot.key}>
                                          <div
                                            className={`grid grid-cols-[36px_minmax(0,1fr)_90px_110px_110px_120px] items-center gap-3 bg-surface-1 px-[18px] py-2 ${
                                              lastLot && !lotSplit
                                                ? "border-b border-border"
                                                : "border-b border-border-soft"
                                            }`}
                                          >
                                            <span />
                                            <div className="flex min-w-0 items-center gap-2 pl-[34px]">
                                              <span className="mb-2 size-3 flex-none self-center rounded-bl-[3px] border-b border-l border-border-strong" />
                                              {splittable ? (
                                                <button
                                                  type="button"
                                                  aria-label={
                                                    lotSplit
                                                      ? "Einzeleinträge einklappen"
                                                      : "Position aufsplitten"
                                                  }
                                                  aria-expanded={lotSplit}
                                                  onClick={() =>
                                                    setExpandedPriceLots((current) => ({
                                                      ...current,
                                                      [lot.key]: !current[lot.key],
                                                    }))
                                                  }
                                                  className={`size-4 flex-none text-xs font-bold leading-none text-muted-foreground transition-transform hover:text-foreground ${
                                                    lotSplit ? "rotate-90" : ""
                                                  }`}
                                                >
                                                  ›
                                                </button>
                                              ) : (
                                                <span className="size-4 flex-none" />
                                              )}
                                              <span className="min-w-0">
                                                <span className="block truncate text-xs font-semibold">
                                                  {lot.date ? formatDateSafe(lot.date) : "Datum unbekannt"}
                                                </span>
                                                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                                                  {resolvePositionSourceLabel(lot.source)}
                                                  {splittable ? ` · ${lot.positions.length} Einträge` : ""}
                                                </span>
                                              </span>
                                            </div>
                                            <span className="text-right text-xs tabular-nums text-muted-foreground">
                                              {lot.quantity}×
                                            </span>
                                            <span
                                              className={`text-right text-[11px] font-semibold ${
                                                lot.excluded
                                                  ? "text-danger"
                                                  : lot.partiallyExcluded
                                                    ? "text-warn"
                                                    : "text-success"
                                              }`}
                                            >
                                              {lot.excluded
                                                ? "excluded"
                                                : lot.partiallyExcluded
                                                  ? "teils excluded"
                                                  : "aktiv"}
                                            </span>
                                            {hasSuggestion ? (
                                              <button
                                                type="button"
                                                title="Vorschlag für diese Position übernehmen"
                                                disabled={lotSaving}
                                                onClick={() =>
                                                  void handleAcceptSuggestedClusterPrice(
                                                    { key: lot.key, positions: lot.positions },
                                                    suggestedPrice,
                                                  )
                                                }
                                                className="text-right text-xs tabular-nums text-muted-foreground underline-offset-2 transition-colors hover:text-success hover:underline disabled:opacity-50"
                                              >
                                                {formatUsdInDisplayCurrency(suggestedPrice)}
                                              </button>
                                            ) : (
                                              <span className="text-right text-xs tabular-nums text-muted-foreground">
                                                —
                                              </span>
                                            )}
                                            <span className="flex justify-end">
                                              <span className="relative">
                                                <span className="pointer-events-none absolute left-2 top-1.5 text-[11px] text-muted-foreground">
                                                  {currencySymbol}
                                                </span>
                                                <input
                                                  type="number"
                                                  min="0"
                                                  step="0.01"
                                                  aria-label={`Einkaufspreis ${cluster.name} ${lot.dayKey}`}
                                                  value={lotDraft}
                                                  onChange={(event) =>
                                                    handlePriceDraftChange(
                                                      lotDraftKey,
                                                      event.target.value,
                                                    )
                                                  }
                                                  onBlur={() =>
                                                    void handleSaveClusterPrice({
                                                      key: lot.key,
                                                      positions: lot.positions,
                                                    })
                                                  }
                                                  placeholder={
                                                    lot.mixedPrices
                                                      ? "gemischt"
                                                      : hasSuggestion
                                                        ? convertFromUsd(suggestedPrice).toFixed(2)
                                                        : ""
                                                  }
                                                  disabled={lotSaving || ratesLoading}
                                                  className={`h-[30px] w-[104px] rounded-lg border bg-background py-0 pl-5 pr-2 text-right text-xs tabular-nums outline-none ${
                                                    lotDraft ? "border-border" : "border-warn/45"
                                                  }`}
                                                />
                                              </span>
                                            </span>
                                          </div>

                                          {lotSplit
                                            ? lot.positions.map((position, entryIndex) => {
                                                const posPrice = Number(
                                                  position.buyPriceUsd ?? position.buyPrice ?? 0,
                                                );
                                                const posDraft =
                                                  priceDrafts[position.id] ??
                                                  String(
                                                    posPrice > 0
                                                      ? convertFromUsd(posPrice).toFixed(2)
                                                      : "",
                                                  );
                                                const lastEntry =
                                                  entryIndex === lot.positions.length - 1;
                                                return (
                                                  <div
                                                    key={position.id}
                                                    className={`grid grid-cols-[36px_minmax(0,1fr)_90px_110px_110px_120px] items-center gap-3 bg-surface-2 px-[18px] py-1.5 ${
                                                      lastEntry && lastLot
                                                        ? "border-b border-border"
                                                        : "border-b border-border-soft"
                                                    }`}
                                                  >
                                                    <span />
                                                    <div className="flex min-w-0 items-center gap-2 pl-[64px]">
                                                      <span className="text-[10px] text-muted-foreground">
                                                        Eintrag {entryIndex + 1}
                                                      </span>
                                                    </div>
                                                    <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                                                      {Math.max(1, Number(position.quantity || 1))}×
                                                    </span>
                                                    <span
                                                      className={`text-right text-[11px] font-semibold ${
                                                        position.excluded
                                                          ? "text-danger"
                                                          : "text-success"
                                                      }`}
                                                    >
                                                      {position.excluded ? "excluded" : "aktiv"}
                                                    </span>
                                                    {hasSuggestion ? (
                                                      <button
                                                        type="button"
                                                        title="Vorschlag nur für diesen Eintrag übernehmen"
                                                        disabled={savingPriceItemId === position.id}
                                                        onClick={() =>
                                                          void handleAcceptSuggestedPrice(
                                                            position,
                                                            suggestedPrice,
                                                          )
                                                        }
                                                        className="text-right text-[11px] tabular-nums text-muted-foreground underline-offset-2 transition-colors hover:text-success hover:underline disabled:opacity-50"
                                                      >
                                                        {formatUsdInDisplayCurrency(suggestedPrice)}
                                                      </button>
                                                    ) : (
                                                      <span />
                                                    )}
                                                    <span className="flex justify-end">
                                                      <span className="relative">
                                                        <span className="pointer-events-none absolute left-2 top-1 text-[11px] text-muted-foreground">
                                                          {currencySymbol}
                                                        </span>
                                                        <input
                                                          type="number"
                                                          min="0"
                                                          step="0.01"
                                                          aria-label={`Einkaufspreis Eintrag ${entryIndex + 1}`}
                                                          value={posDraft}
                                                          onChange={(event) =>
                                                            handlePriceDraftChange(
                                                              position.id,
                                                              event.target.value,
                                                            )
                                                          }
                                                          onBlur={() =>
                                                            void handleSaveSteamItemPrice(position)
                                                          }
                                                          disabled={
                                                            savingPriceItemId === position.id ||
                                                            ratesLoading
                                                          }
                                                          className="h-[26px] w-[104px] rounded-lg border border-border bg-background py-0 pl-5 pr-2 text-right text-[11px] tabular-nums outline-none"
                                                        />
                                                      </span>
                                                    </span>
                                                  </div>
                                                );
                                              })
                                            : null}
                                        </div>
                                      );
                                    },
                                  )
                                : null}
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 px-[18px] py-3">
                        <span className="text-[11px] text-muted-foreground">
                          {filteredPriceClusters.length} Cluster · Cluster aufklappen, um Preise je
                          Position zu setzen · Eingabe in {currency}, gespeichert in USD zum heutigen Kurs
                        </span>
                      </div>
                    </div>

                    {/* Inspector for the highlighted cluster. */}
                    <aside className="flex flex-col gap-4 border-t border-border bg-surface-1 p-[18px] xl:border-l xl:border-t-0">
                      {inspectedCluster ? (
                        <>
                          <div className="flex items-center gap-3">
                            <ItemThumb
                              src={inspectedCluster.imageUrl}
                              alt={inspectedCluster.name}
                              size="xl"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold">{inspectedCluster.name}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {inspectedCluster.bucket === "inventory" ? "Inventar" : "Investment"} ·{" "}
                                {inspectedLots.length}{" "}
                                {inspectedLots.length === 1 ? "Position" : "Positionen"}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-col gap-[7px] rounded-xl border border-border-soft bg-surface-1 p-3 text-xs">
                            <MetaRow
                              label="Vorschlag"
                              value={
                                Number(inspectedCluster.suggestion?.value ?? 0) > 0
                                  ? formatUsdInDisplayCurrency(Number(inspectedCluster.suggestion.value))
                                  : "—"
                              }
                            />
                            <MetaRow
                              label="Bestand"
                              value={`${inspectedCluster.totalQuantity} Stk. in ${inspectedLots.length} Pos.`}
                            />
                            <MetaRow
                              label="Ø Einkauf"
                              value={inspectedSummary.detail}
                              tone={inspectedSummary.missing > 0 ? "warn" : "default"}
                            />
                          </div>

                          <div className="flex flex-col gap-2">
                            <SectionLabel>Einkaufspreise je Position ({currency})</SectionLabel>
                            {inspectedLots.map((lot) => {
                              const lotDraftKey = `cluster:${lot.key}`;
                              const lotDraft =
                                priceDrafts[lotDraftKey] ??
                                String(
                                  lot.buyPriceUsd > 0
                                    ? convertFromUsd(lot.buyPriceUsd).toFixed(2)
                                    : "",
                                );
                              const missing = !lotDraft;
                              return (
                                <div
                                  key={lot.key}
                                  className={`flex items-center gap-2.5 rounded-[11px] border px-2.5 py-2.5 ${
                                    missing ? "border-warn/40 bg-warn/8" : "border-border bg-background"
                                  }`}
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-semibold">
                                      {lot.date ? formatDateSafe(lot.date) : "Datum unbekannt"}
                                      {" · "}
                                      {lot.quantity}×
                                    </span>
                                    <span
                                      className={`mt-0.5 block truncate text-[10px] ${
                                        lot.excluded
                                          ? "text-danger"
                                          : missing
                                            ? "text-warn"
                                            : "text-muted-foreground"
                                      }`}
                                    >
                                      {resolvePositionSourceLabel(lot.source)}
                                      {lot.excluded
                                        ? " · excluded"
                                        : missing
                                          ? " · kein Preis"
                                          : lot.mixedPrices
                                            ? " · gemischte Preise"
                                            : " · aktiv"}
                                    </span>
                                  </span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    aria-label={`Einkaufspreis ${lot.dayKey}`}
                                    value={lotDraft}
                                    onChange={(event) =>
                                      handlePriceDraftChange(lotDraftKey, event.target.value)
                                    }
                                    onBlur={() =>
                                      void handleSaveClusterPrice({
                                        key: lot.key,
                                        positions: lot.positions,
                                      })
                                    }
                                    placeholder={
                                      Number(inspectedCluster.suggestion?.value ?? 0) > 0
                                        ? convertFromUsd(
                                            Number(inspectedCluster.suggestion.value),
                                          ).toFixed(2)
                                        : currencySymbol
                                    }
                                    disabled={savingPriceItemId === lotDraftKey || ratesLoading}
                                    className={`h-8 w-[88px] rounded-[8px] border bg-card px-2.5 text-right text-[13px] tabular-nums outline-none placeholder:text-muted-foreground/60 focus:border-border-strong ${
                                      missing ? "border-warn/50" : "border-border-strong"
                                    }`}
                                  />
                                </div>
                              );
                            })}
                          </div>

                          <div className="h-px bg-border" />

                          <div className="flex flex-col gap-2">
                            <SectionLabel>Für alle Positionen setzen</SectionLabel>
                            <div className="flex gap-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                aria-label="Preis für alle Positionen"
                                value={priceDrafts[`cluster:${inspectedCluster.key}`] ?? ""}
                                onChange={(event) =>
                                  handlePriceDraftChange(
                                    `cluster:${inspectedCluster.key}`,
                                    event.target.value,
                                  )
                                }
                                placeholder={
                                  Number(inspectedCluster.suggestion?.value ?? 0) > 0
                                    ? convertFromUsd(Number(inspectedCluster.suggestion.value)).toFixed(2)
                                    : currencySymbol
                                }
                                className="h-9 w-full min-w-0 flex-1 rounded-[8px] border border-border bg-background px-2.5 text-[13px] tabular-nums outline-none"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={ratesLoading}
                                className="shrink-0 whitespace-nowrap"
                                onClick={() => void handleSaveClusterPrice(inspectedCluster)}
                              >
                                Auf {inspectedLots.length} Pos.
                              </Button>
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              Überschreibt bestehende Positionspreise.
                            </span>
                          </div>

                          {Number(inspectedCluster.suggestion?.value ?? 0) > 0 ? (
                            <Button
                              variant="softSuccess"
                              size="sm"
                              onClick={() =>
                                void handleAcceptSuggestedClusterPrice(
                                  inspectedCluster,
                                  Number(inspectedCluster.suggestion.value),
                                )
                              }
                            >
                              Vorschlag übernehmen
                            </Button>
                          ) : null}

                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            Der Kurs zum Kaufzeitpunkt ist nicht rekonstruierbar — kleine
                            Abweichungen sind normal.
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Cluster in der Liste anklicken, um Positionen und Einkaufspreise hier zu
                          bearbeiten.
                        </p>
                      )}
                    </aside>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* === GROUPS SECTION === */}
          {managementSection === "groups" ? (
            <div className="flex flex-col gap-4">
              <Card className="overflow-hidden">
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
                  <div>
                    <CardTitle>Investment-Gruppen</CardTitle>
                    <p className="mt-1.5 text-[13px] text-muted-foreground">
                      Ein Anzeige-Layer über den Clustern. Erst Gruppe wählen, dann Cluster
                      zuweisen — Positionsdaten bleiben unverändert.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant={isGroupFormOpen ? "outline" : "default"}
                      onClick={() => {
                        if (isGroupFormOpen) {
                          setGroupFormOpen(false);
                          return;
                        }
                        handleStartCreatePortfolioGroup();
                        setGroupFormOpen(true);
                      }}
                    >
                      {isGroupFormOpen ? "Formular schließen" : "Neue Gruppe"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Group editor — a modal in the v2 design, so the group list
                      stays readable while a group is being created or edited. */}
                  {isGroupFormOpen ? (
                  <div
                    className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-10 backdrop-blur-[3px]"
                    role="dialog"
                    aria-modal="true"
                    aria-label={portfolioGroupEditor ? "Gruppe bearbeiten" : "Neue Gruppe anlegen"}
                  >
                  <div className="w-[560px] max-w-full space-y-3 overflow-hidden rounded-2xl border border-border-strong bg-card p-5 shadow-[0_30px_70px_rgba(0,0,0,0.5)]">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-base font-bold">
                          {portfolioGroupEditor ? "Gruppe bearbeiten" : "Neue Gruppe anlegen"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Cluster weist du danach im Gruppen-Tab zu.
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label="Schließen"
                        onClick={() => {
                          resetPortfolioGroupEditor();
                          setGroupFormOpen(false);
                        }}
                        className="size-[30px] flex-none rounded-lg border border-border text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        Name
                      </label>
                      <input
                        type="text"
                        value={portfolioGroupDraft.name}
                        onChange={(event) =>
                          handlePortfolioGroupDraftChange(
                            "name",
                            event.target.value,
                          )
                        }
                        placeholder="z. B. Souvenir Mix Antwerp"
                        className="h-[42px] w-full rounded-[11px] border border-input bg-background px-3.5 text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        These / Notiz
                      </label>
                      <textarea
                        value={portfolioGroupDraft.thesis}
                        onChange={(event) =>
                          handlePortfolioGroupDraftChange(
                            "thesis",
                            event.target.value,
                          )
                        }
                        placeholder="Optional: Warum gehoeren diese Cluster zusammen?"
                        className="min-h-[92px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Farbe</label>
                      <div className="flex flex-wrap gap-2.5">
                        {PORTFOLIO_GROUP_COLORS.map((color) => {
                          const active =
                            normalizePortfolioGroupColor(portfolioGroupDraft.color) === color;
                          return (
                            <button
                              key={color}
                              type="button"
                              aria-label={`Farbe ${color}`}
                              aria-pressed={active}
                              onClick={() => handlePortfolioGroupDraftChange("color", color)}
                              className={`size-[30px] rounded-[9px] ${GROUP_COLOR_SWATCH[color]} ${
                                active
                                  ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                                  : ""
                              }`}
                            />
                          );
                        })}
                      </div>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Gruppen ändern keine Positionsdaten. Ein Cluster kann in mehreren
                      Gruppen liegen.
                    </p>
                    {portfolioGroupMessage ? (
                      <p className="text-xs text-success">
                        {portfolioGroupMessage}
                      </p>
                    ) : null}
                    {portfolioGroupError ? (
                      <p className="text-xs text-danger">
                        {portfolioGroupError}
                      </p>
                    ) : null}
                    <div className="-mx-5 -mb-5 mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-1 px-5 py-3.5">
                      {portfolioGroupEditor ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="mr-auto"
                          onClick={() =>
                            void handleDeletePortfolioGroup(
                              portfolioGroupEditor.id,
                            )
                          }
                        >
                          Gruppe löschen
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          resetPortfolioGroupEditor();
                          setGroupFormOpen(false);
                        }}
                      >
                        Abbrechen
                      </Button>
                      <Button size="sm" onClick={() => void handleSavePortfolioGroup()}>
                        {portfolioGroupEditor ? "Änderungen speichern" : "Gruppe anlegen"}
                      </Button>
                    </div>
                  </div>
                  </div>
                  ) : null}

                  {/* Active-group chips. Selecting one is what the assignment
                      list below acts on, so it reads as a filter row rather than
                      a sidebar of records. */}
                  <div className="flex flex-col gap-2">
                    <SectionLabel>Aktive Gruppe</SectionLabel>
                    {portfolioGroupsLoading ? (
                      <div className="flex gap-2">
                        <Skeleton className="h-12 w-48" />
                        <Skeleton className="h-12 w-48" />
                      </div>
                    ) : portfolioGroups.length === 0 ? (
                      <p className="py-2 text-sm text-muted-foreground">
                        Noch keine Gruppen angelegt.
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {portfolioGroups.map((group) => {
                          const groupSummary =
                            portfolioGroupSummaryById?.get(String(group.id)) || null;
                          const isActive = portfolioGroupEditorId === group.id;
                          const groupColor = normalizePortfolioGroupColor(group.color);
                          return (
                            <div
                              key={group.id}
                              className={`flex items-center gap-2.5 rounded-[11px] border px-3 py-2 transition-colors ${
                                isActive
                                  ? GROUP_COLOR_CHIP[groupColor]
                                  : "border-border hover:border-border-strong"
                              }`}
                            >
                              <button
                                type="button"
                                aria-pressed={isActive}
                                onClick={() => handleEditPortfolioGroup(group)}
                                className="flex min-w-0 items-center gap-2.5 text-left"
                              >
                                <LayeredGroupIcon
                                  visuals={groupSummary?.topVisuals || []}
                                  fallbackLabel={group.name}
                                  size="sm"
                                />
                                <span className="min-w-0">
                                  <span className="block truncate text-[13px] font-bold">
                                    {group.name}
                                  </span>
                                  <span
                                    className={`block truncate text-[11px] tabular-nums ${
                                      isActive ? GROUP_COLOR_TEXT[groupColor] : "text-muted-foreground"
                                    }`}
                                  >
                                    {groupSummary?.clusterCount || 0} Cluster ·{" "}
                                    {groupSummary?.totalQuantity || 0} Items
                                  </span>
                                </span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="h-px bg-border" />

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[13px] text-muted-foreground">
                      „Cluster hinzufügen" ist nur ein Shortcut — intern werden die konkreten
                      Positionen zugeordnet.
                    </span>
                    <span className="text-xs whitespace-nowrap text-muted-foreground">
                      {portfolioGroupEditor ? (
                        <>
                          Zuweisen zu{" "}
                          <b
                            className={
                              GROUP_COLOR_TEXT[
                                normalizePortfolioGroupColor(portfolioGroupEditor.color)
                              ]
                            }
                          >
                            {portfolioGroupEditor.name}
                          </b>
                        </>
                      ) : (
                        "Oben eine Gruppe wählen"
                      )}
                    </span>
                    {portfolioGroupEditor ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Gruppe bearbeiten"
                          onClick={() => {
                            handleEditPortfolioGroup(portfolioGroupEditor);
                            setGroupFormOpen(true);
                          }}
                        >
                          Bearbeiten
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Gruppe im Inventar öffnen"
                          onClick={() => handleOpenPortfolioGroupInInventory(portfolioGroupEditor.id)}
                        >
                          Inventar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Cluster der Gruppe anzeigen"
                          onClick={() => handleOpenPortfolioGroupInManagement(portfolioGroupEditor.id)}
                        >
                          Cluster
                        </Button>
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="relative block flex-1">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        value={groupSearchTerm}
                        onChange={(event) => setGroupSearchTerm(event.target.value)}
                        placeholder="Nach Cluster oder Gruppenname suchen..."
                        className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm"
                      />
                    </label>
                    <NativeSelect size="default"
                      value={groupSortBy}
                      onChange={(event) => setGroupSortBy(event.target.value)}
                    >
                      <option value="name_asc">Name (A-Z)</option>
                      <option value="updated_desc">Neueste</option>
                    </NativeSelect>
                  </div>

                  {managementLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-16 w-full" />
                    </div>
                  ) : filteredGroupManagementClusters.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Kein Cluster passt zur Suche.
                    </p>
                  ) : (
                    <div className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto pr-1">
                      {/* gap-1 (4px) rather than the design's 9px: our rows are a
                          few px taller than the design's, so the design gap would
                          leave this list visibly looser than Exclude. 4px puts the
                          row pitch at Exclude's 65px, which is what makes switching
                          tabs feel continuous. */}
                      {filteredGroupManagementClusters.map((cluster) => {
                        const clusterAssignment = managementGroupsByClusterKey.get(cluster.key) || {
                          assignmentState: "ungrouped",
                          assignedGroupId: "",
                          assignedGroupName: "",
                          assignedCount: 0,
                          totalCount: cluster.positions.length,
                        };
                        const clusterInvestmentIds = uniqueInvestmentIds(
                          cluster.positions.map((position) => position.id),
                        );
                        const isExpanded = Boolean(expandedGroupManagementClusters[cluster.key]);
                        const activeGroupAssignedCount = portfolioGroupEditor
                          ? clusterInvestmentIds.filter(
                              (investmentId) =>
                                portfolioGroupMembershipMap.get(investmentId) === portfolioGroupEditor.id,
                            ).length
                          : 0;
                        const isAssignedToActiveGroup =
                          portfolioGroupEditor && clusterAssignment.assignedGroupId === portfolioGroupEditor.id;
                        const canAssignCluster = Boolean(portfolioGroupEditor) && !isAssignedToActiveGroup;
                        const canRemoveCluster =
                          Boolean(portfolioGroupEditor) && activeGroupAssignedCount > 0;

                        return (
                          <div
                            key={cluster.id}
                            className={`rounded-[13px] border px-3 py-2.5 transition-colors ${
                              clusterAssignment.assignmentState === "grouped"
                                ? "border-success/30 bg-success/7"
                                : clusterAssignment.assignmentState === "partial"
                                  ? "border-warn/30 bg-warn/7"
                                  : "border-border bg-background"
                            }`}
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                              <div className="flex min-w-0 items-center gap-3">
                                {/* 36px, matching the design and keeping the row
                                    pitch in line with Exclude/Preise — "xl" (56px)
                                    made this list visibly taller than every other
                                    tab's. */}
                                <ItemThumb src={cluster.imageUrl} alt={cluster.name} size="md" />
                                <div className="min-w-0">
                                  <p className="truncate text-[13px] font-bold">{cluster.name}</p>
                                  {/* Design states this as one sentence rather than
                                      five pipe-separated fragments plus a pill. */}
                                  <p className="mt-[3px] truncate text-[11px] text-muted-foreground">
                                    {cluster.totalCount} Stk. · {cluster.positions.length}{" "}
                                    {cluster.positions.length === 1 ? "Position" : "Positionen"} ·{" "}
                                    {clusterAssignment.assignmentState === "grouped" ? (
                                      <span className="font-semibold text-success">
                                        vollständig in dieser Gruppe
                                      </span>
                                    ) : clusterAssignment.assignmentState === "partial" ? (
                                      <span className="font-semibold text-warn">
                                        teilweise gruppiert ({clusterAssignment.assignedCount}/
                                        {clusterAssignment.totalCount})
                                      </span>
                                    ) : (
                                      "nicht gruppiert"
                                    )}
                                  </p>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                {/* Actions follow the state, as in the design: there is
                                    nothing to remove from an ungrouped cluster and
                                    nothing to add to a fully grouped one. The state
                                    itself now reads from the meta line, so the pill
                                    that repeated it is gone. */}
                                {clusterAssignment.assignmentState === "partial" ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 rounded-[9px] px-3 text-[12px] font-semibold"
                                    onClick={() => toggleExpandedGroupManagementCluster(cluster.key)}
                                  >
                                    {isExpanded ? "Ausblenden" : "Positionen"}
                                  </Button>
                                ) : null}
                                {clusterAssignment.assignmentState === "grouped" ? (
                                  <Button
                                    size="sm"
                                    className="h-8 rounded-[9px] px-3 text-[12px] font-semibold"
                                    variant="outline"
                                    disabled={!canRemoveCluster}
                                    onClick={() =>
                                      void handleRemoveInvestmentIdsFromGroup(
                                        portfolioGroupEditor?.id,
                                        clusterInvestmentIds,
                                      )
                                    }
                                  >
                                    Entfernen
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant={
                                      clusterAssignment.assignmentState === "partial"
                                        ? "default"
                                        : "outline"
                                    }
                                    className="h-8 rounded-[9px] px-3 text-[12px] font-semibold"
                                    disabled={!canAssignCluster}
                                    onClick={() =>
                                      void handleAssignInvestmentIdsToGroup(
                                        portfolioGroupEditor?.id,
                                        clusterInvestmentIds,
                                      )
                                    }
                                  >
                                    {clusterAssignment.assignmentState === "partial"
                                      ? "Rest hinzufügen"
                                      : "Cluster hinzufügen"}
                                  </Button>
                                )}
                              </div>
                            </div>

                            {isExpanded ? (
                              <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                                {cluster.positions.map((position) => {
                                  const positionId = normalizeInvestmentId(position.id);
                                  const assignedGroupId = portfolioGroupMembershipMap.get(positionId) || "";
                                  const assignedGroupName = assignedGroupId
                                    ? portfolioGroupsById.get(assignedGroupId)?.name || ""
                                    : "";
                                  const inActiveGroup =
                                    Boolean(portfolioGroupEditor) && assignedGroupId === portfolioGroupEditor.id;
                                  const canAssignPosition =
                                    Boolean(portfolioGroupEditor) && !inActiveGroup;
                                  const canRemovePosition =
                                    Boolean(portfolioGroupEditor) && inActiveGroup;
                                  const positionPrice = Number(position.buyPriceUsd || 0);

                                  return (
                                    <div
                                      key={position.id}
                                      className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/55 p-3 md:flex-row md:items-center md:justify-between"
                                    >
                                      <div className="min-w-0">
                                        <p className="truncate text-sm font-medium">{position.name}</p>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                          <span>{position.quantity} Stk.</span>
                                          <span>|</span>
                                          <span>{position.bucket === "inventory" ? "Inventar" : "Investment"}</span>
                                          <span>|</span>
                                          <span>{positionPrice > 0 ? `${positionPrice.toFixed(2)} USD Buy-in` : "ohne Buy-in"}</span>
                                          {assignedGroupName ? (
                                            <>
                                              <span>|</span>
                                              <span>Gruppe: {assignedGroupName}</span>
                                            </>
                                          ) : null}
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          disabled={!canAssignPosition}
                                          onClick={() =>
                                            void handleAssignInvestmentIdsToGroup(
                                              portfolioGroupEditor?.id,
                                              [positionId],
                                            )
                                          }
                                        >
                                          Position hinzufügen
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          disabled={!canRemovePosition}
                                          onClick={() =>
                                            void handleRemoveInvestmentIdsFromGroup(
                                              portfolioGroupEditor?.id,
                                              [positionId],
                                            )
                                          }
                                        >
                                          Entfernen
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}

          {/* === CREATE (MANUAL ITEM) SECTION === */}
          {managementSection === "create" ? (
            <Card>
              <CardHeader>
                <CardTitle>Manuelles Investment hinzufügen</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Für Items, die kein Sync erfasst — P2P-Käufe, Fehlkäufe, Off-Market-Trades.
                </p>
              </CardHeader>
              <CardContent className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-3">
                {/* Catalog picker. The debounced lookup already lived in
                    PortfolioPage but its hits were never rendered — this is the
                    dropdown that surfaces them. Only a catalog hit is a valid
                    selection, so the item resolves to a real item_id. */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold">Item aus dem Katalog wählen</span>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={manualItemDraft.name}
                      onChange={(event) => {
                        handleManualItemDraftChange("name", event.target.value);
                        setCatalogOpen(true);
                      }}
                      onFocus={() => setCatalogOpen(true)}
                      placeholder="Item-Namen eingeben, z. B. redline"
                      className={`h-[42px] w-full rounded-[5px] border bg-background pl-[38px] pr-24 text-sm outline-none transition-colors ${
                        manualSelectedSuggestion ? "border-success/45" : "border-border-strong"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setCatalogOpen((open) => !open)}
                      className="absolute right-2 top-[7px] h-7 rounded-[8px] border border-border bg-card px-2.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {catalogOpen ? "Schließen" : "Katalog"}
                    </button>

                    {catalogOpen && manualNameSuggestions.length > 0 ? (
                      <div className="absolute inset-x-0 top-12 z-20 flex max-h-[320px] flex-col overflow-hidden rounded-[5px] border border-border-strong bg-card shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
                        <div className="flex shrink-0 items-center justify-between border-b border-border-soft px-3 py-2">
                          <SectionLabel className="tracking-[0.08em]">
                            {manualNameSuggestions.length} Treffer im Katalog
                          </SectionLabel>
                          <span className="text-[11px] text-muted-foreground">
                            Klicken zum Übernehmen
                          </span>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto">
                        {manualNameSuggestions.map((hit) => {
                          const hitName = hit.marketHashName || hit.displayName;
                          const picked =
                            manualSelectedSuggestion?.marketHashName === hit.marketHashName;
                          return (
                            <button
                              key={hit.marketHashName}
                              type="button"
                              onClick={() => {
                                handleManualSuggestionPick(hit);
                                setCatalogOpen(false);
                              }}
                              className={`flex w-full items-center gap-2.5 border-b border-border-soft px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-surface-2 ${
                                picked ? "bg-success/10" : ""
                              }`}
                            >
                              <ItemThumb src={hit.iconUrl} alt={hitName} size="md" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-semibold">
                                  {hitName}
                                </span>
                                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                                  {hit.itemTypeLabel}
                                  {hit.wearLabel ? ` · ${hit.wearLabel}` : ""}
                                </span>
                              </span>
                              {Number.isFinite(Number(hit.livePriceEur)) ? (
                                <span className="whitespace-nowrap text-xs font-bold tabular-nums">
                                  {formatPrice(Number(hit.livePriceEur))}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                        </div>
                        <div className="shrink-0 border-t border-border-soft px-3 py-2.5 text-[11px] text-muted-foreground">
                          Nur Items aus dem Katalog sind wählbar. Fehlt eines, hilft ein Sync
                          oder eine Meldung an den Katalog.
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <span
                    className={`text-[11px] ${
                      manualSelectedSuggestion
                        ? "text-success"
                        : manualNameSuggestionsError
                          ? "text-warn"
                          : "text-muted-foreground"
                    }`}
                  >
                    {manualSelectedSuggestion
                      ? "✓ Im Katalog gefunden — Bild, Typ und Live-Preis werden übernommen"
                      : manualNameSuggestionsError
                        ? manualNameSuggestionsError
                        : manualNameSuggestionsLoading
                          ? "Katalog wird durchsucht…"
                          : "Wähle einen Treffer aus der Liste. Freie Eingaben sind nicht möglich."}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[130px_1fr_1fr]">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Menge
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={manualItemDraft.quantity}
                      onChange={(event) =>
                        handleManualItemDraftChange(
                          "quantity",
                          event.target.value,
                        )
                      }
                      className="h-[42px] w-full rounded-[11px] border border-input bg-background px-3.5 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Kaufdatum
                    </label>
                    <input
                      type="date"
                      value={manualItemDraft.purchaseDate || ""}
                      onChange={(event) =>
                        handleManualItemDraftChange("purchaseDate", event.target.value)
                      }
                      className="h-[42px] w-full rounded-[11px] border border-input bg-background px-3.5 text-sm tabular-nums"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Einkaufspreis ({currency})
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={manualItemDraft.buyPriceInput}
                      onChange={(event) =>
                        handleManualItemDraftChange(
                          "buyPriceInput",
                          event.target.value,
                        )
                      }
                      className="h-[42px] w-full rounded-[11px] border border-input bg-background px-3.5 text-sm"
                    />
                  </div>
                </div>
                {(() => {
                  const manualBuyInput = Number(manualItemDraft.buyPriceInput);
                  const manualBuyAsUsd = convertToUsd(manualBuyInput);
                  const showManualUsd =
                    currency !== "USD" &&
                    Number.isFinite(manualBuyAsUsd) &&
                    manualBuyAsUsd > 0;
                  return (
                    <p className="text-[10px] leading-snug text-muted-foreground">
                      Preis in deiner Währung ({currency}) eingeben.{" "}
                      {showManualUsd
                        ? `Wird als ${manualBuyAsUsd.toFixed(2)} USD gespeichert (heutiger Kurs). `
                        : ""}
                      Der Wechselkurs zum Kaufzeitpunkt lässt sich nicht rekonstruieren, daher sind kleine Kursabweichungen normal.
                    </p>
                  );
                })()}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Typ
                  </label>
                  <NativeSelect size="lg"
                    value={manualItemDraft.type}
                    onChange={(event) =>
                      handleManualItemDraftChange("type", event.target.value)
                    }
                    className="w-full"
                  >
                    <option value="other">Anderes</option>
                    <option value="weapon">Waffe</option>
                    <option value="knife">Messer</option>
                    <option value="gloves">Handschuhe</option>
                    <option value="sticker">Sticker</option>
                    <option value="agent">Agent</option>
                    <option value="collectible">Sammlerstueck</option>
                    <option value="container">Container</option>
                    <option value="key">Key</option>
                    <option value="music">Musik-Kit</option>
                    <option value="patch">Patch</option>
                    <option value="pin">Pin</option>
                    <option value="graffiti">Graffiti</option>
                    <option value="tool">Tool</option>
                  </NativeSelect>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Bucket</label>
                  <SegmentedControl
                    className="h-[42px] w-full rounded-[11px] p-[3px] [&>button]:h-full [&>button]:flex-1"
                    value={manualItemDraft.bucket === "inventory" ? "inventory" : "investment"}
                    onChange={(next) => handleManualItemDraftChange("bucket", next)}
                    items={[
                      { value: "investment", label: "Investment" },
                      { value: "inventory", label: "Inventar" },
                    ]}
                  />
                </div>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                  <Button
                    disabled={manualItemSaving || ratesLoading || !manualSelectedSuggestion}
                    onClick={() => void handleCreateManualInvestment()}
                  >
                    {manualItemSaving ? "Speichert…" : "Investment anlegen"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setManualItemDraft({
                        name: "",
                        buyPriceInput: "",
                        quantity: "1",
                        platform: "manual",
                        fundingMode: "wallet_funded",
                        type: "skin",
                        bucket: "investment",
                      });
                      setManualSelectedSuggestion?.(null);
                      setCatalogOpen(false);
                    }}
                  >
                    Zurücksetzen
                  </Button>
                </div>
                </div>

                {/* Vorschau — mirrors what will actually be written: the entry
                    cost in the display currency and the USD it converts to,
                    since USD is the stored source of truth. */}
                {(() => {
                  const qty = Math.max(1, Number(manualItemDraft.quantity || 1));
                  const entry = Number(manualItemDraft.buyPriceInput);
                  const hasEntry = Number.isFinite(entry) && entry > 0;
                  const entryUsd = hasEntry ? convertToUsd(entry) : 0;
                  return (
                    <aside className="flex flex-col gap-3.5 rounded-2xl border border-border bg-background p-4">
                      <SectionLabel>Vorschau</SectionLabel>
                      <div className="flex items-center gap-3">
                        <ItemThumb
                          src={manualSelectedSuggestion?.iconUrl}
                          alt={manualSelectedSuggestion?.displayName || ""}
                          size="xl"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">
                            {manualSelectedSuggestion?.displayName || "Noch kein Item gewählt"}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {manualSelectedSuggestion
                              ? [manualSelectedSuggestion.itemTypeLabel, manualSelectedSuggestion.wearLabel]
                                  .filter(Boolean)
                                  .join(" · ")
                              : "Wähle einen Treffer aus dem Katalog"}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 text-[13px]">
                        <MetaRow label="Menge" value={`${qty}×`} />
                        <MetaRow
                          label="Kaufdatum"
                          value={
                            manualItemDraft.purchaseDate
                              ? formatDateSafe(manualItemDraft.purchaseDate)
                              : "heute"
                          }
                        />
                        <MetaRow
                          label="Einstand"
                          value={hasEntry ? `${entry.toFixed(2)} ${currencySymbol}` : "—"}
                        />
                        <MetaRow
                          label="Gespeichert als"
                          value={hasEntry ? `${entryUsd.toFixed(2)} USD` : "—"}
                        />
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Der Kurs zum Kaufzeitpunkt lässt sich nicht rekonstruieren — kleine
                        Abweichungen sind normal.
                      </p>
                    </aside>
                  );
                })()}
              </CardContent>
            </Card>
          ) : null}

          {/* === EXCLUDE SECTION === */}
          {managementSection === "exclude" && managementLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : null}

          {managementSection === "exclude" &&
          !managementLoading &&
          filteredManagementClusters.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">
                Keine Cluster für den gewählten Filter gefunden.
              </CardContent>
            </Card>
          ) : null}

          {managementSection === "exclude" ? (
            <Card className="overflow-hidden">
              <CardHeader className="space-y-3">
              <div>
                <h4 className="text-base font-bold">Positionen ein- und ausschließen</h4>
                <p className="mt-1.5 text-[13px] text-muted-foreground">
                  Excluded Positionen zählen nicht in Rendite und Portfolio-Wert.
                </p>
              </div>
              {/* Design keeps search, scope segments and the two selects on ONE
                  wrapping row inside the header block, not stacked over three. */}
              <div className="flex flex-wrap items-center gap-2.5">
                <label className="relative block min-w-[240px] flex-[1_1_300px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={managementSearchTerm}
                    onChange={(event) =>
                      setManagementSearchTerm(event.target.value)
                    }
                    placeholder="Item oder Trade-ID…"
                    className="h-[38px] w-full rounded-[10px] border border-border bg-background pl-[34px] pr-3 text-[13px] outline-none transition-colors focus:border-border-strong"
                  />
                </label>
                <SegmentedControl
                  size="sm"
                  value={managementFilter}
                  onChange={setManagementFilter}
                  items={[
                    { value: "all", label: "Alle" },
                    { value: "active", label: "Nur aktiv" },
                    { value: "excluded", label: "Nur excluded" },
                  ]}
                />
                <NativeSelect size="default"
                  value={managementTypeFilter}
                  onChange={(event) =>
                    setManagementTypeFilter(event.target.value)
                  }
                >
                  <option value="all">Typ: Alle</option>
                  {managementTypeOptions.map((type) => (
                    <option key={type} value={type}>
                      Typ: {type}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect size="default"
                  value={managementBucketFilter}
                  onChange={(event) =>
                    setManagementBucketFilter(event.target.value)
                  }
                >
                  <option value="all">Bucket: Alle</option>
                  <option value="investment">Bucket: Investment</option>
                  <option value="inventory">Bucket: Inventar</option>
                </NativeSelect>
                <NativeSelect size="default"
                  value={managementSortBy}
                  onChange={(event) => setManagementSortBy(event.target.value)}
                >
                  <option value="name_asc">Sortierung: Name A-Z</option>
                  <option value="name_desc">Sortierung: Name Z-A</option>
                  <option value="qty_desc">
                    Sortierung: Menge absteigend
                  </option>
                  <option value="qty_asc">
                    Sortierung: Menge aufsteigend
                  </option>
                  <option value="updated_desc">
                    Sortierung: Zuletzt aktualisiert
                  </option>
                </NativeSelect>
              </div>
              </CardHeader>
              {/* Flat separated rows, per the design — not a stack of detached
                  rounded cards. The expanded cluster is tinted instead. */}
              <CardContent className="p-0">
              <div className="border-t border-border">
                {filteredManagementClusters.map((cluster) => {
                  const isExpanded = Boolean(expandedClusters[cluster.id]);
                  const visiblePositions = cluster.positions.filter(
                    (position) => {
                      if (managementFilter === "excluded") {
                        return !!position.excluded;
                      }
                      if (managementFilter === "active") {
                        return !position.excluded;
                      }
                      return true;
                    },
                  );

                  if (visiblePositions.length === 0) {
                    return null;
                  }

                  const excludedCount = cluster.positions.filter((p) => p.excluded).length;

                  return (
                    <div
                      key={cluster.id}
                      className={`border-b border-border-soft last:border-b-0 transition-colors ${
                        isExpanded ? "bg-surface-1" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3.5 px-5 py-3">
                        <ItemThumb
                          src={cluster.imageUrl || cluster.iconUrl}
                          alt={cluster.name || "Item"}
                          size="lg"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-bold">
                            {cluster.name || "Unbenannter Cluster"}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {visiblePositions.length}{" "}
                            {visiblePositions.length === 1 ? "Position" : "Positionen"} ·{" "}
                            {excludedCount > 0 ? (
                              <span className="font-semibold text-danger">
                                {excludedCount} excluded
                              </span>
                            ) : (
                              <span className="font-semibold text-success">alle aktiv</span>
                            )}
                          </p>
                        </div>
                        <span className="inline-flex h-[22px] shrink-0 items-center rounded-[6px] bg-surface-2 px-[9px] text-[11px] font-bold">
                          {cluster.bucket === "inventory" ? "Inventar" : "Investment"}
                        </span>
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() =>
                            // Accordion: only one cluster open at a time — opening a new
                            // one collapses the previously expanded cluster.
                            setExpandedClusters((current) =>
                              current[cluster.id] ? {} : { [cluster.id]: true },
                            )
                          }
                          className={`inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-[9px] border px-3 text-[12px] font-semibold leading-none transition-colors ${
                            isExpanded
                              ? "border-border-strong bg-surface-2 text-foreground"
                              : "border-border-strong text-foreground hover:bg-surface-2"
                          }`}
                        >
                          {isExpanded ? "Ausblenden" : "Positionen"}
                        </button>
                      </div>

                      {isExpanded ? (
                        <div className="flex flex-col gap-1 px-5 pb-3.5">
                          {visiblePositions.map((position) => {
                            const positionImageUrl =
                              String(
                                position.imageUrl || position.iconUrl || "",
                              ).trim() || null;
                            const positionBuyPrice = Number(
                              position.buyPriceUsd || 0,
                            );
                            const positionPurchasedAt = position.purchasedAt
                              ? formatDateSafe(position.purchasedAt)
                              : "";
                            const positionMatched = isPositionMatchLinked(
                              position,
                              resolvedMatchIds,
                            );
                            return (
                            <div
                              key={position.id}
                              className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 sm:flex-nowrap ${
                                position.excluded
                                  ? "border-danger/30 bg-danger/8"
                                  : "border-border bg-background"
                              }`}
                            >
                              <ItemThumb
                                src={positionImageUrl}
                                alt={position.name || "Item"}
                                size="sm"
                                className={position.excluded ? "opacity-50" : ""}
                              />
                              <div className={`min-w-0 flex-1 ${position.excluded ? "opacity-70" : ""}`}>
                                <div className="flex min-w-0 flex-wrap items-center gap-[7px]">
                                  <p className="truncate text-[13px] font-semibold">
                                    {position.name || "Unbekannt"}
                                  </p>
                                  <span className="inline-flex h-[19px] shrink-0 items-center rounded-[5px] border border-border-strong px-[7px] text-[10px] text-muted-foreground">
                                    {resolvePositionSourceLabel(position.platform)}
                                  </span>
                                  {positionMatched ? (
                                    <span className="inline-flex h-[19px] shrink-0 items-center gap-1 rounded-[5px] border border-success/40 px-[7px] text-[10px] text-success">
                                      <Link2 className="size-2.5" />
                                      Gematcht
                                    </span>
                                  ) : null}
                                </div>
                                <p className={`mt-[3px] text-[11px] ${position.excluded ? "text-danger" : "text-muted-foreground"}`}>
                                  {position.type || "unbekannt"} ·{" "}
                                  {position.quantity || 1}x ·{" "}
                                  {position.excluded
                                    ? "excluded"
                                    : "aktiv"}
                                  {" · "}
                                  {positionPurchasedAt
                                    ? `Kauf: ${positionPurchasedAt}`
                                    : "Kaufdatum unbekannt"}
                                  {" · "}
                                  {positionBuyPrice > 0
                                    ? `${positionBuyPrice.toFixed(2)} USD Buy-in`
                                    : "ohne Buy-in"}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                {/* An excluded position keeps only its way back —
                                    the design drops the bucket select there. */}
                                {position.excluded ? null : (
                                  <NativeSelect size="sm"
                                    value={position.bucket || "investment"}
                                    onChange={(event) =>
                                      void handleManagementBucketToggle(
                                        position.id,
                                        event.target.value,
                                      )
                                    }
                                    className="bg-card"
                                  >
                                    <option value="investment">Investment</option>
                                    <option value="inventory">Inventar</option>
                                  </NativeSelect>
                                )}
                                <Button
                                  size="sm"
                                  variant={
                                    position.excluded ? "outline" : "softDanger"
                                  }
                                  onClick={() =>
                                    void handleManagementExcludeToggle(
                                      position.id,
                                      !position.excluded,
                                    )
                                  }
                                  className="h-[30px] rounded-[8px] px-3 text-[12px] font-bold"
                                >
                                  {position.excluded
                                    ? "Ent-excluden"
                                    : "Excluden"}
                                </Button>
                              </div>
                            </div>
                            );
                          })}
                          {cluster.positions.filter((p) => !p.excluded).length >
                          0 ? (
                            <div className="flex items-center gap-2 pt-1">
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() =>
                                  void handleManagementClusterToggle(
                                    cluster,
                                    true,
                                  )
                                }
                                className="text-xs"
                              >
                                Alle excluden
                              </Button>
                              <NativeSelect size="sm"
                                value=""
                                onChange={(event) =>
                                  void handleManagementClusterBucketToggle(
                                    cluster,
                                    event.target.value,
                                  )
                                }
                              >
                                <option value="" disabled>
                                  Bucket für alle …
                                </option>
                                <option value="investment">Investment</option>
                                <option value="inventory">Inventar</option>
                              </NativeSelect>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              </CardContent>
            </Card>
          ) : null}

          {/* === MATCHING SECTION === */}
          {managementSection === "matching" ? (
            <Card className="overflow-hidden">
              <CardHeader className="space-y-3">
                {/* Stats bar: open vs. confirmed, and how much of the work the
                    scorer did on its own. All three come from the loaded rows —
                    nothing here is a placeholder. */}
                <div className="-mx-6 -mt-6 mb-1 flex flex-wrap items-stretch justify-between gap-5 border-b border-border bg-surface-1 px-6 py-4">
                  <div className="flex flex-wrap items-center gap-6">
                    <div className="flex items-center gap-3">
                      <span className="grid size-[38px] place-items-center rounded-xl border border-border bg-card">
                        <Link2 className="size-[18px]" />
                      </span>
                      <span>
                        <span className="block text-[15px] font-bold">
                          Steam ↔ CSFloat Matching
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Jeder Vorschlag zeigt, welche Signale den Score erzeugt haben.
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-[18px]">
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[19px] font-extrabold tabular-nums">
                          {matchingSuggestedCount}
                        </span>
                        <span className="text-[11px] text-muted-foreground">offen</span>
                      </span>
                      <span className="w-px self-stretch bg-border" />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[19px] font-extrabold tabular-nums text-success">
                          {confirmedMatchCount}
                        </span>
                        <span className="text-[11px] text-muted-foreground">bestätigt</span>
                      </span>
                      {autoMatchShare !== null ? (
                        <>
                          <span className="w-px self-stretch bg-border" />
                          <span className="flex flex-col gap-0.5">
                            <span className="text-[19px] font-extrabold tabular-nums">
                              {autoMatchShare} %
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              automatisch erkannt
                            </span>
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-center">
                    {syncNotification?.lastSyncedAt ? (
                      <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                        Letzter Lauf {formatDateSafe(syncNotification.lastSyncedAt)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setManualMatchOpen(true)}
                      className="inline-flex h-[34px] shrink-0 items-center gap-[7px] whitespace-nowrap rounded-[10px] border border-border-strong px-3.5 text-[12px] font-semibold leading-none transition-colors hover:bg-surface-2"
                    >
                      <Link2 className="size-3.5" />
                      Manuelles Matching
                    </button>
                  </div>
                </div>
                <div className="mt-3.5 grid grid-cols-1 gap-2.5 lg:grid-cols-[minmax(0,1fr)_180px_190px_auto]">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={matchingSearchTerm}
                      onChange={(event) =>
                        setMatchingSearchTerm(event.target.value)
                      }
                      placeholder="Suche nach Steam/CSFloat Item..."
                      className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm"
                    />
                  </label>
                  <NativeSelect size="default"
                    value={matchingConfidenceFilter}
                    onChange={(event) =>
                      setMatchingConfidenceFilter(event.target.value)
                    }
                  >
                    <option value="all">Konfidenz: Alle</option>
                    <option value="high">Hoch</option>
                    <option value="medium">Mittel</option>
                    <option value="low">Niedrig</option>
                  </NativeSelect>
                  <NativeSelect size="default"
                    value={matchingSortBy}
                    onChange={(event) => setMatchingSortBy(event.target.value)}
                  >
                    <option value="score_desc">Score ↓</option>
                    <option value="score_asc">Score ↑</option>
                    <option value="newest">Neueste zuerst</option>
                  </NativeSelect>
                  <button
                    type="button"
                    aria-pressed={showMatchedMatchingRows}
                    onClick={() => setShowMatchedMatchingRows(!showMatchedMatchingRows)}
                    className={`inline-flex h-[38px] items-center justify-center whitespace-nowrap rounded-[10px] border px-3.5 text-xs font-semibold leading-none transition-colors ${
                      showMatchedMatchingRows
                        ? "border-border-strong bg-surface-2 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Gematchte anzeigen
                  </button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {matchingLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                  </div>
                ) : matchingDisplayRows.length === 0 ? (
                  <div className="flex flex-col items-center gap-3.5 px-5 py-11 text-center">
                    <span className="grid size-13 place-items-center rounded-2xl border border-success/35 bg-success/10 text-success">
                      <Check className="size-6" />
                    </span>
                    <div className="max-w-[480px]">
                      <p className="text-[15px] font-bold">
                        {showMatchedMatchingRows
                          ? "Keine Matching-Einträge vorhanden"
                          : "Alle Positionen sind zugeordnet"}
                      </p>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                        {showMatchedMatchingRows
                          ? "Es liegen weder offene noch bestätigte Matches vor. Ein CSFloat-Sync erzeugt neue Vorschläge."
                          : `${confirmedMatchCount} CSFloat-Käufe sind mit einem Steam-Item verknüpft. Neue Vorschläge entstehen automatisch beim nächsten Sync.`}
                      </p>
                    </div>
                    {confirmedMatchCount > 0 ? (
                      <div className="flex items-center gap-6 rounded-[14px] border border-border bg-surface-1 px-5 py-3.5 text-center">
                        <span className="flex flex-col gap-0.5">
                          <span className="text-base font-bold tabular-nums">
                            {confirmedMatchCount}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            bestätigte Matches
                          </span>
                        </span>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap justify-center gap-2">
                      {hasCsFloatKey ? (
                        <Button size="sm" onClick={() => setIsCsFloatSyncOpen(true)}>
                          CSFloat Sync starten
                        </Button>
                      ) : null}
                      {!showMatchedMatchingRows && confirmedMatchCount > 0 ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowMatchedMatchingRows(true)}
                        >
                          Bestätigte Matches ansehen
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : filteredMatchingRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Kein Match passt zu den aktiven Filtern.
                  </p>
                ) : (
                  <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                    {filteredMatchingRows.map((row, index) => {
                      const steamItem =
                        managementInvestmentById.get(
                          String(row?.steamAssetId || ""),
                        ) || null;
                      const csfloatItem =
                        managementInvestmentById.get(
                          String(row?.csfloatInvestmentId || ""),
                        ) || null;
                      const steamImageUrl =
                        String(
                          steamItem?.imageUrl || steamItem?.iconUrl || "",
                        ).trim() || null;
                      const csfloatImageUrl =
                        String(
                          csfloatItem?.imageUrl ||
                            csfloatItem?.iconUrl ||
                            "",
                        ).trim() || null;
                      // The stored match row only carries the Steam side's name; the
                      // CSFloat name lives on the linked investment the image already
                      // resolves through, so fall back to it before the placeholder.
                      const steamDisplayName =
                        String(row?.steamItemName || steamItem?.name || "").trim() ||
                        "Steam Item";
                      const csfloatDisplayName =
                        String(row?.csfloatItemName || csfloatItem?.name || "").trim() ||
                        "CSFloat Item";
                      const matchScore = Number(row.matchScore);
                      const createdAtLabel = formatDateSafe(
                        row?.createdAt || null,
                      );
                      const confidenceMeta =
                        MATCH_CONFIDENCE_META[
                          String(row?.confidence || "").toLowerCase()
                        ] || MATCH_CONFIDENCE_META.low;
                      const reasonChips = parseMatchReasons(row?.reason);
                      const breakdownRows = buildMatchBreakdownRows(
                        row?.scoreBreakdown,
                        reasonChips,
                      );
                      const breakdownSum = breakdownRows.reduce(
                        (acc, item) =>
                          acc + (Number.isFinite(item.points) ? item.points : 0),
                        0,
                      );
                      const confidenceRationale = describeMatchConfidence(
                        row?.confidence,
                        matchScore,
                        reasonChips,
                      );
                      const matchStatus = String(row?.status || "").toLowerCase();
                      // Same predicate buildResolvedMatchIdSet uses: these two
                      // statuses are what "gematcht" means everywhere else.
                      const matchResolved =
                        matchStatus === "manual_confirmed" || matchStatus === "auto_linked";

                      return (
                        <div
                          key={String(row.id || `match-${index}`)}
                          className={`rounded-2xl border p-2 sm:p-3 ${
                            matchResolved
                              ? "border-success/28 bg-success/6"
                              : "border-border bg-background"
                          }`}
                        >
                          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                            <div className="space-y-2">
                              <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)]">
                                <div className="flex items-center gap-2.5 rounded-[10px] border border-border bg-background p-2.5">
                                  <div className="h-10 w-10 overflow-hidden rounded-md border bg-muted/30 p-1">
                                    {steamImageUrl ? (
                                      <img
                                        src={steamImageUrl}
                                        alt={steamDisplayName}
                                        className="h-full w-full object-contain"
                                        loading="lazy"
                                        decoding="async"
                                      />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                                        N/A
                                      </div>
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-medium">
                                      {steamDisplayName}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                      Steam
                                    </p>
                                  </div>
                                </div>
                                <div
                                  className={`grid place-items-center ${
                                    matchResolved ? "text-success" : "text-muted-foreground"
                                  }`}
                                  title={matchResolved ? "Gematcht" : "Vorschlag"}
                                >
                                  <Link2 className="size-5" />
                                </div>
                                <div className="flex items-center gap-2.5 rounded-[10px] border border-border bg-background p-2.5">
                                  <div className="h-10 w-10 overflow-hidden rounded-md border bg-muted/30 p-1">
                                    {csfloatImageUrl ? (
                                      <img
                                        src={csfloatImageUrl}
                                        alt={csfloatDisplayName}
                                        className="h-full w-full object-contain"
                                        loading="lazy"
                                        decoding="async"
                                      />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                                        N/A
                                      </div>
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-medium">
                                      {csfloatDisplayName}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                      CSFloat
                                    </p>
                                  </div>
                                </div>
                              </div>
                              {/* Signal pills carrying the actual measured deviation */}
                              {breakdownRows.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {breakdownRows.map((item, itemIndex) => (
                                    <span
                                      key={`${item.code}-${itemIndex}`}
                                      className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 text-[11px] text-muted-foreground"
                                    >
                                      <span className="font-bold text-foreground">
                                        {item.label}
                                      </span>
                                      {item.detail ? (
                                        <span className="text-muted-foreground">
                                          {item.detail}
                                        </span>
                                      ) : null}
                                      {Number.isFinite(item.points) ? (
                                        <span className="font-bold text-success">
                                          +{item.points}
                                        </span>
                                      ) : null}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            {/* Score column — identical for open suggestions and
                                resolved matches, so a confirmed row stays as
                                readable as the one it was confirmed from. Only the
                                actions below the meter differ by status. */}
                            <div
                              className="flex shrink-0 flex-col gap-2 lg:w-[168px]"
                              title={`${confidenceRationale} · Erstellt: ${createdAtLabel}`}
                            >
                              <div className="flex items-baseline justify-between gap-2">
                                <span
                                  className={`text-[11px] font-bold uppercase tracking-[0.08em] ${confidenceMeta.accentText}`}
                                >
                                  {confidenceMeta.label}
                                </span>
                                <span className="text-xl font-extrabold tabular-nums text-foreground">
                                  {breakdownSum}
                                </span>
                              </div>
                              <div className="mt-0.5 mb-1 h-1.5 overflow-hidden rounded-full bg-border">
                                <div
                                  className={`h-full rounded-full ${confidenceMeta.accentBar}`}
                                  style={{
                                    width: `${Math.max(
                                      0,
                                      Math.min(
                                        100,
                                        Math.round(
                                          (breakdownSum / MATCH_SCORE_METER_MAX) * 100,
                                        ),
                                      ),
                                    )}%`,
                                  }}
                                />
                              </div>
                              {matchStatus === "suggested" ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="default"
                                    onClick={() =>
                                      void handleMatchStatusUpdate(
                                        row.id,
                                        "manual_confirmed",
                                      )
                                    }
                                  >
                                    Bestätigen
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      void handleMatchStatusUpdate(row.id, "rejected")
                                    }
                                  >
                                    Ablehnen
                                  </Button>
                                </>
                              ) : matchStatus === "auto_linked" ? (
                                <>
                                  <span className="flex h-[34px] items-center justify-center rounded-[9px] border border-border-strong text-[13px] font-bold leading-none text-muted-foreground">
                                    Auto-Match
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      void handleMatchStatusUpdate(
                                        row.id,
                                        "manual_confirmed",
                                      )
                                    }
                                  >
                                    Bestätigen
                                  </Button>
                                </>
                              ) : (
                                <span className="flex h-[34px] items-center justify-center rounded-[9px] border border-success/40 bg-success/10 text-[13px] font-bold leading-none text-success">
                                  Bestätigt
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      {/* Modals */}
      <ManualMatchModal
        open={manualMatchOpen}
        onClose={() => setManualMatchOpen(false)}
        steamCandidates={manualSteamCandidates}
        csfloatCandidates={manualCsfloatCandidates}
        onConfirm={handleManualMatchCreate}
      />
      {isCsFloatSyncOpen ? (
        <Suspense fallback={null}>
          <CsFloatTradeSyncModal
            open={isCsFloatSyncOpen}
            onClose={() => setIsCsFloatSyncOpen(false)}
          />
        </Suspense>
      ) : null}
      {isSkinBaronSyncOpen ? (
        <Suspense fallback={null}>
          <SkinBaronSalesSyncModal
            open={isSkinBaronSyncOpen}
            onClose={() => setIsSkinBaronSyncOpen(false)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
