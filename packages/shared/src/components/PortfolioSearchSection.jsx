import { Suspense, lazy } from "react";
import { Skeleton } from "./ui/skeleton.jsx";

const ItemSearch = lazy(() =>
  import("./ItemSearch.jsx").then((module) => ({
    default: module.ItemSearch,
  })),
);

/**
 * Search tab content for the Portfolio page — thin wrapper around ItemSearch.
 */
export function PortfolioSearchSection({
  forceMount,
  searchPageInitialTerm,
  globalSearchWatchlistItems,
  onAddToWatchlist,
  onWarningsChange,
}) {
  return (
    <div
      forceMount={forceMount}
      className="space-y-4 sm:space-y-6"
    >
      <Suspense
        fallback={
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        }
      >
        <ItemSearch
          onAddToWatchlist={onAddToWatchlist}
          existingItems={globalSearchWatchlistItems.map((entry) => ({
            name: entry?.name || entry?.marketHashName || "",
          }))}
          onWarningsChange={onWarningsChange}
          initialSearchTerm={searchPageInitialTerm}
          submittedTerm={searchPageInitialTerm}
          showSearchInput={false}
          autoFocus={false}
        />
      </Suspense>
    </div>
  );
}
