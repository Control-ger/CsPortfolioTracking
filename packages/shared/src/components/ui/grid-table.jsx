import * as React from "react";

import { cn } from "../../lib/utils.js";

/**
 * The dense CSS-grid table from the Inventar design.
 *
 * A real `<table>` cannot hold this layout: the cells carry sparklines and
 * meters that must track a fixed pixel width while the name column absorbs the
 * rest, and every row is a click target. So the shape is a grid whose column
 * template lives on the parent and is handed to head/row/foot alike — pass the
 * same `columns` string to all of them or the header stops lining up with the
 * body.
 */
function GridTable({ className, children, ...props }) {
  return (
    <div
      className={cn("overflow-hidden rounded-2xl border border-border bg-card", className)}
      {...props}
    >
      {children}
    </div>
  );
}

function GridTableHead({ columns, className, children, ...props }) {
  return (
    <div
      role="row"
      style={{ gridTemplateColumns: columns }}
      className={cn(
        "grid gap-3 border-b border-border-soft bg-surface-1 px-4 py-[11px]",
        "text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Body row. `selected` paints the design's `row-sel` wash; `indent` is the
 * nested-cluster step under an expanded group.
 */
const GridTableRow = React.forwardRef(function GridTableRow(
  { columns, selected = false, indent = false, className, children, onClick, ...props },
  ref,
) {
  const interactive = typeof onClick === "function";

  return (
    <div
      ref={ref}
      role="row"
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick(event);
              }
            }
          : undefined
      }
      style={{ gridTemplateColumns: columns }}
      className={cn(
        "grid items-center gap-3 border-b border-border-soft px-4 py-[9px] transition-colors",
        interactive && "cursor-pointer",
        selected ? "bg-row-sel" : interactive && "hover:bg-surface-1",
        indent && "bg-surface-1/60 pl-10",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});

/** Summary strip closing the table ("8 von 42 Positionen" / "Gesamtwert …"). */
function GridTableFoot({ className, children, ...props }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-border-soft bg-surface-1 px-4 py-[11px] text-[11.5px] text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Centered empty state occupying the body area of a grid table. */
function GridTableEmpty({ className, children, ...props }) {
  return (
    <div
      className={cn("px-4 py-10 text-center text-[12.5px] text-muted-foreground", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export { GridTable, GridTableHead, GridTableRow, GridTableFoot, GridTableEmpty };
