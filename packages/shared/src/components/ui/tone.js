/**
 * The one semantic tone vocabulary of the design system.
 *
 * A "tone" is what a value *means*, never what colour it is: a falling price is
 * `danger`, a stale timestamp is `warn`, a reference figure is `info`. The
 * mapping to an actual colour lives here and only here, so a theme change is a
 * token change and never a grep across components.
 *
 * These maps were previously copy-pasted five times (`META_TONE` in
 * data-display, `DELTA_TONE` + the inline ternary in inspector, `KEY_STATE_TONE`
 * and `BANNER_TONE` in settings-card, `DOT_TONE` in status-pill). They had
 * already begun to drift — the inspector's stat row silently had no `warn` at
 * all and fell back to plain foreground.
 *
 * Three roles, deliberately separate:
 * - `TONE_TEXT`  — coloured text on an existing surface.
 * - `TONE_FILL`  — a solid block of the colour: dots, bars, meters.
 * - `TONE_TINT`  — the callout idiom: hairline border + 10% wash + tinted text.
 *
 * Using a fill where a tint belongs (or vice versa) is the one mistake this
 * system makes easy to spot: a fill-coloured callout is a solid green box.
 */

/** Tones that carry a status meaning. `default`/`muted` are neutral text only. */
export const STATUS_TONES = ["success", "warn", "info", "danger"];

/** Every tone accepted by `TONE_TEXT`. */
export const TONES = ["default", "muted", "success", "warn", "info", "danger"];

export const TONE_TEXT = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  success: "text-success",
  warn: "text-warn",
  info: "text-info",
  danger: "text-danger",
};

export const TONE_FILL = {
  default: "bg-foreground",
  muted: "bg-muted-foreground",
  success: "bg-success",
  warn: "bg-warn",
  info: "bg-info",
  danger: "bg-danger",
};

export const TONE_BORDER = {
  default: "border-border-strong",
  muted: "border-border",
  success: "border-success/30",
  warn: "border-warn/30",
  info: "border-info/30",
  danger: "border-danger/30",
};

/**
 * Border + wash without a text colour, for a tinted box holding ordinary prose.
 *
 * A short status label reads well in its own tone; a three-line German hint set
 * in info-blue on an info wash does not. Those keep `text-foreground` and let
 * the border, wash and icon carry the meaning.
 */
export const TONE_TINT_SURFACE = {
  default: "border-border bg-surface-1",
  muted: "border-border-soft bg-surface-1",
  success: "border-success/30 bg-success/10",
  warn: "border-warn/30 bg-warn/10",
  info: "border-info/30 bg-info/10",
  danger: "border-danger/30 bg-danger/10",
};

export const TONE_TINT = {
  default: "border-border bg-surface-1 text-foreground",
  muted: "border-border-soft bg-surface-1 text-muted-foreground",
  success: "border-success/30 bg-success/10 text-success",
  warn: "border-warn/30 bg-warn/10 text-warn",
  info: "border-info/30 bg-info/10 text-info",
  danger: "border-danger/30 bg-danger/10 text-danger",
};

/**
 * Tone lookups fall back instead of yielding `undefined`, because an unknown
 * tone must render as readable neutral text — not as an unstyled element that
 * inherits whatever the parent happened to set.
 */
export function toneText(tone, fallback = "default") {
  return TONE_TEXT[tone] ?? TONE_TEXT[fallback];
}

export function toneFill(tone, fallback = "muted") {
  return TONE_FILL[tone] ?? TONE_FILL[fallback];
}

export function toneBorder(tone, fallback = "muted") {
  return TONE_BORDER[tone] ?? TONE_BORDER[fallback];
}

export function toneTint(tone, fallback = "info") {
  return TONE_TINT[tone] ?? TONE_TINT[fallback];
}

export function toneTintSurface(tone, fallback = "info") {
  return TONE_TINT_SURFACE[tone] ?? TONE_TINT_SURFACE[fallback];
}

/**
 * Tone for a signed number: gains read `success`, losses `danger`, and a flat
 * or unknown value stays `muted` rather than being forced into one of the two.
 * Centralised because "is this green or red?" was decided ad hoc in a dozen
 * places, with `>= 0` and `> 0` used interchangeably — which coloured a true
 * zero as a gain on some screens and as neutral on others.
 */
export function toneForDelta(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return "muted";
  return numeric > 0 ? "success" : "danger";
}
