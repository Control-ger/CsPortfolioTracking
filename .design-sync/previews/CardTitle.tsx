import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Button } from "@packages/shared";

// CardTitle is a Card slot — the card shows the composition it belongs to.
export const InContext = () => (
  <Card className="w-[380px]">
    <CardHeader>
      <CardTitle>AK-47 | Leet Museo</CardTitle>
      <CardDescription>Minimal Wear · 1 Position</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-semibold tabular-nums">213,23 €</div>
      <p className="mt-1 text-sm text-destructive tabular-nums">-11,19 %</p>
    </CardContent>
    <CardFooter className="justify-end"><Button size="sm" variant="outline">Details</Button></CardFooter>
  </Card>
);
