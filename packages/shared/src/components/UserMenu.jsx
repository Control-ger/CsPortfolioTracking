import { UserRound, LogOut } from "lucide-react"
import { Link, useLocation, useNavigate } from "react-router-dom"

import { Button } from "@shared/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu"
import { logout } from "@shared/lib/auth"

const NAV_ITEMS = [
  { label: "Portfolio", to: "/" },
  { label: "Einstellungen", to: "/settings" },
  { label: "Debug Panel", to: "/debug" },
]

export function UserMenu() {
  const location = useLocation()
  const navigate = useNavigate()

  const handleLogout = async () => {
    logout()
    // Reload to trigger auth check
    window.location.href = '/'
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Benutzermenue oeffnen">
          <UserRound className="h-4 w-4" />
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

