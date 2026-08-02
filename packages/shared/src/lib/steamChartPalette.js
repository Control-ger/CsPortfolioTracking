/**
 * Chart-usable colors derived from the avatar Steam palette.
 *
 * The `--steam-shell-color-*` variables produced by `deriveSteamPaletteFromUser`
 * are background wash colors: they bake a low alpha (0.11-0.20) into the hsla
 * string so large gradient areas stay subtle. Using them directly as chart
 * fills renders marks at ~15% opacity, which reads as washed-out grey — a donut
 * filled that way looks empty.
 *
 * These helpers keep the avatar-derived hue (so the project's palette rule still
 * holds) but drop the alpha and clamp saturation/lightness into a band that
 * stays legible against both the dark shell and a light card.
 */

const DEFAULT_CHART_FALLBACKS = Object.freeze({
  a: "hsl(212, 70%, 58%)",
  b: "hsl(188, 62%, 55%)",
  c: "hsl(39, 66%, 56%)",
  d: "hsl(32, 60%, 54%)",
});

const MIN_SATURATION = 48;
const MAX_SATURATION = 85;
const MIN_LIGHTNESS = 46;
const MAX_LIGHTNESS = 70;

export function toOpaqueChartColor(paletteColor, fallback) {
  const match = /hsla?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%/i.exec(
    String(paletteColor || ""),
  );
  if (!match) {
    return fallback;
  }

  const hue = Number(match[1]);
  if (!Number.isFinite(hue)) {
    return fallback;
  }

  const saturation = Math.min(MAX_SATURATION, Math.max(MIN_SATURATION, Number(match[2])));
  const lightness = Math.min(MAX_LIGHTNESS, Math.max(MIN_LIGHTNESS, Number(match[3])));

  return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
}

/**
 * Build the `--wrapped-chart-*` custom properties from a shell palette.
 */
export function buildChartPaletteVars(shellPalette) {
  return {
    "--wrapped-chart-a": toOpaqueChartColor(shellPalette?.colorA, DEFAULT_CHART_FALLBACKS.a),
    "--wrapped-chart-b": toOpaqueChartColor(shellPalette?.colorB, DEFAULT_CHART_FALLBACKS.b),
    "--wrapped-chart-c": toOpaqueChartColor(shellPalette?.colorC, DEFAULT_CHART_FALLBACKS.c),
    "--wrapped-chart-d": toOpaqueChartColor(shellPalette?.colorD, DEFAULT_CHART_FALLBACKS.d),
  };
}
