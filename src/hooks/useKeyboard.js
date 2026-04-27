import { useEffect, useCallback } from 'react';
import { KEYBOARD } from '@/lib/constants';

/**
 * Hook to handle keyboard shortcuts
 * @param {Object} handlers - Object with key combinations and their handlers
 * @param {boolean} isActive - Whether keyboard listeners are active
 */
export function useKeyboard(handlers = {}, isActive = true) {
  const {
    onEscape,
    onArrowLeft,
    onArrowRight,
    onSearch,
    onEnter
  } = handlers;

  const handleKeyDown = useCallback((event) => {
    if (!isActive) return;

    // Handle Escape key
    if (event.key === KEYBOARD.ESCAPE && onEscape) {
      onEscape(event);
      return;
    }

    // Handle Arrow keys
    if (event.key === KEYBOARD.ARROW_LEFT && onArrowLeft) {
      onArrowLeft(event);
      return;
    }

    if (event.key === KEYBOARD.ARROW_RIGHT && onArrowRight) {
      onArrowRight(event);
      return;
    }

    // Handle Ctrl/Cmd + K for search
    if ((event.ctrlKey || event.metaKey) && event.key === KEYBOARD.K && onSearch) {
      event.preventDefault();
      onSearch(event);
      return;
    }

    // Handle Enter
    if (event.key === KEYBOARD.ENTER && onEnter) {
      onEnter(event);
      return;
    }
  }, [isActive, onEscape, onArrowLeft, onArrowRight, onSearch, onEnter]);

  useEffect(() => {
    if (!isActive) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, isActive]);
}

/**
 * Hook specifically for modal keyboard handling (ESC to close)
 * @param {Function} onClose - Callback when modal should close
 * @param {boolean} isOpen - Whether the modal is open
 */
export function useModalKeyboard(onClose, isOpen) {
  useKeyboard({
    onEscape: () => {
      if (isOpen) onClose?.();
    }
  }, isOpen);
}
