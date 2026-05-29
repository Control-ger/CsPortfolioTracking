/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { fetchExchangeRate } from "@shared/lib/apiClient.js";

const STORAGE_KEY = "preferred_currency";
const DEFAULT_CURRENCY = "EUR";
const FALLBACK_EXCHANGE_RATES = {
  EUR: 1,
  USD: 1.08,
  GBP: 0.85,
};

const CurrencyContext = createContext(null);

function isValidCurrencyCode(value) {
  return /^[A-Z]{3}$/.test(String(value || "").toUpperCase());
}

function getLocale() {
  if (typeof navigator !== "undefined" && typeof navigator.language === "string" && navigator.language.trim() !== "") {
    return navigator.language;
  }
  return "en-US";
}

function getCurrencySymbol(code) {
  try {
    const parts = new Intl.NumberFormat(getLocale(), {
      style: "currency",
      currency: code,
      currencyDisplay: "symbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).formatToParts(0);
    const symbolPart = parts.find((part) => part.type === "currency");
    return symbolPart?.value || code;
  } catch {
    return code;
  }
}

function getCurrencyName(code) {
  try {
    const displayNames = new Intl.DisplayNames([getLocale()], { type: "currency" });
    return displayNames.of(code) || code;
  } catch {
    return code;
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
    result[code] = {
      code,
      symbol: getCurrencySymbol(code),
      name: getCurrencyName(code),
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

  const currencies = useMemo(() => buildCurrencyCatalog(exchangeRates), [exchangeRates]);

  useEffect(() => {
    const loadRates = async () => {
      setRatesLoading(true);
      try {
        // Works for web and desktop (desktop resolves local sidecar base URL in apiClient).
        const data = await fetchExchangeRate();
        const normalized = normalizeRates(data?.rates || data);
        setExchangeRates(normalized);
      } catch (err) {
        // Keep fallback rates on network error (silent fail)
        console.debug("[CurrencyContext] Exchange rate fetch failed, using fallback rates", err?.message);
      } finally {
        setRatesLoading(false);
      }
    };
    void loadRates();
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
