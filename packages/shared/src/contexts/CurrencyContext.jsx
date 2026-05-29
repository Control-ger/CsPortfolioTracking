/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { fetchExchangeRate, fetchCurrencyPreference, updateCurrencyPreference } from "@shared/lib/apiClient.js";

const STORAGE_KEY = "preferred_currency";
const DEFAULT_CURRENCY = "EUR";
const FALLBACK_EXCHANGE_RATES = {
  EUR: 1,
  USD: 1.08,
  GBP: 0.85,
};
const CURRENCY_REGION_OVERRIDES = {
  EUR: "EU",
  USD: "US",
  GBP: "GB",
  XAF: "CM",
  XCD: "AG",
  XOF: "SN",
  XPF: "PF",
};

const CurrencyContext = createContext(null);

function isValidCurrencyCode(value) {
  return /^[A-Z]{3}$/.test(String(value || "").toUpperCase());
}

function normalizeCurrencyCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return isValidCurrencyCode(normalized) ? normalized : "";
}

function getLocale() {
  if (typeof navigator !== "undefined" && typeof navigator.language === "string" && navigator.language.trim() !== "") {
    return navigator.language;
  }
  return "en-US";
}

function getCurrencySymbolVariant(code, currencyDisplay) {
  try {
    const parts = new Intl.NumberFormat(getLocale(), {
      style: "currency",
      currency: code,
      currencyDisplay,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).formatToParts(0);
    const symbolPart = parts.find((part) => part.type === "currency");
    return String(symbolPart?.value || "").trim();
  } catch {
    return "";
  }
}

function isSymbolEffectivelyCode(symbol, code) {
  if (!symbol) {
    return true;
  }

  const normalizedSymbol = String(symbol).trim().toUpperCase();
  if (normalizedSymbol === code) {
    return true;
  }

  return /^[A-Z]{3}$/.test(normalizedSymbol);
}

function getCurrencySymbol(code) {
  const narrow = getCurrencySymbolVariant(code, "narrowSymbol");
  if (!isSymbolEffectivelyCode(narrow, code)) {
    return narrow;
  }

  const generic = getCurrencySymbolVariant(code, "symbol");
  if (!isSymbolEffectivelyCode(generic, code)) {
    return generic;
  }

  return "";
}

function getCurrencyName(code) {
  try {
    const displayNames = new Intl.DisplayNames([getLocale()], { type: "currency" });
    return displayNames.of(code) || code;
  } catch {
    return code;
  }
}

function inferRegionCode(code) {
  const override = CURRENCY_REGION_OVERRIDES[code];
  if (override) {
    return override;
  }

  if (code.startsWith("X")) {
    return null;
  }

  const region = code.slice(0, 2);
  return /^[A-Z]{2}$/.test(region) ? region : null;
}

function regionToFlagEmoji(regionCode) {
  if (!regionCode || !/^[A-Z]{2}$/.test(regionCode)) {
    return "🌍";
  }

  const chars = [...regionCode].map((char) => 0x1F1E6 + (char.charCodeAt(0) - 65));
  return String.fromCodePoint(...chars);
}

function getRegionName(regionCode) {
  if (!regionCode || !/^[A-Z]{2}$/.test(regionCode)) {
    return null;
  }

  try {
    const displayNames = new Intl.DisplayNames([getLocale()], { type: "region" });
    return displayNames.of(regionCode) || null;
  } catch {
    return null;
  }
}

function normalizeRates(rawRates) {
  const normalized = {};
  if (!rawRates || typeof rawRates !== "object") {
    return { ...FALLBACK_EXCHANGE_RATES };
  }

  Object.entries(rawRates).forEach(([currencyCode, value]) => {
    const code = String(currencyCode || "").trim().toUpperCase();
    const rate = Number(value);
    if (!isValidCurrencyCode(code) || !Number.isFinite(rate) || rate <= 0) {
      return;
    }
    normalized[code] = rate;
  });

  if (Object.keys(normalized).length === 0) {
    return { ...FALLBACK_EXCHANGE_RATES };
  }

  normalized.EUR = 1;
  return normalized;
}

function normalizePopularCurrencies(rawPopularCurrencies) {
  if (!Array.isArray(rawPopularCurrencies)) {
    return [];
  }

  const seenCodes = new Set();
  const normalizedEntries = [];
  rawPopularCurrencies.forEach((entry) => {
    const code = normalizeCurrencyCode(entry?.currency || entry?.code);
    if (!code || seenCodes.has(code)) {
      return;
    }
    seenCodes.add(code);
    normalizedEntries.push({
      currency: code,
      activeUsers: Math.max(0, Number(entry?.activeUsers || 0)),
      selectionEvents: Math.max(0, Number(entry?.selectionEvents || 0)),
      lastSelectedAt: entry?.lastSelectedAt || null,
    });
  });

  return normalizedEntries;
}

function buildCurrencyCatalog(rates) {
  const codes = Object.keys(rates).filter((code) => isValidCurrencyCode(code.toUpperCase()));
  codes.sort((left, right) => {
    if (left === DEFAULT_CURRENCY) {
      return -1;
    }
    if (right === DEFAULT_CURRENCY) {
      return 1;
    }
    return left.localeCompare(right);
  });

  return codes.reduce((result, code) => {
    const regionCode = inferRegionCode(code);
    const symbol = getCurrencySymbol(code);
    result[code] = {
      code,
      symbol,
      hasDistinctSymbol: Boolean(symbol),
      name: getCurrencyName(code),
      regionCode,
      regionName: getRegionName(regionCode),
      flag: regionToFlagEmoji(regionCode),
    };
    return result;
  }, {});
}

export function CurrencyProvider({ children }) {
  const [currency, setCurrency] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      const normalizedStored = String(stored || "").trim().toUpperCase();
      if (isValidCurrencyCode(normalizedStored)) {
        return normalizedStored;
      }
    }
    return DEFAULT_CURRENCY;
  });
  const [exchangeRates, setExchangeRates] = useState(() => ({ ...FALLBACK_EXCHANGE_RATES }));
  const [ratesLoading, setRatesLoading] = useState(false);
  const [popularCurrencies, setPopularCurrencies] = useState([]);

  const currencies = useMemo(() => buildCurrencyCatalog(exchangeRates), [exchangeRates]);
  const popularCurrencyCodes = useMemo(
    () => popularCurrencies.map((entry) => entry.currency).filter((code) => isValidCurrencyCode(code)),
    [popularCurrencies],
  );

  useEffect(() => {
    const loadCurrencyData = async () => {
      setRatesLoading(true);
      try {
        const [ratesResult, preferenceResult] = await Promise.allSettled([
          fetchExchangeRate(),
          fetchCurrencyPreference(),
        ]);

        if (ratesResult.status === "fulfilled") {
          // Works for web and desktop (desktop resolves local sidecar base URL in apiClient).
          const normalizedRates = normalizeRates(ratesResult.value?.rates || ratesResult.value);
          setExchangeRates(normalizedRates);
        }

        if (preferenceResult.status === "fulfilled") {
          const preferencePayload = preferenceResult.value?.data || {};
          const normalizedPreference = normalizeCurrencyCode(preferencePayload?.currency);
          if (normalizedPreference) {
            setCurrency(normalizedPreference);
            localStorage.setItem(STORAGE_KEY, normalizedPreference);
          }

          const normalizedPopular = normalizePopularCurrencies(preferencePayload?.popularCurrencies);
          setPopularCurrencies(normalizedPopular);
        }
      } catch (err) {
        // Keep fallback rates on network error (silent fail)
        console.debug("[CurrencyContext] Currency bootstrap failed, using fallback data", err?.message);
      } finally {
        setRatesLoading(false);
      }
    };
    void loadCurrencyData();
  }, []);

  useEffect(() => {
    if (!currencies[currency]) {
      setCurrency(DEFAULT_CURRENCY);
      localStorage.setItem(STORAGE_KEY, DEFAULT_CURRENCY);
    }
  }, [currencies, currency]);

  const setPreferredCurrency = useCallback((newCurrency) => {
    const normalized = String(newCurrency || "").trim().toUpperCase();
    if (!isValidCurrencyCode(normalized) || !Number.isFinite(exchangeRates[normalized])) {
      return;
    }
    setCurrency(normalized);
    localStorage.setItem(STORAGE_KEY, normalized);

    void updateCurrencyPreference(normalized)
      .then((response) => {
        const payload = response?.data || {};
        const persistedCurrency = normalizeCurrencyCode(payload?.currency);
        if (persistedCurrency) {
          setCurrency(persistedCurrency);
          localStorage.setItem(STORAGE_KEY, persistedCurrency);
        }

        const normalizedPopular = normalizePopularCurrencies(payload?.popularCurrencies);
        if (normalizedPopular.length > 0) {
          setPopularCurrencies(normalizedPopular);
        }
      })
      .catch((error) => {
        console.debug("[CurrencyContext] Failed to persist currency preference", error?.message || error);
      });
  }, [exchangeRates]);

  // Convert price from EUR to target currency
  const convertPrice = useCallback((priceInEur) => {
    if (!priceInEur || typeof priceInEur !== "number") {
      return 0;
    }
    const rate = exchangeRates[currency] || 1;
    return priceInEur * rate;
  }, [currency, exchangeRates]);

  // Convert from USD to target currency
  const convertFromUsd = useCallback((priceInUsd) => {
    if (!priceInUsd || typeof priceInUsd !== "number") {
      return 0;
    }
    // First convert USD to EUR, then to target.
    const eurRate = exchangeRates.USD || FALLBACK_EXCHANGE_RATES.USD;
    const priceInEur = priceInUsd / eurRate;
    const targetRate = exchangeRates[currency] || 1;
    return priceInEur * targetRate;
  }, [currency, exchangeRates]);

  const formatPrice = useCallback((price, options = {}) => {
    const {
      useUsd = false, // If true and buyPriceUsd available, use that.
      buyPriceUsd = null,
      decimals = 2,
    } = options;

    const convertedPrice = useUsd && buyPriceUsd !== null
      ? convertFromUsd(buyPriceUsd)
      : convertPrice(price);

    try {
      return new Intl.NumberFormat(getLocale(), {
        style: "currency",
        currency,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(convertedPrice);
    } catch {
      return `${currency} ${Number(convertedPrice || 0).toFixed(decimals)}`;
    }
  }, [currency, convertPrice, convertFromUsd]);

  const value = {
    currency,
    currencies,
    setCurrency: setPreferredCurrency,
    convertPrice,
    convertFromUsd,
    formatPrice,
    exchangeRates,
    ratesLoading,
    popularCurrencies,
    popularCurrencyCodes,
  };

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error("useCurrency must be used within CurrencyProvider");
  }
  return context;
}
