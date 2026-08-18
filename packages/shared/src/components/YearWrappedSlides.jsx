import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
} from "recharts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarRange, Eye, Flame, Sparkles, TrendingDown, TrendingUp } from "lucide-react";

import { useCurrency } from "../contexts/CurrencyContext.jsx";
import { useCountUp } from "../hooks/useCountUp.js";
import { formatDateSafe } from "../lib/portfolioHelpers.js";
import { getMonthLabels } from "../lib/yearWrapped.js";
import { toneText } from "./ui/tone.js";

// Chart marks use the opaque siblings of the avatar palette (set by
// YearWrappedPage via toOpaqueChartColor). The --steam-shell-color-* vars
// themselves bake in a 0.11-0.20 alpha because they are background washes;
// filling a donut with them renders it nearly invisible.
const STEAM_CHART_COLORS = [
  "var(--wrapped-chart-a, hsl(212, 70%, 58%))",
  "var(--wrapped-chart-b, hsl(188, 62%, 55%))",
  "var(--wrapped-chart-d, hsl(32, 60%, 54%))",
  "var(--wrapped-chart-c, hsl(39, 66%, 56%))",
];

// 12 months x 250ms = a ~3s run-up across the year.
const MONTH_BAR_STEP_MS = 250;

function useUsdFormatter() {
  const { formatPrice } = useCurrency();
  return (usdValue) => formatPrice(usdValue, { useUsd: true, buyPriceUsd: Number(usdValue) || 0 });
}

function formatPercent(value, decimals = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  return `${parsed > 0 ? "+" : ""}${parsed.toFixed(decimals)} %`;
}

