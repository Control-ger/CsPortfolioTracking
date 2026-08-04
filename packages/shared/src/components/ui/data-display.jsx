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

export { SectionLabel, MetaRow, Pagination };
