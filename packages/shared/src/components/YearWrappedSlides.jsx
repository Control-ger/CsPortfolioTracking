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
import { CalendarRange, Eye, Flame, Sparkles, TrendingDown, TrendingUp } from "lucide-react";

import { useCurrency } from "../contexts/CurrencyContext.jsx";
import { useCountUp } from "../hooks/useCountUp.js";
import { formatDateSafe } from "../lib/portfolioHelpers.js";
import { MONTH_LABELS } from "../lib/yearWrapped.js";

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
function StatBlock({ label, value, countTo, format, hint, tone = "neutral", active = true, sound = false }) {
  const shouldCount = typeof countTo === "number" && typeof format === "function";
  const animatedValue = useCountUp(shouldCount ? countTo : 0, { active: active && shouldCount, sound });

  const toneClass =
    tone === "positive"
      ? "text-emerald-500 dark:text-emerald-400"
      : tone === "negative"
        ? "text-rose-500 dark:text-rose-400"
        : "text-foreground";

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
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="truncate text-base font-semibold text-foreground">{name}</span>
        <span className="text-sm text-muted-foreground">{primary}</span>
        {secondary ? <span className="text-xs text-muted-foreground">{secondary}</span> : null}
      </div>
    </div>
  );
}

export function WrappedIntroSlide({ year, user }) {
  // Static avatar only, mirroring resolveAvatarUrls()'s `staticAvatarUrl` in
  // SteamLoginPrompt: animated Steam avatars are video URLs and would not
  // render inside an <img>.
  const avatarUrl =
    user?.avatar || user?.steam_avatar || user?.steamAvatar || user?.avatarUrl || user?.avatar_url || null;
  const displayName = user?.name || "Investor";

  return (
    <WrappedSlideShell
      eyebrow={`Jahresrueckblick ${year}`}
      title={`Dein CS-Investment-Jahr ${year}`}
      icon={Sparkles}
    >
      <div className="flex items-center gap-4">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full border border-border/60" />
        ) : null}
        <div className="flex flex-col">
          <span className="text-lg font-semibold text-foreground">{displayName}</span>
          <span className="text-sm text-muted-foreground">
            Ein Rueckblick auf zwoelf Monate Portfolio.
          </span>
        </div>
      </div>
      <p className="text-base text-muted-foreground">
        Kaeufe, Ausgaben, Plattformen und die Kurve deines Portfolios — Slide fuer Slide.
      </p>
    </WrappedSlideShell>
  );
}

export function WrappedPurchasesSlide({ year, purchases }) {
  const formatUsd = useUsdFormatter();
  const animatedCount = useCountUp(purchases.count, { sound: true });
  const animatedPieces = useCountUp(purchases.totalQuantity);

  return (
    <WrappedSlideShell
      eyebrow={`Kaeufe ${year}`}
      title={
        purchases.count === 1
          ? "Ein Kauf in diesem Jahr"
          : `${Math.round(animatedCount)} Kaeufe in diesem Jahr`
      }
      icon={Flame}
      footnote={
        purchases.undatedCount > 0
          ? `${purchases.undatedCount} Position(en) ohne Kaufdatum sind hier nicht beruecksichtigt.`
          : null
      }
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <StatBlock
          label="Gesamtausgaben"
          countTo={purchases.totalSpentUsd}
          format={formatUsd}
          hint={`${Math.round(animatedPieces)} Stueck insgesamt`}
        />
        <StatBlock
          label="Durchschnittspreis"
          countTo={purchases.avgBuyPriceUsd}
          format={formatUsd}
          hint="pro Stueck"
        />
      </div>
    </WrappedSlideShell>
  );
}

