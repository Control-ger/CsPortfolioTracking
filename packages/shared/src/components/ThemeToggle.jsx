import { useTheme } from '../ThemeContext';

export function ThemeToggle() {
  const { isDark, toggle, themeMode } = useTheme();
  const title =
    themeMode === 'system'
      ? `Systemmodus aktiv (${isDark ? 'dunkel' : 'hell'}) - klicken zum Ueberschreiben`
      : isDark
        ? 'Helles Design aktivieren'
        : 'Dunkles Design aktivieren';

  return (
    <button
      onClick={toggle}
      className="relative rounded-xl border border-border/80 bg-card/75 p-2.5 text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground"
      aria-label="Farbmodus umschalten"
      title={title}
    >
      {isDark ? (
        // Sun icon for light mode
        <svg
          className="w-5 h-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        // Moon icon for dark mode
        <svg
          className="w-5 h-5"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
      {themeMode === 'system' ? (
        <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[8px] font-semibold leading-none text-primary-foreground">
          A
        </span>
      ) : null}
    </button>
  );
}
