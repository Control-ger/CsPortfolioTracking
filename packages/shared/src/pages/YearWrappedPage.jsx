import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { deriveSteamPaletteFromUser } from "../components/SteamLoginPrompt.jsx";
import {
  WrappedCurveSlide,
  WrappedExtremesSlide,
  WrappedHighlightsSlide,
  WrappedIntroSlide,
  WrappedMonthlySlide,
  WrappedOutroSlide,
  WrappedPerformersSlide,
  WrappedPlatformsSlide,
  WrappedPurchasesSlide,
  WrappedWatchlistSlide,
} from "../components/YearWrappedSlides.jsx";
import { usePortfolio } from "../hooks/usePortfolio.jsx";
import { getCurrentUser } from "../lib/auth.js";
import { resolveDesktopLocalUserId } from "../lib/userIdentity.js";
import { buildYearWrappedStats, resolveWrappedSeason } from "../lib/yearWrapped.js";

// Frozen fallback for the avatar-derived shell gradient, mirroring the vault
// gate in apps/web/src/App.jsx. The palette is applied as a scoped inline style
// rather than on documentElement so leaving the story restores the app colors.
const DEFAULT_STEAM_SHELL_PALETTE = Object.freeze({
  colorA: "hsla(212, 62%, 52%, 0.24)",
  colorB: "hsla(188, 55%, 52%, 0.18)",
  colorC: "hsla(39, 48%, 52%, 0.14)",
  colorD: "hsla(32, 42%, 46%, 0.14)",
});

function isDesktopRuntime() {
  return Boolean(typeof window !== "undefined" && window.electronAPI?.localStore);
}

