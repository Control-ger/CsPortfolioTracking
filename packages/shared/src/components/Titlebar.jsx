import React from 'react';
import appIcon from '/icon.ico?url';

export const Titlebar = () => {
    // Prüfen, ob wir in Electron sind
    const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

    // Wenn nicht in Electron (also im Browser), gar nichts rendern
    if (!isElectron) return null;

    return (
        <div
            className="flex justify-between items-center h-8 bg-zinc-950 border-b border-white/5 select-none"
            style={{ WebkitAppRegion: 'drag' }}
        >
            {/* Linke Seite: Logo & Name */}
            <div className="flex items-center gap-2 pl-3">
                <img src={appIcon} className="w-4 h-4 opacity-80" alt="logo" />
                <span className="text-[10px] uppercase tracking-[0.2em] opacity-40 font-bold">
          CS Portfolio Tracking
        </span>
            </div>

            {/* Rechte Seite: Fenster-Steuerung */}
            <div className="flex h-full" style={{ WebkitAppRegion: 'no-drag' }}>
                {/* Minimieren */}
                <button
                    onClick={() => window.electronAPI?.minimize()}
                    className="px-4 hover:bg-white/5 transition-colors text-zinc-400"
                >
                    <span className="text-lg">−</span>
                </button>

                {/* Maximieren / Wiederherstellen */}
                <button
                    onClick={() => window.electronAPI?.maximize()}
                    className="px-4 hover:bg-white/5 transition-colors text-zinc-400"
                    title="Maximieren"
                >
                    <div className="w-3 h-3 border border-zinc-400 rounded-[1px]" />
                </button>

                {/* Schließen */}
                <button
                    onClick={() => window.electronAPI?.close()}
                    className="px-4 hover:bg-red-500/80 hover:text-white transition-colors text-zinc-400"
                >
                    <span className="text-xs">✕</span>
                </button>
            </div>
        </div>
    );
};