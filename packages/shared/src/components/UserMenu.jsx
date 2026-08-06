import { useEffect, useState } from "react"
import { UserRound, LogOut, Lock, AlertTriangle } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import { Button } from "@shared/components/ui/button"
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

const NAV_ITEMS = [
  { label: "Portfolio", to: "/" },
  { label: "Einstellungen", to: "/settings" },
]

function isVideoAvatarUrl(url) {
  const lower = String(url || "").toLowerCase()
  return lower.endsWith(".webm") || lower.endsWith(".mp4") || lower.includes(".webm?") || lower.includes(".mp4?")
}

export function UserMenu({
  menuSide = "bottom",
  menuAlign = "end",
  menuSideOffset = 4,
}) {
  const location = useLocation()
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
      ? "Sitzung abgelaufen — Sync pausiert. Bitte neu anmelden."
      : "Nur lokal angemeldet — Sync inaktiv. Bitte neu anmelden."

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label={
            sessionUnhealthy
              ? `Benutzermenue oeffnen — ${sessionBadgeLabel}`
              : "Benutzermenue oeffnen"
          }
          title={sessionUnhealthy ? sessionBadgeLabel : undefined}
          className="relative h-11 w-11 rounded-full border-border/80 bg-card/75 p-0"
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
                aria-label={user?.name ? `${user.name} Steam Avatar` : "Steam Avatar"}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <img
                src={avatarUrl}
                alt={user?.name ? `${user.name} Steam Avatar` : "Steam Avatar"}
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
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={menuSide}
        align={menuAlign}
        sideOffset={menuSideOffset}
        className="w-52 rounded-2xl border-border/70 bg-card/92 p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.36)]"
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
        <DropdownMenuLabel>Navigation</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {NAV_ITEMS.map((item) => (
          <DropdownMenuItem
            key={item.to}
            asChild
            className={location.pathname === item.to ? "bg-primary/15 text-foreground" : ""}
          >
            <Link to={item.to}>{item.label}</Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          <span>Abmelden</span>
        </DropdownMenuItem>
        {window.electronAPI?.secrets?.lockVault ? (
          <DropdownMenuItem onClick={() => void handleLogout({ lockVault: true })} className="text-destructive focus:text-destructive">
            <Lock className="mr-2 h-4 w-4" />
            <span>Abmelden & sperren</span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
