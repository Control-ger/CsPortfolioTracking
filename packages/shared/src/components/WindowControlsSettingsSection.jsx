import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.jsx";
import {
  detectNativeWindowControls,
  getWindowControlsStyle,
  resolveWindowControls,
  setWindowControlsStyle,
  subscribeWindowControlsStyle,
} from "../lib/windowControls.js";

const SOURCE_LABELS = {
  "gtk-theme": "GTK-Theme",
  "icon-theme": "Icon-Theme",
  platform: "Betriebssystem",
  fallback: "keine Theme-Icons gefunden",
};

/** Desktop only — the web build has no custom titlebar to style. */
export function WindowControlsSettingsSection() {
  const [style, setStyle] = useState(() => getWindowControlsStyle());
  const [detection, setDetection] = useState(null);
  // Starts true: the first detection is kicked off by the mount effect below,
  // which must not flip state synchronously.
  const [detecting, setDetecting] = useState(true);

  useEffect(() => subscribeWindowControlsStyle(setStyle), []);

  const applyDetection = useCallback(
    (force) =>
      detectNativeWindowControls(force)
        .then(setDetection)
        .finally(() => setDetecting(false)),
    [],
  );

  useEffect(() => {
    applyDetection(false);
  }, [applyDetection]);

  const handleRedetect = useCallback(() => {
    setDetecting(true);
    applyDetection(true);
  }, [applyDetection]);

  const resolved = resolveWindowControls(style, detection);
  const detectedThemeLabel = detection
    ? `${SOURCE_LABELS[detection.source] || detection.source}${
        detection.themeName ? `: ${detection.themeName}` : ""
      }`
    : "wird ermittelt …";

  const options = [
    {
      value: "auto",
      label: "Automatisch",
      hint: detection?.assets?.close
        ? "Icons aus deinem Desktop-Theme"
        : "Passt sich dem Betriebssystem an",
    },
    { value: "windows", label: "Windows", hint: "Striche rechts, roter Schließen-Button" },
    { value: "macos", label: "macOS", hint: "Farbige Punkte links" },
  ];

  return (
    <Card id="settings-section-window-controls">
      <CardHeader>
        <CardTitle>Fenster-Buttons</CardTitle>
        <CardDescription>
          Die App zeichnet ihre Titelleiste selbst. Automatisch uebernimmt sie unter Linux
          Position und Icons deines Desktop-Themes — auch eigene Theme-Icons.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setWindowControlsStyle(option.value)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                style === option.value
                  ? "border-primary/40 bg-primary/12"
                  : "border-border bg-transparent hover:bg-accent/55 dark:border-border/75 dark:bg-card/65"
              }`}
            >
              <p className="text-sm font-semibold text-foreground">{option.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{option.hint}</p>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-transparent p-3 dark:border-border/70 dark:bg-card/65">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              Erkannt: <span className="font-semibold text-foreground">{detectedThemeLabel}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Aktive Darstellung:{" "}
              <span className="font-semibold text-foreground">
                {resolved.preset === "native" ? "Theme-Icons" : resolved.preset}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleRedetect}
            disabled={detecting}
            className="flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-accent/55 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${detecting ? "animate-spin" : ""}`} />
            Neu erkennen
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
