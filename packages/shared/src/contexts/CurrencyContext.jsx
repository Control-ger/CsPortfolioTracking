import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const CURRENCIES = {
  EUR: { symbol: '€', code: 'EUR', name: 'Euro' },
  USD: { symbol: '$', code: 'USD', name: 'US Dollar' },
  GBP: { symbol: '£', code: 'GBP', name: 'British Pound' },
};

const STORAGE_KEY = 'preferred_currency';
const DEFAULT_CURRENCY = 'EUR';

const CurrencyContext = createContext(null);

export function CurrencyProvider({ children }) {
  const [currency, setCurrency] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored && CURRENCIES[stored] ? stored : DEFAULT_CURRENCY;
    }
    return DEFAULT_CURRENCY;
  });

  const [exchangeRates, setExchangeRates] = useState({
    EUR: 1,
    USD: 1.08, // Fallback rates
    GBP: 0.85,
  });
  const [ratesLoading, setRatesLoading] = useState(false);

  // Load exchange rates on mount
  useEffect(() => {
    const loadRates = async () => {
      setRatesLoading(true);
      try {
        // Only try to fetch if not using file:// protocol (Electron on first load)
        if (typeof window !== 'undefined' && window.location.protocol !== 'file:') {
          const response = await fetch('/api/v1/exchange-rate');
          if (response.ok) {
            const data = await response.json();
            // data contains rates relative to EUR
            setExchangeRates({
              EUR: 1,
              USD: data.USD || 1.08,
              GBP: data.GBP || 0.85,
            });
          }
        }
      } catch (err) {
        // Keep fallback rates on network error (silent fail)
        console.debug('[CurrencyContext] Exchange rate fetch failed, using fallback rates', err?.message);
      } finally {
        setRatesLoading(false);
      }
    };
    loadRates();
  }, []);

  const setPreferredCurrency = useCallback((newCurrency) => {
    if (CURRENCIES[newCurrency]) {
      setCurrency(newCurrency);
      localStorage.setItem(STORAGE_KEY, newCurrency);
    }
  }, []);

  // Convert price from EUR to target currency
  const convertPrice = useCallback((priceInEur) => {
    if (!priceInEur || typeof priceInEur !== 'number') return 0;
    const rate = exchangeRates[currency] || 1;
    return priceInEur * rate;
  }, [currency, exchangeRates]);

  // Convert from USD to target currency
  const convertFromUsd = useCallback((priceInUsd) => {
    if (!priceInUsd || typeof priceInUsd !== 'number') return 0;
    // First convert USD to EUR, then to target
    const eurRate = exchangeRates.USD || 1.08;
    const priceInEur = priceInUsd / eurRate;
    const targetRate = exchangeRates[currency] || 1;
    return priceInEur * targetRate;
  }, [currency, exchangeRates]);

  const formatPrice = useCallback((price, options = {}) => {
    const { 
      useUsd = false, // If true and buyPriceUsd available, use that
      buyPriceUsd = null,
      decimals = 2 
    } = options;
    
    let convertedPrice;
    if (useUsd && buyPriceUsd !== null) {
      // User paid in USD, convert to their preferred currency
      convertedPrice = convertFromUsd(buyPriceUsd);
    } else {
      // Use EUR price
      convertedPrice = convertPrice(price);
    }
    
    const currencyInfo = CURRENCIES[currency];
    return `${currencyInfo.symbol}${convertedPrice.toFixed(decimals)}`;
  }, [currency, convertPrice, convertFromUsd]);

  const value = {
    currency,
    currencies: CURRENCIES,
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
    throw new Error('useCurrency must be used within CurrencyProvider');
  }
  return context;
}
