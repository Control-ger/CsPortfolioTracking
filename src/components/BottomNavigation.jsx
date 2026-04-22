import { useLocation, useNavigate } from "react-router-dom";
import { Home, Archive, Eye, User } from "lucide-react";

const NAV_ITEMS = [
  { path: "/", label: "Übersicht", icon: Home },
  { path: "/inventory", label: "Inventar", icon: Archive },
  { path: "/watchlist", label: "Watchlist", icon: Eye },
];

export const BottomNavigation = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const isActivePath = (path) => {
    if (path === "/") {
      return location.pathname === "/";
    }
    return location.pathname === path;
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background"
      aria-label="Hauptnavigation"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8">
        <div className="flex h-20 items-center justify-between gap-2">
          <div className="flex flex-1 items-center justify-around gap-1">
            {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
              const isActive = isActivePath(path);
              return (
                <button
                  key={path}
                  onClick={() => navigate(path)}
                  className={`flex flex-col items-center justify-center gap-1 rounded-lg px-4 py-2 text-xs font-medium transition-colors ${
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-label={label}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[10px]">{label}</span>
                </button>
              );
            })}
          </div>

          {/* Trennlinie */}
          <div className="h-8 w-px bg-border" />

          {/* Settings Icon */}
          <div className="flex items-center justify-center gap-1">
            <button
              onClick={() => navigate("/settings")}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                location.pathname === "/settings"
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-label="Einstellungen"
              aria-current={location.pathname === "/settings" ? "page" : undefined}
            >
              <User className="h-5 w-5" />
              <span className="text-[10px]">User</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};


