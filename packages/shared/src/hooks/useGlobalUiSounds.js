import { useEffect } from "react";

import { playUiSound, primeUiSounds } from "../lib/uiSounds.js";

/**
 * App-wide click feedback.
 *
 * Implemented as one delegated listener rather than a sound call in every
 * component: the app has dozens of interactive surfaces across three rail
 * copies, modals and settings sections, and touching each one would guarantee
 * both drift and missed spots.
 *
 * Opt out per element with `data-no-sound` (also honored on any ancestor) —
 * used for high-frequency controls like range sliders that play their own
 * feedback, or where a click sound would fire in bursts.
 *
 * Listener is passive and on the capture phase so it still observes clicks on
 * handlers that call stopPropagation().
 */
export function useGlobalUiSounds() {
  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const handlePointerDown = (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== "function") {
        return;
      }

      // Browsers keep the AudioContext suspended until a real user gesture;
      // this listener IS that gesture, so unlock before the first play.
      primeUiSounds();

      if (target.closest("[data-no-sound]")) {
        return;
      }

      const interactive = target.closest(
        'button, a[href], [role="button"], [role="switch"], [role="tab"], [role="menuitem"], summary',
      );
      if (!interactive || interactive.disabled || interactive.getAttribute("aria-disabled") === "true") {
        return;
      }

      playUiSound("click");
    };

    document.addEventListener("pointerdown", handlePointerDown, { capture: true, passive: true });
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  }, []);
}
