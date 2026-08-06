/**
 * The design system's single entry point.
 *
 *     import { Card, StatusPill, Callout, toneForDelta } from "@shared/components/ui";
 *
 * Everything a new view needs is exported here, so building a screen starts by
 * reading this list rather than by grepping the components folder. Deep imports
 * (`.../ui/button.jsx`) still work and are not being hunted down, but new code
 * should come through the barrel — that is what keeps the inventory visible.
 *
 * Grouped by job, not alphabetically, because the grouping *is* the guidance:
 * when two primitives look interchangeable, the comment says which one to pick.
 */

/* ── Foundations ──────────────────────────────────────────────────────────── */
// The semantic tone vocabulary. Never write `text-emerald-400`; ask for a tone.
export * from "./tone.js";

/* ── Layout & containers ──────────────────────────────────────────────────── */
// `Card` is the generic surface. Settings screens use the `Settings*` family
// instead — a settings card is a clipped block of full-bleed rows, not a padded
// card, and mixing the two is what made the old settings screens drift.
export * from "./card.jsx";
export * from "./settings-card.jsx";
export * from "./separator.jsx";
export * from "./scroll-area.jsx";
export * from "./accordion.jsx";

/* ── Actions & input ──────────────────────────────────────────────────────── */
export * from "./button.jsx";
export * from "./input.jsx";
export * from "./switch.jsx";
// `Select` is the Radix combobox (searchable, styled menu); `NativeSelect` is
// the OS control. Prefer `NativeSelect` on dense rows and on mobile, where the
// native picker is both faster and more accessible.
export * from "./select.jsx";
export * from "./native-select.jsx";
export * from "./segmented-control.jsx";
export * from "./dropdown-menu.jsx";
export * from "./tabs.jsx";

/* ── Status & feedback ────────────────────────────────────────────────────── */
// `StatusPill` labels a *thing's* state inline (a row, a header). `Badge` is a
// neutral count/tag. `Callout` is a block-level message with prose. `Alert` is
// the legacy shadcn block — prefer `Callout` for new work.
export * from "./status-pill.jsx";
export * from "./badge.jsx";
export * from "./callout.jsx";
export * from "./alert.jsx";
export * from "./alert-dialog.jsx";
export * from "./tooltip.jsx";
export * from "./skeleton.jsx";
export * from "./empty-state.jsx";

/* ── Data display ─────────────────────────────────────────────────────────── */
// Two table systems, and the choice is not stylistic:
// `GridTable` is a CSS-grid table for the dense portfolio lists — columns stay
// aligned across a virtualised body and rows can be full-bleed selectable.
// `Table` is semantic <table> markup for small static tables inside modals.
export * from "./grid-table.jsx";
export * from "./table.jsx";
// SectionLabel, MetaRow, Sparkline, RoiMeter, Pagination.
export * from "./data-display.jsx";
export * from "./item-thumb.jsx";
export * from "./chart.jsx";

/* ── Detail & filtering shells ────────────────────────────────────────────── */
export * from "./inspector.jsx";
export * from "./filter-sidebar.jsx";
