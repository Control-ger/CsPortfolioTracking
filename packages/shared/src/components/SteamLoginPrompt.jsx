import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { initiateSteamLogin, isAuthenticated, getCurrentUser, devModeLogin } from "../lib/auth.js";
import { useState, useEffect } from "react";

/**
 * Steam Login Prompt Component
 * 
 * Shown when user is not authenticated.
 * Provides Steam OpenID login button and CS2 inventory import flow.
 */
export function SteamLoginPrompt({ onLoginSuccess }) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);

  // Check if already logged in (e.g., after page reload)
  useEffect(() => {
    const checkAuth = async () => {
      const authenticated = await isAuthenticated();
      if (authenticated) {
        const currentUser = await getCurrentUser();
        setUser(currentUser);
        onLoginSuccess?.(currentUser);
      }
    };
    checkAuth();
  }, [onLoginSuccess]);

  const handleSteamLogin = async () => {
    setIsLoading(true);
    setError("");

    try {
      const result = await initiateSteamLogin();
      
      if (result.success) {
        setUser(result.user);
        
        // Optional: Fetch CS2 inventory and import as investments
        if (result.user?.steamId) {
          await importCS2Inventory(result.user.steamId, result.user.id);
        }
        
        onLoginSuccess?.(result.user);
      } else {
        setError(result.error || "Login failed");
      }
    } catch (err) {
      setError(err.message || "Failed to initiate Steam login");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDevModeLogin = async () => {
    setIsLoading(true);
    setError("");

    try {
      const result = await devModeLogin();
      
      if (result.success) {
        setUser(result.user);
        onLoginSuccess?.(result.user);
      } else {
        setError("Dev mode login failed");
      }
    } catch (err) {
      setError(err.message || "Failed to start dev mode");
    } finally {
      setIsLoading(false);
    }
  };

  const importCS2Inventory = async (steamId, userId) => {
    try {
      const { fetchCS2Inventory, importInventoryAsInvestments } = await import("../lib/auth.js");
      
      const inventoryResult = await fetchCS2Inventory(steamId);
      
      if (inventoryResult.success && inventoryResult.items?.length > 0) {
        // Filter for marketable items (skins, cases, etc.)
        const marketableItems = inventoryResult.items.filter(item => item.marketable);
        
        if (marketableItems.length > 0) {
          await importInventoryAsInvestments(marketableItems, userId);
          
          // Show success message or redirect
          console.log(`Imported ${marketableItems.length} CS2 items as investments`);
        }
      }
    } catch (err) {
      console.warn("Failed to import CS2 inventory:", err);
      // Don't block login if inventory import fails
    }
  };

  // If already logged in, show welcome message
  if (user) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle>Welcome, {user.name}!</CardTitle>
          <CardDescription>
            {user.isDevMode
              ? "Running in dev mode. Add items manually to your portfolio."
              : "Your Steam account is connected. Your CS2 inventory has been imported as investments."
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            {user.avatar && (
              <img
                src={user.avatar}
                alt={user.name}
                className="w-12 h-12 rounded-full"
              />
            )}
            <div>
              <p className="font-medium">{user.name}</p>
              <p className="text-sm text-muted-foreground">
                {user.isDevMode ? "Dev Mode" : `Steam ID: ${user.steamId}`}
              </p>
            </div>
          </div>
          <Button
            type="button"
            className="mt-4 w-full"
            onClick={() => onLoginSuccess?.(user)}
          >
            Dashboard öffnen
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle>Welcome to CS Investor Hub</CardTitle>
        <CardDescription>
          Connect your Steam account to track your CS2 portfolio and investments.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">
            {error}
          </div>
        )}

        <div className="text-sm text-muted-foreground space-y-2">
          <p>✓ Secure Steam OpenID authentication</p>
          <p>✓ Import your CS2 inventory automatically</p>
          <p>✓ Track prices and portfolio value</p>
          <p>✓ Local-first: Your data stays on your device</p>
        </div>

        <Button
          onClick={handleSteamLogin}
          disabled={isLoading}
          className="w-full bg-[#1b2838] hover:bg-[#2a475e] text-white"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Connecting to Steam...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.72 1.97 4.52 5.15 4.52 8.66 0 2.36-.76 4.54-2.07 6.33l-1.55-1.04z" />
              </svg>
              Sign in with Steam
            </span>
          )}
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">Or</span>
          </div>
        </div>

        <Button
          onClick={handleDevModeLogin}
          disabled={isLoading}
          variant="outline"
          className="w-full"
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
            Continue in Dev Mode (no server)
          </span>
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          By signing in, you agree to our Terms of Service and Privacy Policy.
          <br />
          We only access your public Steam profile and CS2 inventory.
        </p>
      </CardContent>
    </Card>
  );
}
