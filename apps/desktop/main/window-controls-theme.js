/* eslint-disable no-undef -- Electron main process: Node globals, like the other main/ modules. */

/**
 * Detects how the host desktop draws window buttons, so the custom (frameless)
 * titlebar can mirror the native look instead of always shipping Windows glyphs.
 *
 * Linux is the interesting case: the button *order and side* live in a gsettings
 * key, while the button *artwork* is part of the GTK theme. Themes such as
 * WhiteSur (macOS look) or any custom/joke theme ship those buttons as SVG/PNG
 * under `<theme>/metacity-1/titlebuttons/`, which is what GNOME/Metacity-family
 * WMs render. Reading those files gives us the real icons — including custom
 * ones — instead of guessing "windows or mac".
 *
 * Resolution order per platform:
 *   win32/darwin → the matching built-in preset (renderer side), no probing.
 *   linux        → layout from gsettings, artwork from the GTK theme, then the
 *                  icon theme's `window-*` symbolic icons, then built-ins.
 *
 * Everything here is best-effort: any failure falls back one level down and the
 * renderer always has its built-in presets as a last resort.
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const ACTIONS = ["close", "minimize", "maximize", "unmaximize"];
const LAYOUT_ACTIONS = new Set(["close", "minimize", "maximize"]);

// Guards against pathological theme assets being inlined into the renderer.
const MAX_ASSET_BYTES = 96 * 1024;

let cachedDetection = null;

function runCommand(command, args, timeoutMs = 1500) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, encoding: "utf8" }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

function unquoteGsettingsValue(value) {
  if (!value) return "";
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function readGsettings(schema, key) {
  const raw = await runCommand("gsettings", ["get", schema, key]);
  const value = unquoteGsettingsValue(raw);
  return value && value !== "@as []" ? value : null;
}

/**
 * `button-layout` looks like `appmenu:minimize,maximize,close` — everything
 * before the colon is drawn on the left, everything after on the right.
 * Entries we cannot act on (appmenu, menu, icon, spacer) are dropped.
 */
function parseButtonLayout(layout) {
  if (!layout || typeof layout !== "string") {
    return null;
  }
  const [leftRaw = "", rightRaw = ""] = layout.split(":");
  const pick = (part) =>
    part
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => LAYOUT_ACTIONS.has(entry));

  const left = pick(leftRaw);
  const right = pick(rightRaw);
  if (left.length === 0 && right.length === 0) {
    return null;
  }
  return { left, right };
}

async function detectButtonLayout() {
  const candidates = [
    ["org.gnome.desktop.wm.preferences", "button-layout"],
    ["org.cinnamon.desktop.wm.preferences", "button-layout"],
    ["org.mate.Marco.general", "button-layout"],
  ];

  for (const [schema, key] of candidates) {
    const parsed = parseButtonLayout(await readGsettings(schema, key));
    if (parsed) {
      return parsed;
    }
  }

  // GTK's own setting, used when no gsettings schema answered (e.g. XFCE/plain WMs).
  try {
    const iniPath = path.join(os.homedir(), ".config", "gtk-3.0", "settings.ini");
    const ini = await fs.readFile(iniPath, "utf8");
    const match = ini.match(/^\s*gtk-decoration-layout\s*=\s*(.+)$/m);
    const parsed = parseButtonLayout(match ? match[1].trim() : null);
    if (parsed) {
      return parsed;
    }
  } catch {
    // No GTK settings file — fall through to the default below.
  }

  return { left: [], right: ["minimize", "maximize", "close"] };
}

function themeSearchDirs() {
  const home = os.homedir();
  const xdgDataDirs = String(process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share")
    .split(":")
    .filter(Boolean)
    .map((dir) => path.join(dir, "themes"));

  return [
    path.join(home, ".themes"),
    path.join(home, ".local", "share", "themes"),
    ...xdgDataDirs,
    "/usr/share/themes",
  ];
}

function iconSearchDirs() {
  const home = os.homedir();
  const xdgDataDirs = String(process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share")
    .split(":")
    .filter(Boolean)
    .map((dir) => path.join(dir, "icons"));

  return [
    path.join(home, ".icons"),
    path.join(home, ".local", "share", "icons"),
    ...xdgDataDirs,
    "/usr/share/icons",
  ];
}

async function firstExistingDir(dirs, name) {
  if (!name) return null;
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        return candidate;
      }
    } catch {
      // Not in this root — keep looking.
    }
  }
  return null;
}

function mimeForAsset(filePath) {
  return filePath.toLowerCase().endsWith(".png") ? "image/png" : "image/svg+xml";
}

