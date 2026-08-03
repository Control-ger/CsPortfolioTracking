import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Button } from "@packages/shared";

export const Confirm = () => (
  <Dialog open modal={false}>
    <DialogContent className="relative left-auto top-auto translate-x-0 translate-y-0">
      <DialogHeader>
        <DialogTitle>Item entfernen?</DialogTitle>
        <DialogDescription>
          Möchtest du AK-47 | Aphrodite (Factory New) wirklich aus deiner Watchlist entfernen?
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline">Abbrechen</Button>
        <Button variant="destructive">Ja, entfernen</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export const WithForm = () => (
  <Dialog open modal={false}>
    <DialogContent className="relative left-auto top-auto translate-x-0 translate-y-0">
      <DialogHeader>
        <DialogTitle>Position bearbeiten</DialogTitle>
        <DialogDescription>Einstandspreis und Menge für Recoil Case.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Einstandspreis</span>
          <div className="h-10 rounded-md border border-input px-3 py-2 text-sm text-muted-foreground">0,20 €</div>
        </div>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Menge</span>
          <div className="h-10 rounded-md border border-input px-3 py-2 text-sm text-muted-foreground">96</div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline">Abbrechen</Button>
        <Button>Speichern</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
