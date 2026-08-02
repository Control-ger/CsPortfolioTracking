/**
 * Window-control (minimize/maximize/close) style for the custom titlebar.
 *
 * The desktop window is frameless, so we draw those buttons ourselves and they
 * used to be Windows glyphs on every OS. The main process reports what the host
 * desktop actually uses (`window-controls-theme` IPC): button order/side plus,
 * on Linux, the real button artwork from the active GTK or icon theme — which
 * is how a macOS-style theme like WhiteSur, or any custom theme, shows up
 * automatically.
 *
 * The user can override the detection with an explicit Windows/macOS preset.
 * Like the sound setting this is a pure client-side UI preference and lives in
 * localStorage rather than in the synced `portfolioPreferences` blob.
 */

const STYLE_KEY = "ui:window-controls:style:v1";

export const WINDOW_CONTROL_STYLES = ["auto", "windows", "macos"];
const DEFAULT_STYLE = "auto";

const listeners = new Set();
let style = null;

function readStoredStyle() {
  try {
    const raw = localStorage.getItem(STYLE_KEY);
    return WINDOW_CONTROL_STYLES.includes(raw) ? raw : DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
  }
}

export function getWindowControlsStyle() {
  if (style === null) {
    style = readStoredStyle();
  }
  return style;
}

export function setWindowControlsStyle(next) {
  const value = WINDOW_CONTROL_STYLES.includes(next) ? next : DEFAULT_STYLE;
  style = value;
  try {
    localStorage.setItem(STYLE_KEY, value);
  } catch {
    // Private mode / storage disabled: keep the in-memory value for this session.
  }
  listeners.forEach((listener) => listener(value));
}

export function subscribeWindowControlsStyle(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Asks the main process what the host desktop uses. Web builds and any IPC
 * failure resolve to `null`, which leaves the renderer on its built-in presets.
 */
export async function detectNativeWindowControls(force = false) {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;
  if (typeof api?.windowControlsTheme !== "function") {
    return null;
  }
  try {
    const detected = await api.windowControlsTheme(force);
    return detected && typeof detected === "object" ? detected : null;
  } catch {
    return null;
  }
}

const PRESET_LAYOUTS = {
  windows: { left: [], right: ["minimize", "maximize", "close"] },
  macos: { left: ["close", "minimize", "maximize"], right: [] },
};

/**
 * Box the native buttons fall back to when the detection reported no metrics —
 * matches what the titlebar used before sizes were detected at all.
 */
const DEFAULT_NATIVE_METRICS = { iconSize: 16, buttonSize: 32, gap: 8, edgePadding: 12 };

function normalizeMetrics(metrics) {
  if (!metrics || typeof metrics !== "object") {
    return DEFAULT_NATIVE_METRICS;
  }
  const number = (value, fallback, min, max) =>
    Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : fallback;

  return {
    iconSize: number(metrics.iconSize, DEFAULT_NATIVE_METRICS.iconSize, 8, 32),
    buttonSize: number(metrics.buttonSize, DEFAULT_NATIVE_METRICS.buttonSize, 8, 64),
    gap: number(metrics.gap, DEFAULT_NATIVE_METRICS.gap, 0, 24),
    edgePadding: number(metrics.edgePadding, DEFAULT_NATIVE_METRICS.edgePadding, 0, 32),
  };
}

/**
 * Resolves the preference plus the detection into what the titlebar renders:
 * `{ preset, layout, assets, metrics }`. `assets` is only populated when native
 * theme artwork was found and the user did not force a preset; `metrics` sizes
 * those native buttons the way the theme draws them.
 */
export function resolveWindowControls(preference, detection) {
  if (preference === "windows" || preference === "macos") {
    return {
      preset: preference,
      layout: PRESET_LAYOUTS[preference],
      assets: {},
      metrics: DEFAULT_NATIVE_METRICS,
    };
  }

  const platform = detection?.platform;
  const layout =
    detection?.layout?.left?.length || detection?.layout?.right?.length
      ? detection.layout
      : PRESET_LAYOUTS[platform === "darwin" ? "macos" : "windows"];

  const assets = detection?.assets && Object.keys(detection.assets).length > 0 ? detection.assets : {};
  const preset = assets.close ? "native" : platform === "darwin" ? "macos" : "windows";

  return { preset, layout, assets, metrics: normalizeMetrics(detection?.metrics) };
}
