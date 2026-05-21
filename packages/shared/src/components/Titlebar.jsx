import React from 'react';
import appIcon from '/icon.ico?url';

export const Titlebar = () => {
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

  if (!isElectron) {
    return null;
  }

  return (
    <div
      className="flex h-8 select-none items-center justify-between border-b border-border/70 bg-card/90 backdrop-blur-md"
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
          className="px-4 text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground"
          aria-label="Fenster minimieren"
        >
          <span className="text-lg">-</span>
        </button>

        <button
          onClick={() => window.electronAPI?.maximize()}
          className="px-4 text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground"
          title="Maximieren"
          aria-label="Fenster maximieren"
        >
          <div className="h-3 w-3 rounded-[1px] border border-current" />
        </button>

        <button
          onClick={() => window.electronAPI?.close()}
          className="px-4 text-muted-foreground transition-colors hover:bg-red-500/80 hover:text-white"
          aria-label="Fenster schliessen"
        >
          <span className="text-xs">x</span>
        </button>
      </div>
    </div>
  );
};
