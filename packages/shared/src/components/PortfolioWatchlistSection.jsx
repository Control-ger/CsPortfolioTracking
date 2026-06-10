import { Suspense, lazy } from "react";
import { Skeleton } from "./Skeleton.jsx";

const Watchlist = lazy(() =>
  import("./Watchlist.jsx").then((module) => ({
    default: module.Watchlist,
  })),
);

/**
 * Watchlist tab content for the Portfolio page — thin wrapper around Watchlist component.
 */
export function PortfolioWatchlistSection({
  forceMount,
  watchlistFocusTarget,
  onWarningsChange,
}) {
  return (
    <div forceMount={forceMount} className="space-y-4 sm:space-y-6">
      <Suspense
        fallback={
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        }
      >
        <Watchlist
          focusTarget={watchlistFocusTarget}
          onWarningsChange={onWarningsChange}
        />
      </Suspense>
    </div>
  );
}
