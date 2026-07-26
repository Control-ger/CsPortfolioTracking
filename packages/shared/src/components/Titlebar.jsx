import React, { useState, useEffect } from 'react';
import appIcon from '/icon.ico?url';

const WindowControlIcons = ({ platform }) => {
  const isWindows = platform === 'win32';
  const isMac = platform === 'darwin';
  const isLinux = platform === 'linux';

  if (isWindows) {
    return (
      <>
        <button
          onClick={() => window.electronAPI?.minimize()}
          className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/50"
          title="Minimieren"
          aria-label="Fenster minimieren"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <line x1="0" y1="8" x2="10" y2="8" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <button
          onClick={() => window.electronAPI?.maximize()}
          className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/50"
          title="Maximieren"
          aria-label="Fenster maximieren"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          onClick={() => window.electronAPI?.close()}
          className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-red-500 hover:text-white"
          title="Schließen"
          aria-label="Fenster schließen"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <line x1="2.5" y1="2.5" x2="7.5" y2="7.5" stroke="currentColor" strokeWidth="1.5" />
            <line x1="7.5" y1="2.5" x2="2.5" y2="7.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </>
    );
  }

  if (isMac) {
    return (
      <>
        <button
          onClick={() => window.electronAPI?.close()}
          className="flex h-full w-12 items-center justify-center text-red-500 transition-colors hover:text-red-600"
          title="Schließen"
          aria-label="Fenster schließen"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <circle cx="6" cy="6" r="5.5" stroke="currentColor" strokeWidth="1" fill="none" />
            <line x1="3.5" y1="6" x2="8.5" y2="6" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <button
          onClick={() => window.electronAPI?.minimize()}
          className="flex h-full w-12 items-center justify-center text-yellow-500 transition-colors hover:text-yellow-600"
          title="Minimieren"
          aria-label="Fenster minimieren"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <circle cx="6" cy="6" r="5.5" stroke="currentColor" strokeWidth="1" fill="none" />
            <line x1="3.5" y1="6" x2="8.5" y2="6" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <button
          onClick={() => window.electronAPI?.maximize()}
          className="flex h-full w-12 items-center justify-center text-green-500 transition-colors hover:text-green-600"
          title="Maximieren"
          aria-label="Fenster maximieren"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <circle cx="6" cy="6" r="5.5" stroke="currentColor" strokeWidth="1" fill="none" />
            <line x1="3.5" y1="6" x2="8.5" y2="6" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => window.electronAPI?.minimize()}
        className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/50"
        title="Minimieren"
        aria-label="Fenster minimieren"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <line x1="0" y1="8" x2="10" y2="8" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <button
        onClick={() => window.electronAPI?.maximize()}
        className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/50"
        title="Maximieren"
        aria-label="Fenster maximieren"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        onClick={() => window.electronAPI?.close()}
        className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-red-500 hover:text-white"
        title="Schließen"
        aria-label="Fenster schließen"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <line x1="2.5" y1="2.5" x2="7.5" y2="7.5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="7.5" y1="2.5" x2="2.5" y2="7.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
    </>
  );
};

export const Titlebar = () => {
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
  const [platform, setPlatform] = useState(null);

  useEffect(() => {
    if (isElectron && window.electronAPI?.platform) {
      setPlatform(window.electronAPI.platform());
    }
  }, [isElectron]);

  if (!isElectron) {
    return null;
  }

  return (
    <div
      className="relative z-[130] flex h-8 select-none items-center justify-between border-b border-border/70 bg-card/90 backdrop-blur-md"
      style={{ WebkitAppRegion: 'drag' }}
    >
      <div className="flex items-center gap-2 pl-3">
        <img src={appIcon} className="h-4 w-4 opacity-85" alt="logo" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          CS Portfolio Tracking
        </span>
      </div>

      <div className="flex h-full" style={{ WebkitAppRegion: 'no-drag' }}>
        {platform && <WindowControlIcons platform={platform} />}
      </div>
    </div>
  );
};
