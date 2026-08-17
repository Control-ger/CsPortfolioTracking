/**
 * Single source of truth for what "language" means in this app.
 *
 * Deliberately free of React and of i18next, so the pure formatting helpers
 * (portfolioHelpers, PortfolioChart tick formatters, CurrencyContext) can share
 * it without pulling a provider into a module-level function.
 */

export const SUPPORTED_LANGUAGES = Object.freeze(["en", "de"]);

/**
 * English is the source language: the UI text is authored here first and German
 * is a translation of it. A missing German key therefore falls back to a
 * complete English string rather than to a raw key.
 */
export const DEFAULT_LANGUAGE = "en";

export const LANGUAGE_STORAGE_KEY = "preferred_language";

/**
 * Namespaces mirror the app's surfaces (see docs/architecture-overview.md §5),
 * so a catalogue file maps onto one screen and can be reviewed as a unit.
 */
export const I18N_NAMESPACES = Object.freeze([
  "common",
  "dashboard",
  "inventory",
  "watchlist",
  "search",
  "settings",
  "updates",
  "wrapped",
]);

export const DEFAULT_NAMESPACE = "common";

/**
 * Region fallback per language. Only used when the browser gives us nothing
 * usable — a `de` user on a `de-AT` system keeps Austrian formatting.
 */
const FALLBACK_REGIONAL_LOCALE = Object.freeze({
  en: "en-US",
  de: "de-DE",
});

export function normalizeLanguage(value) {
  const base = String(value || "")
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES.includes(base) ? base : "";
}

function readNavigatorLanguages() {
  if (typeof navigator === "undefined") {
    return [];
  }
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages;
  }
  return typeof navigator.language === "string" ? [navigator.language] : [];
}

export function detectNavigatorLanguage() {
  for (const candidate of readNavigatorLanguages()) {
    const normalized = normalizeLanguage(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

export function readStoredLanguage() {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function persistLanguage(language) {
  const normalized = normalizeLanguage(language);
  if (!normalized || typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
  } catch {
    // Private-mode / quota failures must not break a language switch.
  }
}

export function resolveInitialLanguage() {
  return readStoredLanguage() || detectNavigatorLanguage() || DEFAULT_LANGUAGE;
}

/**
 * The BCP-47 tag handed to `Intl.*`. Keeps the user's own region when it agrees
 * with the chosen UI language (en-GB dates for a British user reading English),
 * and falls back to the language's default region otherwise.
 *
 * This is what makes formatting follow the *UI language* instead of the OS —
 * before this existed, dates were hardcoded `de-DE` while currency followed
 * `navigator.language`, so an English user saw English numbers next to German
 * dates.
 */
export function resolveIntlLocale(language) {
  const normalized = normalizeLanguage(language) || DEFAULT_LANGUAGE;

  for (const candidate of readNavigatorLanguages()) {
    if (normalizeLanguage(candidate) === normalized && String(candidate).includes("-")) {
      return candidate;
    }
  }

  return FALLBACK_REGIONAL_LOCALE[normalized] || normalized;
}
