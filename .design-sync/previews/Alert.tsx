import { Alert, AlertTitle, AlertDescription } from "@packages/shared";

export const Default = () => (
  <Alert className="w-[520px]">
    <AlertTitle>Preise werden aktualisiert</AlertTitle>
    <AlertDescription>Der Cron-Lauf synchronisiert gerade 1.204 Items.</AlertDescription>
  </Alert>
);

export const Destructive = () => (
  <Alert variant="destructive" className="w-[520px]">
    <AlertTitle>API-Key ungültig</AlertTitle>
    <AlertDescription>CSFloat hat den hinterlegten Schlüssel abgelehnt (401).</AlertDescription>
  </Alert>
);
