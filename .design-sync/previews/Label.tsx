import { Label, Input, Checkbox, Switch } from "@packages/shared";

export const WithControls = () => (
  <div className="grid w-[380px] gap-4">
    <div className="grid gap-1.5">
      <Label htmlFor="key">CSFloat API-Key</Label>
      <Input id="key" placeholder="Schlüssel einfügen..." />
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="excl" defaultChecked />
      <Label htmlFor="excl">Ausgeschlossene Positionen anzeigen</Label>
    </div>
    <div className="flex items-center gap-2">
      <Switch id="snd" defaultChecked />
      <Label htmlFor="snd">Sounds aktiviert</Label>
    </div>
  </div>
);
