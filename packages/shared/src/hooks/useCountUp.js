import { useEffect, useRef, useState } from "react";

import { playUiSound } from "../lib/uiSounds.js";

const DEFAULT_DURATION_MS = 1400;
const TICK_SOUND_INTERVAL_MS = 90;

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// easeOutExpo — fast start, long settle. Reads as "counting up and landing"
// rather than a linear scroll, which is what makes the Wrapped-style reveal work.
function easeOutExpo(t) {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/**
 * Animate a number from 0 to `target`.
 *
 * Returns the current value. Honors `prefers-reduced-motion` by jumping
 * straight to the target — the same escape hatch the slide animations use.
 *
 * `active` gates the run so a counter only animates once its slide is on
 * screen; without it every counter in the story would burn through its
 * animation while hidden and appear already finished.
 */
export function useCountUp(target, { active = true, duration = DEFAULT_DURATION_MS, sound = false } = {}) {
  const numericTarget = Number.isFinite(Number(target)) ? Number(target) : 0;

  // Whether this instance will animate at all is decided once, at mount, from
  // values that cannot change without the component remounting (slides are
  // keyed, so every slide change gives each counter a fresh mount). Deciding it
  // here rather than in the effect keeps the initial render already correct and
  // avoids setting state from inside the effect body.
  const willAnimate =
    active && numericTarget !== 0 && duration > 0 && !prefersReducedMotion();

  const [value, setValue] = useState(willAnimate ? 0 : numericTarget);
  const frameRef = useRef(0);
  const lastTickSoundRef = useRef(0);

  useEffect(() => {
    if (!willAnimate) {
      return undefined;
    }

    const startedAt = performance.now();
    lastTickSoundRef.current = startedAt;

    const step = (now) => {
      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / duration);
      const eased = easeOutExpo(progress);
      setValue(numericTarget * eased);

      if (sound && progress < 1 && now - lastTickSoundRef.current >= TICK_SOUND_INTERVAL_MS) {
        lastTickSoundRef.current = now;
        playUiSound("tick");
      }

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
        return;
      }

      setValue(numericTarget);
      if (sound) {
        playUiSound("countDone");
      }
    };

    frameRef.current = requestAnimationFrame(step);

    // Safety net: requestAnimationFrame does not run while the document is
    // hidden or the window is occluded. Without this the counter would sit at
    // its start value and display 0 — not a missing animation but a wrong
    // number. setTimeout is throttled in background documents but still fires,
    // so the true value always lands.
    const settleId = window.setTimeout(() => {
      cancelAnimationFrame(frameRef.current);
      setValue(numericTarget);
    }, duration + 500);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.clearTimeout(settleId);
    };
  }, [numericTarget, willAnimate, duration, sound]);

  return value;
}
