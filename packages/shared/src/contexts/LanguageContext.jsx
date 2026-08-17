/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  changeLanguage as applyLanguage,
  getActiveLanguage,
  i18next,
  initI18n,
  normalizeLanguage,
  persistLanguage,
  resolveInitialLanguage,
  resolveIntlLocale,
} from "@shared/lib/i18n/index.js";

const LanguageContext = createContext(null);

/**
 * Init runs at module load, not inside the provider: the pure formatters
 * (`getActiveIntlLocale`) are called from module-level helpers that can run
 * before the first render, and they must not observe an uninitialised i18next.
 */
void initI18n();

function buildLanguageCatalog(activeLanguage) {
  const locale = resolveIntlLocale(activeLanguage);

  return SUPPORTED_LANGUAGES.map((code) => {
    let label = code.toUpperCase();
    try {
      const displayNames = new Intl.DisplayNames([locale], { type: "language" });
      label = displayNames.of(code) || label;
    } catch {
      // Intl.DisplayNames is unavailable on some older runtimes; the code is a
      // usable label on its own.
    }

    let nativeLabel = label;
    try {
      const nativeNames = new Intl.DisplayNames([resolveIntlLocale(code)], { type: "language" });
      nativeLabel = nativeNames.of(code) || label;
    } catch {
      nativeLabel = label;
    }

    return { code, label, nativeLabel };
  });
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => resolveInitialLanguage());

  useEffect(() => {
    // i18next is the authority once it has initialised — it may have resolved a
    // different language than our optimistic first guess (e.g. an unsupported
    // stored value that fell back).
    const syncFromI18next = () => setLanguageState(getActiveLanguage());

    void initI18n().then(syncFromI18next);
    i18next.on("languageChanged", syncFromI18next);
    return () => {
      i18next.off("languageChanged", syncFromI18next);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    // `index.html` ships a static `lang="de"`; without this the document lies
    // about its language to screen readers and to the browser's own hyphenation
    // and spellcheck.
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback(async (nextLanguage) => {
    const normalized = normalizeLanguage(nextLanguage);
    if (!normalized) {
      return;
    }

    // Persist before awaiting: a reload mid-switch should come back in the
    // language the user picked, not the one they left.
    persistLanguage(normalized);
    setLanguageState(normalized);
    await applyLanguage(normalized);
  }, []);

  const value = useMemo(() => ({
    language,
    languages: buildLanguageCatalog(language),
    locale: resolveIntlLocale(language),
    setLanguage,
    defaultLanguage: DEFAULT_LANGUAGE,
  }), [language, setLanguage]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}
