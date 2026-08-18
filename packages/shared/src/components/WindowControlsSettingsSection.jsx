import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";

import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
  SettingsNote,
  SettingsTile,
} from "./ui/settings-card.jsx";
import {
  detectNativeWindowControls,
  getWindowControlsStyle,
  resolveWindowControls,
  setWindowControlsStyle,
  subscribeWindowControlsStyle,
} from "../lib/windowControls.js";

const SOURCE_LABEL_KEYS = {
  "gtk-theme": "windowControls.gtkTheme",
  "icon-theme": "windowControls.iconTheme",
  platform: "windowControls.operatingSystem",
  fallback: "windowControls.noThemeIcons",
};

/** Desktop only — the web build has no custom titlebar to style. */
export function WindowControlsSettingsSection() {
  const { t } = useTranslation("settings");
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
    ? `${
        SOURCE_LABEL_KEYS[detection.source]
          ? t(SOURCE_LABEL_KEYS[detection.source])
          : detection.source
      }${detection.themeName ? `: ${detection.themeName}` : ""}`
    : t("windowControls.detecting");

  const options = [
    {
      value: "auto",
      label: t("windowControls.automatic"),
      hint: detection?.assets?.close
        ? t("windowControls.automaticHint")
        : t("windowControls.systemHint"),
    },
    { value: "windows", label: "Windows", hint: t("windowControls.windowsHint") },
    { value: "macos", label: "macOS", hint: t("windowControls.macosHint") },
  ];

  return (
    <SettingsCard id="settings-section-window-controls">
      <SettingsCardHeader
        title={t("windowControls.title")}
        description={t("windowControls.description")}
      />
      <SettingsCardBody className="flex flex-col gap-3">
        <div className="grid gap-2.5 sm:grid-cols-3">
          {options.map((option) => (
            <SettingsTile
              key={option.value}
              active={style === option.value}
              label={option.label}
              hint={option.hint}
              onClick={() => setWindowControlsStyle(option.value)}
            />
          ))}
        </div>

        <SettingsNote>
          <span className="flex min-w-0 flex-col gap-[3px]">
            <span>
              {t("windowControls.detected")}{" "}
              <span className="font-bold text-foreground">{detectedThemeLabel}</span>
            </span>
            <span>
              {t("windowControls.activePresentation")}{" "}
              <span className="font-bold text-foreground">
                {resolved.preset === "native" ? t("windowControls.themeIcons") : resolved.preset}
              </span>
            </span>
          </span>
          <button
            type="button"
            onClick={handleRedetect}
            disabled={detecting}
            className="inline-flex h-8 shrink-0 items-center gap-[7px] rounded-[9px] border border-border-strong px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <RefreshCw className={`size-[13px] ${detecting ? "animate-spin" : ""}`} />
            {t("windowControls.redetect")}
          </button>
        </SettingsNote>
      </SettingsCardBody>
    </SettingsCard>
  );
}
