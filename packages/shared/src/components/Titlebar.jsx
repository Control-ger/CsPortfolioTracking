import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import appIcon from '/icon.ico?url';

import {
  detectNativeWindowControls,
  getWindowControlsStyle,
  resolveWindowControls,
  subscribeWindowControlsStyle,
} from '../lib/windowControls.js';

/** Minimum gap between two forced (cache-skipping) theme detections. */
const FORCED_DETECTION_INTERVAL_MS = 60_000;

/**
 * Key suffixes rather than resolved strings: the three button presets are
 * separate components, so each resolves the pair itself through its own hook
 * instead of receiving prebuilt labels from a module constant that cannot see
 * the active language.
 */
const ACTION_LABEL_KEYS = {
  minimize: { title: 'titlebar.minimize', aria: 'titlebar.minimizeWindow' },
  maximize: { title: 'titlebar.maximize', aria: 'titlebar.maximizeWindow' },
  close: { title: 'titlebar.close', aria: 'titlebar.closeWindow' },
};

/** Resolves the title/aria pair for one window action. */
function useActionLabel(action) {
  const { t } = useTranslation('common');
  const keys = ACTION_LABEL_KEYS[action];
  return { title: t(keys.title), aria: t(keys.aria) };
}

function triggerWindowAction(action) {
  if (action === 'close') window.electronAPI?.close();
  else if (action === 'minimize') window.electronAPI?.minimize();
  else if (action === 'maximize') window.electronAPI?.maximize();
}

