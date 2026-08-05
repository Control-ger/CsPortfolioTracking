import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "../../lib/utils.js";

/**
 * Collapsible filter rail from the Inventar/Watchlist designs.
 *
 * The visual language is deliberately flat: no pills, no rounded controls. A
 * selected row is marked by a 2px left accent bar plus a `surface-1` wash, and
 * groups are separated by hairlines rather than gaps. That is what keeps a rail
 * this dense from reading as a stack of buttons.
 *
 * Open it is a 208px column; collapsed it shrinks to 58px and keeps the scope
 * switches as full-width icon buttons, so the primary filter stays reachable.
 *
 * Wide-desktop only: below `lg` the surrounding views render their own inline
 * controls. A 208px rail plus a table plus a 356px inspector does not fit in a
 * 768px viewport, and the inspector is the one that must not be dropped.
 */
function FilterSidebar({ open, onToggle, title = "Filter", collapsed, children, className, ...props }) {
  const Chevron = open ? ChevronLeft : ChevronRight;

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col gap-3.5 self-stretch border-r border-border-soft bg-background/40 lg:flex",
        open ? "w-52 py-[18px] pl-2.5 pr-3.5" : "w-[58px] px-2 py-[18px]",
        className,
      )}
      {...props}
    >
      <div className={cn("flex items-center gap-2", open ? "justify-between" : "justify-center")}>
        {open ? (
          <span className="text-[9.5px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
            {title}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onToggle}
          title={open ? "Filter einklappen" : "Filter ausklappen"}
          aria-expanded={open}
          className="grid size-7 shrink-0 place-items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <Chevron className="size-[15px]" />
        </button>
      </div>

      {open ? <div className="flex flex-col">{children}</div> : collapsed}
    </aside>
  );
}

/**
 * Labelled block inside the sidebar ("Bereich", "Kategorie", "Zeitraum",
 * "Sortierung"). Separation comes from a top hairline, which the first block
 * drops — hence the `first:`/`last:` variants rather than a wrapper gap.
 */
function FilterGroup({ label, children, className, ...props }) {
  return (
    <div
      className={cn(
        "border-t border-border-soft py-4 first:border-t-0 first:pt-0 last:pb-0",
        className,
      )}
      {...props}
    >
      <p className="mb-[7px] text-[9.5px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

/**
 * Shared shape of every selectable row in the rail: left accent bar, tinted
 * background when active, muted when not.
 */
function flatRowClasses(active, disabled) {
  return cn(
    "flex items-center border-l-2 pl-2 pr-[9px] text-left transition-colors",
    disabled
      ? "cursor-not-allowed border-l-transparent text-muted-foreground opacity-45"
      : active
        ? "border-l-primary bg-surface-1 font-extrabold text-foreground"
        : "border-l-transparent font-semibold text-muted-foreground hover:text-foreground",
  );
}

/** Small "coming soon" marker for controls whose feature does not exist yet. */
function SoonBadge({ className }) {
  return (
    <span
      className={cn(
        "shrink-0 border border-border-soft px-1 py-px text-[8.5px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground",
        className,
      )}
    >
      Bald
    </span>
  );
}

/**
 * Full-width scope row: label left, count right.
 *
 * `soon` marks a scope whose backing feature is not implemented — it renders
 * disabled with a "Bald" badge instead of being hidden, so the planned shape of
 * the view stays visible.
 */
function FilterScopeButton({ active = false, label, count, soon = false, className, ...props }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={soon || props.disabled}
      title={soon ? "Noch nicht verfügbar" : undefined}
      className={cn(flatRowClasses(active, soon), "h-[30px] justify-between gap-2 text-[12.5px]", className)}
      {...props}
    >
      <span className="truncate">{label}</span>
      {soon ? (
        <SoonBadge />
      ) : count != null ? (
        <span className="shrink-0 text-[11px] tabular-nums opacity-70">{count}</span>
      ) : null}
    </button>
  );
}

/**
 * Full-width icon scope button shown while the sidebar is collapsed.
 *
 * Icons rather than initials: the scopes this rail carries are "Investments"
 * and "Inventar", which share not just a first letter but a first syllable —
 * no abbreviation short enough for 34px tells them apart.
 */
function FilterScopeIcon({ active = false, label, icon, soon = false, className, ...props }) {
  return (
    <button
      type="button"
      title={soon ? `${label} — noch nicht verfügbar` : label}
      aria-label={label}
      aria-pressed={active}
      disabled={soon || props.disabled}
      className={cn(
        flatRowClasses(active, soon),
        "h-[34px] w-full justify-center px-0 pl-0",
        active ? "border-l-primary" : "",
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
}

/**
 * Category chip. Square by design — the rail has no rounded controls, so a
 * pill here would be the only one and would read as a different kind of thing.
 */
function FilterChip({ active = false, className, children, ...props }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "border px-2 py-1 text-[11px] transition-colors",
        active
          ? "border-border-strong bg-surface-1 font-extrabold text-foreground"
          : "border-border-soft font-semibold text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** Sort / range row. Same accent treatment as the scopes, one step smaller. */
function FilterSortButton({
  active = false,
  direction,
  soon = false,
  className,
  children,
  ...props
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={soon || props.disabled}
      title={soon ? "Noch nicht verfügbar" : undefined}
      className={cn(flatRowClasses(active, soon), "h-7 justify-between gap-2 text-xs", className)}
      {...props}
    >
      <span className="truncate">{children}</span>
      {soon ? (
        <SoonBadge />
      ) : active && direction ? (
        <span aria-hidden="true" className="shrink-0 opacity-70">
          {direction === "asc" ? "↑" : "↓"}
        </span>
      ) : null}
    </button>
  );
}

export {
  FilterSidebar,
  FilterGroup,
  FilterScopeButton,
  FilterScopeIcon,
  FilterChip,
  FilterSortButton,
  SoonBadge,
};
