import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Home, Archive, Eye, UserRound } from "lucide-react";
import { getCurrentUser, getSession, validateSession } from "@shared/lib/auth";

const NAV_ITEMS = [
  { path: "/", label: "Übersicht", icon: Home },
  { path: "/inventory", label: "Inventar", icon: Archive },
  { path: "/watchlist", label: "Watchlist", icon: Eye },
];

export const BottomNavigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [avatarUrl, setAvatarUrl] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const loadUser = async () => {
      const currentUser = await getCurrentUser();
      let resolvedUser = currentUser;

      if (!resolvedUser?.avatar && !resolvedUser?.steam_avatar && !resolvedUser?.steamAvatar) {
        const session = await getSession();
        if (session?.token) {
          const refreshed = await validateSession(session.token);
          if (refreshed?.success && refreshed?.user) {
            resolvedUser = { ...resolvedUser, ...refreshed.user };
            if (window.electronAPI?.storeSession) {
              await window.electronAPI.storeSession(session.token, resolvedUser);
            } else {
              sessionStorage.setItem("auth_user", JSON.stringify(resolvedUser));
            }
          }
        }
      }

      if (isMounted) {
        setAvatarUrl(resolvedUser?.avatar || resolvedUser?.steam_avatar || resolvedUser?.steamAvatar || null);
      }
    };

    void loadUser();

    return () => {
      isMounted = false;
    };
  }, []);

  const isActivePath = (path) => {
    if (path === "/") {
      return location.pathname === "/";
    }
    return location.pathname === path;
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background md:hidden"
      aria-label="Hauptnavigation"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8">
        <div className="flex h-20 items-center justify-between gap-2">
          <div className="flex flex-1 items-center justify-around gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = isActivePath(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`flex flex-col items-center justify-center gap-1 rounded-lg px-4 py-2 text-xs font-medium transition-colors ${
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="text-[10px]">{item.label}</span>
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
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Steam Avatar"
                  className="h-6 w-6 rounded-full object-cover"
                />
              ) : (
                <UserRound className="h-5 w-5" />
              )}
              <span className="text-[10px]">User</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};
