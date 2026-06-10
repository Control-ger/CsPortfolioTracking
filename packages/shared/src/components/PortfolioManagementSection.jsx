import { Suspense, lazy } from "react";
import { Info, Search } from "lucide-react";
import { Badge } from "./ui/badge.jsx";
import { Button } from "./ui/button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.jsx";
import { Skeleton } from "./ui/skeleton.jsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip.jsx";
import {
  getItemNameKey,
  normalizeBucket,
  formatDateSafe,
} from "../lib/portfolioHelpers.js";

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
  matchingLoading,
  matchingSearchTerm,
  setMatchingSearchTerm,
  matchingSortBy,
  setMatchingSortBy,
  showMatchedMatchingRows,
  setShowMatchedMatchingRows,
  handleMatchStatusUpdate,
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

  // Manual item
  manualItemDraft,
  setManualItemDraft,
  manualSelectedSuggestion,
  manualItemSaving,
  handleManualItemDraftChange,
  handleCreateManualInvestment,

  // Portfolio group state
  portfolioGroups,
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

  // Additional matching state
  matchingDisplayRows,
  handleEditPortfolioGroup,

  // Derived / computed values
  filteredManagementClusters,
  managementTypeOptions,
  managementQuickHints,
  filteredMatchingRows,
  matchingSuggestedCount,
  matchedSteamInventoryItemsCount,
  filteredPriceItems,
  suggestedPriceByNameKey,
  priceMissingCount,
}) {
  if (!forceMount) {
    return null;
  }

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
          {/* Inbox section */}
          <div className="space-y-4 rounded-lg border border-border/70 bg-background/35 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold tracking-tight">Inbox</h3>
                <p className="text-sm text-muted-foreground">
                  Aufgaben aus dem letzten Steam-Sync in einer Uebersicht.
                </p>
              </div>
              <Badge variant="secondary" className="h-7 px-3 text-xs">
                Auto-Sync: {autoSyncEnabled ? "An" : "Aus"}
              </Badge>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-border/70 bg-background/70 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Neue Steam-Items
                </p>
                <p className="mt-1 text-2xl font-semibold leading-none tracking-tight">
                  {syncNotification.newItemsCount}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-background/70 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Matching offen
                </p>
                <p className="mt-1 text-2xl font-semibold leading-none tracking-tight">
                  {matchingSuggestedCount}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-background/70 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Ohne Einkaufspreis
                </p>
                <p className="mt-1 text-2xl font-semibold leading-none tracking-tight">
                  {priceMissingCount}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="default"
                disabled={isSteamSyncing}
                onClick={() => void runSteamSync({ manual: true })}
              >
                {isSteamSyncing ? "Sync laeuft..." : "Steam Sync starten"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleToggleAutoSync()}
              >
                Auto-Sync umschalten
              </Button>
              {hasCsFloatKey ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsCsFloatSyncOpen(true)}
                >
                  CSFloat Sync
                </Button>
              ) : null}
              {hasSkinBaronImportReady ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsSkinBaronSyncOpen(true)}
                >
                  SkinBaron Sync
                </Button>
              ) : null}
            </div>

            {!hasCsFloatKey && !hasSkinBaronImportReady ? (
              <p className="text-xs text-muted-foreground">
                Kein CSFloat-Key bzw. kein gueltiger SkinBaron Session-Zugriff
                hinterlegt. Import-Buttons erscheinen automatisch nach Setup.
              </p>
            ) : null}

            {/* Sub-section toggles */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={
                  managementSection === "matching" ? "default" : "outline"
                }
                size="sm"
                onClick={() => setManagementSection("matching")}
              >
                Matching
              </Button>
              <Button
                variant={
                  managementSection === "prices" ? "default" : "outline"
                }
                size="sm"
                onClick={() => setManagementSection("prices")}
              >
                Preise
              </Button>
              <Button
                variant={
                  managementSection === "exclude" ? "default" : "outline"
                }
                size="sm"
                onClick={() => setManagementSection("exclude")}
              >
                Exclude
              </Button>
              <Button
                variant={
                  managementSection === "groups" ? "default" : "outline"
                }
                size="sm"
                onClick={() => setManagementSection("groups")}
              >
                Gruppen
              </Button>
              <Button
                variant={
                  managementSection === "create" ? "default" : "outline"
                }
                size="sm"
                onClick={() => setManagementSection("create")}
              >
                Hinzufuegen
              </Button>
            </div>

            <TooltipProvider delayDuration={140}>
              <div className="flex flex-wrap items-center gap-2">
                {managementQuickHints.map((hint) => (
                  <Tooltip key={hint.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <Info className="h-3.5 w-3.5" />
                        <span>{hint.title}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="max-w-[260px] text-xs leading-relaxed"
                    >
                      {hint.text}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>

            {steamSyncError ? (
              <p className="text-xs text-destructive">{steamSyncError}</p>
            ) : null}

            <p className="text-[11px] text-muted-foreground">
              Datenabruf erfolgt nur lokal fuer deinen Account. Auto-Sync
              laeuft maximal alle 30 Minuten pro App-Instanz und kann jederzeit
              deaktiviert werden.
            </p>
          </div>

          {/* Management error */}
          {managementError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {managementError}
            </div>
          ) : null}

          {/* === PRICES SECTION === */}
          {managementSection === "prices" ? (
            <Card className="overflow-hidden">
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>Preise setzen</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {filteredPriceItems.length} sichtbar
                    </Badge>
                    {matchedSteamInventoryItemsCount > 0 ? (
                      <Badge variant="outline">
                        {matchedSteamInventoryItemsCount} gematcht ausgeblendet
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Nur nicht gematchte Steam-Inventory-Items koennen hier einen
                  Einkaufspreis erhalten.
                </p>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={priceSearchTerm}
                      onChange={(event) =>
                        setPriceSearchTerm(event.target.value)
                      }
                      placeholder="Nach Item suchen..."
                      className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm"
                    />
                  </label>
                  <select
                    value={priceSortBy}
                    onChange={(event) => setPriceSortBy(event.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="name_asc">Sortierung: Name A-Z</option>
                    <option value="name_desc">Sortierung: Name Z-A</option>
                    <option value="price_desc">
                      Sortierung: Preis absteigend
                    </option>
                    <option value="price_asc">
                      Sortierung: Preis aufsteigend
                    </option>
                    <option value="qty_desc">
                      Sortierung: Menge absteigend
                    </option>
                  </select>
                  <label className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                    <input
                      type="checkbox"
                      checked={priceMissingOnly}
                      onChange={(event) =>
                        setPriceMissingOnly(event.target.checked)
                      }
                      className="h-4 w-4 rounded border-input"
                    />
                    Nur ohne Preis ({priceMissingCount})
                  </label>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {rawSteamInventoryItems.length === 0 ? (
                  steamInventoryItemsAll.length > 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Alle Steam-Inventory-Items sind bereits gematcht. Keine
                      manuellen Preise noetig.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Noch keine Steam-Inventory-Items vorhanden.
                    </p>
                  )
                ) : filteredPriceItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Kein Item passt zu Suche/Filter.
                  </p>
                ) : (
                  <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                    {filteredPriceItems.map((item) => {
                      const currentPrice = Number(
                        item.buyPriceUsd ?? item.buyPrice ?? 0,
                      );
                      const nameKey = getItemNameKey(item);
                      const suggestion =
                        suggestedPriceByNameKey.get(nameKey) || null;
                      const suggestedPrice = Number(suggestion?.value ?? 0);
                      const hasSuggestion =
                        Number.isFinite(suggestedPrice) && suggestedPrice > 0;
                      const draftValue =
                        priceDrafts[item.id] ??
                        String(currentPrice > 0 ? currentPrice : "");
                      const itemImageUrl =
                        String(item.imageUrl || item.iconUrl || "").trim() ||
                        null;
                      const bucket = normalizeBucket(item.bucket, "inventory");
                      const quantity = Math.max(
                        1,
                        Number(item.quantity || 1),
                      );

                      return (
                        <div key={item.id} className="rounded-md border p-2 sm:p-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="h-12 w-12 overflow-hidden rounded-md border bg-muted/30 p-1">
                              {itemImageUrl ? (
                                <img
                                  src={itemImageUrl}
                                  alt={item.name}
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
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold">
                                {item.name}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                <span>{quantity}x</span>
                                <span>|</span>
                                <span>
                                  {bucket === "inventory"
                                    ? "Inventar"
                                    : "Investment"}
                                </span>
                                <span>|</span>
                                <span>
                                  Aktuell:{" "}
                                  {currentPrice > 0
                                    ? `${currentPrice.toFixed(2)} USD`
                                    : "kein Preis gesetzt"}
                                </span>
                              </div>
                              {hasSuggestion ? (
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  Vorschlag: {suggestedPrice.toFixed(2)} USD (
                                  {String(suggestion?.source || "live")})
                                </p>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={draftValue}
                                onChange={(event) =>
                                  handlePriceDraftChange(
                                    item.id,
                                    event.target.value,
                                  )
                                }
                                className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
                                placeholder={
                                  hasSuggestion
                                    ? `${suggestedPrice.toFixed(2)} USD`
                                    : "USD"
                                }
                                disabled={savingPriceItemId === item.id}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void handleSaveSteamItemPrice(item)
                                }
                                disabled={savingPriceItemId === item.id}
                              >
                                {savingPriceItemId === item.id
                                  ? "Speichert..."
                                  : "Speichern"}
                              </Button>
                              {hasSuggestion ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    void handleAcceptSuggestedPrice(
                                      item,
                                      suggestedPrice,
                                    )
                                  }
                                  disabled={savingPriceItemId === item.id}
                                >
                                  Uebernehmen
                                </Button>
                              ) : null}
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

          {/* === GROUPS SECTION === */}
          {managementSection === "groups" ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
              <Card className="overflow-hidden">
                <CardHeader className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>Investment Gruppen</CardTitle>
                    <Badge variant="secondary">
                      {portfolioGroups.length} Gruppen
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Gruppen sind nur ein Anzeige-Layer. Cluster und Positionen
                    darunter bleiben fachlich unveraendert.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleStartCreatePortfolioGroup()}
                    >
                      Neue Gruppe hinzufuegen
                    </Button>
                    {portfolioGroupEditor ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resetPortfolioGroupEditor()}
                      >
                        Bearbeitung verlassen
                      </Button>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Group editor form */}
                  <div className="space-y-3 rounded-xl border border-border/70 bg-background/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">
                        {portfolioGroupEditor
                          ? "Gruppe bearbeiten"
                          : "Neue Gruppe"}
                      </p>
                      {portfolioGroupEditor ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => resetPortfolioGroupEditor()}
                        >
                          Reset
                        </Button>
                      ) : null}
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
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => void handleSavePortfolioGroup()}
                      >
                        {portfolioGroupEditor
                          ? "Aenderungen speichern"
                          : "Gruppe anlegen"}
                      </Button>
                      {portfolioGroupEditor ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            void handleDeletePortfolioGroup(
                              portfolioGroupEditor.id,
                            )
                          }
                        >
                          Gruppe loeschen
                        </Button>
                      ) : null}
                    </div>
                    {portfolioGroupMessage ? (
                      <p className="text-xs text-emerald-400">
                        {portfolioGroupMessage}
                      </p>
                    ) : null}
                    {portfolioGroupError ? (
                      <p className="text-xs text-destructive">
                        {portfolioGroupError}
                      </p>
                    ) : null}
                  </div>

                  {/* Group list */}
                  <div className="space-y-2">
                    {portfolioGroupsLoading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                      </div>
                    ) : portfolioGroups.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        Noch keine Gruppen angelegt.
                      </p>
                    ) : (
                      portfolioGroups.map((group) => (
                        <div
                          key={group.id}
                          className={`rounded-lg border p-3 transition-colors ${
                            portfolioGroupEditorId === group.id
                              ? "border-primary/50 bg-primary/5"
                              : "border-border/70"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {group.name}
                              </p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {group.clusterCount || 0} Cluster ·{" "}
                                {group.totalQuantity || 0} Items
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  handleEditPortfolioGroup(group)
                                }
                              >
                                Bearbeiten
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  handleOpenPortfolioGroupInInventory(group.id)
                                }
                              >
                                Inventar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  handleOpenPortfolioGroupInManagement(
                                    group.id,
                                  )
                                }
                              >
                                Cluster
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}

          {/* === CREATE (MANUAL ITEM) SECTION === */}
          {managementSection === "create" ? (
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Manuelles Investment hinzufuegen</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Trage ein Item ein, das nicht automatisch importiert wurde,
                  z. B. ein P2P-Item oder einen Fehlkauf.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Item-Name
                  </label>
                  <input
                    type="text"
                    value={manualItemDraft.name}
                    onChange={(event) =>
                      handleManualItemDraftChange("name", event.target.value)
                    }
                    placeholder="z. B. AK-47 | Redline (Field-Tested)"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  {manualSelectedSuggestion ? (
                    <p className="text-xs text-emerald-400">
                      Ausgewaehlt: {manualSelectedSuggestion.name}
                    </p>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-3">
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
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Einkaufspreis (USD)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={manualItemDraft.buyPriceUsd}
                      onChange={(event) =>
                        handleManualItemDraftChange(
                          "buyPriceUsd",
                          event.target.value,
                        )
                      }
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Typ
                  </label>
                  <select
                    value={manualItemDraft.type}
                    onChange={(event) =>
                      handleManualItemDraftChange("type", event.target.value)
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Externe URL (optional)
                  </label>
                  <input
                    type="url"
                    value={manualItemDraft.externalUrl}
                    onChange={(event) =>
                      handleManualItemDraftChange(
                        "externalUrl",
                        event.target.value,
                      )
                    }
                    placeholder="https://steamcommunity.com/market/listings/..."
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={
                      manualItemSaving ||
                      !String(manualItemDraft.name || "").trim()
                    }
                    onClick={() => void handleCreateManualInvestment()}
                  >
                    {manualItemSaving
                      ? "Speichert..."
                      : "Investment anlegen"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setManualItemDraft({
                        name: "",
                        quantity: 1,
                        buyPriceUsd: "",
                        type: "other",
                        externalUrl: "",
                      })
                    }
                  >
                    Zuruecksetzen
                  </Button>
                </div>
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
                Keine Cluster fuer den gewaehlten Filter gefunden.
              </CardContent>
            </Card>
          ) : null}

          {managementSection === "exclude" ? (
            <>
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={managementSearchTerm}
                    onChange={(event) =>
                      setManagementSearchTerm(event.target.value)
                    }
                    placeholder="Suche nach Item oder Trade-ID..."
                    className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm"
                  />
                </label>
                <select
                  value={managementTypeFilter}
                  onChange={(event) =>
                    setManagementTypeFilter(event.target.value)
                  }
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="all">Typ: Alle</option>
                  {managementTypeOptions.map((type) => (
                    <option key={type} value={type}>
                      Typ: {type}
                    </option>
                  ))}
                </select>
                <select
                  value={managementBucketFilter}
                  onChange={(event) =>
                    setManagementBucketFilter(event.target.value)
                  }
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="all">Bucket: Alle</option>
                  <option value="investment">Bucket: Investment</option>
                  <option value="inventory">Bucket: Inventar</option>
                </select>
                <select
                  value={managementSortBy}
                  onChange={(event) => setManagementSortBy(event.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
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
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={managementFilter === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setManagementFilter("all")}
                >
                  Alle
                </Button>
                <Button
                  variant={
                    managementFilter === "excluded" ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setManagementFilter("excluded")}
                >
                  Nur Excluded
                </Button>
                <Button
                  variant={
                    managementFilter === "active" ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setManagementFilter("active")}
                >
                  Nur Aktiv
                </Button>
                <Badge variant="secondary">
                  {filteredManagementClusters.length} Cluster
                </Badge>
              </div>
              <div className="space-y-3">
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

                  return (
                    <div
                      key={cluster.id}
                      className="rounded-lg border border-border/70"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedClusters((current) => ({
                            ...current,
                            [cluster.id]: !isExpanded,
                          }))
                        }
                        className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-muted/30"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">
                            {cluster.name || "Unbenannter Cluster"}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {visiblePositions.length} Positionen ·{" "}
                            {cluster.positions.filter((p) => p.excluded)
                              .length > 0
                              ? `${cluster.positions.filter((p) => p.excluded).length} excluded`
                              : "alle aktiv"}
                          </p>
                        </div>
                      </button>

                      {isExpanded ? (
                        <div className="space-y-1 border-t border-border/50 p-2">
                          {visiblePositions.map((position) => (
                            <div
                              key={position.id}
                              className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 p-2 sm:flex-nowrap"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium">
                                  {position.name || "Unbekannt"}
                                </p>
                                <p className="mt-0.5 text-[10px] text-muted-foreground">
                                  {position.type || "unbekannt"} ·{" "}
                                  {position.quantity || 1}x ·{" "}
                                  {position.excluded
                                    ? "excluded"
                                    : "aktiv"}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <Button
                                  size="sm"
                                  variant={
                                    position.excluded ? "outline" : "destructive"
                                  }
                                  onClick={() =>
                                    void handleManagementExcludeToggle(
                                      position.id,
                                      !position.excluded,
                                    )
                                  }
                                  className="text-xs"
                                >
                                  {position.excluded
                                    ? "Ent-excluden"
                                    : "Excluden"}
                                </Button>
                                <select
                                  value={position.bucket || "investment"}
                                  onChange={(event) =>
                                    void handleManagementBucketToggle(
                                      position.id,
                                      event.target.value,
                                    )
                                  }
                                  className="h-7 rounded border border-input bg-background px-1 text-[11px]"
                                >
                                  <option value="investment">Investment</option>
                                  <option value="inventory">Inventar</option>
                                </select>
                              </div>
                            </div>
                          ))}
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
                              <select
                                value=""
                                onChange={(event) =>
                                  void handleManagementClusterBucketToggle(
                                    cluster,
                                    event.target.value,
                                  )
                                }
                                className="h-7 rounded border border-input bg-background px-1 text-[11px]"
                              >
                                <option value="" disabled>
                                  Bucket fuer alle...
                                </option>
                                <option value="investment">Investment</option>
                                <option value="inventory">Inventar</option>
                              </select>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          {/* === MATCHING SECTION === */}
          {managementSection === "matching" ? (
            <Card className="overflow-hidden">
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>Steam {'<->'} CSFloat Matching Queue</CardTitle>
                  <div className="flex items-center gap-2">
                    {showMatchedMatchingRows ? (
                      <Badge variant="secondary">
                        {filteredMatchingRows.length} sichtbar
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        {filteredMatchingRows.length} offen
                      </Badge>
                    )}
                    {showMatchedMatchingRows ? (
                      <Badge variant="outline">
                        Gematcht: {matchingSuggestedCount}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
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
                  <select
                    value={matchingSortBy}
                    onChange={(event) => setMatchingSortBy(event.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="score_desc">
                      Sortierung: Score absteigend
                    </option>
                    <option value="score_asc">
                      Sortierung: Score aufsteigend
                    </option>
                    <option value="newest">
                      Sortierung: Neueste zuerst
                    </option>
                  </select>
                  <label className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                    <input
                      type="checkbox"
                      checked={showMatchedMatchingRows}
                      onChange={(event) =>
                        setShowMatchedMatchingRows(event.target.checked)
                      }
                      className="h-4 w-4 accent-primary"
                    />
                    Gematchte anzeigen
                  </label>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {matchingLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                  </div>
                ) : matchingDisplayRows.length === 0 ? (
                  showMatchedMatchingRows ? (
                    <p className="text-sm text-muted-foreground">
                      Keine Matching-Eintraege vorhanden.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Keine offenen Matching-Vorschlaege vorhanden.
                    </p>
                  )
                ) : filteredMatchingRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Kein Match passt zur Suche.
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
                      const matchScore = Number(row.matchScore);
                      const matchScoreLabel = Number.isFinite(matchScore)
                        ? matchScore.toFixed(0)
                        : "-";
                      const createdAtLabel = formatDateSafe(
                        row?.createdAt || null,
                      );

                      return (
                        <div
                          key={String(row.id || `match-${index}`)}
                          className="rounded-md border p-2 sm:p-3"
                        >
                          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                            <div className="space-y-2">
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <div className="flex items-center gap-2 rounded-md border border-border/60 p-2">
                                  <div className="h-10 w-10 overflow-hidden rounded-md border bg-muted/30 p-1">
                                    {steamImageUrl ? (
                                      <img
                                        src={steamImageUrl}
                                        alt={
                                          row?.steamItemName || "Steam Item"
                                        }
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
                                      {row?.steamItemName || "Steam Item"}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                      Steam
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 rounded-md border border-border/60 p-2">
                                  <div className="h-10 w-10 overflow-hidden rounded-md border bg-muted/30 p-1">
                                    {csfloatImageUrl ? (
                                      <img
                                        src={csfloatImageUrl}
                                        alt={
                                          row?.csfloatItemName ||
                                          "CSFloat Item"
                                        }
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
                                      {row?.csfloatItemName || "CSFloat Item"}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                      CSFloat
                                    </p>
                                  </div>
                                </div>
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                Score: {matchScoreLabel} · Erstellt:{" "}
                                {createdAtLabel}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {row.status === "pending" ? (
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
                                    Bestaetigen
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      void handleMatchStatusUpdate(
                                        row.id,
                                        "rejected",
                                      )
                                    }
                                  >
                                    Ablehnen
                                  </Button>
                                </>
                              ) : (
                                <Badge variant="outline">
                                  {String(row?.status || "").toLowerCase() ===
                                  "auto_linked"
                                    ? "Auto gematcht"
                                    : "Gematcht"}
                                </Badge>
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