// Children animate in staggered rather than all at once — the delay is what
// makes a slide read as "revealed" instead of "rendered".
export function WrappedSlideShell({ eyebrow, title, icon: Icon, children, footnote }) {
  return (
    <div className="wrapped-slide flex w-full max-w-3xl flex-col gap-6 rounded-3xl border border-border/60 bg-card/85 p-6 shadow-xl backdrop-blur-md sm:p-10">
      <div className="wrapped-reveal flex items-center gap-3" style={{ "--wrapped-reveal-delay": "0ms" }}>
        {Icon ? <Icon className="h-5 w-5 shrink-0 text-primary" /> : null}
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {eyebrow}
        </span>
      </div>
      <h2
        className="wrapped-reveal text-2xl font-semibold leading-tight text-foreground sm:text-4xl"
        style={{ "--wrapped-reveal-delay": "90ms" }}
      >
        {title}
      </h2>
      <div className="wrapped-reveal flex flex-col gap-5" style={{ "--wrapped-reveal-delay": "200ms" }}>
        {children}
      </div>
      {footnote ? (
        <p className="wrapped-reveal text-xs text-muted-foreground" style={{ "--wrapped-reveal-delay": "320ms" }}>
          {footnote}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A headline number. `countTo` opts the value into the count-up animation:
 * pass the raw number plus a `format` function, since the displayed string is
 * currency/percent formatted and cannot be interpolated directly.
 */
function StatBlock({ label, value, countTo, format, hint, tone = "default", active = true, sound = false }) {
  const shouldCount = typeof countTo === "number" && typeof format === "function";
  const animatedValue = useCountUp(shouldCount ? countTo : 0, { active: active && shouldCount, sound });

  const toneClass = toneText(tone);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`text-3xl font-semibold tabular-nums sm:text-5xl ${toneClass}`}>
        {shouldCount ? format(animatedValue) : value}
      </span>
      {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function ItemTile({ label, name, imageUrl, primary, secondary }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border/60 bg-background/40 p-4">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          className="h-16 w-16 shrink-0 rounded-xl object-contain"
        />
      ) : (
        <div className="h-16 w-16 shrink-0 rounded-xl bg-muted" />
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        {label ? (
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        ) : null}
        <span className="truncate text-base font-semibold text-foreground">{name}</span>
        <span className="text-sm text-muted-foreground">{primary}</span>
        {secondary ? <span className="text-xs text-muted-foreground">{secondary}</span> : null}
      </div>
    </div>
  );
}

export function WrappedIntroSlide({ year, user }) {
  const { t } = useTranslation("wrapped");
  // Static avatar only, mirroring resolveAvatarUrls()'s `staticAvatarUrl` in
  // SteamLoginPrompt: animated Steam avatars are video URLs and would not
  // render inside an <img>.
  const avatarUrl =
    user?.avatar || user?.steam_avatar || user?.steamAvatar || user?.avatarUrl || user?.avatar_url || null;
  const displayName = user?.name || t("player.investor");

  return (
    <WrappedSlideShell
      eyebrow={t("eyebrow.eyebrowReview", { year })}
      title={t("intro.title", { year })}
      icon={Sparkles}
    >
      <div className="flex items-center gap-4">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full border border-border/60" />
        ) : null}
        <div className="flex flex-col">
          <span className="text-lg font-semibold text-foreground">{displayName}</span>
          <span className="text-sm text-muted-foreground">
            {t("intro.subtitle")}
          </span>
        </div>
      </div>
      <p className="text-base text-muted-foreground">
        {t("intro.body")}
      </p>
    </WrappedSlideShell>
  );
}

export function WrappedPurchasesSlide({ year, purchases }) {
  const { t } = useTranslation("wrapped");
  const formatUsd = useUsdFormatter();
  const animatedCount = useCountUp(purchases.count, { sound: true });
  const animatedPieces = useCountUp(purchases.totalQuantity);

  return (
    <WrappedSlideShell
      eyebrow={`Kaeufe ${year}`}
      title={
        purchases.count === 1
          ? t("purchases.onePurchase")
          : t("purchases.countThisYear", { count: Math.round(animatedCount) })
      }
      icon={Flame}
      footnote={
        purchases.undatedCount > 0
          ? t("purchases.undatedNote", { count: purchases.undatedCount })
          : null
      }
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <StatBlock
          label={t("purchases.totalSpend")}
          countTo={purchases.totalSpentUsd}
          format={formatUsd}
          hint={`${Math.round(animatedPieces)} Stueck insgesamt`}
        />
        <StatBlock
          label={t("purchases.averagePrice")}
          countTo={purchases.avgBuyPriceUsd}
          format={formatUsd}
          hint={t("purchases.perPiece")}
        />
      </div>
    </WrappedSlideShell>
  );
}

export function WrappedMonthlySlide({ year, monthly }) {
  const { t } = useTranslation("wrapped");
  const formatUsd = useUsdFormatter();
  const peakLabel = getMonthLabels()[monthly.peakMonth?.month ?? 0];
  // Recharts grows every bar at once, so the months are revealed by feeding the
  // chart one more real value per step — that is what makes them come up in
  // sequence instead of as a single block.
  const [revealedMonths, setRevealedMonths] = useState(0);

  useEffect(() => {
    if (revealedMonths >= monthly.buckets.length) {
      return undefined;
    }
    const timer = setTimeout(() => setRevealedMonths((current) => current + 1), MONTH_BAR_STEP_MS);
    return () => clearTimeout(timer);
  }, [revealedMonths, monthly.buckets.length]);

  const revealedBuckets = monthly.buckets.map((bucket, index) =>
    index < revealedMonths ? bucket : { ...bucket, count: 0 },
  );

  return (
    <WrappedSlideShell
      eyebrow={t("eyebrow.eyebrowBusiestMonth", { year })}
      title={t("monthly.mostActive", { month: peakLabel })}
      icon={CalendarRange}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <StatBlock
          label={t("purchases.peakMonthPurchases")}
          countTo={monthly.peakMonth?.count ?? 0}
          format={(v) => String(Math.round(v))}
          hint={formatUsd(monthly.peakMonth?.spentUsd ?? 0)}
          sound
        />
      </div>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={revealedBuckets} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "currentColor" }}
              className="text-muted-foreground"
            />
            <Bar
              dataKey="count"
              radius={[6, 6, 0, 0]}
              isAnimationActive
              animationDuration={MONTH_BAR_STEP_MS}
              animationEasing="ease-out"
            >
              {monthly.buckets.map((bucket) => (
                <Cell
                  key={bucket.month}
                  fill={
                    bucket.month === monthly.peakMonth?.month
                      ? STEAM_CHART_COLORS[0]
                      : STEAM_CHART_COLORS[1]
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </WrappedSlideShell>
  );
}

export function WrappedHighlightsSlide({ year, highlights }) {
  const { t } = useTranslation("wrapped");
  const formatUsd = useUsdFormatter();

  return (
    <WrappedSlideShell eyebrow={`Highlights ${year}`} title={t("outliers.title")} icon={Sparkles}>
      <div className="flex flex-col gap-3">
        {highlights.mostBoughtItem ? (
          <ItemTile
            label={t("outliers.mostBought")}
            name={highlights.mostBoughtItem.name}
            imageUrl={highlights.mostBoughtItem.imageUrl}
            primary={`${highlights.mostBoughtItem.count} Stueck`}
            secondary={formatUsd(highlights.mostBoughtItem.spentUsd)}
          />
        ) : null}
        {highlights.mostExpensivePurchase ? (
          <ItemTile
            label={t("outliers.priciestSingle")}
            name={highlights.mostExpensivePurchase.name}
            imageUrl={highlights.mostExpensivePurchase.imageUrl}
            primary={formatUsd(highlights.mostExpensivePurchase.spentUsd)}
            secondary={formatDateSafe(highlights.mostExpensivePurchase.date)}
          />
        ) : null}
      </div>
    </WrappedSlideShell>
  );
}

export function WrappedPlatformsSlide({ year, platforms }) {
  const { t } = useTranslation("wrapped");
  const formatUsd = useUsdFormatter();
  const leader = platforms.entries[0];

  return (
    <WrappedSlideShell
      eyebrow={`Plattform-Mix ${year}`}
      title={leader ? t("platforms.leader", { platform: leader.label }) : t("platforms.title")}
      footnote={t("platforms.hint")}
      icon={Sparkles}
    >
      <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="relative h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={platforms.entries}
                dataKey="spentUsd"
                nameKey="label"
                innerRadius="62%"
                outerRadius="94%"
                paddingAngle={2}
                stroke="none"
                startAngle={90}
                // Sweeps a full turn clockwise as it grows in.
                endAngle={-270}
                isAnimationActive
                animationBegin={220}
                animationDuration={1100}
                animationEasing="ease-out"
              >
                {platforms.entries.map((entry, index) => (
                  <Cell key={entry.key} fill={STEAM_CHART_COLORS[index % STEAM_CHART_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          {/* Centre label — the hole was the emptiest part of the slide. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {formatUsd(platforms.totalSpentUsd)}
            </span>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {platforms.totalCount} Kaeufe
            </span>
          </div>
        </div>
        <ul className="flex flex-col gap-3">
          {platforms.entries.map((entry, index) => {
            const color = STEAM_CHART_COLORS[index % STEAM_CHART_COLORS.length];
            return (
              <li key={entry.key} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                    <span className="truncate font-medium text-foreground">{entry.label}</span>
                  </span>
                  <span className="shrink-0 tabular-nums font-medium text-foreground">
                    {formatUsd(entry.spentUsd)} · {entry.percentage.toFixed(0)} %
                  </span>
                </div>
                {/* Share bar: gives the legend visual weight instead of leaving
                    the right half of the slide as bare text. */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted-foreground/15">
                  <span
                    className="wrapped-bar-grow block h-full rounded-full"
                    style={{ background: color, "--wrapped-bar-width": `${entry.percentage}%` }}
                  />
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {entry.count} Kaeufe · {entry.countPercentage.toFixed(0)} % der Kaeufe
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </WrappedSlideShell>
  );
}

export function WrappedCurveSlide({ year, curve }) {
  const { t } = useTranslation("wrapped");
  const formatUsd = useUsdFormatter();
  const isPositive = curve.deltaUsd >= 0;
  const startsAtYearStart = String(curve.coverageFrom || "").slice(5) === "01-01";

  return (
    <WrappedSlideShell
      eyebrow={`Portfolio-Kurve ${year}`}
      title={isPositive ? t("portfolio.grew") : t("portfolio.declined")}
      icon={isPositive ? TrendingUp : TrendingDown}
      footnote={
        startsAtYearStart
          ? null
          : t("curve.coverageFrom", { date: formatDateSafe(curve.coverageFrom) })
      }
    >
      <div className="grid gap-6 sm:grid-cols-3">
        <StatBlock label={t("portfolio.start")} countTo={curve.firstValue} format={formatUsd} />
        <StatBlock label={t("portfolio.end")} countTo={curve.lastValue} format={formatUsd} sound />
        <StatBlock
          label={t("portfolio.change")}
          countTo={curve.deltaPercent}
          format={(v) => formatPercent(v)}
          hint={formatUsd(curve.deltaUsd)}
          tone={isPositive ? "success" : "danger"}
        />
      </div>
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={curve.points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <Line
              type="monotone"
              dataKey="wert"
              stroke={STEAM_CHART_COLORS[0]}
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </WrappedSlideShell>
  );
}

export function WrappedExtremesSlide({ year, extremes }) {
  const { t } = useTranslation("wrapped");
  const formatUsd = useUsdFormatter();

  return (
    <WrappedSlideShell eyebrow={`Extreme ${year}`} title={t("portfolio.bestAndWorstDay")} icon={TrendingUp}>
      <div className="grid gap-6 sm:grid-cols-2">
        <StatBlock
          label={`Bester Tag · ${formatDateSafe(extremes.bestDay.date)}`}
          value={formatUsd(extremes.bestDay.deltaUsd)}
          hint={formatPercent(extremes.bestDay.deltaPercent)}
          tone="success"
        />
        <StatBlock
          label={`Schwaechster Tag · ${formatDateSafe(extremes.worstDay.date)}`}
          value={formatUsd(extremes.worstDay.deltaUsd)}
          hint={formatPercent(extremes.worstDay.deltaPercent)}
          tone="danger"
        />
      </div>
    </WrappedSlideShell>
  );
}

const PERFORMER_COUNT_DURATION_MS = 1600;

/**
 * Staged reveal: headline first, then the ROI counts up, and only once it has
 * landed does the position itself appear. Naming the item up front would give
 * away the punchline the counter is building to.
 */
function PerformerReveal({ headline, performer, tone, delayMs, formatUsd }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), delayMs + 400),
      setTimeout(() => setPhase(2), delayMs + 400 + PERFORMER_COUNT_DURATION_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [delayMs]);

  const roi = useCountUp(performer.roi, {
    active: phase >= 1,
    duration: PERFORMER_COUNT_DURATION_MS,
    sound: true,
  });
  const toneClass = toneText(tone, "success");

  return (
    <div className="flex flex-col gap-3">
      <span
        className="wrapped-reveal text-sm font-medium text-muted-foreground"
        style={{ "--wrapped-reveal-delay": `${delayMs}ms` }}
      >
        {headline}
      </span>
      <span className={`text-4xl font-semibold tabular-nums sm:text-6xl ${toneClass}`}>
        {formatPercent(phase >= 1 ? roi : 0)}
      </span>
      {phase >= 2 ? (
        <div className="wrapped-reveal" style={{ "--wrapped-reveal-delay": "0ms" }}>
          <ItemTile
            name={performer.name}
            imageUrl={performer.imageUrl}
            primary={formatUsd(performer.profitUsd)}
          />
        </div>
      ) : (
        // Placeholder keeps the slide from jumping when the tile lands.
        <div className="h-[6.5rem]" aria-hidden="true" />
      )}
    </div>
  );
}

export function WrappedPerformersSlide({ year, performers }) {
  const { t } = useTranslation("wrapped");
  const formatUsd = useUsdFormatter();

  return (
    <WrappedSlideShell
      eyebrow={`Performer ${year}`}
      title={t("positions.title")}
      icon={TrendingUp}
      footnote={t("positions.hint")}
    >
      <div className="flex flex-col gap-6">
        <PerformerReveal
          headline={t("positions.mostProfit")}
          performer={performers.best}
          tone="success"
          delayMs={0}
          formatUsd={formatUsd}
        />
        <PerformerReveal
          headline={t("positions.mostPain")}
          performer={performers.worst}
          tone="danger"
          delayMs={900}
          formatUsd={formatUsd}
        />
      </div>
    </WrappedSlideShell>
  );
}

export function WrappedWatchlistSlide({ year, watchlist }) {
  const { t } = useTranslation("wrapped");
  const buckets = Array.isArray(watchlist.buckets) ? watchlist.buckets : [];
  const sharePercent =
    watchlist.totalCount > 0
      ? Math.min(100, (watchlist.addedCount / watchlist.totalCount) * 100)
      : 0;

  return (
    <WrappedSlideShell
      eyebrow={`Watchlist ${year}`}
      title={t("watchlist.title")}
      icon={Eye}
      footnote={
        watchlist.peakMonth
          ? t("watchlist.peakMonth", { month: watchlist.peakMonth.label })
          : null
      }
    >
      <div className="grid items-center gap-6 sm:grid-cols-2">
        <StatBlock
          label={t("watchlist.newlyWatched")}
          countTo={watchlist.addedCount}
          format={(v) => String(Math.round(v))}
          hint={`von aktuell ${watchlist.totalCount} Eintraegen`}
          sound
        />
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("watchlist.shareOfHoldings")}
          </span>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted-foreground/15">
            <span
              className="wrapped-bar-grow block h-full rounded-full"
              style={{
                background: STEAM_CHART_COLORS[0],
                "--wrapped-bar-width": `${sharePercent}%`,
              }}
            />
          </div>
          <span className="text-sm tabular-nums text-muted-foreground">
            {sharePercent.toFixed(0)} % deiner Watchlist
          </span>
        </div>
      </div>

      {buckets.length > 0 ? (
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={buckets} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="wrappedWatchlistFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={STEAM_CHART_COLORS[0]} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={STEAM_CHART_COLORS[0]} stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "currentColor" }}
                className="text-muted-foreground"
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke={STEAM_CHART_COLORS[0]}
                strokeWidth={2}
                fill="url(#wrappedWatchlistFill)"
                animationDuration={1000}
                animationBegin={240}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </WrappedSlideShell>
  );
}

export function WrappedOutroSlide({ year, stats, onClose }) {
  const { t } = useTranslation("wrapped");
  const formatUsd = useUsdFormatter();

  const summaryRows = [
    stats.purchases.available
      ? { label: t("summary.purchases"), value: String(stats.purchases.count) }
      : null,
    stats.purchases.available
      ? { label: t("summary.spend"), value: formatUsd(stats.purchases.totalSpentUsd) }
      : null,
    stats.monthly.available
      ? { label: t("summary.busiestMonth"), value: getMonthLabels()[stats.monthly.peakMonth.month] }
      : null,
    stats.curve.available
      ? { label: t("summary.portfolioChange"), value: formatPercent(stats.curve.deltaPercent) }
      : null,
    stats.watchlist.available
      ? { label: t("summary.newWatchlistItems"), value: String(stats.watchlist.addedCount) }
      : null,
  ].filter(Boolean);

  return (
    <WrappedSlideShell
      eyebrow={t("eyebrow.eyebrowConclusion", { year })}
      title={t("outro.thatWas", { year })}
      icon={Sparkles}
    >
      <dl className="flex flex-col divide-y divide-border/60">
        {summaryRows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 py-3">
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd className="text-base font-semibold tabular-nums text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={onClose}
        className="self-start rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {t("outro.backToDashboard")}
      </button>
    </WrappedSlideShell>
  );
}
