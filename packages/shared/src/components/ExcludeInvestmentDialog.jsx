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
  const action = isCurrentlyExcluded ? 'wieder einschliessen' : 'ausschliessen';

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-border/60">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-warning" />
            <AlertDialogTitle>
              {isCurrentlyExcluded ? 'Item wieder einschliessen?' : 'Item ausschliessen?'}
            </AlertDialogTitle>
          </div>
        </AlertDialogHeader>

        <AlertDialogDescription className="space-y-3 text-sm">
          <p>
            <strong>{itemName}</strong> wird {action}.
          </p>

          {!isCurrentlyExcluded && (
            <div className="rounded-xl border border-warning/35 bg-warning/12 p-3 text-warning">
              <p className="font-semibold">Folgen:</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>Item verschwindet aus dem Portfolio</li>
                <li>Wird nicht in Gewinn/Verlust berechnet</li>
                <li>Bleibt in der Datenbank gespeichert (nicht geloescht)</li>
                <li>Kann spaeter wieder eingeschlossen werden</li>
              </ul>
            </div>
          )}

          {isCurrentlyExcluded && (
            <div className="rounded-xl border border-info/35 bg-info/12 p-3 text-info">
              <p className="font-semibold">Das Item wird:</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>Wieder im Portfolio angezeigt</li>
                <li>Wieder in Statistiken beruecksichtigt</li>
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
                ? 'bg-info-solid text-info-foreground hover:bg-info-solid/90'
                : 'bg-warning-solid text-warning-foreground hover:bg-warning-solid/90'
            }`}
          >
            {isLoading ? 'Wird gespeichert...' : isCurrentlyExcluded ? 'Einschliessen' : 'Ausschliessen'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
