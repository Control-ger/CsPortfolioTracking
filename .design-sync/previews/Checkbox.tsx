import { Checkbox, Label } from "@packages/shared";

export const States = () => (
  <div className="grid gap-3">
    <div className="flex items-center gap-2"><Checkbox id="a" defaultChecked /><Label htmlFor="a">Ausgewählt</Label></div>
    <div className="flex items-center gap-2"><Checkbox id="b" /><Label htmlFor="b">Nicht ausgewählt</Label></div>
    <div className="flex items-center gap-2"><Checkbox id="c" checked="indeterminate" /><Label htmlFor="c">Teilweise</Label></div>
    <div className="flex items-center gap-2"><Checkbox id="d" disabled /><Label htmlFor="d">Deaktiviert</Label></div>
  </div>
);