function parseYearParam(rawValue, fallbackYear) {
  const parsed = Number.parseInt(String(rawValue || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2999) {
    return fallbackYear;
  }
  return parsed;
}

export function YearWrappedPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const season = useMemo(() => resolveWrappedSeason(new Date()), []);
  const year = parseYearParam(searchParams.get("year"), season.year);

  const [user, setUser] = useState(null);
  const [shellPalette, setShellPalette] = useState(DEFAULT_STEAM_SHELL_PALETTE);
  const [rawInvestments, setRawInvestments] = useState([]);
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [slideIndex, setSlideIndex] = useState(0);

  const {
    enrichedInvestments,
    portfolioHistory,
    isLoading: portfolioLoading,
  } = usePortfolio({ scope: "all", rowScope: "all" });

  const handleClose = useCallback(() => {
    navigate("/", { replace: true });
  }, [navigate]);

  // Wrapped reads un-clustered local rows because the clustered/aggregated
  // paths collapse by item name and drop the per-purchase dates.
  useEffect(() => {
    if (!isDesktopRuntime()) {
      setLocalLoading(false);
      return undefined;
    }

    let cancelled = false;

    const loadLocalData = async () => {
      try {
        const activeUser = await getCurrentUser().catch(() => null);
        const localUserId = resolveDesktopLocalUserId(activeUser, 1);
        const [investments, watchlist] = await Promise.all([
          window.electronAPI.localStore.listInvestments(localUserId),
          window.electronAPI.localStore.listWatchlist(localUserId),
        ]);

        if (cancelled) {
          return;
        }
        setUser(activeUser);
        setRawInvestments(Array.isArray(investments) ? investments : []);
        setWatchlistItems(Array.isArray(watchlist) ? watchlist : []);
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to load year wrapped data", error);
        }
      } finally {
        if (!cancelled) {
          setLocalLoading(false);
        }
      }
    };

    void loadLocalData();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const derivePalette = async () => {
      try {
        const derived = await deriveSteamPaletteFromUser(user || null);
        if (cancelled) {
          return;
        }
        setShellPalette({
          colorA: derived?.colorA || DEFAULT_STEAM_SHELL_PALETTE.colorA,
          colorB: derived?.colorB || DEFAULT_STEAM_SHELL_PALETTE.colorB,
          colorC: derived?.colorC || DEFAULT_STEAM_SHELL_PALETTE.colorC,
          colorD: derived?.colorD || derived?.colorB || DEFAULT_STEAM_SHELL_PALETTE.colorD,
        });
      } catch {
        if (!cancelled) {
          setShellPalette(DEFAULT_STEAM_SHELL_PALETTE);
        }
      }
    };

    void derivePalette();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const stats = useMemo(
    () =>
      buildYearWrappedStats({
        rawInvestments,
        portfolioHistory,
        enrichedInvestments,
        watchlistItems,
        year,
      }),
    [rawInvestments, portfolioHistory, enrichedInvestments, watchlistItems, year],
  );

  const slides = useMemo(() => {
    const candidates = [
      { key: "intro", node: <WrappedIntroSlide year={year} user={user} /> },
      stats.purchases.available
        ? { key: "purchases", node: <WrappedPurchasesSlide year={year} purchases={stats.purchases} /> }
        : null,
      stats.monthly.available
        ? { key: "monthly", node: <WrappedMonthlySlide year={year} monthly={stats.monthly} /> }
        : null,
      stats.highlights.available
        ? { key: "highlights", node: <WrappedHighlightsSlide year={year} highlights={stats.highlights} /> }
        : null,
      stats.platforms.available
        ? { key: "platforms", node: <WrappedPlatformsSlide year={year} platforms={stats.platforms} /> }
        : null,
      stats.curve.available
        ? { key: "curve", node: <WrappedCurveSlide year={year} curve={stats.curve} /> }
        : null,
      stats.extremes.available
        ? { key: "extremes", node: <WrappedExtremesSlide year={year} extremes={stats.extremes} /> }
        : null,
      stats.performers.available
        ? { key: "performers", node: <WrappedPerformersSlide year={year} performers={stats.performers} /> }
        : null,
      stats.watchlist.available
        ? { key: "watchlist", node: <WrappedWatchlistSlide year={year} watchlist={stats.watchlist} /> }
        : null,
      { key: "outro", node: <WrappedOutroSlide year={year} stats={stats} onClose={handleClose} /> },
    ];

    return candidates.filter(Boolean);
  }, [stats, year, user, handleClose]);

  const isLoading = localLoading || portfolioLoading;
  const slideCount = slides.length;
  const activeIndex = Math.min(slideIndex, Math.max(0, slideCount - 1));

  const goToPrevious = useCallback(() => {
    setSlideIndex((current) => Math.max(0, current - 1));
  }, []);

  const goToNext = useCallback(() => {
    setSlideIndex((current) => Math.min(slideCount - 1, current + 1));
  }, [slideCount]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPrevious();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goToNext();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToPrevious, goToNext, handleClose]);

  // Keep this after every hook so the hook order stays stable across renders.
  // Wrapped depends on the local SQLite rows, which only exist on desktop.
  if (!isDesktopRuntime()) {
    return <Navigate to="/" replace />;
  }

  const shellStyle = {
    "--steam-shell-color-a": shellPalette.colorA,
    "--steam-shell-color-b": shellPalette.colorB,
    "--steam-shell-color-c": shellPalette.colorC,
    "--steam-shell-color-d": shellPalette.colorD,
  };

  return (
    <div
      className="steam-startup-shell steam-startup-shell-overlay flex flex-col overflow-y-auto"
      style={shellStyle}
      data-keyboard-scope="page"
    >
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 sm:py-10">
        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center gap-1.5">
            {slides.map((slide, index) => (
              <span
                key={slide.key}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  index <= activeIndex ? "bg-primary" : "bg-muted-foreground/25"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Jahresrueckblick schliessen"
            data-keyboard-cancel
            className="rounded-full border border-border/60 bg-card/70 p-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Jahresrueckblick wird berechnet...</p>
          ) : (
            slides[activeIndex]?.node
          )}
        </div>

        {!isLoading && slideCount > 1 ? (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goToPrevious}
              disabled={activeIndex === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-card/70 px-4 py-2 text-sm font-medium text-foreground transition-opacity disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <ChevronLeft className="h-4 w-4" />
              Zurueck
            </button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {activeIndex + 1} / {slideCount}
            </span>
            <button
              type="button"
              onClick={activeIndex === slideCount - 1 ? handleClose : goToNext}
              data-keyboard-default
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {activeIndex === slideCount - 1 ? "Fertig" : "Weiter"}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default YearWrappedPage;
