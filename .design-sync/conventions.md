## How to build with this design system

CS Investor Hub is a portfolio tracker for CS2 skins: dense, numeric, dark-first,
with a light theme that is fully supported and must keep working.

### No wrapper, no theme provider

Components render standalone. There is no `ThemeProvider` to wrap — the theme is a
`dark` class on the root element, and every token flips with it:

```jsx
<div className="dark">      {/* or omit for light */}
  <Card>…</Card>
</div>
```

`ChartContainer` is the one exception: chart parts (`ChartTooltip`, `ChartLegend`)
only work inside it, because it supplies the chart config context.

### Colour is tokens only — never a Tailwind palette class

There is not a single `text-slate-300`, `bg-emerald-500/12` or `border-white/15`
left in this codebase, and adding one breaks the light theme. Use these:

| Purpose | Classes |
|---|---|
| Surfaces | `bg-background`, `bg-card`, `bg-popover`, `bg-muted`, `bg-accent` |
| Text | `text-foreground`, `text-muted-foreground`, `text-card-foreground` |
| Lines | `border-border`, `border-input`, `ring-ring` |
| Brand | `bg-primary` + `text-primary-foreground`, `bg-secondary` + `text-secondary-foreground` |

**Status colours exist in two roles — do not mix them up.**

- On a surface (text, icons, tinted boxes): `text-success`, `text-warning`,
  `text-info`, `text-destructive`. These flip per theme.
- As a fill (buttons, badges, status dots): `bg-<token>-solid` paired with
  `text-<token>-foreground`. These do **not** flip — a destructive button is the
  same red in both themes.

Using the on-surface tone as a fill produces pastel buttons with unreadable
labels. It is the single most common mistake with this system.

The tinted-box idiom, used for every inline hint, warning and error:

```jsx
<div className="rounded-xl border border-warning/35 bg-warning/12 p-3 text-sm text-warning">
  Preise sind älter als 24 Stunden.
</div>
```

Swap `warning` for `success`, `info` or `destructive`. Keep the `/35` and `/12`
alphas — the light-mode tones are tuned so exactly this pairing clears 4.5:1.

For a subtle raised area on any surface, use `bg-foreground/5` and
`border-foreground/15`, never `bg-white/5` — white is invisible on a light card.

### Numbers

This is a financial UI. Always `tabular-nums` on figures so columns align, and
colour gains with `text-success`, losses with `text-destructive`.

```jsx
<span className="text-2xl font-semibold tabular-nums">12.480,55 €</span>
<span className="text-sm font-medium text-success tabular-nums">+7,24 %</span>
```

### Gradients

Shells, sidebars, hero panels and large surfaces derive their gradient from the
user's Steam avatar via `--steam-shell-color-a` … `-d`. Don't invent gradient
colours; use those variables (they carry their own alpha) or a flat token surface.

### Radii and type

`--radius` is `0.875rem`; use `rounded-md` / `rounded-lg` / `rounded-xl` /
`rounded-2xl` rather than pixel values. The display font is Manrope, applied
globally — don't set `font-family`.

### Where the truth is

`_ds/<folder>/styles.css` and its `@import` closure hold every token definition.
Each component's `<Name>.d.ts` is its API and `<Name>.prompt.md` its usage notes.
Read those before styling around a component.

### A representative composition

```jsx
<Card className="w-[380px]">
  <CardHeader>
    <CardTitle>AK-47 | Leet Museo</CardTitle>
    <CardDescription>Minimal Wear · gekauft am 14.03.2026</CardDescription>
  </CardHeader>
  <CardContent>
    <div className="flex items-baseline justify-between">
      <span className="text-2xl font-semibold tabular-nums">213,23 €</span>
      <span className="text-sm font-medium text-destructive tabular-nums">-11,19 %</span>
    </div>
    <p className="mt-2 text-sm text-muted-foreground">Einstand 240,08 € · 1 Position</p>
  </CardContent>
  <CardFooter className="justify-between">
    <Badge variant="outline" className="border-success/35 bg-success/12 text-success">frisch</Badge>
    <Button size="sm" variant="outline">Details</Button>
  </CardFooter>
</Card>
```
