# Design System

Status: FINAL
Last updated: 2026-08-05

The component library every view is built from.

Source: `packages/shared/src/components/ui/`. Tokens: `apps/web/src/index.css`.

## 0. Browsing the catalogue

Route **`#/design`** (desktop or web). Not in the sidebar rail or bottom nav —
it is a builder's tool reached by URL, like `#/wrapped`. Start here when
building a view: the point is to see what already exists instead of hand-rolling
another tinted box.

It renders every primitive against the real tokens, with a jump nav across the
fourteen sections and its own light/dark toggle — which drives the `dark` class
on the root element rather than a scoped preview wrapper, because several
primitives carry `dark:` variants that only respond to the root class. That
makes the page the light/dark regression check as well: anything that breaks on
a theme flip breaks visibly here first.

Coverage is 109 of 117 exports. The eight absentees — `AlertDialogOverlay`,
`AlertDialogPortal`, `ChartStyle`, `DropdownMenuPortal`, `ScrollBar`,
`SelectScrollUpButton`, `SelectScrollDownButton`, `SoonBadge` — are internal
plumbing that their parent renders for you; you never write them. (`SoonBadge`
is in fact visible on the page, via `soon` on a filter row.)

## 1. The one rule

**Colour comes from tokens. Never from a Tailwind palette class.**

`text-slate-300`, `bg-emerald-500/12`, `border-white/15` are forbidden. They
encode one theme, so every one of them needs a `dark:` twin — and when the twin
is missing the light theme breaks. That failure mode is not hypothetical: this
codebase carried 383 such classes and ~200 lines of `!important` overrides in
`index.css` whose only job was to rescue the light theme from them. Both are
gone, and `index.css` now contains zero `!important`.

Tokens flip themselves with the `dark` class on the root element, so tokenised
code needs almost no `dark:` variants at all.

Two deliberate exceptions:

- **Modal scrims** — `bg-black/70`. A scrim is a lightbox, not a themed surface;
  it is black in both themes. Use `/70`; the codebase previously had `/60`,
  `/70` and `/80` in three different places.
- **Dark-only elevation** — `dark:shadow-[…]`, `dark:backdrop-blur`,
  `dark:rounded-xl`. These are a real design difference (dark surfaces get glass
  and lift, light ones get flat hairlines), not a colour workaround.

## 2. Tokens

| Purpose | Classes |
|---|---|
| Surfaces | `bg-background`, `bg-card`, `bg-popover`, `bg-muted`, `bg-accent` |
| Washes over a surface | `bg-surface-1` (3-4%), `bg-surface-2` (6-7%) |
| Text | `text-foreground`, `text-muted-foreground` |
| Lines | `border-border-soft` (inside a card), `border-border` (default), `border-border-strong` (emphasis) |
| Brand | `bg-primary` + `text-primary-foreground`, `bg-secondary` + `text-secondary-foreground` |
| Status | `success`, `warn`, `info`, `danger` |
| Rows | `bg-row-sel` (selected), `bg-stripe` (hatch placeholder) |
| Focus | `ring-ring` |

`--radius` is **14px**, so `rounded-xl` is 18px. The design's 9/10/12/14px steps
are written explicitly (`rounded-[10px]`), which is why the primitives use
bracket radii rather than the scale.

Gradients (shells, sidebar, hero, panels) must use the avatar-derived Steam
palette — `--steam-shell-color-a` … `-d`. See the Frontend Visual Rule in
`AGENTS.md`. Chart *marks* must not use those variables directly: they bake in a
0.11-0.20 alpha and render nearly invisible. Use the opaque siblings from
`steamChartPalette.js` (`--wrapped-chart-a` … `-d`).

## 3. Tone vocabulary

`packages/shared/src/components/ui/tone.js` is the single source. A tone says
what a value *means* — a falling price is `danger`, a stale timestamp is `warn`,
a reference figure is `info`.

Vocabulary: `default`, `muted`, `success`, `warn`, `info`, `danger`.

