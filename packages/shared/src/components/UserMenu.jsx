import { useEffect, useState } from "react"
import { UserRound, LogOut } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import { Button } from "@shared/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu"
import { getCurrentUser, getSession, logout, validateSession } from "@shared/lib/auth"

const NAV_ITEMS = [
  { label: "Portfolio", to: "/" },
  { label: "Einstellungen", to: "/settings" },
]

export function UserMenu() {
  const location = useLocation()
  const [user, setUser] = useState(null)

  useEffect(() => {
    let isMounted = true

    const loadUser = async () => {
      const currentUser = await getCurrentUser()
      let resolvedUser = currentUser

      if (!resolvedUser?.avatar && !resolvedUser?.steam_avatar && !resolvedUser?.steamAvatar) {
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

  const handleLogout = async () => {
    await logout()
    const isDesktopFileRuntime =
      typeof window !== "undefined" && window.location.protocol === "file:"
    if (isDesktopFileRuntime) {
      window.location.reload()
      return
    }
    window.location.href = "/"
  }
  const avatarUrl = user?.avatar || user?.steam_avatar || user?.steamAvatar || null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="Benutzermenue oeffnen"
          className="h-11 w-11 rounded-full p-0"
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={user?.name ? `${user.name} Steam Avatar` : "Steam Avatar"}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <UserRound className="h-5 w-5" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Navigation</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {NAV_ITEMS.map((item) => (
          <DropdownMenuItem
            key={item.to}
            asChild
            className={location.pathname === item.to ? "bg-accent" : ""}
          >
            <Link to={item.to}>{item.label}</Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          <span>Abmelden</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
