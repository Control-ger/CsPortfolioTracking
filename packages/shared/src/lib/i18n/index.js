import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import {
  DEFAULT_LANGUAGE,
  DEFAULT_NAMESPACE,
  I18N_NAMESPACES,
  SUPPORTED_LANGUAGES,
  normalizeLanguage,
  resolveInitialLanguage,
  resolveIntlLocale,
} from "./config.js";

export {
  DEFAULT_LANGUAGE,
  DEFAULT_NAMESPACE,
  I18N_NAMESPACES,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  detectNavigatorLanguage,
  normalizeLanguage,
  persistLanguage,
  readStoredLanguage,
  resolveInitialLanguage,
  resolveIntlLocale,
} from "./config.js";

/**
 * Catalogues are bundled, never fetched. The desktop runtime loads the app from
 * `file://` and must work with no network at all, so an HTTP i18next backend is
 * not an option here.
 */
const localeModules = import.meta.glob("./locales/*/*.json", { eager: true });

function buildResources() {
  const resources = {};

  for (const [path, module] of Object.entries(localeModules)) {
    const match = /\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (!match) {
      continue;
    }

    const [, language, namespace] = match;
    if (!SUPPORTED_LANGUAGES.includes(language) || !I18N_NAMESPACES.includes(namespace)) {
      continue;
    }

    resources[language] = resources[language] || {};
    resources[language][namespace] = module?.default || module || {};
  }

  return resources;
}

let initPromise = null;

export function initI18n() {
  if (initPromise) {
    return initPromise;
  }

  initPromise = i18next
    .use(initReactI18next)
    .init({
      resources: buildResources(),
      lng: resolveInitialLanguage(),
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: [...SUPPORTED_LANGUAGES],
      ns: [...I18N_NAMESPACES],
      defaultNS: DEFAULT_NAMESPACE,
      // Keys are semantic paths (`dashboard.kpi.totalRoi`), so `.` must stay a
      // separator; `:` is the namespace separator. Both are i18next defaults and
      // are spelled out here because the key style depends on them.
      keySeparator: ".",
      nsSeparator: ":",
      interpolation: {
        // React escapes for us; double-escaping would print `&amp;` in labels.
        escapeValue: false,
      },
      returnEmptyString: false,
      react: {
        useSuspense: false,
      },
    });

  return initPromise;
}

export function getActiveLanguage() {
  return normalizeLanguage(i18next.resolvedLanguage || i18next.language) || DEFAULT_LANGUAGE;
}

/**
 * The BCP-47 tag every `Intl.*` call in the app must use. Reading it off
 * i18next rather than off a React context is deliberate: most of the date and
 * sort formatters are module-level pure functions, and threading a provider
 * through them would have meant rewriting their call sites instead of their
 * bodies.
 */
export function getActiveIntlLocale() {
  return resolveIntlLocale(getActiveLanguage());
}

/**
 * Translation for module-level pure functions that have no React context to
 * read from — the same escape hatch, and the same rationale, as
 * `getActiveIntlLocale`. Components must use `useTranslation` instead: this
 * does not subscribe, so a caller that only uses `translate` will not re-render
 * on a language switch.
 *
 * Keys must be namespace-qualified (`"common:units.hoursShort"`).
 */
export function translate(key, options) {
  return i18next.t(key, options);
}

export async function changeLanguage(language) {
  const normalized = normalizeLanguage(language);
  if (!normalized) {
    return getActiveLanguage();
  }
  await i18next.changeLanguage(normalized);
  return normalized;
}

export { i18next };
export default i18next;
