import { Suspense, lazy } from "react";
import { Skeleton } from "./ui/skeleton.jsx";
import { Button } from "./ui/button.jsx";
import { BREAKPOINTS } from "../lib/index.js";
import { resolveLiveClusterItem, withBuyOrderFields } from "../lib/portfolioHelpers.js";

const InventoryTable = lazy(() =>
  import("./InventoryTable.jsx").then((module) => ({
    default: module.InventoryTable,
  })),
);
const ItemDetailsModal = lazy(() =>
  import("./ItemDetailsModal.jsx").then((module) => ({
    default: module.ItemDetailsModal,
  })),
);
const ItemDetailPanel = lazy(() =>
  import("./ItemDetailPanel.jsx").then((module) => ({
    default: module.ItemDetailPanel,
  })),
);

/**
 * Inventory tab content for the Portfolio page.
 */
export function PortfolioInventorySection({
  forceMount,
  inventoryScope,
  onInventoryScopeChange,
  inventoryTabItems,
  portfolioGroupSummaries,
  onSelectItem,
  onSelectGroup,
  onSelectCluster,
  selectedItemWithLiveAndBuyOrders,
  selectedItem,
  selectedItemHistory,
  selectedItemHistoryLoading,
  isDesktopRuntime,
  onExcludeChange,
  onBucketChange,
  canToggleExclude,
  canToggleBucket,
  onModalExcludeToggle,
  modals,
  onCloseModal,
  enrichedInvestments,
  inventoryBuyOrderSummary,
}) {
  return (
    <div forceMount={forceMount} className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
      <div className="md:col-span-2 space-y-2">
        <h3 className="text-base font-semibold">Ansicht</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={inventoryScope === "investment" ? "default" : "outline"}
            onClick={() => onInventoryScopeChange("investment")}
          >
            Investments
          </Button>
          <Button
            size="sm"
            variant={inventoryScope === "inventory" ? "default" : "outline"}
            onClick={() => onInventoryScopeChange("inventory")}
          >
            Inventar
          </Button>
          <Button
            size="sm"
            variant={inventoryScope === "all" ? "default" : "outline"}
            onClick={() => onInventoryScopeChange("all")}
          >
            Alles
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto md:col-span-1 sm:rounded-2xl sm:border sm:border-border/70 sm:bg-card/65">
        <Suspense
          fallback={
            <div className="space-y-3 p-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          }
        >
          <InventoryTable
            investments={inventoryTabItems}
            groups={(Array.isArray(portfolioGroupSummaries) ? portfolioGroupSummaries : []).filter(
              (group) =>
                inventoryScope === "all" ||
                String(group?.bucket || "investment") === inventoryScope,
            )}
            onSelectItem={onSelectItem}
            onSelectGroup={onSelectGroup}
            onSelectCluster={onSelectCluster}
          />
        </Suspense>
      </div>

      <div className="hidden md:col-span-1 md:sticky md:top-20 md:block md:self-start md:max-h-[calc(100vh-6rem)] md:overflow-y-auto">
        <Suspense fallback={<Skeleton className="h-[28rem] w-full rounded-2xl" />}>
          <ItemDetailPanel
            item={selectedItemWithLiveAndBuyOrders || selectedItem}
            history={selectedItemHistory}
            historyLoading={selectedItemHistoryLoading}
            onExcludeChange={isDesktopRuntime ? onExcludeChange : undefined}
            onBucketChange={isDesktopRuntime ? onBucketChange : undefined}
            canToggleExclude={canToggleExclude}
            canToggleBucket={canToggleBucket}
          />
        </Suspense>
      </div>

      {modals.map((modal) =>
        modal.type === "itemDetail" ? (() => {
          const rawModalItem = modal?.data?.item;
          // Group selections must NOT be resolved against enrichedInvestments: their
          // sourceInvestmentIds (mapped from memberInvestmentIds) overlap real rows and
          // would return a single member instead of the group aggregate.
          const isGroupModalItem =
            rawModalItem?.__detailKind === "group" ||
            rawModalItem?.__detailKind === "group-cluster";
          const liveModalItem = isGroupModalItem
            ? rawModalItem
            : resolveLiveClusterItem(rawModalItem, enrichedInvestments) || rawModalItem || null;
          const modalItemWithBuyOrders = withBuyOrderFields(liveModalItem, inventoryBuyOrderSummary);
          return (
            <Suspense key={modal.id} fallback={null}>
              <ItemDetailsModal
                isOpen={true}
                onClose={() => onCloseModal(modal.id)}
                item={modalItemWithBuyOrders}
                history={selectedItemHistory}
                historyLoading={selectedItemHistoryLoading}
                onToggleExclude={isDesktopRuntime ? onModalExcludeToggle : undefined}
                onBucketChange={isDesktopRuntime ? onBucketChange : undefined}
                canToggleExclude={isDesktopRuntime}
              />
            </Suspense>
          );
        })() : null,
      )}
    </div>
  );
}
