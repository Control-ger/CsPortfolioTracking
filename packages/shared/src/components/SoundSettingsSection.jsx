import { useCallback, useEffect, useState } from "react";

import { Switch } from "./ui/switch.jsx";
import { SettingsCard, SettingsCardHeader, SettingsRow } from "./ui/settings-card.jsx";
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

  const percent = Math.round(volume * 100);

  return (
    <SettingsCard id="settings-section-sounds">
      <SettingsCardHeader
        title="Sounds"
        description="Kurzes Klick-Feedback bei Aktionen und im Jahresrückblick. Die Töne werden im Browser erzeugt — es werden keine Audiodateien geladen."
      />
      <SettingsRow
        title="UI-Sounds"
        description="Gilt app-weit und bleibt über Neustarts erhalten."
        divider={false}
      >
        {/* The slider sits inline with the switch (design), but a 160px track
            needs the room — below `sm` it drops and the switch alone remains. */}
        <span className="hidden items-center gap-2 sm:flex">
          <input
            id="ui-sound-volume"
            type="range"
            min="0"
            max="100"
            step="5"
            value={percent}
            onChange={handleVolumeChange}
            disabled={!enabled}
            aria-label="Lautstärke"
            data-no-sound
            className="ui-range w-[160px] disabled:opacity-40"
            style={{
              background: `linear-gradient(to right, var(--foreground) ${percent}%, var(--surface-2) ${percent}%)`,
            }}
          />
          <span className="w-[34px] text-right text-[11px] tabular-nums text-muted-foreground">
            {percent} %
          </span>
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          aria-label="Sounds umschalten"
          data-no-sound
        />
      </SettingsRow>
    </SettingsCard>
  );
}
