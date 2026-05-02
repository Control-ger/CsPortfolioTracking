import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Button } from './ui/button';
import { AlertCircle } from 'lucide-react';

export function ExcludeInvestmentDialog({
  isOpen,
  onOpenChange,
  investment,
  onConfirm,
  isLoading = false
}) {
  const itemName = investment?.name || 'Item';
  const isCurrentlyExcluded = investment?.excluded || false;
  const action = isCurrentlyExcluded ? 'again einschließen' : 'ausschließen';

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-border/60">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            <AlertDialogTitle>
              {isCurrentlyExcluded ? 'Item wieder einschließen?' : 'Item ausschließen?'}
            </AlertDialogTitle>
          </div>
        </AlertDialogHeader>

        <AlertDialogDescription className="space-y-3 text-sm">
          <p>
            <strong>{itemName}</strong> wird {isCurrentlyExcluded ? 'wieder ' : ''}
            {action}.
          </p>

          {!isCurrentlyExcluded && (
            <div className="rounded-md border border-amber-200/80 bg-amber-50/80 p-3 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-200">
              <p className="font-semibold">Folgen:</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>Item verschwindet aus dem Portfolio</li>
                <li>Wird nicht in Gewinn/Verlust berechnet</li>
                <li>Bleibt in der Datenbank gespeichert (nicht gelöscht)</li>
                <li>Kann später wieder eingeschlossen werden</li>
              </ul>
            </div>
          )}

          {isCurrentlyExcluded && (
            <div className="rounded-md border border-blue-200/80 bg-blue-50/80 p-3 text-blue-900 dark:border-blue-700/60 dark:bg-blue-950/35 dark:text-blue-200">
              <p className="font-semibold">Das Item wird:</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>Wieder im Portfolio angezeigt</li>
                <li>Wieder in Statistiken berücksichtigt</li>
              </ul>
            </div>
          )}
        </AlertDialogDescription>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>
            Abbrechen
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onConfirm(!isCurrentlyExcluded)}
            disabled={isLoading}
            className={`font-semibold shadow-sm transition-all hover:scale-[1.02] ${
              isCurrentlyExcluded
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-amber-600 text-white hover:bg-amber-700"
            }`}
          >
            {isLoading ? 'Wird gespeichert...' : (isCurrentlyExcluded ? 'Einschließen' : 'Ausschließen')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