async function readAssetAsDataUri(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_ASSET_BYTES) {
      return null;
    }
    const buffer = await fs.readFile(filePath);
    return `data:${mimeForAsset(filePath)};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * GTK themes ship the real titlebar buttons here, one file per state. We take
 * the idle and hover variants; anything else (active/backdrop) is noise for a
 * custom titlebar that only needs those two.
 */
async function readGtkThemeButtons(themeName) {
  const themeDir = await firstExistingDir(themeSearchDirs(), themeName);
  if (!themeDir) {
    return null;
  }
  const buttonsDir = path.join(themeDir, "metacity-1", "titlebuttons");
  const assets = {};

  for (const action of ACTIONS) {
    for (const extension of [".svg", ".png"]) {
      const normal = await readAssetAsDataUri(
        path.join(buttonsDir, `titlebutton-${action}${extension}`),
      );
      if (!normal) continue;
      const hover = await readAssetAsDataUri(
        path.join(buttonsDir, `titlebutton-${action}-hover${extension}`),
      );
      assets[action] = { normal, hover: hover || normal, tint: false };
      break;
    }
  }

  if (!assets.close) {
    return null;
  }
  return { assets, themeDir };
}

/**
 * Fallback artwork: the icon theme's `window-close` family. These are symbolic
 * (drawn in `currentColor`), so the renderer masks them instead of showing them
 * as images — otherwise they would be invisible on a dark titlebar.
 */
async function readIconThemeButtons(iconThemeName, depth = 0) {
  const iconDir = await firstExistingDir(iconSearchDirs(), iconThemeName);
  if (!iconDir) {
    return null;
  }

  const relativeCandidates = (icon) => [
    path.join("actions", "symbolic", `${icon}-symbolic.svg`),
    path.join("symbolic", "actions", `${icon}-symbolic.svg`),
    path.join("scalable", "actions", `${icon}-symbolic.svg`),
    path.join("actions", "scalable", `${icon}.svg`),
    path.join("actions", "24", `${icon}.svg`),
    path.join("actions", "22", `${icon}.svg`),
    path.join("actions", "16", `${icon}.svg`),
  ];

  const iconForAction = {
    close: "window-close",
    minimize: "window-minimize",
    maximize: "window-maximize",
    unmaximize: "window-restore",
  };

  const assets = {};
  for (const action of ACTIONS) {
    for (const relative of relativeCandidates(iconForAction[action])) {
      const dataUri = await readAssetAsDataUri(path.join(iconDir, relative));
      if (dataUri) {
        assets[action] = { normal: dataUri, hover: dataUri, tint: true };
        break;
      }
    }
  }

  if (assets.close) {
    return { assets, themeDir: iconDir };
  }

  // Follow one level of theme inheritance (e.g. WhiteSur → breeze → hicolor).
  if (depth >= 2) {
    return null;
  }
  try {
    const index = await fs.readFile(path.join(iconDir, "index.theme"), "utf8");
    const match = index.match(/^\s*Inherits\s*=\s*(.+)$/m);
    const parents = match ? match[1].split(",").map((entry) => entry.trim()) : [];
    for (const parent of parents) {
      const inherited = await readIconThemeButtons(parent, depth + 1);
      if (inherited) {
        return inherited;
      }
    }
  } catch {
    // No index.theme — nothing to inherit from.
  }
  return null;
}

async function detectLinuxWindowControls() {
  const layout = await detectButtonLayout();
  const gtkTheme = process.env.GTK_THEME || (await readGsettings("org.gnome.desktop.interface", "gtk-theme"));
  const iconTheme = await readGsettings("org.gnome.desktop.interface", "icon-theme");

  const fromGtkTheme = gtkTheme ? await readGtkThemeButtons(gtkTheme) : null;
  if (fromGtkTheme) {
    return {
      layout,
      source: "gtk-theme",
      themeName: gtkTheme,
      assets: fromGtkTheme.assets,
    };
  }

  const fromIconTheme = iconTheme ? await readIconThemeButtons(iconTheme) : null;
  if (fromIconTheme) {
    return {
      layout,
      source: "icon-theme",
      themeName: iconTheme,
      assets: fromIconTheme.assets,
    };
  }

  return { layout, source: "fallback", themeName: gtkTheme || null, assets: {} };
}

/**
 * @param {boolean} force skip the process-lifetime cache (used by the "detect
 *   again" action in settings after the user switched their desktop theme).
 */
export async function detectWindowControls(force = false) {
  if (cachedDetection && !force) {
    return cachedDetection;
  }

  const base = {
    platform: process.platform,
    desktop: process.env.XDG_CURRENT_DESKTOP || null,
  };

  if (process.platform !== "linux") {
    cachedDetection = {
      ...base,
      source: "platform",
      themeName: null,
      assets: {},
      layout:
        process.platform === "darwin"
          ? { left: ["close", "minimize", "maximize"], right: [] }
          : { left: [], right: ["minimize", "maximize", "close"] },
    };
    return cachedDetection;
  }

  try {
    cachedDetection = { ...base, ...(await detectLinuxWindowControls()) };
  } catch (error) {
    console.warn("[window-controls] detection failed", error);
    cachedDetection = {
      ...base,
      source: "fallback",
      themeName: null,
      assets: {},
      layout: { left: [], right: ["minimize", "maximize", "close"] },
    };
  }
  return cachedDetection;
}
