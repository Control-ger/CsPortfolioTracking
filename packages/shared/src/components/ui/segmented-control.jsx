import * as React from "react";

import { cn } from "../../lib/utils.js";

/**
 * Track-and-pill segmented control.
 *
 * The design uses this shape for every mutually-exclusive switch: the five
 * Verwaltung tabs, the exclude filter (Alle/Nur aktiv/Nur excluded), the
 * Investment/Inventar bucket toggle and the grid/list view switch. The track is
 * a `surface-2` rounded rect; the active segment is a solid `primary` pill.
 *
 * @param {Array<{value: string, label: React.ReactNode, count?: number|string}>} items
 */
function SegmentedControl({ items = [], value, onChange, size = "default", className, ...props }) {
  const isIcon = size === "icon";
  return (
    <div
      role="tablist"
      className={cn("inline-flex gap-0.5 rounded-xl bg-surface-2 p-[3px]", className)}
      {...props}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={item.title}
            disabled={item.disabled}
            onClick={() => onChange?.(item.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-[9px] whitespace-nowrap transition-colors",
              isIcon ? "size-8" : size === "sm" ? "h-[30px] px-3 text-xs" : "h-[34px] px-3.5 text-[13px]",
              item.disabled
                ? "cursor-not-allowed font-semibold text-muted-foreground opacity-45"
                : active
                  ? "bg-primary font-bold text-primary-foreground"
                  : "font-semibold text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {item.count != null ? (
              <span className="tabular-nums opacity-65">{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export { SegmentedControl };
