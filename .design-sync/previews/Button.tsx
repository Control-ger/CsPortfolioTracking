import { Button } from "@packages/shared";

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button>Speichern</Button>
    <Button variant="secondary">Duplizieren</Button>
    <Button variant="outline">Abbrechen</Button>
    <Button variant="ghost">Details</Button>
    <Button variant="destructive">Entfernen</Button>
    <Button variant="link">Zum Inventar</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="sm">Klein</Button>
    <Button>Standard</Button>
    <Button size="lg">Groß</Button>
  </div>
);

export const Disabled = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button disabled>Speichern</Button>
    <Button variant="outline" disabled>Abbrechen</Button>
    <Button variant="destructive" disabled>Entfernen</Button>
  </div>
);
