import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Button } from "@packages/shared";

// DialogHeader is a Dialog slot — the card shows the composition it belongs to.
export const InContext = () => (
  <Dialog open modal={false}>
    <DialogContent className="relative left-auto top-auto translate-x-0 translate-y-0">
      <DialogHeader>
        <DialogTitle>Item entfernen?</DialogTitle>
        <DialogDescription>AK-47 | Aphrodite (Factory New) aus der Watchlist entfernen?</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline">Abbrechen</Button>
        <Button variant="destructive">Ja, entfernen</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
