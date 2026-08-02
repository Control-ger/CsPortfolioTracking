import { useCallback, useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.jsx";
import { Label } from "./ui/label.jsx";
import { Slider } from "./ui/slider.jsx";
import { Switch } from "./ui/switch.jsx";
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

  const handleVolumeChange = useCallback(([percent]) => {
    setUiSoundVolume(percent / 100);
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
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            aria-label="Sounds umschalten"
            data-no-sound
            className="shrink-0"
          />
        </div>

        <div className="rounded-lg border border-border bg-transparent p-3 dark:border-border/70 dark:bg-card/65">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="ui-sound-volume">Lautstaerke</Label>
            <span className="text-xs tabular-nums text-muted-foreground">
              {Math.round(volume * 100)} %
            </span>
          </div>
          <Slider
            id="ui-sound-volume"
            min={0}
            max={100}
            step={5}
            value={[Math.round(volume * 100)]}
            onValueChange={handleVolumeChange}
            disabled={!enabled}
            aria-label="Lautstaerke"
            className="mt-3"
          />
        </div>
      </CardContent>
    </Card>
  );
}
