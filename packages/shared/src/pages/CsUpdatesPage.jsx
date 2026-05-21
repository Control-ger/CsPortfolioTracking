import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { CsUpdatesFeed } from "@shared/components/CsUpdatesFeed";
import { ThemeToggle } from "@shared/components/ThemeToggle";
import { UserMenu } from "@shared/components/UserMenu";
import { Button } from "@shared/components/ui/button";

export default function CsUpdatesPage() {
  const isElectronRuntime = typeof window !== "undefined" && Boolean(window.electronAPI);

  return (
    <div
      className={`${isElectronRuntime ? "min-h-full" : "min-h-screen"} bg-background px-3.5 pb-[calc(8.5rem+env(safe-area-inset-bottom))] pt-[max(0.35rem,env(safe-area-inset-top))] font-sans text-foreground sm:p-6 md:p-8 md:pb-0`}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Live Feed
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              CS Updates
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Aktuelle Counter-Strike-Updates im Fullscreen-View.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
            <Button asChild variant="outline" size="icon" className="sm:hidden">
              <Link to="/" aria-label="Zurueck zum Portfolio">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="hidden sm:inline-flex">
              <Link to="/">Zurueck zum Portfolio</Link>
            </Button>
          </div>
        </header>

        <CsUpdatesFeed />
      </div>
    </div>
  );
}

