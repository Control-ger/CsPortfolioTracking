import { Link } from "react-router-dom";

import { CsUpdatesFeed } from "@/components/CsUpdatesFeed";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";

export default function CsUpdatesPage() {
  return (
    <div className="min-h-screen bg-background p-4 font-sans text-foreground sm:p-6 md:p-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Live Feed
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">
              CS Updates
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Aktuelle Counter-Strike-Updates im Fullscreen-View.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
            <Button asChild variant="outline">
              <Link to="/">Zurueck zum Portfolio</Link>
            </Button>
          </div>
        </header>

        <CsUpdatesFeed />
      </div>
    </div>
  );
}


