import { Switch, Label } from "@packages/shared";

export const States = () => (
  <div className="grid gap-3">
    <div className="flex items-center gap-2"><Switch id="s1" defaultChecked /><Label htmlFor="s1">Sounds aktiv</Label></div>
    <div className="flex items-center gap-2"><Switch id="s2" /><Label htmlFor="s2">Web-Push aus</Label></div>
    <div className="flex items-center gap-2"><Switch id="s3" defaultChecked disabled /><Label htmlFor="s3">Gesperrt</Label></div>
  </div>
);
