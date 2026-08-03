import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@packages/shared";

export const Confirm = () => (
  <AlertDialog open>
    <AlertDialogContent className="relative left-auto top-auto translate-x-0 translate-y-0">
      <AlertDialogHeader>
        <AlertDialogTitle>Item ausschließen?</AlertDialogTitle>
        <AlertDialogDescription>
          Recoil Case verschwindet aus dem Portfolio und wird nicht in Gewinn/Verlust berechnet. Die Daten bleiben erhalten.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
        <AlertDialogAction className="bg-warning-solid text-warning-foreground hover:bg-warning-solid/90">Ausschließen</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