const GLYPHS = {
  minimize: (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <line x1="0" y1="8" x2="10" y2="8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  maximize: (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
  close: (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <line x1="2.5" y1="2.5" x2="7.5" y2="7.5" stroke="currentColor" strokeWidth="1.5" />
      <line x1="7.5" y1="2.5" x2="2.5" y2="7.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
};

const MAC_DOT_COLORS = {
  close: 'bg-[#ff5f57]',
  minimize: 'bg-[#febc2e]',
  maximize: 'bg-[#28c840]',
};

/** Windows-style: wide flat cells, red close on hover. */
const WindowsButton = ({ action, onClick }) => {
  const label = useActionLabel(action);
  return (
    <button
      type="button"
      onClick={onClick}
      title={label.title}
      aria-label={label.aria}
      className={`flex h-full w-12 items-center justify-center text-muted-foreground transition-colors ${
        action === 'close' ? 'hover:bg-danger hover:text-white' : 'hover:bg-accent/50'
      }`}
    >
      {GLYPHS[action]}
    </button>
  );
};

/** macOS-style: traffic lights that only reveal their glyph on hover. */
const MacButton = ({ action, onClick }) => {
  const label = useActionLabel(action);
  return (
    <button
      type="button"
      onClick={onClick}
      title={label.title}
      aria-label={label.aria}
      className="group flex h-full w-6 items-center justify-center"
    >
      <span
        className={`flex h-3 w-3 items-center justify-center rounded-full ${MAC_DOT_COLORS[action]} text-black/60 transition-opacity hover:brightness-95`}
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
          className="opacity-0 transition-opacity group-hover:opacity-100"
        >
          {action === 'close' && (
            <>
              <line x1="2.5" y1="2.5" x2="7.5" y2="7.5" stroke="currentColor" strokeWidth="1.6" />
              <line x1="7.5" y1="2.5" x2="2.5" y2="7.5" stroke="currentColor" strokeWidth="1.6" />
            </>
          )}
          {action === 'minimize' && (
            <line x1="2" y1="5" x2="8" y2="5" stroke="currentColor" strokeWidth="1.6" />
          )}
          {action === 'maximize' && (
            <rect x="2.5" y="2.5" width="5" height="5" stroke="currentColor" strokeWidth="1.4" />
          )}
        </svg>
      </span>
    </button>
  );
};

/**
 * Native (Linux) look: the actual artwork the GTK/icon theme ships for this
 * button. Symbolic icons come in `currentColor` and would be invisible as an
 * <img>, so those are painted as a CSS mask instead (`tint`).
 */
const NativeButton = ({ action, asset, metrics, onClick }) => {
  const label = useActionLabel(action);
  const iconStyle = { width: metrics.iconSize, height: metrics.iconSize };
  const layer = (src, className) =>
    asset.tint ? (
      <span
        aria-hidden="true"
        className={`absolute bg-current ${className}`}
        style={{
          ...iconStyle,
          maskImage: `url("${src}")`,
          WebkitMaskImage: `url("${src}")`,
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
        }}
      />
    ) : (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className={`absolute ${className}`}
        style={iconStyle}
      />
    );

  return (
      <button
        type="button"
        onClick={onClick}
        title={label.title}
        aria-label={label.aria}
        className="group relative flex h-full items-center justify-center text-muted-foreground"
        style={{ width: metrics.buttonSize }}
      >
        {layer(asset.normal, 'opacity-100 group-hover:opacity-0')}
        {layer(asset.hover, 'opacity-0 group-hover:opacity-100')}
      </button>
  );
};

const WindowControls = ({ actions, preset, assets, metrics, isMaximized }) => {
  if (actions.length === 0) {
    return null;
  }

  // Native buttons follow the detected theme metrics; the built-in presets keep
  // their own spacing (Windows cells are edge-to-edge, mac dots use gap-2/px-3).
  const spacing =
    preset === 'native'
      ? { gap: metrics.gap, paddingLeft: metrics.edgePadding, paddingRight: metrics.edgePadding }
      : null;

  return (
      <div
        className={`flex h-full items-center ${
          preset === 'windows' || spacing ? '' : 'gap-2 px-3'
        }`}
        style={{ WebkitAppRegion: 'no-drag', ...spacing }}
      >
        {actions.map((action) => {
          const onClick = () => triggerWindowAction(action);
          // The maximize button turns into "restore" while the window is maximized —
          // themes ship a separate asset for that state.
          const assetKey = action === 'maximize' && isMaximized ? 'unmaximize' : action;
          const asset = assets[assetKey] || assets[action];

          if (preset === 'native' && asset) {
            return (
              <NativeButton
                key={action}
                action={action}
                asset={asset}
                metrics={metrics}
                onClick={onClick}
              />
            );
          }
          if (preset === 'macos') {
            return <MacButton key={action} action={action} onClick={onClick} />;
          }
          return <WindowsButton key={action} action={action} onClick={onClick} />;
        })}
      </div>
  );
};

export const Titlebar = () => {
  const { t } = useTranslation('common');
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
  const [detection, setDetection] = useState(null);
  const [preference, setPreference] = useState(() => getWindowControlsStyle());
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => subscribeWindowControlsStyle(setPreference), []);

  const lastForcedDetection = useRef(0);

  const refreshDetection = useCallback((force) => {
    detectNativeWindowControls(force).then((result) => {
      if (result) setDetection(result);
    });
  }, []);

  useEffect(() => {
    if (!isElectron) {
      return undefined;
    }
    refreshDetection(false);

    // The desktop theme can change while the app runs, so re-detect on focus to
    // pick that up without a restart — but throttled: a forced detection spawns
    // gsettings and re-reads (and re-transfers) the theme assets, and focus
    // fires on every alt-tab.
    const onFocus = () => {
      const now = Date.now();
      if (now - lastForcedDetection.current < FORCED_DETECTION_INTERVAL_MS) {
        return;
      }
      lastForcedDetection.current = now;
      refreshDetection(true);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isElectron, refreshDetection]);

  useEffect(() => {
    if (!isElectron || typeof window.electronAPI?.isWindowMaximized !== 'function') {
      return undefined;
    }
    const read = () => {
      Promise.resolve(window.electronAPI.isWindowMaximized())
        .then(setIsMaximized)
        .catch(() => {});
    };
    // `resize` fires continuously while dragging a window edge; only the settled
    // state decides between the maximize and restore icon.
    let timer = null;
    const sync = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 150);
    };
    read();
    window.addEventListener('resize', sync);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', sync);
    };
  }, [isElectron]);

  const { preset, layout, assets, metrics } = useMemo(
    () => resolveWindowControls(preference, detection),
    [preference, detection],
  );

  if (!isElectron) {
    return null;
  }

  return (
      <div
        className="relative z-[130] flex h-8 select-none items-center border-b border-border/70 bg-card/90 backdrop-blur-md"
        style={{ WebkitAppRegion: 'drag' }}
      >
        <WindowControls
          actions={layout.left}
          preset={preset}
          assets={assets}
          metrics={metrics}
          isMaximized={isMaximized}
        />

        {/* `flex-1` instead of `justify-between` on the bar: with the buttons on
            one side only, the empty other side is not rendered at all and
            `justify-between` would push the title against the opposite edge. */}
        <div
          className={`flex min-w-0 flex-1 items-center gap-2 ${
            layout.left.length > 0 ? 'justify-center pr-3' : 'pl-3'
          }`}
        >
          <img src={appIcon} className="h-4 w-4 opacity-85" alt="logo" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            {t('appName')}
          </span>
        </div>

        <WindowControls
          actions={layout.right}
          preset={preset}
          assets={assets}
          metrics={metrics}
          isMaximized={isMaximized}
        />
      </div>
  );
};
