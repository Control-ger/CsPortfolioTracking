import { Badge } from "@packages/shared";

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge>Investment</Badge>
    <Badge variant="secondary">Wallet</Badge>
    <Badge variant="outline">Skin</Badge>
    <Badge variant="destructive">Ausgeschlossen</Badge>
  </div>
);

export const StatusTones = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge variant="outline" className="border-success/35 bg-success/12 text-success">frisch</Badge>
    <Badge variant="outline" className="border-warning/35 bg-warning/12 text-warning">veraltet</Badge>
    <Badge variant="outline" className="border-info/35 bg-info/12 text-info">synchronisiert</Badge>
    <Badge variant="outline" className="border-destructive/35 bg-destructive/12 text-destructive">Fehler</Badge>
  </div>
);
