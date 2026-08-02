import { useCallback, useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.jsx";
import {
  getUiSoundVolume,
  isUiSoundsEnabled,
  playUiSound,
  primeUiSounds,
  setUiSoundVolume,
  setUiSoundsEnabled,
  subscribeUiSounds,
} from "../lib/uiSounds.js";

export function SoundSettingsSection() {
  const [enabled, setEnabled] = useState(() => isUiSoundsEnabled());
  const [volume, setVolume] = useState(() => getUiSoundVolume());

  // The setting is global and can also be flipped from the Year Wrapped story,
  // so mirror the module state instead of owning it here.
  useEffect(
    () =>
      subscribeUiSounds((snapshot) => {
        setEnabled(snapshot.enabled);
        setVolume(snapshot.volume);
      }),
    [],
  );

  const handleToggle = useCallback(() => {
    const next = !isUiSoundsEnabled();
    setUiSoundsEnabled(next);
    if (next) {
      // Must run from this click: browsers keep the AudioContext suspended
      // until a real user gesture unlocks it.
      primeUiSounds();
      playUiSound("success");
    }
  }, []);

  const handleVolumeChange = useCallback((event) => {
    const next = Number(event.target.value) / 100;
    setUiSoundVolume(next);
    primeUiSounds();
    playUiSound("click");
  }, []);

  return (
    <Card id="settings-section-sounds">
      <CardHeader>
        <CardTitle>Sounds</CardTitle>
        <CardDescription>
          Kurze Toene bei Aktionen und im Jahresrueckblick. Die Toene werden im Browser erzeugt —
          es werden keine Audiodateien geladen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-transparent p-3 dark:border-border/70 dark:bg-card/65">
          <div className="flex min-w-0 items-center gap-3">
            {enabled ? (
              <Volume2 className="h-5 w-5 shrink-0 text-primary" />
            ) : (
              <VolumeX className="h-5 w-5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                Sounds {enabled ? "aktiv" : "aus"}
              </p>
              <p className="text-xs text-muted-foreground">
                Gilt app-weit und bleibt ueber Neustarts erhalten.
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Sounds umschalten"
            data-no-sound
            onClick={handleToggle}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              enabled ? "bg-primary" : "bg-muted-foreground/35"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-background transition-transform ${
                enabled ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        <div className="rounded-lg border border-border bg-transparent p-3 dark:border-border/70 dark:bg-card/65">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="ui-sound-volume" className="text-sm text-foreground">
              Lautstaerke
            </label>
            <span className="text-xs tabular-nums text-muted-foreground">
              {Math.round(volume * 100)} %
            </span>
          </div>
          <input
            id="ui-sound-volume"
            type="range"
            min="0"
            max="100"
            step="5"
            value={Math.round(volume * 100)}
            onChange={handleVolumeChange}
            disabled={!enabled}
            className="ui-range mt-3 w-full disabled:opacity-40"
            style={{
              background: `linear-gradient(to right, var(--primary) ${Math.round(volume * 100)}%, var(--muted) ${Math.round(volume * 100)}%)`,
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
