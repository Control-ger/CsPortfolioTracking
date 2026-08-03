import { Input, Label } from "@packages/shared";

export const Default = () => (
  <div className="grid w-[380px] gap-1.5">
    <Label htmlFor="q">Suche</Label>
    <Input id="q" placeholder="Suche nach Item, Typ oder Kategorie..." />
  </div>
);

export const States = () => (
  <div className="grid w-[380px] gap-3">
    <Input defaultValue="AK-47 | Leet Museo" />
    <Input placeholder="Leer" />
    <Input disabled placeholder="Deaktiviert" />
  </div>
);
