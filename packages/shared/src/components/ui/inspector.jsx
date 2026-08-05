import * as React from "react";
import { X } from "lucide-react";

import { cn } from "../../lib/utils.js";

/**
 * The right-hand detail column from the Inventar design.
 *
 * It is one card cut into full-bleed bands by hairline rules rather than a
 * stack of padded sub-cards: header, headline price, chart, stat rows, buy
 * orders, actions. Every band therefore closes itself with a bottom border and
 * the card clips, so the last rule falls outside the rounded edge.
 *
 * Shared by the inventory and watchlist inspectors — they show different bands
 * but must not drift into two different detail treatments.
 */
function Inspector({ className, children, ...props }) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-[14px] border border-border bg-card",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function InspectorHeader({ thumb, title, meta, badge, onClose, className, ...props }) {
  return (
    <div
      className={cn(
        "flex items-center gap-[13px] border-b border-border-soft px-4 py-[15px]",
        className,
      )}
      {...props}
    >
      {thumb}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-extrabold">{title}</span>
          {badge}
        </div>
        {meta ? (
          <span className="mt-1 block truncate text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {meta}
          </span>
        ) : null}
      </div>
      {typeof onClose === "function" ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Auswahl aufheben"
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

const DELTA_TONE = {
  success: "text-success",
  danger: "text-danger",
  muted: "text-muted-foreground",
};

/** Headline price with its signed delta on the baseline next to it. */
function InspectorPrice({ value, delta, tone = "muted", className, ...props }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline gap-2.5 border-b border-border-soft px-4 pb-[13px] pt-[15px]",
        className,
      )}
      {...props}
    >
      <span className="text-[28px] font-extrabold tracking-[-0.03em] tabular-nums">{value}</span>
      {delta ? (
        <span className={cn("text-[12.5px] font-bold", DELTA_TONE[tone] ?? DELTA_TONE.muted)}>
          {delta}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Labelled band. `aside` is the right-aligned annotation the design uses for
 * context that belongs to the band but not to its heading — the buy-order
 * reference over the price chart, for instance.
 */
function InspectorBlock({ label, aside, className, children, ...props }) {
  return (
    <div className={cn("border-b border-border-soft px-4 py-3", className)} {...props}>
      {label || aside ? (
        <div className="flex items-center justify-between gap-3 text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
          <span className="truncate">{label}</span>
          {aside ? <span className="shrink-0 text-info">{aside}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Label/value stat row. The bands of these replace the old 2×3 stat tiles. */
function InspectorStat({ label, value, tone = "default", className, ...props }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border-soft px-4 py-[9px]",
        className,
      )}
      {...props}
    >
      <span className="text-[11.5px] font-semibold text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-[12.5px] font-extrabold tabular-nums",
          tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Action bar pinned to the bottom of the card. */
function InspectorFooter({ className, children, ...props }) {
  return (
    <div className={cn("mt-auto flex gap-2 bg-surface-1 px-4 py-[13px]", className)} {...props}>
      {children}
    </div>
  );
}

/** Placeholder shown while nothing is selected. */
function InspectorEmpty({ className, children, ...props }) {
  return (
    <div
      className={cn(
        "flex min-h-50 items-center justify-center rounded-[14px] border border-dashed border-border px-4 py-10 text-center text-[12.5px] text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export {
  Inspector,
  InspectorHeader,
  InspectorPrice,
  InspectorBlock,
  InspectorStat,
  InspectorFooter,
  InspectorEmpty,
};
