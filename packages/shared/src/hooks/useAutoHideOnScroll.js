import { useCallback, useEffect, useState } from "react";

const DEFAULT_THRESHOLD = 10;
const TOP_ZONE = 24;

/**
 * Hides a sticky header while the user scrolls down and brings it back on the
 * first upward scroll. Listens in the capture phase so it picks up whichever
 * element actually scrolls — the window on web, the shell column on desktop.
 *
 * `reveal()` brings the bar back immediately (used by the search shortcut).
 * While `disabled` is set the bar always stays visible; when it is released the
 * hidden state resets, so an open-then-cancel search never leaves it stuck.
 */
export const useAutoHideOnScroll = ({
  disabled = false,
  threshold = DEFAULT_THRESHOLD,
} = {}) => {
  const [hidden, setHidden] = useState(false);
  const [lastDisabled, setLastDisabled] = useState(disabled);

  // Render-time state adjustment (the documented React pattern): leaving the
  // disabled state always starts over from "visible".
  if (lastDisabled !== disabled) {
    setLastDisabled(disabled);
    setHidden(false);
  }

  const reveal = useCallback(() => {
    setHidden(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    if (disabled) {
      return undefined;
    }

    const lastOffsets = new WeakMap();
    let frame = 0;

    const readOffset = (source) =>
      source === document || source === window || source === document.documentElement
        ? window.scrollY || document.documentElement.scrollTop || 0
        : source.scrollTop;

    const evaluate = (source) => {
      const offset = readOffset(source);
      const previous = lastOffsets.get(source) ?? 0;
      const delta = offset - previous;
      if (Math.abs(delta) < threshold) {
        return;
      }
      lastOffsets.set(source, offset);
      if (offset <= TOP_ZONE) {
        setHidden(false);
        return;
      }
      if (delta > 0) {
        setHidden(true);
        return;
      }
      setHidden(false);
    };

    // Capture phase: scroll events do not bubble, so this is the only way to
    // observe whichever element actually scrolls (window, shell column, ...).
    const handleScroll = (event) => {
      const source = event.target === document ? document.documentElement : event.target;
      if (!source || typeof source.scrollTop !== "number") {
        return;
      }
      if (!lastOffsets.has(source)) {
        lastOffsets.set(source, readOffset(source));
        return;
      }
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        evaluate(source);
      });
    };

    document.addEventListener("scroll", handleScroll, { capture: true, passive: true });

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      document.removeEventListener("scroll", handleScroll, { capture: true });
    };
  }, [disabled, threshold]);

  return { hidden: disabled ? false : hidden, reveal };
};
