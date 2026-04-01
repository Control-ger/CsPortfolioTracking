import { Link } from "react-router-dom";

import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SettingsPage() {
  return (
    <div className="min-h-screen bg-background p-8 font-sans text-foreground">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-primary">Einstellungen</h1>
            <p className="text-muted-foreground">Platzhalter fuer zukuenftige Konfigurationsoptionen.</p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Settings Placeholder</CardTitle>
            <CardDescription>Diese Seite wird in einem spaeteren Schritt mit echten Optionen befuellt.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/">Zurueck zum Portfolio</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
