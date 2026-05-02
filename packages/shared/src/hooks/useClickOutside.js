import { useEffect, useRef } from 'react';

/**
 * Hook to detect clicks outside of a referenced element
 * @param {Function} onClickOutside - Callback when click outside occurs
 * @param {boolean} isActive - Whether the listener is active
 * @returns {React.RefObject} Ref to attach to the element
 */
export function useClickOutside(onClickOutside, isActive = true) {
  const ref = useRef(null);

  useEffect(() => {
    if (!isActive) return;

    const handleClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        onClickOutside?.();
      }
    };

    // Use capture phase to ensure we catch the click before it bubbles
    document.addEventListener('mousedown', handleClick, true);
    document.addEventListener('touchstart', handleClick, true);

    return () => {
      document.removeEventListener('mousedown', handleClick, true);
      document.removeEventListener('touchstart', handleClick, true);
    };
  }, [onClickOutside, isActive]);

  return ref;
}
