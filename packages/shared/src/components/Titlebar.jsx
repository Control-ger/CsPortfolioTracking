import React from 'react';
import appIcon from '/icon.ico?url';

export const Titlebar = () => {
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

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
        <button
          onClick={() => window.electronAPI?.minimize()}
          className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground"
          aria-label="Fenster minimieren"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>

        <button
          onClick={() => window.electronAPI?.maximize()}
          className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground"
          title="Maximieren"
          aria-label="Fenster maximieren"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>

        <button
          onClick={() => window.electronAPI?.close()}
          className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-red-500/80 hover:text-white"
          aria-label="Fenster schliessen"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1" />
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>
  );
};
