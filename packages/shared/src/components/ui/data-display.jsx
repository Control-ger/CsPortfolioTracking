import * as React from "react";

import { cn } from "../../lib/utils.js";

/**
 * Uppercase, letterspaced micro-heading used above every grouped block in the
 * design ("Einkaufspreise je Position", "Aktive Gruppe", "Vorschau").
 */
function SectionLabel({ className, children, ...props }) {
  return (
    <span
      className={cn(
        "text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

const META_TONE = {
  default: "text-foreground",
  success: "text-success",
  warn: "text-warn",
  danger: "text-danger",
  muted: "text-muted-foreground",
};

/**
 * Label-left / value-right row for the inspector and preview panels. Values are
 * tabular so stacked numbers align on the decimal.
 */
function MetaRow({ label, value, tone = "default", className, ...props }) {
  return (
    <div className={cn("flex justify-between gap-2", className)} {...props}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-bold tabular-nums", META_TONE[tone] ?? META_TONE.default)}>
        {value}
      </span>
    </div>
  );
}

/**
 * Sharp-cornered price sparkline.
 *
 * The Inventar design asks for "Graphen mit spitzen Ecken": the polyline keeps
 * miter joins instead of the rounded ones the earlier drafts used, so a spike
 * reads as a spike. `preserveAspectRatio="none"` lets the same 14-ish samples
 * fill whatever cell width the column template hands it.
 *
 * Renders nothing below two finite samples — an item without history must show
 * an empty cell, never a straight line that looks like a flat price.
 */
function Sparkline({
  values,
  width = 80,
  height = 26,
  positive,
  maxSamples = 40,
  className,
  ...props
}) {
  const finite = (Array.isArray(values) ? values : [])
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));

  if (finite.length < 2) return null;

  // Price history is hourly: a 60-day window is ~1500 points, which at 80px wide
  // is 19 points per pixel — a solid smear, not a trend. Stride down to a
  // readable count, always keeping the first and last sample so the endpoints
  // (and therefore the visible direction) stay true to the series.
  let samples = finite;
  if (finite.length > maxSamples) {
    const step = (finite.length - 1) / (maxSamples - 1);
    samples = Array.from({ length: maxSamples }, (_, index) =>
      finite[Math.round(index * step)],
    );
  }

  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const span = max - min;
  const pad = 1.5;
  const usable = height - pad * 2;

  const points = samples
    .map((value, index) => {
      const x = (index / (samples.length - 1)) * width;
      // A constant series has no span to normalise against — draw it centred.
      const ratio = span === 0 ? 0.5 : (value - min) / span;
      return `${x.toFixed(1)},${(height - pad - ratio * usable).toFixed(1)}`;
    })
    .join(" ");

  const trendUp = positive ?? samples[samples.length - 1] >= samples[0];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {/* Stroke comes from a Tailwind token class, not a `stroke="var(…)"`
          attribute: `--danger` has no raw definition (the token layer only maps
          `--color-danger` → `--destructive`), so the attribute form resolved to
          `none` and every falling series drew nothing. */}
      <polyline
        points={points}
        fill="none"
        className={trendUp ? "stroke-success" : "stroke-danger"}
        strokeWidth="1.6"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

/**
 * Centre-anchored ROI bar: the fill grows right from the midpoint for a gain and
 * left for a loss, so sign is readable before the number is. Magnitude is capped
 * at the `full` percentage (60% by default) — beyond that the bar is saturated
 * and the label carries the exact value.
 */
function RoiMeter({ value, full = 60, className, ...props }) {
  const roi = Number(value);
  const known = Number.isFinite(roi);
  const magnitude = known ? Math.min(1, Math.abs(roi) / full) : 0;
  const positive = known && roi >= 0;

  return (
    <span
      className={cn(
        "relative block h-[5px] w-10 shrink-0 overflow-hidden rounded-full bg-surface-2",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "absolute inset-y-0",
          positive ? "left-1/2" : "right-1/2",
          positive ? "bg-success" : "bg-danger",
        )}
        style={{ width: `${(magnitude * 50).toFixed(1)}%` }}
      />
    </span>
  );
}

/**
 * Numbered pager. Renders nothing for a single page. The number strip is capped
 * at `window` entries and slides with the current page, so a 40-page result set
 * does not blow out the row.
 */
function Pagination({ page, pageCount, onPageChange, window: windowSize = 5, className, ...props }) {
  if (!pageCount || pageCount <= 1) return null;

  const cell =
    "inline-flex size-8 items-center justify-center rounded-[9px] text-xs transition-colors";

  const span = Math.min(windowSize, pageCount);
  const start = Math.min(Math.max(1, page - Math.floor(span / 2)), pageCount - span + 1);
  const pages = Array.from({ length: span }, (_, i) => start + i);

  return (
    <div className={cn("flex gap-1.5", className)} {...props}>
      <button
        type="button"
        aria-label="Vorherige Seite"
        disabled={page <= 1}
        onClick={() => onPageChange?.(page - 1)}
        className={cn(cell, "border border-border text-muted-foreground hover:text-foreground disabled:opacity-40")}
      >
        ‹‹
      </button>
      {pages.map((n) => (
        <button
          key={n}
          type="button"
          aria-current={n === page ? "page" : undefined}
          onClick={() => onPageChange?.(n)}
          className={cn(
            cell,
            n === page
              ? "bg-primary font-bold text-primary-foreground"
              : "border border-border text-foreground hover:bg-surface-2",
          )}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        aria-label="Nächste Seite"
        disabled={page >= pageCount}
        onClick={() => onPageChange?.(page + 1)}
        className={cn(cell, "border border-border text-muted-foreground hover:text-foreground disabled:opacity-40")}
      >
        ››
      </button>
    </div>
  );
}

export { SectionLabel, MetaRow, Sparkline, RoiMeter, Pagination };
