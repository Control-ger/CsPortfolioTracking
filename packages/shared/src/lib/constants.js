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
/**
 * `short` and `full` are acronyms and their expansions — the same in every
 * language — so only the description carries a key.
 */
export const ABBREVIATIONS = {
  ROI: {
    short: 'ROI',
    full: 'Return on Investment',
    descriptionKey: 'common:abbreviations.roi',
  },
  'Cash-In': {
    short: 'Cash-In',
    full: 'CSFloat Wallet',
    descriptionKey: 'common:abbreviations.cashIn',
  },
  Wallet: {
    short: 'Wallet',
    full: 'Steam Wallet',
    descriptionKey: 'common:abbreviations.wallet',
  },
  API: {
    short: 'API',
    full: 'Application Programming Interface',
    descriptionKey: 'common:abbreviations.api',
  },
  FX: {
    short: 'FX',
    full: 'Foreign Exchange',
    descriptionKey: 'common:abbreviations.fx',
  },
  CSFloat: {
    short: 'CSFloat',
    full: 'CSFloat Database',
    descriptionKey: 'common:abbreviations.csfloat',
  },
  EUR: {
    short: 'EUR',
    full: 'Euro',
    descriptionKey: 'common:abbreviations.eur',
  },
};

// Time ranges for charts
