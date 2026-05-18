/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext();
const THEME_MODE_KEY = 'theme_mode';
const LEGACY_THEME_KEY = 'theme';

function normalizeThemeMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'light' || normalized === 'dark' || normalized === 'system') {
    return normalized;
  }
  return null;
}

function readSystemPrefersDark() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveInitialThemeMode() {
  if (typeof window === 'undefined') {
    return 'system';
  }

  const savedMode = normalizeThemeMode(localStorage.getItem(THEME_MODE_KEY));
  if (savedMode) {
    return savedMode;
  }

  const legacyMode = normalizeThemeMode(localStorage.getItem(LEGACY_THEME_KEY));
  if (legacyMode === 'light' || legacyMode === 'dark') {
    return legacyMode;
  }

  return 'system';
}

export function ThemeProvider({ children }) {
  const [themeMode, setThemeModeState] = useState(resolveInitialThemeMode);
  const [systemPrefersDark, setSystemPrefersDark] = useState(readSystemPrefersDark);
  const isDark = themeMode === 'system' ? systemPrefersDark : themeMode === 'dark';

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event) => {
      setSystemPrefersDark(Boolean(event.matches));
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const html = document.documentElement;
    if (isDark) {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
    localStorage.setItem(THEME_MODE_KEY, themeMode);
    localStorage.setItem(LEGACY_THEME_KEY, isDark ? 'dark' : 'light');
  }, [isDark, themeMode]);

  const setThemeMode = (nextMode) => {
    setThemeModeState(normalizeThemeMode(nextMode) || 'system');
  };

  const toggle = () => {
    setThemeModeState((currentMode) => {
      const effectiveDark = currentMode === 'system' ? systemPrefersDark : currentMode === 'dark';
      return effectiveDark ? 'light' : 'dark';
    });
  };

  return (
    <ThemeContext.Provider
      value={{
        isDark,
        themeMode,
        setThemeMode,
        toggle,
        isSystemTheme: themeMode === 'system',
        systemPrefersDark,
        isLoaded: true,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
