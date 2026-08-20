import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX, X } from "lucide-react";

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
import { buildChartPaletteVars } from "../lib/steamChartPalette.js";
import { resolveDesktopLocalUserId } from "../lib/userIdentity.js";
import {
  isUiSoundsEnabled,
  playUiSound,
  primeUiSounds,
  setUiSoundsEnabled,
  subscribeUiSounds,
} from "../lib/uiSounds.js";
import { buildYearWrappedStats, resolveWrappedSeason } from "../lib/yearWrapped.js";

// Dwell time per slide before auto-advancing. Single knob — change this one
// number to retune the pace of the whole story.
const AUTOPLAY_INTERVAL_MS = 12000;

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
  const { t } = useTranslation("wrapped");
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
  const [isPaused, setIsPaused] = useState(false);
  const [soundsEnabled, setSoundsEnabled] = useState(() => isUiSoundsEnabled());

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

  // Intro and outro always exist, so "only those two" means the year has
  // nothing to tell. Without this the story would run as two empty cards —
  // easily mistaken for a bug, especially since excluded positions are filtered
  // out and a year can legitimately end up with zero countable purchases.
  const hasAnyData = slides.length > 2;

  const isLoading = localLoading || portfolioLoading;
  const slideCount = slides.length;
  const activeIndex = Math.min(slideIndex, Math.max(0, slideCount - 1));

  const isLastSlide = activeIndex >= slideCount - 1;

  const goToPrevious = useCallback(() => {
    primeUiSounds();
    setSlideIndex((current) => {
      if (current <= 0) {
        return current;
      }
      playUiSound("slidePrev");
      return current - 1;
    });
  }, []);

  const goToNext = useCallback(() => {
    primeUiSounds();
    setSlideIndex((current) => {
      if (current >= slideCount - 1) {
        return current;
      }
      playUiSound(current + 1 === slideCount - 1 ? "success" : "slideNext");
      return current + 1;
    });
  }, [slideCount]);

  // Auto-advance. Stops on the last slide so the story ends on the summary
  // instead of looping, and pauses while the window is hidden so a backgrounded
  // app does not silently run the whole story out.
  useEffect(() => {
    if (isLoading || isPaused || isLastSlide || slideCount <= 1 || !hasAnyData) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => goToNext(), AUTOPLAY_INTERVAL_MS);
    return () => window.clearTimeout(timeoutId);
  }, [isLoading, isPaused, isLastSlide, slideCount, activeIndex, hasAnyData, goToNext]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setIsPaused(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // No explicit sound here: the global click handler already covers a plain
  // button press. Only controls with a *semantic* sound of their own opt out
  // of the global one via data-no-sound.
  const togglePaused = useCallback(() => {
    primeUiSounds();
    setIsPaused((current) => !current);
  }, []);

  // The story exposes its own sound toggle, but the setting is global — mirror
  // external changes (e.g. from Settings) so the icon never lies.
  const toggleSounds = useCallback(() => {
    const next = !isUiSoundsEnabled();
    setUiSoundsEnabled(next);
    if (next) {
      primeUiSounds();
      playUiSound("click");
    }
  }, []);

  useEffect(() => subscribeUiSounds(({ enabled }) => setSoundsEnabled(enabled)), []);

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
      if (event.key === " ") {
        event.preventDefault();
        togglePaused();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToPrevious, goToNext, togglePaused, handleClose]);

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
    // Opaque siblings for chart marks — see lib/steamChartPalette.js.
    ...buildChartPaletteVars(shellPalette),
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
                className={`h-1 flex-1 overflow-hidden rounded-full ${
                  index < activeIndex ? "bg-primary" : "bg-muted-foreground/25"
                }`}
              >
                {index === activeIndex && !isLastSlide && !isLoading ? (
                  <span
                    key={`${slide.key}-${isPaused ? "paused" : "running"}`}
                    className="wrapped-progress-fill block h-full w-full rounded-full bg-primary"
                    data-paused={isPaused ? "true" : "false"}
                    style={{ "--wrapped-autoplay-duration": `${AUTOPLAY_INTERVAL_MS}ms` }}
                  />
                ) : index === activeIndex ? (
                  <span className="block h-full w-full rounded-full bg-primary" />
                ) : null}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={togglePaused}
            aria-label={isPaused ? t("controls.resumePlayback") : t("controls.pausePlayback")}
            title={isPaused ? t("controls.resumeSpace") : t("controls.pauseSpace")}
            className="rounded-full border border-border/60 bg-card/70 p-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={toggleSounds}
            data-no-sound
            aria-label={soundsEnabled ? t("controls.soundsOff") : t("controls.soundsOn")}
            title={soundsEnabled ? t("controls.soundsOffShort") : t("controls.soundsOnShort")}
            className="rounded-full border border-border/60 bg-card/70 p-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {soundsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t("controls.close")}
            data-keyboard-cancel
            className="rounded-full border border-border/60 bg-card/70 p-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t("controls.calculating")}</p>
          ) : !hasAnyData ? (
            <div className="wrapped-slide flex w-full max-w-2xl flex-col gap-4 rounded-3xl border border-border/60 bg-card/85 p-6 text-center shadow-xl backdrop-blur-md sm:p-10">
              <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">
                {t("empty.title", { year })}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("empty.body")}{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  #/wrapped?year={year + 1}
                </code>
                .
              </p>
              <button
                type="button"
                onClick={handleClose}
                className="mx-auto rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {t("outro.backToDashboard")}
              </button>
            </div>
          ) : (
            // Keyed so every slide change remounts the subtree: that is what
            // restarts the entrance animations and the count-up counters.
            <div key={slides[activeIndex]?.key} className="flex w-full justify-center">
              {slides[activeIndex]?.node}
            </div>
          )}
        </div>

        {!isLoading && hasAnyData && slideCount > 1 ? (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goToPrevious}
              data-no-sound
              disabled={activeIndex === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-card/70 px-4 py-2 text-sm font-medium text-foreground transition-opacity disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <ChevronLeft className="h-4 w-4" />
              {t("controls.back")}
            </button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {activeIndex + 1} / {slideCount}
            </span>
            <button
              type="button"
              onClick={activeIndex === slideCount - 1 ? handleClose : goToNext}
              data-no-sound
              data-keyboard-default
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {activeIndex === slideCount - 1 ? t("controls.done") : t("controls.next")}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default YearWrappedPage;
