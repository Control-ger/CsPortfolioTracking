import { Progress } from "@packages/shared";

export const Values = () => (
  <div className="grid w-[380px] gap-4">
    <div className="grid gap-1.5"><span className="text-sm text-muted-foreground">Sync 35 %</span><Progress value={35} /></div>
    <div className="grid gap-1.5"><span className="text-sm text-muted-foreground">Import abgeschlossen</span><Progress value={100} indicatorClassName="bg-success-solid" /></div>
    <div className="grid gap-1.5"><span className="text-sm text-muted-foreground">Kaum Fortschritt</span><Progress value={8} /></div>
  </div>
);
