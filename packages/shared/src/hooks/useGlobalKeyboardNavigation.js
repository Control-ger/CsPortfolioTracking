import { useEffect } from "react";

const KEYBOARD_SCOPE_SELECTOR = '[data-keyboard-scope], [role="dialog"][aria-modal="true"]';
const DEFAULT_ACTION_SELECTOR = '[data-keyboard-default]:not([disabled]):not([aria-disabled="true"])';
const CANCEL_ACTION_SELECTOR = '[data-keyboard-cancel]:not([disabled]):not([aria-disabled="true"])';
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  '[contenteditable=""]',
].join(",");
const NATIVE_INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[contenteditable="true"]',
  '[contenteditable=""]',
].join(",");

function isElement(value) {
  return value instanceof Element;
}

function isVisible(element) {
  if (!isElement(element)) {
    return false;
  }
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

function isDisabled(element) {
  return Boolean(
    element.disabled ||
      element.getAttribute("aria-disabled") === "true" ||
      element.closest("[inert]") ||
      element.closest("[aria-hidden='true']"),
  );
}

function isUsable(element) {
  return isElement(element) && isVisible(element) && !isDisabled(element);
}

function getRoot(scope) {
  return scope === document ? document : scope;
}

function queryUsable(scope, selector) {
  const root = getRoot(scope);
  return Array.from(root.querySelectorAll(selector)).filter(isUsable);
}

function getActiveKeyboardScope() {
  const scopes = queryUsable(document, KEYBOARD_SCOPE_SELECTOR);
  return scopes.length > 0 ? scopes[scopes.length - 1] : document;
}

function isInsideScope(element, scope) {
  if (!isElement(element)) {
    return false;
  }
  return scope === document ? document.contains(element) : scope.contains(element);
}

function getFocusableElements(scope) {
  return queryUsable(scope, FOCUSABLE_SELECTOR).filter((element) => element.tabIndex >= 0);
}

function focusElement(element) {
  if (!isElement(element)) {
    return;
  }
  element.focus({ preventScroll: true });
}

function shouldPreserveNativeEnter(target) {
  if (!isElement(target)) {
    return false;
  }
  return Boolean(target.closest(NATIVE_INTERACTIVE_SELECTOR));
}

function handleTab(event) {
  const scope = getActiveKeyboardScope();
  const focusables = getFocusableElements(scope);

  if (focusables.length === 0) {
    event.preventDefault();
    return;
  }

  const activeElement = document.activeElement;
  const hasActiveElementInScope = isInsideScope(activeElement, scope);

  if (!hasActiveElementInScope || activeElement === document.body) {
    event.preventDefault();
    focusElement(event.shiftKey ? focusables[focusables.length - 1] : focusables[0]);
    return;
  }

  if (scope === document) {
    return;
  }

  const firstElement = focusables[0];
  const lastElement = focusables[focusables.length - 1];

  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault();
    focusElement(lastElement);
    return;
  }

  if (!event.shiftKey && activeElement === lastElement) {
    event.preventDefault();
    focusElement(firstElement);
  }
}

function clickAction(element) {
  if (!isUsable(element)) {
    return false;
  }
  focusElement(element);
  element.click();
  return true;
}

export function useGlobalKeyboardNavigation(isActive = true) {
  useEffect(() => {
    if (!isActive || typeof window === "undefined" || typeof document === "undefined") {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (event.key === "Tab") {
        handleTab(event);
        return;
      }

      if (event.key === "Escape") {
        const scope = getActiveKeyboardScope();
        const cancelAction = queryUsable(scope, CANCEL_ACTION_SELECTOR)[0];
        if (cancelAction && clickAction(cancelAction)) {
          event.preventDefault();
        }
        return;
      }

      if (event.key === "Enter") {
        if (shouldPreserveNativeEnter(event.target)) {
          return;
        }
        const scope = getActiveKeyboardScope();
        const defaultAction = queryUsable(scope, DEFAULT_ACTION_SELECTOR)[0];
        if (defaultAction && clickAction(defaultAction)) {
          event.preventDefault();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isActive]);
}