Three roles, and mixing them is the mistake this system makes easy to spot:

| Helper | Use for | Example |
|---|---|---|
| `toneText(tone)` | coloured text on an existing surface | a signed delta |
| `toneFill(tone)` | a solid block of colour | status dots, meter bars |
| `toneTint(tone)` | border + 10% wash + tinted text | short status boxes |
| `toneTintSurface(tone)` | border + wash, caller sets text | callouts holding prose |

`toneForDelta(value)` maps a signed number to a tone: gains `success`, losses
`danger`, and a flat or unknown value stays `muted` rather than being forced
into one of the two. Use it instead of writing `value >= 0 ? green : red` —
that comparison was written both as `>= 0` and `> 0` across the codebase, so a
true zero rendered as a gain on some screens and as neutral on others.

Every lookup falls back rather than returning `undefined`, so an unknown tone
renders as readable neutral text instead of an unstyled element.

## 4. Primitive inventory

Import from the barrel — that is what keeps the inventory visible:

```jsx
import { Card, StatusPill, Callout, toneForDelta } from "@shared/components/ui";
```

### Layout & containers
`Card` / `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` /
`CardFooter`, `SettingsCard` family, `Separator`, `ScrollArea`, `Accordion`.

### Actions & input
`Button`, `Input`, `Switch`, `Select`, `NativeSelect`, `SegmentedControl`,
`DropdownMenu`, `Tabs`.

### Status & feedback
`StatusPill`, `Badge`, `Callout`, `Alert`, `AlertDialog`, `Tooltip`, `Skeleton`,
`EmptyState`.

### Data display
`GridTable` family, `Table` family, `SectionLabel`, `MetaRow`, `Sparkline`,
`RoiMeter`, `Pagination`, `ItemThumb`, `ChartContainer` family.

### Detail & filtering shells
`Inspector` family, `FilterSidebar` family.

## 5. Which one, when

These pairs look interchangeable and are not:

- **`GridTable` vs `Table`** — `GridTable` is a CSS-grid table for the dense
  portfolio lists: columns stay aligned across a virtualised body and rows are
  full-bleed selectable. `Table` is semantic `<table>` markup for small static
  tables inside modals.
- **`Card` vs `SettingsCard`** — a settings card is a clipped block of
  full-bleed rows, not a padded card. Rows carry their own divider and sit
  *directly* in the card; `SettingsCardBody` is the padded area for cards that
  hold tiles or a form grid instead. Mixing the two is what made the old
  settings screens drift.
- **`Select` vs `NativeSelect`** — `NativeSelect` on dense rows and on mobile,
  where the OS picker is faster and more accessible than a rebuilt menu.
- **`Callout` vs `StatusPill` vs `Badge`** — `Callout` is a block-level message
  with prose; `StatusPill` labels a thing's state inline; `Badge` is a neutral
  count or tag.
- **`Alert` vs `Callout`** — `Alert` is the legacy shadcn block. Prefer
  `Callout` for new work.
- **`EmptyState` vs `GridTableEmpty` / `InspectorEmpty`** — the latter two fill
  a known slot inside their own container and must stay flush with it.
  `EmptyState` is the standalone block, and takes an `action` so an empty state
  is not a dead end.

`Button` already carries tonal variants (`softSuccess`, `softWarn`,
`softDanger`) for affirmative or cautionary secondary actions. Do not hand-build
a tinted button.

## 6. Known residue

- **Deep imports still exist.** Older code imports `.../ui/button.jsx`
  directly. Both paths work; new code should use the barrel.
- **`components/index.js` re-exports only part of `ui/`.** It predates the
  barrel and was left alone. `ui/index.js` is the authority.
- **`ds-bundle/` and `.design-sync/` are generated and gitignored.**
  `ds-bundle/README.md` describes an idealised system with tokens
  (`--warning`, `-solid` fills) that do not exist in this codebase. It is tool
  output, not a specification — do not follow it.
