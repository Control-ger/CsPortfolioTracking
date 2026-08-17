import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconCircleButton } from "@shared/components/ui/icon-circle-button";
import { UserRound, LogOut, Lock, AlertTriangle } from "lucide-react"

import { Callout } from "@shared/components/ui/callout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu"
import { getCurrentUser, getSession, logout, validateSession } from "@shared/lib/auth"
import {
  SESSION_HEALTH_OK,
  SESSION_HEALTH_REJECTED,
  getSessionHealth,
  subscribeSessionHealth,
} from "@shared/lib/sessionHealthBus"

function isVideoAvatarUrl(url) {
  const lower = String(url || "").toLowerCase()
  return lower.endsWith(".webm") || lower.endsWith(".mp4") || lower.includes(".webm?") || lower.includes(".mp4?")
}

export function UserMenu({
  menuSide = "bottom",
  menuAlign = "end",
  menuSideOffset = 4,
}) {
  const { t } = useTranslation("common")
  const [user, setUser] = useState(null)
  const [sessionHealth, setSessionHealth] = useState(getSessionHealth)

  useEffect(() => subscribeSessionHealth(setSessionHealth), [])

  useEffect(() => {
    let isMounted = true

    const loadUser = async () => {
      const currentUser = await getCurrentUser()
      let resolvedUser = currentUser

      if (
        !resolvedUser?.animatedAvatar &&
        !resolvedUser?.animated_avatar &&
        !resolvedUser?.avatar &&
        !resolvedUser?.steam_avatar &&
        !resolvedUser?.steamAvatar
      ) {
        const session = await getSession()
        if (session?.token) {
          const refreshed = await validateSession(session.token)
          if (refreshed?.success && refreshed?.user) {
            resolvedUser = { ...resolvedUser, ...refreshed.user }
            if (window.electronAPI?.storeSession) {
              await window.electronAPI.storeSession(session.token, resolvedUser)
            } else {
              sessionStorage.setItem("auth_user", JSON.stringify(resolvedUser))
            }
          }
        }
      }

      if (isMounted) {
        setUser(resolvedUser)
      }
    }

    void loadUser()

    return () => {
      isMounted = false
    }
  }, [])

  const handleLogout = async ({ lockVault = false } = {}) => {
    await logout()
    if (lockVault && window.electronAPI?.secrets?.lockVault) {
      try {
        await window.electronAPI.secrets.lockVault()
      } catch (error) {
        console.warn("[user-menu] vault lock after logout failed", error)
      }
    }
    const isDesktopFileRuntime =
      typeof window !== "undefined" && window.location.protocol === "file:"
    if (isDesktopFileRuntime) {
      window.location.reload()
      return
    }
    window.location.href = "/"
  }
  const avatarUrl =
    user?.animatedAvatar ||
    user?.animated_avatar ||
    user?.avatar ||
    user?.steam_avatar ||
    user?.steamAvatar ||
    null
  const fallbackAvatarUrl =
    user?.avatar ||
    user?.steam_avatar ||
    user?.steamAvatar ||
    null
  const avatarIsVideo = isVideoAvatarUrl(avatarUrl)
  const sessionUnhealthy = sessionHealth.status !== SESSION_HEALTH_OK
  const sessionBadgeLabel =
    sessionHealth.status === SESSION_HEALTH_REJECTED
      ? t("userMenu.sessionExpired")
      : t("userMenu.sessionLocalOnly")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconCircleButton
          aria-label={
            sessionUnhealthy
              ? t("userMenu.openWithWarning", { reason: sessionBadgeLabel })
              : t("userMenu.open")
          }
          title={sessionUnhealthy ? sessionBadgeLabel : undefined}
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
                aria-label={user?.name ? t("userMenu.steamAvatarOf", { name: user.name }) : t("userMenu.steamAvatar")}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <img
                src={avatarUrl}
                alt={user?.name ? t("userMenu.steamAvatarOf", { name: user.name }) : t("userMenu.steamAvatar")}
                className="h-10 w-10 rounded-full object-cover"
              />
            )
          ) : (
            <UserRound className="h-5 w-5" />
          )}

          {/* A plain coloured dot would read as "online/offline"; the warning
              glyph makes it unambiguous that something needs attention. */}
          {sessionUnhealthy && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-card bg-warn text-card">
              <AlertTriangle className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
          )}
        </IconCircleButton>
      </DropdownMenuTrigger>
      {/* Width only. The surface, radius and shadow come from the primitive,
          which is translucent *and* blurred in dark but stays opaque in light.
          Overriding it with a flat `bg-card/92` applied that translucency to
          light mode too, where there is no blur behind it — the chart below
          showed straight through the menu. */}
      <DropdownMenuContent
        side={menuSide}
        align={menuAlign}
        sideOffset={menuSideOffset}
        className="w-56"
      >
        {sessionUnhealthy && (
          <>
            <Callout
              tone="warn"
              icon={<AlertTriangle className="size-3.5" />}
              className="px-2 py-2 text-[11px] leading-snug"
            >
              {sessionBadgeLabel}
            </Callout>
            <DropdownMenuSeparator />
          </>
        )}
        {/* Says whose account this is, which is the one thing the avatar button
            cannot show on its own. The Portfolio/Einstellungen links that used
            to sit here were redundant: the desktop rail carries all seven
            destinations and the mobile bottom bar carries both of these. */}
        <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
          <span className="truncate text-[13px] font-bold text-foreground">
            {user?.name || t("userMenu.accountFallback")}
          </span>
          <span className="text-[11px] font-normal text-muted-foreground">
            {sessionUnhealthy ? t("userMenu.syncInactive") : t("userMenu.steamConnected")}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          <span>{t("userMenu.signOut")}</span>
        </DropdownMenuItem>
        {window.electronAPI?.secrets?.lockVault ? (
          <DropdownMenuItem onClick={() => void handleLogout({ lockVault: true })} className="text-destructive focus:text-destructive">
            <Lock className="mr-2 h-4 w-4" />
            <span>{t("userMenu.signOutAndLock")}</span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
