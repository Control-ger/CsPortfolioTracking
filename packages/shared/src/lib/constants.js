// App-wide constants and configuration

// Breakpoints
export const BREAKPOINTS = {
  MOBILE: 768,
  TABLET: 1024,
  DESKTOP: 1280,
};

// Device detection helpers
export const isDesktop = () => window.innerWidth >= BREAKPOINTS.DESKTOP;

// UI Constants
export const UI = {
  MAX_WATCHLIST_ITEMS: 5,
  SWIPE_THRESHOLD: 50,
  TOOLTIP_DELAY: 300,
  DEBOUNCE_DELAY: 300,
  CHART_SKELETON_HEIGHT: 340,
};

// Keyboard Shortcuts
export const KEYBOARD = {
  ESCAPE: 'Escape',
  ENTER: 'Enter',
  ARROW_LEFT: 'ArrowLeft',
  ARROW_RIGHT: 'ArrowRight',
  K: 'k',
  CTRL: 'ctrlKey',
  META: 'metaKey',
};

// Tab indices for navigation
// Abbreviations with descriptions for tooltips
export const ABBREVIATIONS = {
  ROI: {
    short: 'ROI',
    full: 'Return on Investment',
    description: 'Prozentuale Rendite der Investition',
  },
  'Cash-In': {
    short: 'Cash-In',
    full: 'CSFloat Wallet',
    description: 'Kauf über CSFloat Wallet Guthaben',
  },
  Wallet: {
    short: 'Wallet',
    full: 'Steam Wallet',
    description: 'Kauf über Steam Wallet Guthaben',
  },
  API: {
    short: 'API',
    full: 'Application Programming Interface',
    description: 'Schnittstelle für Datenabfrage',
  },
  FX: {
    short: 'FX',
    full: 'Foreign Exchange',
    description: 'Währungsumrechnung',
  },
  CSFloat: {
    short: 'CSFloat',
    full: 'CSFloat Database',
    description: 'Externe Preisdatenbank',
  },
  EUR: {
    short: 'EUR',
    full: 'Euro',
    description: 'Währung: Euro',
  },
};

// Time ranges for charts
