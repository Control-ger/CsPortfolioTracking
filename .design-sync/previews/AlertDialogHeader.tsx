import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@packages/shared";

// AlertDialogHeader is an AlertDialog slot — the card shows the composition it belongs to.
export const InContext = () => (
  <AlertDialog open>
    <AlertDialogContent className="relative left-auto top-auto translate-x-0 translate-y-0">
      <AlertDialogHeader>
        <AlertDialogTitle>Item ausschließen?</AlertDialogTitle>
        <AlertDialogDescription>Recoil Case wird nicht mehr in Gewinn/Verlust berechnet.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
        <AlertDialogAction>Ausschließen</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
