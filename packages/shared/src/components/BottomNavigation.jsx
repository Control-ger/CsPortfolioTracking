import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Home, Archive, Eye, UserRound } from "lucide-react";
import { getCurrentUser, getSession, validateSession } from "@shared/lib/auth";

const NAV_ITEMS = [
  { path: "/", label: "Portfolio", icon: Home },
  { path: "/inventory", label: "Inventar", icon: Archive },
  { path: "/watchlist", label: "Watchlist", icon: Eye },
];

function isVideoAvatarUrl(url) {
  const lower = String(url || "").toLowerCase();
  return (
    lower.endsWith(".webm") ||
    lower.endsWith(".mp4") ||
    lower.includes(".webm?") ||
    lower.includes(".mp4?")
  );
}

export const BottomNavigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const loadUser = async () => {
      const currentUser = await getCurrentUser();
      let resolvedUser = currentUser;

      if (
        !resolvedUser?.animatedAvatar &&
        !resolvedUser?.animated_avatar &&
        !resolvedUser?.avatar &&
        !resolvedUser?.steam_avatar &&
        !resolvedUser?.steamAvatar
      ) {
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
        setUser(resolvedUser);
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

  const avatarUrl =
    user?.animatedAvatar ||
    user?.animated_avatar ||
    user?.avatar ||
    user?.steam_avatar ||
    user?.steamAvatar ||
    null;
  const fallbackAvatarUrl = user?.avatar || user?.steam_avatar || user?.steamAvatar || null;
  const avatarIsVideo = isVideoAvatarUrl(avatarUrl);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.55rem,env(safe-area-inset-bottom))] md:hidden"
      aria-label="Hauptnavigation"
    >
      <div className="tr-bottom-dock mx-auto max-w-2xl rounded-[1.75rem] border border-border/65 px-2.5 py-2.5 shadow-[0_-14px_40px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 flex-1 items-center justify-around gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = isActivePath(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`flex min-w-[76px] flex-col items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-[0_10px_24px_rgba(255,255,255,0.18)]"
                      : "text-muted-foreground hover:bg-accent/80 hover:text-foreground"
                  }`}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                >
                  <item.icon className={`h-[18px] w-[18px] ${isActive ? "" : "opacity-95"}`} />
                  <span className="text-[10px]">{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="h-9 w-px bg-border/60" />

          <div className="flex items-center justify-center">
            <button
              onClick={() => navigate("/settings")}
              className={`flex min-w-[72px] flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold transition-all ${
                location.pathname === "/settings"
                  ? "bg-primary text-primary-foreground shadow-[0_10px_24px_rgba(255,255,255,0.18)]"
                  : "text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              }`}
              aria-label="Einstellungen"
              aria-current={location.pathname === "/settings" ? "page" : undefined}
            >
              {avatarUrl ? (
                avatarIsVideo ? (
                  <video
                    src={avatarUrl}
                    poster={fallbackAvatarUrl || undefined}
                    muted
                    autoPlay
                    loop
                    playsInline
                    aria-label="Steam Avatar"
                    className="h-6 w-6 rounded-full object-cover ring-1 ring-border/60"
                  />
                ) : (
                  <img
                    src={avatarUrl}
                    alt="Steam Avatar"
                    className="h-6 w-6 rounded-full object-cover ring-1 ring-border/60"
                  />
                )
              ) : (
                <UserRound className="h-[18px] w-[18px]" />
              )}
              <span className="text-[10px]">Profil</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};