export function WrappedMonthlySlide({ year, monthly }) {
  const formatUsd = useUsdFormatter();
  const peakLabel = MONTH_LABELS[monthly.peakMonth?.month ?? 0];

  return (
    <WrappedSlideShell
      eyebrow={`Aktivster Monat ${year}`}
      title={`Im ${peakLabel} warst du am aktivsten`}
      icon={CalendarRange}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <StatBlock
          label="Kaeufe im Peak-Monat"
          countTo={monthly.peakMonth?.count ?? 0}
          format={(v) => String(Math.round(v))}
          hint={formatUsd(monthly.peakMonth?.spentUsd ?? 0)}
          sound
        />
      </div>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthly.buckets} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "currentColor" }}
              className="text-muted-foreground"
            />
            <Bar dataKey="count" radius={[6, 6, 0, 0]}>
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
  const formatUsd = useUsdFormatter();

  return (
    <WrappedSlideShell eyebrow={`Highlights ${year}`} title="Deine Ausreisser des Jahres" icon={Sparkles}>
      <div className="flex flex-col gap-3">
        {highlights.mostBoughtItem ? (
          <ItemTile
            label="Meistgekauft"
            name={highlights.mostBoughtItem.name}
            imageUrl={highlights.mostBoughtItem.imageUrl}
            primary={`${highlights.mostBoughtItem.count} Stueck`}
            secondary={formatUsd(highlights.mostBoughtItem.spentUsd)}
          />
        ) : null}
        {highlights.mostExpensivePurchase ? (
          <ItemTile
            label="Teuerster Einzelkauf"
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
  const formatUsd = useUsdFormatter();
  const leader = platforms.entries[0];

  return (
    <WrappedSlideShell
      eyebrow={`Plattform-Mix ${year}`}
      title={leader ? `Am meisten ueber ${leader.label}` : "Deine Plattformen"}
      icon={Sparkles}
    >
      <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="relative h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={platforms.entries}
                dataKey="count"
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
            <span className="text-3xl font-semibold tabular-nums text-foreground">
              {platforms.totalCount}
            </span>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Kaeufe</span>
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
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {entry.count} · {entry.percentage.toFixed(0)} %
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
                  {formatUsd(entry.spentUsd)}
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
  const formatUsd = useUsdFormatter();
  const isPositive = curve.deltaUsd >= 0;
  const startsAtYearStart = String(curve.coverageFrom || "").slice(5) === "01-01";

  return (
    <WrappedSlideShell
      eyebrow={`Portfolio-Kurve ${year}`}
      title={isPositive ? "Dein Portfolio ist gewachsen" : "Dein Portfolio hat nachgegeben"}
      icon={isPositive ? TrendingUp : TrendingDown}
      footnote={
        startsAtYearStart
          ? null
          : `Historie liegt erst ab ${formatDateSafe(curve.coverageFrom)} vor.`
      }
    >
      <div className="grid gap-6 sm:grid-cols-3">
        <StatBlock label="Start" countTo={curve.firstValue} format={formatUsd} />
        <StatBlock label="Ende" countTo={curve.lastValue} format={formatUsd} sound />
        <StatBlock
          label="Veraenderung"
          countTo={curve.deltaPercent}
          format={(v) => formatPercent(v)}
          hint={formatUsd(curve.deltaUsd)}
          tone={isPositive ? "positive" : "negative"}
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
  const formatUsd = useUsdFormatter();

  return (
    <WrappedSlideShell eyebrow={`Extreme ${year}`} title="Bester und schlechtester Tag" icon={TrendingUp}>
      <div className="grid gap-6 sm:grid-cols-2">
        <StatBlock
          label={`Bester Tag · ${formatDateSafe(extremes.bestDay.date)}`}
          value={formatUsd(extremes.bestDay.deltaUsd)}
          hint={formatPercent(extremes.bestDay.deltaPercent)}
          tone="positive"
        />
        <StatBlock
          label={`Schwaechster Tag · ${formatDateSafe(extremes.worstDay.date)}`}
          value={formatUsd(extremes.worstDay.deltaUsd)}
          hint={formatPercent(extremes.worstDay.deltaPercent)}
          tone="negative"
        />
      </div>
    </WrappedSlideShell>
  );
}

export function WrappedPerformersSlide({ year, performers }) {
  const formatUsd = useUsdFormatter();

  return (
    <WrappedSlideShell
      eyebrow={`Performer ${year}`}
      title="Top und Flop deiner Positionen"
      icon={TrendingUp}
      footnote="Unrealisierte Entwicklung der aktuell gehaltenen Positionen."
    >
      <div className="flex flex-col gap-3">
        <ItemTile
          label="Bester Performer"
          name={performers.best.name}
          imageUrl={performers.best.imageUrl}
          primary={formatPercent(performers.best.roi)}
          secondary={formatUsd(performers.best.profitUsd)}
        />
        <ItemTile
          label="Schwaechster Performer"
          name={performers.worst.name}
          imageUrl={performers.worst.imageUrl}
          primary={formatPercent(performers.worst.roi)}
          secondary={formatUsd(performers.worst.profitUsd)}
        />
      </div>
    </WrappedSlideShell>
  );
}

export function WrappedWatchlistSlide({ year, watchlist }) {
  const buckets = Array.isArray(watchlist.buckets) ? watchlist.buckets : [];
  const sharePercent =
    watchlist.totalCount > 0
      ? Math.min(100, (watchlist.addedCount / watchlist.totalCount) * 100)
      : 0;

  return (
    <WrappedSlideShell
      eyebrow={`Watchlist ${year}`}
      title="Was du im Blick behalten hast"
      icon={Eye}
      footnote={
        watchlist.peakMonth
          ? `Die meisten Eintraege kamen im ${watchlist.peakMonth.label} dazu.`
          : null
      }
    >
      <div className="grid items-center gap-6 sm:grid-cols-2">
        <StatBlock
          label="Neu beobachtet"
          countTo={watchlist.addedCount}
          format={(v) => String(Math.round(v))}
          hint={`von aktuell ${watchlist.totalCount} Eintraegen`}
          sound
        />
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Anteil am Bestand
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
  const formatUsd = useUsdFormatter();

  const summaryRows = [
    stats.purchases.available
      ? { label: "Kaeufe", value: String(stats.purchases.count) }
      : null,
    stats.purchases.available
      ? { label: "Ausgaben", value: formatUsd(stats.purchases.totalSpentUsd) }
      : null,
    stats.monthly.available
      ? { label: "Aktivster Monat", value: MONTH_LABELS[stats.monthly.peakMonth.month] }
      : null,
    stats.curve.available
      ? { label: "Portfolio-Entwicklung", value: formatPercent(stats.curve.deltaPercent) }
      : null,
    stats.watchlist.available
      ? { label: "Neue Watchlist-Items", value: String(stats.watchlist.addedCount) }
      : null,
  ].filter(Boolean);

  return (
    <WrappedSlideShell eyebrow={`Fazit ${year}`} title={`Das war ${year}`} icon={Sparkles}>
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
        Zurueck zum Dashboard
      </button>
    </WrappedSlideShell>
  );
}
