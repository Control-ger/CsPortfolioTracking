import { Alert, AlertTitle, AlertDescription } from "@packages/shared";

// AlertDescription is an Alert slot — the card shows the composition it belongs to.
export const InContext = () => (
  <Alert className="w-[520px]">
    <AlertTitle>API-Key ungültig</AlertTitle>
    <AlertDescription>CSFloat hat den hinterlegten Schlüssel abgelehnt (401).</AlertDescription>
  </Alert>
);
